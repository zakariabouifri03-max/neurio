package com.neurio.vm.vm;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;

import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Fills in a {@link Capability} by looking at the machine, not at the model name.
 *
 * <p>Everything here is read-only and needs no permission. Two details worth
 * calling out:
 *
 * <ul>
 *   <li><b>Termux detection</b> goes through {@link PackageManager} and a
 *       {@code <queries>} entry in the manifest. On Android 11+ an app cannot
 *       even stat another app's data directory, so probing
 *       {@code /data/data/com.termux} would always say "absent" — the package
 *       query is the only reliable signal.</li>
 *   <li><b>The AVF binder lookup</b> uses reflection because
 *       {@code android.os.ServiceManager} is not public API. On Android 9+ the
 *       hidden-API policy may refuse it; the refusal is caught and reported as
 *       {@link Capability#avfServiceError} rather than silently treated as
 *       "AVF missing", because the two cases have very different meanings.</li>
 * </ul>
 */
public final class CapabilityProbe {

    private static final String TAG = "CapabilityProbe";

    /** Public feature flag name for the Android Virtualization Framework. */
    public static final String FEATURE_AVF = "android.software.virtualization_framework";

    private static final String[] SU_PATHS = {
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
            "/data/local/xbin/su", "/data/local/bin/su", "/data/local/su",
            "/system/sd/xbin/su", "/system/bin/failsafe/su", "/magisk/.core/bin/su",
            "/apex/com.android.runtime/bin/su", "/debug_ramdisk/su", "/system_ext/bin/su",
            "/vendor/bin/su", "/odm/bin/su", "/product/bin/su"
    };

    private static final String TERMUX_PREFIX = "/data/data/com.termux/files/usr";

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "neurio-probe");
        t.setDaemon(true);
        return t;
    });

    private static final AtomicReference<Capability> CACHE = new AtomicReference<>();

    private CapabilityProbe() {}

    public interface Callback {
        void onProbed(Capability c);
    }

    /** Runs the probe off the main thread. Results are cached per process. */
    public static void probe(final Context ctx, final Callback cb, boolean forceRefresh) {
        if (!forceRefresh) {
            Capability c = CACHE.get();
            if (c != null) { cb.onProbed(c); return; }
        }
        final Context app = ctx.getApplicationContext();
        EXEC.execute(() -> {
            Capability c = probeSync(app);
            CACHE.set(c);
            cb.onProbed(c);
        });
    }

    public static Capability cached() {
        return CACHE.get();
    }

    // ── the probe itself ───────────────────────────────────────────────────

    public static Capability probeSync(Context ctx) {
        Capability.Builder b = Capability.builder();

        b.sdkInt = Build.VERSION.SDK_INT;
        b.release = Build.VERSION.RELEASE;
        b.model = Build.MANUFACTURER + " " + Build.MODEL;
        b.primaryAbi = Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0
                ? Build.SUPPORTED_ABIS[0] : Build.CPU_ABI;
        b.abis = Build.SUPPORTED_ABIS == null ? new String[0] : Build.SUPPORTED_ABIS.clone();
        b.cpuCores = Math.max(1, Runtime.getRuntime().availableProcessors());
        b.kernel = kernelVersion();

        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            b.totalRamBytes = mi.totalMem;
            b.freeStorageBytes = freeBytes(ctx);
        }

        // ── /dev/kvm ────────────────────────────────────────────────────────
        File kvm = new File("/dev/kvm");
        b.kvmExists = kvm.exists();
        b.kvmReadable = b.kvmExists && kvm.canRead();
        b.kvmWritable = b.kvmExists && kvm.canWrite();
        b.nestedKvmModule = new File("/sys/module/kvm").exists();
        Log.i(TAG, "kvm exists=" + b.kvmExists + " read=" + b.kvmReadable + " write=" + b.kvmWritable);

        // ── AVF ─────────────────────────────────────────────────────────────
        b.avfFeature = hasFeature(ctx, FEATURE_AVF);
        b.virtApex = new File("/apex/com.android.virt").exists();
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            Object binder = sm.getMethod("checkService", String.class)
                    .invoke(null, "android.system.virtualizationservice");
            b.avfService = binder != null;
            if (!b.avfService) b.avfServiceError = "service not registered";
        } catch (Throwable t) {
            b.avfService = false;
            Throwable cause = t.getCause() == null ? t : t.getCause();
            b.avfServiceError = cause.getClass().getSimpleName() + ": " + cause.getMessage();
        }

        // ── privilege ───────────────────────────────────────────────────────
        b.suPath = findSu();
        b.root = b.suPath != null;
        b.selinuxEnforcing = "1".equals(Io.readFirstLine("/sys/fs/selinux/enforce"));
        // Android 10 made app-data files non-executable for untrusted_app; only
        // root (or a system app) can run a binary out of Termux's prefix.
        b.canExecAppData = b.root || b.sdkInt < 29;

        // ── container tooling ───────────────────────────────────────────────
        b.termuxPresent = isPackageInstalled(ctx, "com.termux");
        b.prootPath = firstExecutable(TERMUX_PREFIX + "/bin/proot", "/system/bin/proot",
                "/data/local/tmp/proot");
        b.chrootPath = firstExecutable("/system/bin/chroot", TERMUX_PREFIX + "/bin/chroot");
        b.qemuPath = firstExecutable(
                TERMUX_PREFIX + "/bin/qemu-system-aarch64",
                TERMUX_PREFIX + "/bin/qemu-system-arm",
                TERMUX_PREFIX + "/bin/qemu-system-x86_64",
                "/system/bin/qemu-system-aarch64",
                "/data/local/tmp/qemu-system-aarch64");

        // ── in-app isolation primitives ─────────────────────────────────────
        b.webViewSuffixApi = b.sdkInt >= 28;
        b.multiUserSupport = multiUser(ctx);
        b.managedProfileApi = managedProfileApi(ctx);

        return b.build();
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private static String kernelVersion() {
        String v = System.getProperty("os.version");
        if (v != null && !v.isEmpty()) return v;
        String proc = Io.readFirstLine("/proc/version");
        return proc == null ? "unknown" : proc;
    }

    private static long freeBytes(Context ctx) {
        try {
            File target = ctx.getFilesDir();
            if (Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState())) {
                File ext = ctx.getExternalFilesDir(null);
                if (ext != null) target = ext;
            }
            StatFs sf = new StatFs(target.getPath());
            return sf.getAvailableBytes();
        } catch (Throwable t) {
            return 0;
        }
    }

    private static boolean hasFeature(Context ctx, String feature) {
        try {
            PackageManager pm = ctx.getPackageManager();
            return pm != null && pm.hasSystemFeature(feature);
        } catch (Throwable t) {
            return false;
        }
    }

    private static String findSu() {
        for (String p : SU_PATHS) {
            File f = new File(p);
            if (f.exists() && f.canExecute()) return p;
        }
        // Some ROMs ship su without the executable bit visible to untrusted_app
        for (String p : SU_PATHS) {
            if (new File(p).exists()) return p;
        }
        return null;
    }

    private static boolean isPackageInstalled(Context ctx, String pkg) {
        try {
            return ctx.getPackageManager().getPackageInfo(pkg, 0) != null;
        } catch (Throwable t) {
            return false;
        }
    }

    private static String firstExecutable(String... paths) {
        for (String p : paths) {
            File f = new File(p);
            if (f.exists() && f.canExecute()) return p;
        }
        // existence alone is still useful information on a rooted device where
        // the probing process cannot stat another app's prefix
        for (String p : paths) {
            if (new File(p).exists()) return p;
        }
        return null;
    }

    private static boolean multiUser(Context ctx) {
        try {
            android.os.UserManager um =
                    (android.os.UserManager) ctx.getSystemService(Context.USER_SERVICE);
            if (um == null) return false;
            if (Build.VERSION.SDK_INT >= 30) {
                // supportsMultipleUsers() is public from R onwards
                return (Boolean) android.os.UserManager.class
                        .getMethod("supportsMultipleUsers").invoke(um);
            }
            Object users = android.os.UserManager.class.getMethod("getUsers").invoke(um);
            return users instanceof java.util.List && ((java.util.List<?>) users).size() > 1;
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean managedProfileApi(Context ctx) {
        try {
            Object dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm == null) return false;
            Class<?> c = Class.forName("android.app.admin.DevicePolicyManager");
            c.getMethod("setProfileOwnerName", String.class);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
