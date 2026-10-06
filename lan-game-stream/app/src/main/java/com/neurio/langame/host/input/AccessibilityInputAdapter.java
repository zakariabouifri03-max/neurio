package com.neurio.langame.host.input;

import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.graphics.Path;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.neurio.langame.common.Logger;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Input injection through {@link android.accessibilityservice.AccessibilityService#dispatchGesture}.
 *
 * <p><b>How a held joystick is expressed as gestures.</b> The platform gesture API
 * is stroke based: a stroke may be started with {@code willContinue = true} and
 * then extended with {@link GestureDescription.StrokeDescription#continueStroke}.
 * This adapter keeps one live stroke per logical pointer and refreshes every
 * active stroke inside a <i>single</i> {@link GestureDescription} per tick, which
 * is the only way multi-touch stays coherent (dispatching independent gestures
 * concurrently would cancel each other).</p>
 *
 * <p><b>Honest limitations</b> (see docs/INPUT_INJECTION.md):</p>
 * <ul>
 *   <li>Granularity is the tick (~24 ms), so it is not a raw digitizer stream.
 *       Frame-sampled games cope well; anything expecting low-level touch
 *       sampling feels coarser.</li>
 *   <li>Secure windows ({@code FLAG_SECURE}) and some anti-cheat SDKs drop injected
 *       gestures. Then the video keeps running and the game ignores the input — the
 *       app reports that instead of pretending.</li>
 *   <li>Discrete keys (D-pad, shoulders) are injected as touches on the on-screen
 *       zones the player laid out, which is how a physical controller is used with
 *       a mobile game anyway.</li>
 * </ul>
 */
public final class AccessibilityInputAdapter implements GameInputAdapter {

    private static final String TAG = "A11yAdapter";

    /** Refresh interval for held strokes. Lower = smoother, more platform work. */
    private static final long TICK_MS = 24;
    /** Duration granted to every stroke chunk (a little longer than the tick). */
    private static final long CHUNK_MS = TICK_MS + 8;

    private final HandlerThread thread;
    private final Handler handler;
    private final Map<Integer, Pointer> pointers = new HashMap<>(4);
    private final List<GestureDescription.StrokeDescription> pendingStrokes = new ArrayList<>(4);

    private volatile String status = "not prepared";
    private volatile boolean prepared;
    private long dispatchCount;
    private long failedDispatches;
    private volatile float averageDispatchMs;
    private boolean tickScheduled;

    private static final class Pointer {
        float x;
        float y;
        float lastX;
        float lastY;
        boolean down;
        boolean lifting;
        GestureDescription.StrokeDescription stroke;   // null until the first chunk
        long lastTickMs;
    }

    public AccessibilityInputAdapter() {
        thread = new HandlerThread("lgs-a11y-input",
                android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY);
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    @Override
    public String id() {
        return "accessibility";
    }

    @Override
    public String describe() {
        return "System gesture injection (stock Android, works in normal games)";
    }

    @Override
    public boolean isAvailable(Context context) {
        return NeurioAccessibilityService.isConnected();
    }

    @Override
    public boolean prepare(Context context) {
        if (!isAvailable(context)) {
            status = "Enable “LAN Game remote input” in Settings → Accessibility";
            prepared = false;
            return false;
        }
        status = "Active · gesture injection, " + TICK_MS + " ms granularity";
        prepared = true;
        Logger.i(TAG, "Accessibility adapter armed");
        return true;
    }

    @Override
    public String status() {
        return status;
    }

    /** Discrete key injection is not possible without root — see the class docs. */
    public boolean supportsKeys() {
        return false;
    }

    /* ------------------------------------------------------------------ *
     *  Pointer API
     * ------------------------------------------------------------------ */

    @Override
    public void pointerDown(int pointerId, float x, float y) {
        if (!prepared) {
            return;
        }
        handler.post(() -> {
            Pointer pointer;
            synchronized (pointers) {
                pointer = pointers.get(pointerId);
                if (pointer == null) {
                    pointer = new Pointer();
                    pointers.put(pointerId, pointer);
                }
                pointer.x = x;
                pointer.y = y;
                pointer.lastX = x;
                pointer.lastY = y;
                pointer.down = true;
                pointer.lifting = false;
            }
            dispatchAll(false);
        });
    }

    @Override
    public void pointerMove(int pointerId, float x, float y) {
        synchronized (pointers) {
            Pointer pointer = pointers.get(pointerId);
            if (pointer != null) {
                pointer.x = x;
                pointer.y = y;
            }
        }
        // The ticker picks the new position up; no need to dispatch immediately.
        scheduleTick();
    }

    @Override
    public void pointerUp(int pointerId, float x, float y) {
        if (!prepared) {
            return;
        }
        handler.post(() -> {
            synchronized (pointers) {
                Pointer pointer = pointers.get(pointerId);
                if (pointer == null) {
                    return;
                }
                pointer.x = x;
                pointer.y = y;
                if (pointer.stroke == null) {
                    // A tap shorter than one tick: express it as a single short stroke.
                    pointers.remove(pointerId);
                    dispatchTap(x, y);
                    return;
                }
                pointer.lifting = true;
            }
            dispatchAll(false);
        });
    }

    @Override
    public void key(int keyCode, boolean pressed) {
        if (pressed) {
            Logger.w(TAG, "Key " + keyCode + " cannot be injected without root; map it to a "
                    + "controller touch zone instead");
        }
    }

    /* ------------------------------------------------------------------ *
     *  Dispatch engine
     * ------------------------------------------------------------------ */

    private void scheduleTick() {
        if (tickScheduled || !prepared) {
            return;
        }
        tickScheduled = true;
        handler.postDelayed(() -> {
            tickScheduled = false;
            dispatchAll(true);
        }, TICK_MS);
    }

    /**
     * Builds one gesture containing every pointer that is currently down:
     * brand new strokes, continuations, and the final continuation that lifts a
     * finger.
     */
    private void dispatchAll(boolean fromTick) {
        if (!prepared) {
            return;
        }
        long now = SystemClock.uptimeMillis();
        GestureDescription.Builder builder = new GestureDescription.Builder();
        pendingStrokes.clear();

        synchronized (pointers) {
            if (pointers.isEmpty()) {
                return;
            }
            boolean any = false;

            for (Map.Entry<Integer, Pointer> entry : pointers.entrySet()) {
                Pointer pointer = entry.getValue();
                if (!pointer.down && !pointer.lifting) {
                    continue;
                }
                if (fromTick && pointer.stroke != null && !pointer.lifting
                        && now - pointer.lastTickMs < TICK_MS) {
                    pendingStrokes.add(pointer.stroke);   // unchanged, keep it alive
                    continue;
                }

                Path path = new Path();
                if (pointer.stroke == null) {
                    path.moveTo(pointer.x, pointer.y);
                    path.lineTo(pointer.x + 0.01f, pointer.y);
                    GestureDescription.StrokeDescription stroke =
                            new GestureDescription.StrokeDescription(path, 0, CHUNK_MS,
                                    !pointer.lifting);
                    builder.addStroke(stroke);
                    pointer.stroke = pointer.lifting ? null : stroke;
                    pointer.lastX = pointer.x;
                    pointer.lastY = pointer.y;
                } else {
                    path.moveTo(pointer.lastX, pointer.lastY);
                    path.lineTo(pointer.x + 0.01f, pointer.y);
                    GestureDescription.StrokeDescription continued = pointer.stroke.continueStroke(
                            path, 0, CHUNK_MS, !pointer.lifting);
                    builder.addStroke(continued);
                    pointer.stroke = pointer.lifting ? null : continued;
                    pointer.lastX = pointer.x;
                    pointer.lastY = pointer.y;
                }
                pointer.lastTickMs = now;
                any = true;
                if (pointer.lifting) {
                    pointer.down = false;
                    pointer.lifting = false;
                }
            }
            if (!any) {
                return;
            }
        }

        if (!dispatch(builder.build())) {
            // The platform refused the gesture (secure window, service gone, …).
            synchronized (pointers) {
                for (Pointer pointer : pointers.values()) {
                    pointer.stroke = null;
                }
            }
            return;
        }
        synchronized (pointers) {
            // Drop pointers that finished lifting.
            pointers.entrySet().removeIf(e -> !e.getValue().down && e.getValue().stroke == null);
        }
        scheduleTick();
    }

    private void dispatchTap(float x, float y) {
        Path path = new Path();
        path.moveTo(x, y);
        path.lineTo(x + 0.02f, y);
        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, 32, false);
        dispatch(new GestureDescription.Builder().addStroke(stroke).build());
    }

    private boolean dispatch(GestureDescription description) {
        NeurioAccessibilityService service = NeurioAccessibilityService.get();
        if (service == null) {
            status = "Accessibility service disconnected";
            return false;
        }
        long start = System.nanoTime();
        boolean ok = service.dispatch(description, null, handler);
        float elapsedMs = (System.nanoTime() - start) / 1_000_000f;
        dispatchCount++;
        if (!ok) {
            failedDispatches++;
        }
        averageDispatchMs = averageDispatchMs * 0.9f + elapsedMs * 0.1f;
        if (failedDispatches > 20 && failedDispatches % 20 == 0) {
            status = "Gestures rejected (" + failedDispatches
                    + "×) — the game may block injected input";
        }
        return ok;
    }

    @Override
    public void release() {
        prepared = false;
        try {
            synchronized (pointers) {
                for (Pointer pointer : pointers.values()) {
                    if (pointer.stroke != null && pointer.down) {
                        Path path = new Path();
                        path.moveTo(pointer.lastX, pointer.lastY);
                        path.lineTo(pointer.x + 0.01f, pointer.y);
                        GestureDescription.StrokeDescription end =
                                pointer.stroke.continueStroke(path, 0, 16, false);
                        dispatch(new GestureDescription.Builder().addStroke(end).build());
                    }
                }
                pointers.clear();
            }
        } catch (Exception e) {
            Logger.w(TAG, "release cleanup failed: " + e.getMessage());
        }
        try {
            thread.quitSafely();
        } catch (Exception ignored) {
        }
        Logger.i(TAG, "Accessibility adapter released after " + dispatchCount
                + " dispatches (" + failedDispatches + " rejected)");
    }

    public float averageDispatchMs() {
        return averageDispatchMs;
    }

    public long dispatchCount() {
        return dispatchCount;
    }

    public long failedDispatches() {
        return failedDispatches;
    }
}
