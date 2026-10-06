package com.neurio.vm.util;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * App-wide logger that also keeps a ring buffer of the last {@value #MAX_LINES}
 * lines so the hypervisor console and the VM terminal can show what happened
 * without needing logcat.
 */
public final class Log {

    public static final int MAX_LINES = 2000;
    private static final String PREFIX = "NeurioVM";

    public interface Listener {
        void onLogLine(Line line);
    }

    /** One immutable log record. */
    public static final class Line {
        public final long when;
        public final String level;
        public final String tag;
        public final String text;

        Line(long when, String level, String tag, String text) {
            this.when = when;
            this.level = level;
            this.tag = tag;
            this.text = text;
        }

        private static final SimpleDateFormat FMT =
                new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);

        @Override public String toString() {
            return FMT.format(new Date(when)) + " " + level + "/" + tag + ": " + text;
        }
    }

    private static final List<Line> BUFFER = new ArrayList<>();
    private static final List<Listener> LISTENERS = new ArrayList<>();

    private Log() {}

    public static void d(String tag, String msg) { emit("D", tag, msg); }
    public static void i(String tag, String msg) { emit("I", tag, msg); }
    public static void w(String tag, String msg) { emit("W", tag, msg); }
    public static void e(String tag, String msg) { emit("E", tag, msg); }

    public static void e(String tag, String msg, Throwable t) {
        emit("E", tag, msg + " — " + t.getClass().getSimpleName() + ": " + t.getMessage());
    }

    private static synchronized void emit(String level, String tag, String msg) {
        switch (level) {
            case "E": android.util.Log.e(PREFIX, "[" + tag + "] " + msg); break;
            case "W": android.util.Log.w(PREFIX, "[" + tag + "] " + msg); break;
            case "I": android.util.Log.i(PREFIX, "[" + tag + "] " + msg); break;
            default:  android.util.Log.d(PREFIX, "[" + tag + "] " + msg); break;
        }
        Line line = new Line(System.currentTimeMillis(), level, tag, msg);
        BUFFER.add(line);
        while (BUFFER.size() > MAX_LINES) BUFFER.remove(0);
        for (Listener l : new ArrayList<>(LISTENERS)) {
            try { l.onLogLine(line); } catch (Throwable ignored) { }
        }
    }

    public static synchronized List<Line> snapshot() {
        return new ArrayList<>(BUFFER);
    }

    public static synchronized void clear() {
        BUFFER.clear();
    }

    public static synchronized void addListener(Listener l) {
        if (!LISTENERS.contains(l)) LISTENERS.add(l);
    }

    public static synchronized void removeListener(Listener l) {
        LISTENERS.remove(l);
    }
}
