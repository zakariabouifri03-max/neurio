package com.neurio.vm.runtime;

import android.content.Context;
import android.os.Build;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import java.io.File;

/**
 * Decides, at process start-up, which WebView profile this process owns.
 *
 * <p>This is the piece that makes the isolation real rather than cosmetic.
 * Chromium keeps every WebView in one directory tree
 * ({@code <dataDir>/app_webview}) — cookies, localStorage, IndexedDB, service
 * workers, HTTP cache, the lot. Android 9 added
 * {@link android.webkit.WebView#setDataDirectorySuffix(String)} so a single app
 * can keep several trees, but with two hard rules: the suffix must be set
 * <em>before</em> any WebView provider is loaded, and it can never be changed
 * afterwards. Hence one process per concurrent device.
 *
 * <p>What this class does in each browser process:
 * <ol>
 *   <li>works out which slot it is ({@code :vm0} … {@code :vm3}) from its own
 *       process name;</li>
 *   <li>reads {@code vm/slot<N>.txt} to learn which device it should serve;</li>
 *   <li>compares against {@code vm/slot<N>.owner} — if the slot changed hands,
 *       deletes the previous tenant's WebView and cache trees so the new device
 *       boots with genuinely empty storage;</li>
 *   <li>claims the suffix {@code nvm<N>} before any WebView can be created.</li>
 * </ol>
 */
public final class ProcessBridge {

    private static final String TAG = "ProcessBridge";
    private static final String SUFFIX_PREFIX = "nvm";
    private static final String HOST_SUFFIX = "nvmhost";

    private static volatile String processName;
    private static volatile String suffix;
    private static volatile int slot = -1;
    private static volatile String deviceId;
    private static volatile boolean wiped;

    private ProcessBridge() {}

    /** True when the process is one of the isolated browser slots. */
    public static boolean isBrowserProcess() { return slot >= 0; }

    public static int slot() { return slot; }

    /** The suffix actually claimed with the framework, or {@code null} on API &lt; 28. */
    public static String suffix() { return suffix; }

    public static String deviceId() { return deviceId; }

    public static boolean wipedOnHandover() { return wiped; }

    /** WebView profile isolation needs API 28; below that we can only isolate app files. */
    public static boolean isolationSupported() { return Build.VERSION.SDK_INT >= 28; }

    public static String processName(Context ctx) {
        String name = processName;
        if (name != null) return name;
        name = detectProcessName();
        processName = name;
        return name;
    }

    private static String detectProcessName() {
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                String n = android.app.Application.getProcessName();
                if (n != null && !n.isEmpty()) return n;
            } catch (Throwable ignored) { }
        }
        // Fallback for API 24–27: the kernel still tells us in /proc/self/cmdline,
        // NUL-terminated, occasionally padded with zeroes.
        try (java.io.InputStream in = new java.io.FileInputStream("/proc/self/cmdline")) {
            byte[] buf = new byte[256];
            int n = in.read(buf);
            if (n > 0) {
                int end = 0;
                while (end < n && buf[end] != 0) end++;
                String s = new String(buf, 0, end, Io.UTF8).trim();
                if (!s.isEmpty()) return s;
            }
        } catch (Exception ignored) { }
        return "unknown";
    }

    /**
     * Must be called from {@code Application.onCreate()} — before anything
     * touches a WebView. Safe to call in every process.
     */
    public static synchronized void onProcessStart(Context ctx) {
        String name = processName(ctx);
        Log.i(TAG, "process '" + name + "' starting (SDK " + Build.VERSION.SDK_INT + ")");

        int s = parseSlot(name);
        slot = s;

        if (s < 0) {
            // Main process: claim a suffix of its own so that any WebView the
            // host UI ever creates cannot collide with a guest profile.
            deviceId = Sandbox.readActivePointer(ctx);
            claim(ctx, HOST_SUFFIX);
            return;
        }

        deviceId = readPointer(ctx, s);
        if (deviceId == null) {
            Log.w(TAG, "slot " + s + " has no device pointer yet");
        }
        handOver(ctx, s, deviceId);
        claim(ctx, SUFFIX_PREFIX + s);
    }

    private static int parseSlot(String processName) {
        if (processName == null) return -1;
        int idx = processName.indexOf(":vm");
        if (idx < 0) return -1;
        String tail = processName.substring(idx + 3);
        try {
            int n = Integer.parseInt(tail);
            return n >= 0 && n < SlotTable.SLOTS ? n : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String readPointer(Context ctx, int slot) {
        File f = SlotTable.pointer(ctx, slot);
        if (!f.isFile()) return null;
        try {
            String id = Io.read(f).trim();
            return id.isEmpty() ? null : id;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Wipes the previous tenant's WebView profile when a slot is reassigned.
     * Runs before the suffix is claimed, so nothing has the files open yet.
     */
    private static void handOver(Context ctx, int slot, String newDeviceId) {
        File ownerFile = SlotTable.owner(ctx, slot);
        String previous = null;
        if (ownerFile.isFile()) {
            try { previous = Io.read(ownerFile).trim(); } catch (Exception ignored) { }
        }
        if (previous != null && !previous.isEmpty() && !previous.equals(newDeviceId)) {
            Log.i(TAG, "slot " + slot + " changed owner " + previous + " → " + newDeviceId
                    + ": wiping the WebView profile");
            wipeProfile(ctx);
            wiped = true;
        } else {
            wiped = false;
        }
        try {
            Io.mkdirs(Sandbox.root(ctx));
            Io.write(ownerFile, newDeviceId == null ? "" : newDeviceId);
        } catch (Exception e) {
            Log.w(TAG, "could not record the slot owner: " + e.getMessage());
        }
    }

    /**
     * Removes Chromium's two trees for the current process:
     * {@code <dataDir>/app_webview_<suffix>} and {@code <cacheDir>/<suffix>_webview}.
     * Called before {@link android.webkit.WebView#setDataDirectorySuffix(String)}
     * takes effect, so the default (unsuffixed) names are the ones to remove.
     */
    private static void wipeProfile(Context ctx) {
        String dataDir = ctx.getApplicationInfo().dataDir;
        File[] targets = {
                new File(dataDir, "app_webview"),
                new File(dataDir, "app_webview_" + HOST_SUFFIX),
                new File(ctx.getCacheDir(), "WebView"),
        };
        for (int i = 0; i < SlotTable.SLOTS; i++) {
            targets = grow(targets, new File(dataDir, "app_webview_" + SUFFIX_PREFIX + i));
            targets = grow(targets, new File(ctx.getCacheDir(), SUFFIX_PREFIX + i + "_webview"));
        }
        for (File f : targets) {
            if (f.exists()) {
                boolean ok = Io.deleteRecursive(f);
                Log.d(TAG, "  wipe " + f.getName() + " → " + (ok ? "ok" : "FAILED"));
            }
        }
    }

    private static File[] grow(File[] src, File extra) {
        File[] out = new File[src.length + 1];
        System.arraycopy(src, 0, out, 0, src.length);
        out[src.length] = extra;
        return out;
    }

    private static void claim(Context ctx, String wanted) {
        if (Build.VERSION.SDK_INT < 28) {
            suffix = null;
            Log.w(TAG, "API " + Build.VERSION.SDK_INT
                    + " < 28: WebView.setDataDirectorySuffix unavailable — cookie/localStorage"
                    + " isolation is disabled for this process, file isolation still applies");
            return;
        }
        try {
            android.webkit.WebView.setDataDirectorySuffix(wanted);
            suffix = wanted;
            Log.i(TAG, "WebView data-directory suffix claimed: " + wanted);
        } catch (IllegalStateException e) {
            // Already set, or the WebView provider was loaded too early.
            suffix = wanted;
            Log.w(TAG, "suffix already fixed for this process (" + e.getMessage() + ")");
        } catch (Throwable t) {
            Log.e(TAG, "setDataDirectorySuffix failed", t);
        }
    }

    /** The identity this process should present, resolved from the slot pointer. */
    public static DeviceIdentity device(Context ctx) {
        if (deviceId == null) deviceId = Sandbox.readActivePointer(ctx);
        return Sandbox.loadIdentity(ctx, deviceId);
    }

    /** Human readable process banner shown at the top of the browser screen. */
    public static String banner(Context ctx) {
        return processName(ctx) + (suffix == null ? " · shared WebView profile"
                : " · WebView profile " + suffix);
    }
}
