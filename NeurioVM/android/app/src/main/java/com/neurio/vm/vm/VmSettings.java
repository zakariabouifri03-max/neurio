package com.neurio.vm.vm;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * User-supplied paths and arguments for the backends that need external
 * components (QEMU binary, disk image, container root filesystem).
 *
 * <p>These cannot be bundled: a QEMU build is tens of megabytes of native code
 * and an Android system image is a gigabyte or more, and redistributing either
 * is a licensing question, not a technical one. So NeurioVM points at whatever
 * the user already has — typically installed through Termux — and remembers the
 * location here.
 */
public final class VmSettings {

    private static final String FILE = "neurio_vm_settings";

    public static final String KEY_QEMU_BINARY = "qemuBinary";
    public static final String KEY_QEMU_IMAGE = "qemuImage";
    public static final String KEY_QEMU_EXTRA = "qemuExtraArgs";
    public static final String KEY_QEMU_MEMORY_MB = "qemuMemoryMb";
    public static final String KEY_QEMU_SMP = "qemuSmp";
    public static final String KEY_QEMU_KVM = "qemuUseKvm";
    public static final String KEY_ROOTFS = "redroidRootfs";
    public static final String KEY_USE_SU = "alwaysUseSu";
    public static final String KEY_PREFERRED_BACKEND = "preferredBackend";
    public static final String KEY_BROWSER_HOME = "browserHome";

    private final SharedPreferences prefs;

    public VmSettings(Context ctx) {
        this.prefs = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String qemuBinary() { return prefs.getString(KEY_QEMU_BINARY, ""); }
    public void qemuBinary(String v) { edit().putString(KEY_QEMU_BINARY, v == null ? "" : v).apply(); }

    public String qemuImage() { return prefs.getString(KEY_QEMU_IMAGE, ""); }
    public void qemuImage(String v) { edit().putString(KEY_QEMU_IMAGE, v == null ? "" : v).apply(); }

    public String qemuExtraArgs() { return prefs.getString(KEY_QEMU_EXTRA, ""); }
    public void qemuExtraArgs(String v) { edit().putString(KEY_QEMU_EXTRA, v == null ? "" : v).apply(); }

    public int qemuMemoryMb() { return prefs.getInt(KEY_QEMU_MEMORY_MB, 2048); }
    public void qemuMemoryMb(int v) { edit().putInt(KEY_QEMU_MEMORY_MB, v).apply(); }

    public int qemuSmp() { return prefs.getInt(KEY_QEMU_SMP, 4); }
    public void qemuSmp(int v) { edit().putInt(KEY_QEMU_SMP, v).apply(); }

    public boolean qemuUseKvm() { return prefs.getBoolean(KEY_QEMU_KVM, true); }
    public void qemuUseKvm(boolean v) { edit().putBoolean(KEY_QEMU_KVM, v).apply(); }

    public String redroidRootfs() { return prefs.getString(KEY_ROOTFS, ""); }
    public void redroidRootfs(String v) { edit().putString(KEY_ROOTFS, v == null ? "" : v).apply(); }

    public boolean alwaysUseSu() { return prefs.getBoolean(KEY_USE_SU, false); }
    public void alwaysUseSu(boolean v) { edit().putBoolean(KEY_USE_SU, v).apply(); }

    /** Empty means "auto": let {@link Backends#preferred(Capability)} decide. */
    public String preferredBackend() { return prefs.getString(KEY_PREFERRED_BACKEND, ""); }
    public void preferredBackend(String v) { edit().putString(KEY_PREFERRED_BACKEND, v == null ? "" : v).apply(); }

    public String browserHome() { return prefs.getString(KEY_BROWSER_HOME, "https://duckduckgo.com/"); }
    public void browserHome(String v) { edit().putString(KEY_BROWSER_HOME, v).apply(); }

    private SharedPreferences.Editor edit() { return prefs.edit(); }
}
