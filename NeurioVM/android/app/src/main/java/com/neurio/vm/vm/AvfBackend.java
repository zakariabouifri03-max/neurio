package com.neurio.vm.vm;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Io;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Date;

/**
 * The Android Virtualization Framework — pKVM protected VMs.
 *
 * <p>This backend is included because it is the only <em>sanctioned</em> way to
 * run a real virtual machine on a modern Android device, and because the honest
 * answer about it is more useful than silence: <b>a third-party app cannot start
 * one.</b> The entry point, {@code IVirtualMachineService.createVirtualMachine},
 * is guarded by {@code android.permission.MANAGE_VIRTUAL_MACHINE}, whose
 * protection level is {@code signature|privileged}. Only a platform-signed app
 * or one installed into {@code /system/priv-app} can hold it.
 *
 * <p>So this backend does the part that <em>is</em> possible from an installed
 * app: it probes the framework, and when it is present it generates a complete,
 * valid AVF configuration plus the exact shell commands that boot it, written
 * into the device's sandbox. On a Pixel with AVF enabled those commands run
 * straight from {@code adb shell}; that path needs a computer once, and then the
 * VM belongs to the phone.
 */
public final class AvfBackend implements VmBackend {

    public static final String ID = "avf";

    private final VmSettings settings;

    public AvfBackend(VmSettings settings) {
        this.settings = settings;
    }

    @Override public String id() { return ID; }

    @Override public String name() { return "AVF (pKVM protected VM)"; }

    @Override
    public String tagline() {
        return "Android's own hypervisor — the sanctioned path, blocked by a privileged permission.";
    }

    @Override
    public String detail() {
        return "On devices where the Android Virtualization Framework is enabled (Pixel 8 and later "
                + "with Developer options → Enable Virtualization Framework, plus a pKVM-capable "
                + "kernel), Android can run genuine protected virtual machines through "
                + "android.system.virtualizationservice.\n\n"
                + "The API is gated by android.permission.MANAGE_VIRTUAL_MACHINE, protection level "
                + "signature|privileged. An app installed from a file cannot be granted it, so "
                + "NeurioVM cannot press \"start\" here — and this backend will not pretend "
                + "otherwise.\n\n"
                + "What it does instead: writes a complete AVF VirtualMachineConfig (JSON) and the "
                + "matching /apex/com.android.virt/bin/vm command line into the device sandbox, so "
                + "a single `adb shell` invocation boots the VM with this device's identity. "
                + "That is the real thing, one cable away.";
    }

    @Override public Requirement requirement() { return Requirement.PRIVILEGED; }

    @Override
    public boolean isAvailable(Capability c) {
        // Available in the sense that the framework is there and a config can be
        // generated; starting it still needs adb or a privileged caller.
        return c != null && c.avfReady();
    }

    @Override
    public String verdict(Capability c) {
        if (c == null) return "Unknown — run the capability probe first.";
        if (!c.avfFeature) {
            return "This device does not report the virtualization_framework feature. "
                    + "AVF needs a pKVM-capable kernel and an OEM that shipped it.";
        }
        if (!c.virtApex) {
            return "The feature flag is set but /apex/com.android.virt is not mounted.";
        }
        if (!c.avfService) {
            return "AVF apex present, but android.system.virtualizationservice could not be "
                    + "resolved" + (c.avfServiceError == null ? "." : ": " + c.avfServiceError + ".")
                    + " On Android 9+ the hidden-API policy may be what refused the lookup.";
        }
        return "AVF is live on this device. Generating the config now; booting it needs "
                + "`adb shell` (or a platform-signed caller), because MANAGE_VIRTUAL_MACHINE is "
                + "a privileged permission.";
    }

    @Override
    public void start(VmSession s) throws Exception {
        Capability c = CapabilityProbe.cached();
        if (c == null) c = CapabilityProbe.probeSync(s.context());
        DeviceIdentity d = s.device();

        File logDir = Sandbox.logs(s.context(), d);
        Io.mkdirs(logDir);
        File dir = new File(logDir, "avf");
        Io.mkdirs(dir);

        File config = new File(dir, "config.json");
        Io.write(config, avfConfig(d).toString(2));
        s.log("AVF config written to " + config);

        File boot = new File(dir, "boot.sh");
        Io.write(boot, bootScript(config, d));
        s.log("boot commands written to " + boot);

        for (String line : bootScriptLines(config, d)) s.log("  " + line);

        if (!isAvailable(c)) {
            s.setState(VmSession.State.FAILED, c == null ? "no capability data" : verdict(c));
            return;
        }
        // The configuration is generated and valid, but this process is not
        // allowed to call createVirtualMachine. DEGRADED, not RUNNING.
        s.setState(VmSession.State.DEGRADED,
                "config generated — boot it with: adb shell sh " + boot.getPath());
    }

    /**
     * An AVF {@code VirtualMachineConfig} in the JSON shape accepted by
     * {@code /apex/com.android.virt/bin/vm run}. Field names follow the AIDL in
     * {@code packages/modules/Virtualization/aidl/android/system/virtualmachine}.
     */
    private JSONObject avfConfig(DeviceIdentity d) throws Exception {
        JSONObject kernel = new JSONObject();
        String img = settings.qemuImage();
        kernel.put("kernelImagePath", img.isEmpty() ? "/data/local/tmp/vmlinux" : img);
        kernel.put("initRdPath", JSONObject.NULL);
        kernel.put("kernelCmdLine", cmdline(d));

        JSONObject vm = new JSONObject();
        vm.put("name", "neurio-" + shortId(d.id));
        vm.put("memoryMiB", settings.qemuMemoryMb());
        vm.put("cpuTopology", "CPU_TOPOLOGY_ONE_CORE");
        vm.put("vmConfig", new JSONObject().put("kernel", kernel));

        JSONObject app = new JSONObject();
        app.put("customData", new JSONObject()
                .put("neurioDevice", d.id)
                .put("androidId", d.androidId)
                .put("fingerprint", d.fingerprint)
                .put("model", d.model));
        vm.put("appConfig", app);

        JSONObject root = new JSONObject();
        root.put("virtualMachineConfig", vm);
        root.put("generatedBy", "NeurioVM");
        root.put("generatedAt", new Date().toString());
        return root;
    }

    private String cmdline(DeviceIdentity d) {
        return "console=hvc0 reboot=k panic=1 pci=off androidboot.hardware=avf"
                + " ro.product.model=" + d.model
                + " ro.product.brand=" + d.brand
                + " ro.product.manufacturer=" + d.manufacturer
                + " ro.product.device=" + d.device
                + " ro.build.version.release=" + d.release
                + " ro.build.version.sdk=" + d.sdkInt
                + " ro.build.fingerprint=" + d.fingerprint
                + " ro.serialno=" + d.serial
                + " persist.sys.timezone=" + d.timezoneId;
    }

    private String[] bootScriptLines(File config, DeviceIdentity d) {
        return new String[]{
                "#!/system/bin/sh",
                "# NeurioVM — boot \"" + d.displayName() + "\" on the Android Virtualization Framework",
                "# Run these from a computer:  adb shell sh " + config.getParent() + "/boot.sh",
                "# or paste them into an adb shell one at a time.",
                "set -e",
                "VM=/apex/com.android.virt/bin/vm",
                "[ -x \"$VM\" ] || { echo 'the vm tool is not present — AVF is not enabled on this build'; exit 1; }",
                "CFG=" + config.getPath(),
                "# copy the config somewhere the virtualizationservice can read",
                "cp \"$CFG\" /data/local/tmp/neurio-avf.json",
                "chmod 0644 /data/local/tmp/neurio-avf.json",
                "$VM run /data/local/tmp/neurio-avf.json --console",
        };
    }

    private String bootScript(File config, DeviceIdentity d) {
        StringBuilder sb = new StringBuilder();
        for (String line : bootScriptLines(config, d)) sb.append(line).append('\n');
        return sb.toString();
    }

    private static String shortId(String uuid) {
        return uuid == null ? "dev" : uuid.replace("-", "").substring(0, 8);
    }

    @Override
    public void stop(VmSession s) {
        s.log("nothing to stop in-process — the AVF VM is owned by virtualizationservice");
        s.log("to stop it: adb shell /apex/com.android.virt/bin/vm list && vm stop <id>");
        s.setProcess(null);
        s.setState(VmSession.State.STOPPED);
    }

    /** Exposed so the console can offer the config as a shareable file. */
    public static File configDir(VmSession s) {
        return new File(Sandbox.logs(s.context(), s.device()), "avf");
    }

    /** A one-paragraph explainer used in the UI when AVF is absent entirely. */
    public static String explainer(Capability c) {
        JSONArray missing = new JSONArray();
        if (c == null || !c.avfFeature) missing.put("virtualization_framework feature");
        if (c == null || !c.virtApex) missing.put("/apex/com.android.virt");
        if (c == null || !c.avfService) missing.put("android.system.virtualizationservice");
        return "AVF is not usable here. Missing: " + missing;
    }
}
