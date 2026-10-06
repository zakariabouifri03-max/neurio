package com.neurio.langame.host;

import android.content.Context;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Display;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Utils;
import com.neurio.langame.host.input.GameInputAdapter;
import com.neurio.langame.network.InputTransport;

import java.io.Closeable;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Turns the client's input datagrams into real input on the host.
 *
 * <p>Pipeline:</p>
 * <pre>
 *   InputTransport.Receiver → InputReceiver (map coordinates, measure latency)
 *                           → GameInputAdapter (accessibility / root)
 *                           → game
 * </pre>
 *
 * <p>Coordinates arrive <b>normalised</b> (0..1 of the streamed frame), so the
 * host resolves them against the display size <i>at dispatch time</i>. That keeps
 * portrait ↔ landscape transitions correct without any extra negotiation.</p>
 */
public final class InputReceiver implements InputTransport.Receiver.Listener, Closeable {

    private static final String TAG = "InputReceiver";

    public interface Listener {
        /** Periodic health report for the host UI. */
        void onInputStats(float latencyMs, long applied, long dropped, String adapterStatus);

        /** No adapter could be prepared — the session continues video-only. */
        void onInputUnavailable(String reason);
    }

    private final Context context;
    private final GameInputAdapter adapter;
    private final Listener listener;
    private final InputTransport.Receiver transport;
    private final Map<Integer, Long> pointerDownAtMs = new HashMap<>(4);

    private volatile long eventsApplied;
    private volatile long eventsDropped;
    private volatile float averageLatencyMs;
    private volatile long lastEventAtMs = System.currentTimeMillis();
    private volatile long lastStatsAtMs;
    private Thread watchdog;
    private volatile boolean running = true;

    public InputReceiver(Context context, GameInputAdapter adapter, int sessionTag,
                         Listener listener) throws IOException {
        this.context = context.getApplicationContext();
        this.adapter = adapter;
        this.listener = listener;
        this.transport = new InputTransport.Receiver(sessionTag);
        this.transport.setListener(this);
    }

    public void start() {
        transport.start();
        watchdog = Utils.startThread("lgs-input-watchdog", Thread.NORM_PRIORITY, () -> {
            while (running) {
                Utils.sleepQuietly(500);
                long now = System.currentTimeMillis();
                if (now - lastStatsAtMs > 1000) {
                    lastStatsAtMs = now;
                    if (listener != null) {
                        listener.onInputStats(averageLatencyMs, eventsApplied, eventsDropped,
                                adapter == null ? "no adapter" : adapter.status());
                    }
                }
                // Safety net: never leave a finger glued to the screen if the client
                // vanishes mid-press (server crash, Wi-Fi drop, battery pull).
                if (adapter != null && now - lastEventAtMs > 8000) {
                    synchronized (pointerDownAtMs) {
                        if (!pointerDownAtMs.isEmpty()) {
                            Logger.w(TAG, "Releasing stuck pointer(s) — client went quiet");
                            for (Integer id : pointerDownAtMs.keySet()) {
                                adapter.pointerUp(id, 0f, 0f);
                            }
                            pointerDownAtMs.clear();
                        }
                    }
                }
            }
        });
    }

    @Override
    public void onEvent(int type, int pointerId, int code, float x, float y, long eventHostTimeMs) {
        lastEventAtMs = System.currentTimeMillis();
        if (adapter == null) {
            eventsDropped++;
            return;
        }
        long hostNow = SystemClock.uptimeMillis();
        long eventTime = reconstructHostTime(eventHostTimeMs);
        long latency = hostNow - eventTime;
        if (latency >= 0 && latency < 600) {
            averageLatencyMs = averageLatencyMs * 0.85f + latency * 0.15f;
        }

        switch (type) {
            case Protocol.INPUT_DOWN: {
                float[] pixels = toDisplayPixels(x, y);
                synchronized (pointerDownAtMs) {
                    pointerDownAtMs.put(pointerId, hostNow);
                }
                adapter.pointerDown(pointerId, pixels[0], pixels[1]);
                eventsApplied++;
                break;
            }
            case Protocol.INPUT_MOVE: {
                float[] pixels = toDisplayPixels(x, y);
                adapter.pointerMove(pointerId, pixels[0], pixels[1]);
                eventsApplied++;
                break;
            }
            case Protocol.INPUT_UP: {
                float[] pixels = toDisplayPixels(x, y);
                synchronized (pointerDownAtMs) {
                    pointerDownAtMs.remove(pointerId);
                }
                adapter.pointerUp(pointerId, pixels[0], pixels[1]);
                eventsApplied++;
                break;
            }
            case Protocol.INPUT_KEY_DOWN:
                adapter.key(code, true);
                eventsApplied++;
                break;
            case Protocol.INPUT_KEY_UP:
                adapter.key(code, false);
                eventsApplied++;
                break;
            case Protocol.INPUT_AXIS:
            case Protocol.INPUT_SWIPE_SEQUENCE:
            default:
                eventsDropped++;
                break;
        }
    }

    /**
     * The client stamps events with its estimate of <i>our</i> uptime clock
     * (established during the handshake). Only the low 32 bits travel, so rebuild
     * the full value around our current uptime.
     */
    private static long reconstructHostTime(long lowBits) {
        long now = SystemClock.uptimeMillis();
        long candidate = (now & ~0xFFFFFFFFL) | (lowBits & 0xFFFFFFFFL);
        if (candidate > now + 0x8000_0000L) {
            candidate -= 0x1_0000_0000L;
        } else if (candidate < now - 0x8000_0000L) {
            candidate += 0x1_0000_0000L;
        }
        return candidate;
    }

    /** Normalised (0..1) stream coordinates → display pixels. */
    private float[] toDisplayPixels(float normalizedX, float normalizedY) {
        int[] size = displaySize();
        float x = Utils.clamp(normalizedX, 0f, 1f) * size[0];
        float y = Utils.clamp(normalizedY, 0f, 1f) * size[1];
        return new float[]{x, y};
    }

    /** Logical display size in the current rotation (falls back to app metrics). */
    private int[] displaySize() {
        try {
            DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
            Display display = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (display != null) {
                Point size = new Point();
                display.getRealSize(size);
                if (size.x > 0 && size.y > 0) {
                    return new int[]{size.x, size.y};
                }
            }
        } catch (Exception e) {
            Logger.w(TAG, "Display size lookup failed: " + e.getMessage());
        }
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return new int[]{metrics.widthPixels, metrics.heightPixels};
    }

    public float averageLatencyMs() {
        return averageLatencyMs;
    }

    public long eventsApplied() {
        return eventsApplied;
    }

    public GameInputAdapter adapter() {
        return adapter;
    }

    public InputTransport.Receiver transport() {
        return transport;
    }

    @Override
    public void close() {
        running = false;
        transport.close();
        if (adapter != null) {
            adapter.release();
        }
        Logger.i(TAG, "Input receiver closed (" + eventsApplied + " events applied, avg "
                + Math.round(averageLatencyMs) + " ms)");
    }
}
