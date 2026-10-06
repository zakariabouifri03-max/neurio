package com.neurio.langame.common;

import android.content.Context;
import android.util.TypedValue;

import java.io.Closeable;
import java.util.Locale;

/** Small helpers used all over the app. */
public final class Utils {

    private Utils() {
    }

    public static int clamp(int value, int min, int max) {
        return value < min ? min : (value > max ? max : value);
    }

    public static float clamp(float value, float min, float max) {
        return value < min ? min : (value > max ? max : value);
    }

    public static int dp(Context context, float dp) {
        return Math.round(dp * context.getResources().getDisplayMetrics().density);
    }

    public static float sp(Context context, float sp) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp,
                context.getResources().getDisplayMetrics());
    }

    public static String formatBitrate(int bitsPerSecond) {
        if (bitsPerSecond >= 1_000_000) {
            return String.format(Locale.US, "%.1f Mbps", bitsPerSecond / 1_000_000f);
        }
        return String.format(Locale.US, "%d kbps", Math.round(bitsPerSecond / 1000f));
    }

    public static String formatBytes(long bytes) {
        if (bytes >= 1L << 30) {
            return String.format(Locale.US, "%.2f GB", bytes / (float) (1L << 30));
        }
        if (bytes >= 1L << 20) {
            return String.format(Locale.US, "%.1f MB", bytes / (float) (1L << 20));
        }
        if (bytes >= 1L << 10) {
            return String.format(Locale.US, "%.0f kB", bytes / (float) (1L << 10));
        }
        return bytes + " B";
    }

    public static void closeQuietly(Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Exception ignored) {
            // Nothing useful to do while tearing down.
        }
    }

    /** Creates a background thread with a name and a sensible priority. */
    public static Thread startThread(String name, int priority, Runnable body) {
        Thread thread = new Thread(body, name);
        thread.setPriority(priority);
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    public static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
