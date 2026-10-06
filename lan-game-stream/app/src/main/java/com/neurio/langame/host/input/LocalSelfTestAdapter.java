package com.neurio.langame.host.input;

import android.content.Context;
import android.os.SystemClock;

import com.neurio.langame.common.Logger;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * Adapter used to verify the input pipeline <b>without</b> touching another app.
 *
 * <p>It injects nothing. Every event that arrives is timestamped and kept in a small
 * ring buffer (also written to the session log), so a developer can confirm that a
 * tap on the client really travelled: client widget → protocol → UDP → host
 * receiver → adapter. Treating this as a real controller would be dishonest, and
 * the UI says so wherever the mode is selectable.</p>
 */
public final class LocalSelfTestAdapter implements GameInputAdapter {

    private static final String TAG = "SelfTestAdapter";
    private static final int HISTORY = 32;

    private static final Deque<String> HISTORY_LINES = new ArrayDeque<>();
    private static volatile long events;
    private static final long STARTED_AT_MS = SystemClock.uptimeMillis();

    private long lastLogAtMs;

    @Override
    public String id() {
        return "selftest";
    }

    @Override
    public String describe() {
        return "Local self-test — events are recorded in this app, never injected";
    }

    @Override
    public boolean isAvailable(Context context) {
        return true;   // it needs no permission precisely because it injects nothing
    }

    @Override
    public boolean prepare(Context context) {
        Logger.i(TAG, "Self-test adapter ready — no injection will happen");
        record("self-test started");
        return true;
    }

    @Override
    public String status() {
        return String.format(Locale.US, "self-test · %d events recorded", events);
    }

    @Override
    public void pointerDown(int pointerId, float x, float y) {
        record(String.format(Locale.US, "DOWN p%d @ (%.3f, %.3f)", pointerId, x, y));
        events++;
        throttleLog();
    }

    @Override
    public void pointerMove(int pointerId, float x, float y) {
        events++;
        // Moves are far too frequent for the log; keep a counter only.
        if (SystemClock.uptimeMillis() - lastLogAtMs > 1000) {
            record(String.format(Locale.US, "MOVE p%d @ (%.3f, %.3f)", pointerId, x, y));
            throttleLog();
        }
    }

    @Override
    public void pointerUp(int pointerId, float x, float y) {
        record(String.format(Locale.US, "UP   p%d @ (%.3f, %.3f)", pointerId, x, y));
        events++;
        throttleLog();
    }

    @Override
    public void key(int keyCode, boolean pressed) {
        record("KEY " + (pressed ? "down" : "up") + " code=" + keyCode);
        events++;
        throttleLog();
    }

    @Override
    public void release() {
        record(String.format(Locale.US, "self-test released after %d events", events));
        Logger.i(TAG, "Self-test adapter released after " + events + " events");
    }

    /* ------------------------------------------------------------------ */

    private void throttleLog() {
        long now = SystemClock.uptimeMillis();
        if (now - lastLogAtMs >= 500) {
            lastLogAtMs = now;
            Logger.i(TAG, status() + " · uptime " + (now - STARTED_AT_MS) + " ms");
        }
    }

    private static synchronized void record(String line) {
        HISTORY_LINES.addLast(line);
        while (HISTORY_LINES.size() > HISTORY) {
            HISTORY_LINES.removeFirst();
        }
    }

    /** Newest-last copy of the recorded events (used by the host UI / log). */
    public static synchronized List<String> recent() {
        return new ArrayList<>(HISTORY_LINES);
    }

    public static long recordedEvents() {
        return events;
    }
}
