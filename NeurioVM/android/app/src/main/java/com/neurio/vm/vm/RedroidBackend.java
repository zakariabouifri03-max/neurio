package com.neurio.vm.vm;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Io;

import java.io.File;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * A second Android in a container, sharing the host kernel — the redroid model.
 *
 * <p>Because there is no second kernel, the guest only boots if the host kernel
 * already carries the two things Android's userspace cannot live without:
 * <b>binder</b> (as a device node or binderfs) and <b>ashmem</b> (or memfd on
 * newer kernels). Most retail phone kernels do not enable them; custom kernels
 * and some rooted setups do. The probe looks for {@code /dev/binder},
 * {@code /dev/binderfs} and {@code /dev/ashmem} and reports what it finds
 * before anything is started, so the failure — when it comes — is not a mystery.
 *
 * <p>Root is mandatory: mounting proc, sysfs and binderfs inside a chroot is a
 * privileged operation. Two runners are supported — {@code chroot} when the
 * kernel has binder, {@code proot} when the user prefers not to touch the mount
 * table (proot fakes root and intercepts syscalls with ptrace instead).
 */
public final class RedroidBackend implements VmBackend {

    public static final String ID = "redroid";

    private final VmSettings settings;

    public RedroidBackend(VmSettings settings) {
        this.settings = settings;
    }

    @Override public String id() { return ID; }

    @Override public String name() { return "Redroid container"; }

    @Override
    public String tagline() {
        return "A containerised Android on the host kernel — the lightest route to a real second system.";
    }

    @Override
    public String detail() {
        return "Mounts proc, sysfs, devpts and (when present) binderfs inside a rootfs you provide, "
                + "writes the virtual device's identity into default.prop, then runs its /init. "
                + "The guest is a complete Android userspace — init, zygote, surfaceflinger, the "
                + "package manager — talking to the host kernel directly, which makes it far "
                + "lighter than QEMU.\n\n"
                + "Requirements, all of them real:\n"
                + "  • root — mounting inside a chroot is privileged\n"
                + "  • a redroid-compatible rootfs, extracted to a path you configure\n"
                + "  • binder + ashmem in the *host* kernel — the part most phones lack, and the "
                + "one thing an app cannot fix\n\n"
                + "The complete mount-and-boot script is written to the device's log directory "
                + "either way, so it can be read, edited, or run by hand from a root shell.";
    }

    @Override public Requirement requirement() { return Requirement.ROOT; }

    @Override
    public boolean isAvailable(Capability c) {
        return c != null && c.root
                && (c.chrootPath != null || c.prootPath != null)
                && !settings.redroidRootfs().isEmpty();
    }

    @Override
    public String verdict(Capability c) {
        if (c == null) return "Unknown — run the capability probe first.";
        if (!c.root) {
            return "Needs root. No su binary was found in any of the standard locations.";
        }
        boolean binder = Io.exists("/dev/binder") || Io.exists("/dev/binderfs")
                || Io.exists("/dev/binderfs/binder");
        boolean ashmem = Io.exists("/dev/ashmem") || Io.exists("/dev/memfd");
        if (!binder) {
            return "Root found, but this kernel exposes no binder device (/dev/binder, "
                    + "/dev/binderfs). A containerised Android cannot start without it — that needs "
                    + "a custom kernel, not an app.";
        }
        String rootfs = settings.redroidRootfs();
        if (rootfs.isEmpty()) {
            return "Root and binder are present" + (ashmem ? ", ashmem too" : "")
                    + " — set a redroid rootfs path to launch.";
        }
        if (!new File(rootfs).isDirectory()) {
            return "Configured rootfs " + rootfs + " is not a directory.";
        }
        String runner = c.prootPath != null && settings.alwaysUseSu() ? c.prootPath : "/system/bin/chroot";
        return "Available via " + runner + " on a kernel with binder"
                + (ashmem ? " and ashmem" : " (no ashmem — use a memfd-based image)") + ".";
    }

    @Override
    public void start(VmSession s) throws Exception {
        Capability c = CapabilityProbe.cached();
        if (c == null) c = CapabilityProbe.probeSync(s.context());
        if (!c.root) throw new IllegalStateException("root is required for the redroid backend");

        DeviceIdentity d = s.device();
        String rootfs = settings.redroidRootfs();
        if (rootfs.isEmpty()) throw new IllegalStateException("no redroid rootfs configured");

        boolean useProot = c.prootPath != null && settings.alwaysUseSu();

        File logDir = Sandbox.logs(s.context(), d);
        Io.mkdirs(logDir);
        File scriptFile = new File(logDir, "redroid-boot.sh");
        Io.write(scriptFile, bootScript(c, rootfs, d, useProot));
        s.log("boot script written to " + scriptFile);

        List<String> argv = new ArrayList<>();
        argv.add("/system/bin/sh");
        argv.add(scriptFile.getPath());

        s.setState(VmSession.State.STARTING);
        Process p = ProcessRunner.start(s, true, c.suPath, logDir, argv);
        s.setProcess(p);
        ProcessRunner.stream(s, p, null);
        s.setState(VmSession.State.RUNNING);
        s.log("container booting — watch the log for init/zygote output");
    }

    /** The full mount-and-boot script, written to disk and usable by hand. */
    private String bootScript(Capability c, String rootfs, DeviceIdentity d, boolean useProot) {
        StringBuilder sb = new StringBuilder();
        sb.append("#!/system/bin/sh\n");
        sb.append("# NeurioVM — redroid container boot for \"").append(d.displayName()).append("\"\n");
        sb.append("# Generated ").append(new Date()).append('\n');
        sb.append("# Run with:  su -c 'sh redroid-boot.sh'\n");
        sb.append("set -x\n\n");
        sb.append("ROOTFS=").append(ProcessRunner.quote(rootfs)).append('\n');
        sb.append("[ -d \"$ROOTFS\" ] || { echo \"rootfs missing: $ROOTFS\"; exit 1; }\n\n");

        sb.append("# --- pseudo filesystems ---\n");
        sb.append("mkdir -p \"$ROOTFS/proc\" \"$ROOTFS/sys\" \"$ROOTFS/dev\" \"$ROOTFS/dev/pts\" ")
                .append("\"$ROOTFS/dev/shm\" \"$ROOTFS/dev/binderfs\" \"$ROOTFS/data\" \"$ROOTFS/sdcard\"\n");
        sb.append("mount -t proc proc \"$ROOTFS/proc\"\n");
        sb.append("mount -t sysfs sysfs \"$ROOTFS/sys\"\n");
        sb.append("mount -t devpts devpts \"$ROOTFS/dev/pts\"\n");
        sb.append("mount -t tmpfs tmpfs \"$ROOTFS/dev/shm\"\n\n");

        sb.append("# --- binder: the host kernel must provide one of these ---\n");
        sb.append("if [ -d /dev/binderfs ]; then\n");
        sb.append("  mount --bind /dev/binderfs \"$ROOTFS/dev/binderfs\"\n");
        sb.append("elif [ -e /dev/binder ]; then\n");
        sb.append("  for n in binder hwbinder vndbinder; do\n");
        sb.append("    [ -e /dev/$n ] && cp -a /dev/$n \"$ROOTFS/dev/$n\"\n");
        sb.append("  done\n");
        sb.append("else\n");
        sb.append("  echo 'no binder device on the host kernel — the container cannot boot'\n");
        sb.append("  exit 2\n");
        sb.append("fi\n\n");

        sb.append("# --- ashmem, or memfd on newer kernels ---\n");
        sb.append("[ -e /dev/ashmem ] && cp -a /dev/ashmem \"$ROOTFS/dev/ashmem\"\n\n");

        sb.append("# --- guest identity, taken from the virtual device ---\n");
        sb.append("cat > \"$ROOTFS/default.prop\" <<'PROP'\n");
        sb.append("ro.product.model=").append(d.model).append('\n');
        sb.append("ro.product.brand=").append(d.brand).append('\n');
        sb.append("ro.product.manufacturer=").append(d.manufacturer).append('\n');
        sb.append("ro.product.device=").append(d.device).append('\n');
        sb.append("ro.product.name=").append(d.product).append('\n');
        sb.append("ro.build.version.release=").append(d.release).append('\n');
        sb.append("ro.build.version.sdk=").append(d.sdkInt).append('\n');
        sb.append("ro.build.fingerprint=").append(d.fingerprint).append('\n');
        sb.append("ro.build.version.security_patch=").append(d.securityPatch).append('\n');
        sb.append("ro.serialno=").append(d.serial).append('\n');
        sb.append("ro.boot.hardware=redroid\n");
        sb.append("persist.sys.timezone=").append(d.timezoneId).append('\n');
        sb.append("persist.sys.locale=").append(d.language).append('-').append(d.country).append('\n');
        sb.append("PROP\n\n");

        if (useProot && c.prootPath != null) {
            sb.append("exec ").append(ProcessRunner.render(prootArgv(c, rootfs, d))).append('\n');
        } else {
            sb.append("exec chroot \"$ROOTFS\" /init")
                    .append(" androidboot.hardware=redroid")
                    .append(" androidboot.serialno=").append(d.serial)
                    .append(" ro.product.model=").append(shellQuote(d.model))
                    .append(" ro.product.brand=").append(shellQuote(d.brand))
                    .append(" ro.build.version.release=").append(d.release)
                    .append(" ro.build.fingerprint=").append(shellQuote(d.fingerprint))
                    .append(" persist.sys.timezone=").append(d.timezoneId)
                    .append('\n');
        }
        return sb.toString();
    }

    /** {@code proot -0 -r rootfs -b /dev -b /sys -b /proc /init …} */
    private List<String> prootArgv(Capability c, String rootfs, DeviceIdentity d) {
        List<String> a = new ArrayList<>();
        a.add(c.prootPath);
        a.add("-0");                       // fake uid 0
        a.add("-r"); a.add(rootfs);
        a.add("-b"); a.add("/dev");
        a.add("-b"); a.add("/sys");
        a.add("-b"); a.add("/proc");
        a.add("-b"); a.add("/sdcard");
        a.add("-w"); a.add("/");
        a.add("/init");
        a.add("androidboot.hardware=redroid");
        a.add("androidboot.serialno=" + d.serial);
        a.add("ro.product.model=" + d.model);
        a.add("ro.product.brand=" + d.brand);
        a.add("ro.build.version.release=" + d.release);
        a.add("ro.build.fingerprint=" + d.fingerprint);
        a.add("persist.sys.timezone=" + d.timezoneId);
        return a;
    }

    private static String shellQuote(String s) {
        return "'" + (s == null ? "" : s.replace("'", "'\\''")) + "'";
    }

    @Override
    public void stop(VmSession s) {
        Process p = s.process();
        if (p != null) {
            s.log("stopping the container");
            p.destroy();
        }
        s.setProcess(null);
        s.setState(VmSession.State.STOPPED);
    }
}
