package com.neurio.langame.host.input;

import android.content.Context;

import com.neurio.langame.common.Logger;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Input injection through a rooted shell ({@code su -c input ...}).
 *
 * <p>This exists for rooted hosts and for developers driving the host from an
 * {@code adb shell} daemon. It is honest about what it is: every event spawns a
 * process, which costs tens to hundreds of milliseconds. That makes it usable for
 * menus, D-pad navigation and turn-based games — <b>not</b> for analogue sticks in
 * a football game. On a non-rooted phone the adapter simply reports "unavailable"
 * and the engine falls back to the accessibility adapter.</p>
 *
 * <p>The low-latency rooted route (writing raw events to {@code /dev/input/event*})
 * is deliberately left as a documented future extension: it needs a per-device
 * protocol table and a privileged helper, and shipping a half-working version
 * would be worse than shipping none.</p>
 */
public final class RootShellInputAdapter implements GameInputAdapter {

    private static final String TAG = "RootAdapter";

    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "lgs-root-input");
        thread.setDaemon(true);
        return thread;
    });

    private final AtomicBoolean available = new AtomicBoolean();
    private final AtomicInteger commands = new AtomicInteger();
    private volatile String status = "not prepared";
    private volatile float averageLatencyMs;

    private float downX;
    private float downY;
    private long downAtMs;
    private boolean touching;

    @Override
    public String id() {
        return "root-shell";
    }

    @Override
    public String describe() {
        return "Rooted `input` shell — taps/D-pad only, high latency";
    }

    @Override
    public boolean isAvailable(Context context) {
        return available.get();
    }

    @Override
    public boolean prepare(Context context) {
        try {
            Process process = new ProcessBuilder("su", "-c", "id").redirectErrorStream(true).start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line = reader.readLine();
            process.waitFor();
            boolean rooted = line != null && line.contains("uid=0");
            available.set(rooted);
            status = rooted ? "Active · rooted shell (high latency)" : "No root access";
            Logger.i(TAG, "Root probe: " + line + " → " + rooted);
            return rooted;
        } catch (Exception e) {
            available.set(false);
            status = "Root unavailable: " + e.getClass().getSimpleName();
            Logger.w(TAG, "Root probe failed: " + e.getMessage());
            return false;
        }
    }

    @Override
    public String status() {
        return status;
    }

    public boolean supportsKeys() {
        return true;
    }

    @Override
    public void pointerDown(int pointerId, float x, float y) {
        if (pointerId != 0) {
            return;   // the shell input command is single touch
        }
        downX = x;
        downY = y;
        downAtMs = System.currentTimeMillis();
        touching = true;
    }

    @Override
    public void pointerMove(int pointerId, float x, float y) {
        // Swipe gestures are synthesised on lift; nothing to do here.
    }

    @Override
    public void pointerUp(int pointerId, float x, float y) {
        if (!touching || pointerId != 0) {
            return;
        }
        touching = false;
        float dx = Math.abs(x - downX);
        float dy = Math.abs(y - downY);
        long durationMs = Math.max(1, System.currentTimeMillis() - downAtMs);
        int startX = Math.round(downX);
        int startY = Math.round(downY);
        int endX = Math.round(x);
        int endY = Math.round(y);
        boolean tap = dx < 12 && dy < 12 && durationMs < 260;
        if (tap) {
            run("input tap " + endX + " " + endY);
        } else {
            run("input swipe " + startX + " " + startY + " " + endX + " " + endY + " "
                    + (int) Math.min(2000, durationMs));
        }
    }

    @Override
    public void key(int keyCode, boolean pressed) {
        if (!pressed) {
            return;   // keyevent is a complete press+release
        }
        run("input keyevent " + keyCode);
    }

    private void run(String command) {
        worker.execute(() -> {
            long start = System.nanoTime();
            try {
                Process process = new ProcessBuilder("su", "-c", command)
                        .redirectErrorStream(true).start();
                process.waitFor();
                float elapsedMs = (System.nanoTime() - start) / 1_000_000f;
                averageLatencyMs = averageLatencyMs * 0.8f + elapsedMs * 0.2f;
                commands.incrementAndGet();
            } catch (Exception e) {
                Logger.w(TAG, "Command failed: " + command + " → " + e.getMessage());
            }
        });
    }

    public float averageLatencyMs() {
        return averageLatencyMs;
    }

    public int commandCount() {
        return commands.get();
    }

    @Override
    public void release() {
        touching = false;
        worker.shutdownNow();
        Logger.i(TAG, "Root adapter released after " + commands.get() + " commands");
    }
}
