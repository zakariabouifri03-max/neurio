package com.neurio.langame.host;

import android.content.Context;
import android.os.PowerManager;

import com.neurio.langame.common.DeviceInfo;

import java.io.BufferedReader;
import java.io.FileReader;
import java.util.Locale;

/**
 * Cheap, honest device health sampling: our own CPU share, thermal status and the
 * thermal headroom the platform is willing to share.
 *
 * <p>What this class deliberately does <b>not</b> do is invent numbers. Core
 * temperature needs the {@code DEVICE_POWER} permission (system-only) and exact
 * clock speeds are not exposed to apps, so the UI shows the thermal <i>status</i>
 * and the headroom value the platform provides, and nothing else.</p>
 */
public final class PerformanceMonitor {

    private final Context context;
    private long lastCpuTimeMs = -1;
    private long lastSampleAtMs = -1;
    private float cpuPercent;

    public PerformanceMonitor(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Must be called ~1×/s; updates CPU + thermal readings. */
    public void sample() {
        long now = System.currentTimeMillis();
        long cpuMs = processCpuTimeMs();
        if (cpuMs >= 0 && lastCpuTimeMs >= 0 && lastSampleAtMs > 0) {
            long wallDelta = Math.max(1, now - lastSampleAtMs);
            long cpuDelta = cpuMs - lastCpuTimeMs;
            float instant = cpuDelta * 100f / wallDelta;
            cpuPercent = cpuPercent * 0.7f + instant * 0.3f;
        }
        lastCpuTimeMs = cpuMs;
        lastSampleAtMs = now;
    }

    /** Total CPU time of this process (user+system) in milliseconds, or -1. */
    private static long processCpuTimeMs() {
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/self/stat"))) {
            String line = reader.readLine();
            if (line == null) {
                return -1;
            }
            // Fields 14 and 15 (1-based) are utime and stime, in clock ticks.
            int closing = line.lastIndexOf(')');   // the command name may contain spaces
            String[] fields = line.substring(closing + 2).split(" ");
            long utimeTicks = Long.parseLong(fields[11]);
            long stimeTicks = Long.parseLong(fields[12]);
            long ticksPerSecond = 100;             // USER_HZ is 100 on Android
            return (utimeTicks + stimeTicks) * 1000L / ticksPerSecond;
        } catch (Exception e) {
            return -1;
        }
    }

    /** Percentage of a single core used by this app (0..100 × cores). */
    public float cpuPercent() {
        return cpuPercent;
    }

    public int thermalStatus() {
        return DeviceInfo.thermalStatus(context);
    }

    public float thermalHeadroom() {
        return DeviceInfo.thermalHeadroom(context);
    }

    public boolean isThrottling() {
        int status = thermalStatus();
        if (status >= PowerManager.THERMAL_STATUS_SEVERE) {
            return true;
        }
        float headroom = thermalHeadroom();
        return !Float.isNaN(headroom) && headroom > 0.9f;
    }

    public String describeThermal() {
        int status = thermalStatus();
        if (status < 0) {
            return "unavailable on this Android version";
        }
        float headroom = thermalHeadroom();
        String base = DeviceInfo.thermalLabel(status);
        if (Float.isNaN(headroom)) {
            return base;
        }
        return String.format(Locale.US, "%s (headroom %.2f)", base, headroom);
    }
}
