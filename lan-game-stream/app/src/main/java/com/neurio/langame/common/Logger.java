package com.neurio.langame.common;

import android.util.Log;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Tiny in-app log that mirrors to logcat and keeps a bounded ring buffer so the
 * Performance screen can show what actually happened during a session.
 */
public final class Logger {

    private static final String TAG = "LanGame";
    private static final int CAPACITY = 400;

    public interface Sink {
        void onLogLine(String line);
    }

    private static final ArrayDeque<String> RING = new ArrayDeque<>(CAPACITY);
    private static final List<Sink> SINKS = new ArrayList<>(2);
    private static final Object LOCK = new Object();
    private static final long START = System.currentTimeMillis();

    private Logger() {
    }

    public static void i(String tag, String message) {
        Log.i(TAG, "[" + tag + "] " + message);
        append("I", tag, message);
    }

    public static void w(String tag, String message) {
        Log.w(TAG, "[" + tag + "] " + message);
        append("W", tag, message);
    }

    public static void e(String tag, String message) {
        Log.e(TAG, "[" + tag + "] " + message);
        append("E", tag, message);
    }

    public static void e(String tag, String message, Throwable error) {
        Log.e(TAG, "[" + tag + "] " + message, error);
        append("E", tag, message + " ← " + error.getClass().getSimpleName()
                + (error.getMessage() == null ? "" : ": " + error.getMessage()));
    }

    private static void append(String level, String tag, String message) {
        long t = System.currentTimeMillis() - START;
        String line = String.format(Locale.US, "%6.1fs %s/%-14s %s", t / 1000f, level, tag, message);
        synchronized (LOCK) {
            if (RING.size() >= CAPACITY) {
                RING.removeFirst();
            }
            RING.addLast(line);
            for (int i = 0; i < SINKS.size(); i++) {
                SINKS.get(i).onLogLine(line);
            }
        }
    }

    public static List<String> tail(int count) {
        synchronized (LOCK) {
            List<String> all = new ArrayList<>(RING);
            int from = Math.max(0, all.size() - count);
            return new ArrayList<>(all.subList(from, all.size()));
        }
    }

    public static String dump() {
        StringBuilder sb = new StringBuilder();
        for (String line : tail(CAPACITY)) {
            sb.append(line).append('\n');
        }
        return sb.toString();
    }

    public static void addSink(Sink sink) {
        synchronized (LOCK) {
            if (!SINKS.contains(sink)) {
                SINKS.add(sink);
            }
        }
    }

    public static void removeSink(Sink sink) {
        synchronized (LOCK) {
            SINKS.remove(sink);
        }
    }
}
