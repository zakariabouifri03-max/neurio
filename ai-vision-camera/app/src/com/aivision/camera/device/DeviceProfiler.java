package com.aivision.camera.device;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import com.aivision.camera.ai.core.Tier;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;

import javax.microedition.khronos.egl.EGL10;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.egl.EGLContext;
import javax.microedition.khronos.egl.EGLDisplay;
import javax.microedition.khronos.egl.EGLSurface;
import javax.microedition.khronos.opengles.GL10;

/**
 * Measures what the device actually is - cores, big/little split, clocks, RAM class, GPU renderer,
 * thermal and power state - and turns that into the {@link Tier} that every AI budget is derived
 * from. Everything here is a real measurement: no hard-coded model lists.
 */
public class DeviceProfiler {

    private static final String TAG = "DeviceProfiler";

    private final Context ctx;
    private Tier tier = Tier.MID;
    private int cores = 4;
    private int maxFreqKhz;
    private int bigCores;
    private int littleCores;
    private long totalRamMb;
    private long availRamMb;
    private boolean lowRam;
    private String cpuModel = "";
    private String gpuRenderer = "";
    private String gpuVendor = "";
    private String gpuVersion = "";
    private String glExtensions = "";
    private int score;
    private boolean batterySaver;
    private volatile boolean thermalThrottling;

    public DeviceProfiler(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    // ------------------------------------------------------------------ profiling

    public void profile() {
        long t0 = System.currentTimeMillis();
        try {
            cores = Runtime.getRuntime().availableProcessors();
            readCpuTopology();
            readMemory();
            probeGpu();
            readPowerState();
            score = computeScore();
            tier = tierForScore(score);
        } catch (Throwable t) {
            Log.w(TAG, "profiling failed, falling back to MID", t);
            tier = Tier.MID;
        }
        Log.i(TAG, summary());
        Log.i(TAG, "profiling took " + (System.currentTimeMillis() - t0) + " ms");
    }

    private void readCpuTopology() {
        TreeSet<Integer> freqs = new TreeSet<Integer>();
        int best = 0;
        for (int cpu = 0; cpu < cores; cpu++) {
            int khz = readInt("/sys/devices/system/cpu/cpu" + cpu + "/cpufreq/cpuinfo_max_freq");
            if (khz <= 0) khz = readInt("/sys/devices/system/cpu/cpu" + cpu + "/cpufreq/scaling_max_freq");
            if (khz > 0) {
                freqs.add(khz);
                if (khz > best) best = khz;
            }
        }
        maxFreqKhz = best;
        if (freqs.size() >= 2) {
            // big.LITTLE / triple cluster: everything below the fastest cluster counts as "little"
            int fastest = freqs.last();
            for (int cpu = 0; cpu < cores; cpu++) {
                int khz = readInt("/sys/devices/system/cpu/cpu" + cpu + "/cpufreq/cpuinfo_max_freq");
                if (khz <= 0) khz = fastest;
                if (khz >= fastest * 0.85) bigCores++;
                else littleCores++;
            }
        } else {
            bigCores = Math.max(1, cores / 2);
            littleCores = cores - bigCores;
        }
        cpuModel = firstNonNull(Build.SOC_MODEL, Build.HARDWARE, Build.BOARD);
        if (cpuModel != null && cpuModel.contains("unknown")) cpuModel = Build.HARDWARE;
        String abi = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "?";
        cpuModel = cpuModel + " (" + abi + ")";
    }

    private void readMemory() {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            totalRamMb = mi.totalMem / (1024 * 1024);
            availRamMb = mi.availMem / (1024 * 1024);
            lowRam = mi.lowMemory || am.isLowRamDevice();
        }
        if (totalRamMb == 0) {
            // fall back to /proc/meminfo
            long kb = readLongFromProc("/proc/meminfo", "MemTotal:");
            totalRamMb = kb / 1024;
        }
    }

    /**
     * Real GPU probe: creates a tiny offscreen EGL context and reads the GL strings. Cheap (a few ms)
     * and it is the only honest way to know which GPU the device has, since Android has no API for it.
     */
    private void probeGpu() {
        EGL10 egl = (EGL10) EGLContext.getEGL();
        EGLDisplay display = egl.eglGetDisplay(EGL10.EGL_DEFAULT_DISPLAY);
        if (display == null || display == EGL10.EGL_NO_DISPLAY) return;
        int[] version = new int[2];
        if (!egl.eglInitialize(display, version)) return;
        int[] configAttribs = {
                EGL10.EGL_RENDERABLE_TYPE, 4, // EGL_OPENGL_ES2_BIT
                EGL10.EGL_SURFACE_TYPE, EGL10.EGL_PBUFFER_BIT,
                EGL10.EGL_RED_SIZE, 8, EGL10.EGL_GREEN_SIZE, 8, EGL10.EGL_BLUE_SIZE, 8,
                EGL10.EGL_NONE
        };
        EGLConfig[] configs = new EGLConfig[1];
        int[] numConfig = new int[1];
        if (!egl.eglChooseConfig(display, configAttribs, configs, 1, numConfig) || numConfig[0] == 0) {
            egl.eglTerminate(display);
            return;
        }
        int[] ctxAttribs = {0x3098, 2, EGL10.EGL_NONE}; // EGL_CONTEXT_CLIENT_VERSION 2
        EGLContext glCtx = egl.eglCreateContext(display, configs[0], EGL10.EGL_NO_CONTEXT, ctxAttribs);
        if (glCtx == null || glCtx == EGL10.EGL_NO_CONTEXT) {
            egl.eglTerminate(display);
            return;
        }
        int[] pbAttribs = {EGL10.EGL_WIDTH, 4, EGL10.EGL_HEIGHT, 4, EGL10.EGL_NONE};
        EGLSurface surface = egl.eglCreatePbufferSurface(display, configs[0], pbAttribs);
        if (surface == null) {
            egl.eglDestroyContext(display, glCtx);
            egl.eglTerminate(display);
            return;
        }
        if (egl.eglMakeCurrent(display, surface, surface, glCtx)) {
            GL10 gl = (GL10) glCtx.getGL();
            gpuRenderer = safe(gl.glGetString(GL10.GL_RENDERER));
            gpuVendor = safe(gl.glGetString(GL10.GL_VENDOR));
            gpuVersion = safe(gl.glGetString(GL10.GL_VERSION));
            glExtensions = safe(gl.glGetString(GL10.GL_EXTENSIONS));
        }
        egl.eglMakeCurrent(display, EGL10.EGL_NO_SURFACE, EGL10.EGL_NO_SURFACE, EGL10.EGL_NO_CONTEXT);
        egl.eglDestroySurface(display, surface);
        egl.eglDestroyContext(display, glCtx);
        egl.eglTerminate(display);
    }

    private void readPowerState() {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        batterySaver = pm != null && pm.isPowerSaveMode();
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    // ------------------------------------------------------------------ scoring

    private int computeScore() {
        int s = 0;
        // RAM is the strongest predictor of how large a burst we can hold in memory
        if (totalRamMb >= 11000) s += 34;
        else if (totalRamMb >= 7000) s += 28;
        else if (totalRamMb >= 5000) s += 20;
        else if (totalRamMb >= 3500) s += 12;
        else s += 4;
        // big cores are what actually run the pixel loops
        s += Math.min(20, bigCores * 5);
        s += Math.min(8, littleCores * 2);
        if (maxFreqKhz >= 2800000) s += 20;
        else if (maxFreqKhz >= 2300000) s += 15;
        else if (maxFreqKhz >= 1800000) s += 9;
        else if (maxFreqKhz > 0) s += 4;
        String g = (gpuRenderer + " " + gpuVendor).toLowerCase(Locale.US);
        if (g.contains("adreno") || g.contains("mali") || g.contains("powervr") || g.contains("immortalis")) {
            s += 8;
            try {
                // Adreno 6xx/7xx, Mali-G7x/G8x are the modern parts
                int idx = g.indexOf("adreno");
                if (idx >= 0) {
                    String num = g.substring(idx + 6).replaceAll("[^0-9].*", "").trim();
                    if (num.length() > 0) {
                        int n = Integer.parseInt(num.length() > 3 ? num.substring(0, 3) : num);
                        if (n >= 700) s += 10;
                        else if (n >= 600) s += 7;
                        else if (n >= 500) s += 4;
                    }
                }
                if (g.contains("mali-g7") || g.contains("mali-g8") || g.contains("immortalis")) s += 10;
                else if (g.contains("mali-g6")) s += 6;
            } catch (Throwable ignored) {
            }
        }
        if (lowRam) s -= 22;
        if (batterySaver) s -= 8;
        if (cores >= 8) s += 4;
        return Math.max(0, Math.min(100, s));
    }

    private Tier tierForScore(int s) {
        if (s >= 74) return Tier.FLAGSHIP;
        if (s >= 52) return Tier.HIGH;
        if (s >= 30) return Tier.MID;
        return Tier.LOW;
    }

    /** Thread budget for the AI engine: keep one core free for the preview and the encoder. */
    public int getAiThreads() {
        int t = Math.max(1, bigCores + (littleCores / 2));
        if (tier == Tier.LOW) t = Math.min(t, 2);
        return Math.max(1, Math.min(t, cores - 1));
    }

    // ------------------------------------------------------------------ accessors

    public Tier tier() {
        return tier;
    }

    public int score() {
        return score;
    }

    public int cores() {
        return cores;
    }

    public int bigCores() {
        return bigCores;
    }

    public int littleCores() {
        return littleCores;
    }

    public int maxFreqMhz() {
        return maxFreqKhz / 1000;
    }

    public long totalRamMb() {
        return totalRamMb;
    }

    public long availRamMb() {
        return availRamMb;
    }

    public boolean isLowRam() {
        return lowRam;
    }

    public String cpuModel() {
        return cpuModel;
    }

    public String gpuRenderer() {
        return gpuRenderer;
    }

    public String gpuVendor() {
        return gpuVendor;
    }

    public String gpuVersion() {
        return gpuVersion;
    }

    public boolean batterySaver() {
        return batterySaver;
    }

    public boolean isThermalThrottling() {
        return thermalThrottling;
    }

    /** Called when thermal status reports throttling, which lowers the live AI budget. */
    public void setThermalThrottling(boolean v) {
        thermalThrottling = v;
    }

    /** Live tier: falls back a step when the device is hot or in battery saver mode. */
    public Tier liveTier() {
        Tier t = tier;
        if ((thermalThrottling || batterySaver) && t.ordinal() > 0) {
            return Tier.values()[t.ordinal() - 1];
        }
        return t;
    }

    public String summary() {
        return String.format(Locale.US,
                "AI Vision Camera device profile | tier=%s score=%d | SoC=%s | cores=%d (%d big / %d little) @%d MHz"
                        + " | RAM=%d MB (avail %d MB, lowRam=%b) | GPU=%s (%s) | batterySaver=%b",
                tier.label, score, cpuModel, cores, bigCores, littleCores, maxFreqMhz(),
                totalRamMb, availRamMb, lowRam, gpuRenderer, gpuVendor, batterySaver);
    }

    public String gpuSummary() {
        return gpuRenderer + " / " + gpuVendor + " / " + gpuVersion;
    }

    public String extensions() {
        return glExtensions;
    }

    // ------------------------------------------------------------------ /proc helpers

    private static int readInt(String path) {
        try {
            BufferedReader r = new BufferedReader(new FileReader(new File(path)));
            String line = r.readLine();
            r.close();
            return line == null ? 0 : Integer.parseInt(line.trim());
        } catch (Throwable t) {
            return 0;
        }
    }

    private static long readLongFromProc(String path, String key) {
        try {
            BufferedReader r = new BufferedReader(new FileReader(new File(path)));
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith(key)) {
                    String v = line.substring(key.length()).trim().split("\\s+")[0];
                    r.close();
                    return Long.parseLong(v);
                }
            }
            r.close();
        } catch (Throwable ignored) {
        }
        return 0;
    }

    private static String firstNonNull(String... vals) {
        for (String v : vals) {
            if (v != null && v.length() > 0) return v;
        }
        return "";
    }

    /** Human readable list of the AI budgets this device gets, for the settings screen. */
    public List<String> budgetLines() {
        List<String> out = new ArrayList<String>();
        Tier t = tier();
        out.add("AI tier: " + t.label + "  (score " + score + "/100)");
        out.add("Working resolution: " + t.workingLongEdge + " px long edge");
        out.add("Burst frames per shot: " + t.maxBurstFrames);
        out.add("Max AI Ultra scale: " + t.maxUltraScale + "x");
        out.add("AI threads: " + getAiThreads() + " of " + cores);
        return out;
    }

    public boolean hasCameraPermission() {
        return ctx.checkPermission(android.Manifest.permission.CAMERA, android.os.Process.myPid(),
                android.os.Process.myUid()) == PackageManager.PERMISSION_GRANTED;
    }
}
