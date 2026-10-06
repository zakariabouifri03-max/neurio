package com.neurio.vm.vm;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Io;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * A real virtual machine, run by {@code qemu-system}.
 *
 * <p>This is the backend that is closest to what LDPlayer does on a PC: a whole
 * guest Android booting on emulated hardware, with its own kernel. Two things
 * have to be true on the phone:
 *
 * <ol>
 *   <li><b>a qemu-system binary the app may execute.</b> Android 10 removed
 *       execute permission on app-writable storage for unprivileged apps, so a
 *       Termux-installed QEMU can only be launched through {@code su}. Without
 *       root this backend reports exactly that.</li>
 *   <li><b>a guest image.</b> A raw Android system image, or a kernel + initrd
 *       pair. NeurioVM does not ship one — they are gigabytes and their licences
 *       do not allow redistribution — so the path is set on the console screen.</li>
 * </ol>
 *
 * <p>When {@code /dev/kvm} is usable the VM is hardware accelerated and boots in
 * seconds. Without it QEMU falls back to TCG binary translation, which on a
 * phone means minutes to boot and single-digit frames per second. The verdict
 * says which of the two you are getting before you start.
 */
public final class QemuBackend implements VmBackend {

    public static final String ID = "qemu";
    private static final String TAG = "QemuBackend";

    private final VmSettings settings;

    public QemuBackend(VmSettings settings) {
        this.settings = settings;
    }

    @Override public String id() { return ID; }

    @Override public String name() { return "QEMU virtual machine"; }

    @Override
    public String tagline() {
        return "A full guest Android on emulated hardware — its own kernel, its own everything.";
    }

    @Override
    public String detail() {
        return "Launches qemu-system with a virt machine, virtio block and network devices and a "
                + "host-forwarded adb port (5555), so the guest can be driven with the normal adb "
                + "client afterwards.\n\n"
                + "You supply two paths on the console screen: the qemu-system binary (Termux "
                + "installs one with `pkg install qemu-system-aarch64-8`) and a guest image. "
                + "NeurioVM writes the exact command line it used into the device's log directory "
                + "as qemu-launch.sh, so the same VM can be reproduced from a shell.\n\n"
                + "Without root the launch will fail with EACCES on Android 10 and later: that is "
                + "the platform refusing to execute a binary from app storage, not a bug here.";
    }

    @Override public Requirement requirement() { return Requirement.USER_BINARY; }

    @Override
    public boolean isAvailable(Capability c) {
        return c != null && binary(c) != null && (c.canExecAppData || c.root);
    }

    @Override
    public String verdict(Capability c) {
        if (c == null) return "Unknown — run the capability probe first.";
        String bin = binary(c);
        if (bin == null) {
            return "No qemu-system binary found. Install one (Termux: "
                    + "`pkg install qemu-system-aarch64-8`) and set its path on the console screen.";
        }
        if (!c.canExecAppData && !c.root) {
            return "Found " + bin + " but this app may not execute it: Android "
                    + c.release + " blocks exec() from app-writable storage for unprivileged apps. "
                    + "Root is required.";
        }
        String img = settings.qemuImage();
        if (img.isEmpty()) {
            return "Ready to launch, but no guest image is configured. Set one on the console screen.";
        }
        if (!new File(img).isFile()) {
            return "Configured guest image " + img + " does not exist.";
        }
        return "Available" + (c.kvmUsable()
                ? " with KVM acceleration — expect a real boot in seconds."
                : ", but /dev/kvm is not usable: QEMU will fall back to TCG and the guest will be slow.");
    }

    private String binary(Capability c) {
        String configured = settings.qemuBinary();
        if (configured != null && !configured.isEmpty()) {
            return new File(configured).exists() ? configured : null;
        }
        return c.qemuPath;
    }

    @Override
    public void start(VmSession s) throws Exception {
        Capability c = CapabilityProbe.cached();
        if (c == null) c = CapabilityProbe.probeSync(s.context());
        String bin = binary(c);
        if (bin == null) throw new IllegalStateException("no qemu-system binary configured");

        DeviceIdentity d = s.device();
        List<String> argv = buildArgv(bin, d, c);
        String script = renderScript(argv, s, d);

        File logDir = Sandbox.logs(s.context(), d);
        Io.mkdirs(logDir);
        File scriptFile = new File(logDir, "qemu-launch.sh");
        Io.write(scriptFile, script);
        s.log("launch script written to " + scriptFile);

        boolean viaSu = !c.canExecAppData || settings.alwaysUseSu();
        s.log("execution mode: " + (viaSu ? "su -c (root required)" : "direct exec"));

        s.setState(VmSession.State.STARTING);
        Process p = ProcessRunner.start(s, viaSu, c.suPath, logDir, argv);
        s.setProcess(p);
        ProcessRunner.stream(s, p, null);
        s.setState(VmSession.State.RUNNING);
        s.log("qemu started — guest adb will be reachable on localhost:5555 once it boots");
    }

    private List<String> buildArgv(String bin, DeviceIdentity d, Capability c) {
        List<String> a = new ArrayList<>();
        a.add(bin);

        boolean arm = bin.contains("aarch64") || bin.contains("-arm");
        a.add("-machine");
        a.add(arm ? "virt,gic-version=3,virtualization=on" : "q35,accel=kvm:tcg");
        a.add("-cpu");
        a.add(arm ? (c.kvmUsable() ? "host" : "cortex-a72") : (c.kvmUsable() ? "host" : "qemu64"));
        a.add("-smp");
        a.add(String.valueOf(settings.qemuSmp()));
        a.add("-m");
        a.add(String.valueOf(settings.qemuMemoryMb()));

        if (c.kvmUsable() && settings.qemuUseKvm()) {
            a.add("-enable-kvm");
        }

        String img = settings.qemuImage();
        if (!img.isEmpty()) {
            a.add("-drive");
            a.add("file=" + img + ",if=none,id=system,format=raw,aio=threads");
            a.add("-device");
            a.add(arm ? "virtio-blk-device,drive=system" : "virtio-blk-pci,drive=system");
        }

        a.add("-netdev");
        a.add("user,id=net0,hostfwd=tcp::5555-:5555,hostfwd=tcp::5554-:5554");
        a.add("-device");
        a.add(arm ? "virtio-net-device,netdev=net0" : "virtio-net-pci,netdev=net0");

        // The guest's own idea of which handset it is, passed on the kernel
        // command line — this is what makes the VM report the configured model
        // instead of "qemu".
        a.add("-append");
        a.add(kernelCmdline(d));

        a.add("-nographic");
        a.add("-serial");
        a.add("mon:stdio");

        String extra = settings.qemuExtraArgs();
        if (extra != null && !extra.trim().isEmpty()) {
            for (String tok : extra.trim().split("\\s+")) a.add(tok);
        }
        return a;
    }

    private String kernelCmdline(DeviceIdentity d) {
        return String.format(Locale.US,
                "console=ttyAMA0 androidboot.hardware=%s ro.product.model=%s ro.product.brand=%s "
                        + "ro.product.manufacturer=%s ro.product.device=%s ro.build.version.release=%s "
                        + "ro.build.version.sdk=%d ro.build.fingerprint=%s androidboot.serialno=%s",
                d.hardware, d.model, d.brand, d.manufacturer, d.device, d.release, d.sdkInt,
                d.fingerprint, d.serial);
    }

    private String renderScript(List<String> argv, VmSession s, DeviceIdentity d) {
        StringBuilder sb = new StringBuilder();
        sb.append("#!/system/bin/sh\n");
        sb.append("# NeurioVM — QEMU launch for \"").append(d.displayName()).append("\"\n");
        sb.append("# Generated ").append(new java.util.Date()).append('\n');
        sb.append("# Run as root:  su -c 'sh ")
                .append(new File(Sandbox.logs(s.context(), d), "qemu-launch.sh")).append("'\n\n");
        sb.append("cd ").append(ProcessRunner.quote(Sandbox.logs(s.context(), d).getPath())).append('\n');
        sb.append("exec ").append(ProcessRunner.render(argv)).append('\n');
        return sb.toString();
    }

    @Override
    public void stop(VmSession s) {
        Process p = s.process();
        if (p != null) {
            s.log("terminating qemu");
            p.destroy();
        }
        s.setProcess(null);
        s.setState(VmSession.State.STOPPED);
    }
}
