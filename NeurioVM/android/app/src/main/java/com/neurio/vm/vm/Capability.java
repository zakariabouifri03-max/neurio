package com.neurio.vm.vm;

import com.neurio.vm.util.Io;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Everything this handset can and cannot do when it comes to running a second
 * Android inside itself.
 *
 * <p>The probe exists because the honest answer to "can I run LDPlayer on my
 * phone" depends on four independent things — the kernel exposing
 * {@code /dev/kvm}, the AVF virtualization framework being present, the app
 * being allowed to hold a privileged permission, and whether the device is
 * rooted. Most phones fail at least one of them, and the UI has to say which.
 *
 * <p>Instances are immutable; {@link CapabilityProbe#probe} fills them in.
 */
public final class Capability {

    // ── the machine ────────────────────────────────────────────────────────
    public final int sdkInt;
    public final String release;
    public final String primaryAbi;
    public final String[] abis;
    public final int cpuCores;
    public final long totalRamBytes;
    public final long freeStorageBytes;
    public final String kernel;
    public final String model;

    // ── hardware virtualization ────────────────────────────────────────────
    public final boolean kvmExists;        // /dev/kvm is present
    public final boolean kvmReadable;      // and this app may open it
    public final boolean kvmWritable;
    public final boolean nestedKvmModule;  // /sys/module/kvm exists

    // ── Android Virtualization Framework ───────────────────────────────────
    public final boolean avfFeature;       // PackageManager feature flag
    public final boolean virtApex;         // /apex/com.android.virt
    public final boolean avfService;       // binder name resolves
    public final String avfServiceError;   // why the binder lookup failed

    // ── privilege ──────────────────────────────────────────────────────────
    public final boolean root;
    public final String suPath;
    public final boolean selinuxEnforcing;
    public final boolean canExecAppData;   // false on Android 10+ for non-root

    // ── container tooling ──────────────────────────────────────────────────
    public final boolean termuxPresent;
    public final String prootPath;
    public final String qemuPath;
    public final String chrootPath;

    // ── in-app isolation primitives ────────────────────────────────────────
    public final boolean webViewSuffixApi; // API 28+
    public final boolean multiUserSupport; // UserManager reports >1 user
    public final boolean managedProfileApi;// DevicePolicyManager reachable

    private Capability(Builder b) {
        this.sdkInt = b.sdkInt;
        this.release = b.release;
        this.primaryAbi = b.primaryAbi;
        this.abis = b.abis;
        this.cpuCores = b.cpuCores;
        this.totalRamBytes = b.totalRamBytes;
        this.freeStorageBytes = b.freeStorageBytes;
        this.kernel = b.kernel;
        this.model = b.model;
        this.kvmExists = b.kvmExists;
        this.kvmReadable = b.kvmReadable;
        this.kvmWritable = b.kvmWritable;
        this.nestedKvmModule = b.nestedKvmModule;
        this.avfFeature = b.avfFeature;
        this.virtApex = b.virtApex;
        this.avfService = b.avfService;
        this.avfServiceError = b.avfServiceError;
        this.root = b.root;
        this.suPath = b.suPath;
        this.selinuxEnforcing = b.selinuxEnforcing;
        this.canExecAppData = b.canExecAppData;
        this.termuxPresent = b.termuxPresent;
        this.prootPath = b.prootPath;
        this.qemuPath = b.qemuPath;
        this.chrootPath = b.chrootPath;
        this.webViewSuffixApi = b.webViewSuffixApi;
        this.multiUserSupport = b.multiUserSupport;
        this.managedProfileApi = b.managedProfileApi;
    }

    /** KVM usable for acceleration = present and openable read/write. */
    public boolean kvmUsable() { return kvmExists && kvmReadable && kvmWritable; }

    /** True when a pKVM-backed VM could in principle be started. */
    public boolean avfReady() { return avfFeature && virtApex && avfService; }

    /** A short one-line verdict for the console header. */
    public String headline() {
        if (kvmUsable()) return "KVM available — hardware-accelerated virtualization possible";
        if (avfReady()) return "AVF present — but MANAGE_VIRTUAL_MACHINE is a privileged permission";
        if (root) return "Rooted — container and QEMU backends are usable";
        return "Unrooted, no KVM — in-app sandbox backend only";
    }

    /** Every finding, one per line, for the capability screen and the log. */
    public List<String> report() {
        List<String> r = new ArrayList<>();
        r.add(String.format(Locale.US, "Android %s (API %d) — %s", release, sdkInt, model));
        r.add("ABI: " + primaryAbi + (abis.length > 1 ? " (+ " + join(abis) + ")" : ""));
        r.add("CPU cores: " + cpuCores + "   RAM: " + Io.humanBytes(totalRamBytes)
                + "   free storage: " + Io.humanBytes(freeStorageBytes));
        r.add("Kernel: " + kernel);
        r.add("");
        r.add("— hardware virtualization —");
        r.add(fmt("/dev/kvm exists", kvmExists));
        r.add(fmt("/dev/kvm readable by this app", kvmReadable));
        r.add(fmt("/dev/kvm writable by this app", kvmWritable));
        r.add(fmt("kvm kernel module loaded", nestedKvmModule));
        r.add("");
        r.add("— Android Virtualization Framework —");
        r.add(fmt("feature android.software.virtualization_framework", avfFeature));
        r.add(fmt("/apex/com.android.virt mounted", virtApex));
        r.add(fmt("binder android.system.virtualizationservice", avfService));
        if (avfServiceError != null) r.add("    ↳ " + avfServiceError);
        r.add("");
        r.add("— privilege —");
        r.add(fmt("root (su) present", root) + (suPath == null ? "" : " → " + suPath));
        r.add(fmt("SELinux enforcing", selinuxEnforcing));
        r.add(fmt("may exec binaries from app data", canExecAppData));
        r.add("");
        r.add("— container tooling on this device —");
        r.add(fmt("Termux prefix", termuxPresent));
        r.add("proot: " + (prootPath == null ? "not found" : prootPath));
        r.add("chroot: " + (chrootPath == null ? "not found" : chrootPath));
        r.add("qemu-system: " + (qemuPath == null ? "not found" : qemuPath));
        r.add("");
        r.add("— in-app isolation primitives —");
        r.add(fmt("WebView.setDataDirectorySuffix (API 28+)", webViewSuffixApi));
        r.add(fmt("multi-user support", multiUserSupport));
        r.add(fmt("DevicePolicyManager reachable", managedProfileApi));
        r.add("");
        r.add("VERDICT: " + headline());
        return r;
    }

    private static String fmt(String what, boolean yes) {
        return (yes ? "[ ok ] " : "[ -- ] ") + what;
    }

    /** String.join is API 26; this project supports API 24, so join by hand. */
    private static String join(String[] parts) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(parts[i]);
        }
        return sb.toString();
    }

    public static Builder builder() { return new Builder(); }

    /** Mutable accumulator used by {@link CapabilityProbe}. */
    public static final class Builder {
        public int sdkInt;
        public String release = "";
        public String primaryAbi = "";
        public String[] abis = new String[0];
        public int cpuCores = 1;
        public long totalRamBytes;
        public long freeStorageBytes;
        public String kernel = "";
        public String model = "";

        public boolean kvmExists, kvmReadable, kvmWritable, nestedKvmModule;
        public boolean avfFeature, virtApex, avfService;
        public String avfServiceError;

        public boolean root;
        public String suPath;
        public boolean selinuxEnforcing;
        public boolean canExecAppData;

        public boolean termuxPresent;
        public String prootPath;
        public String qemuPath;
        public String chrootPath;

        public boolean webViewSuffixApi, multiUserSupport, managedProfileApi;

        public Capability build() { return new Capability(this); }
    }
}
