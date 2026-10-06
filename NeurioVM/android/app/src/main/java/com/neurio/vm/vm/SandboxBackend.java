package com.neurio.vm.vm;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.ProcessBridge;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.runtime.SlotTable;
import com.neurio.vm.util.Io;

/**
 * The backend that always works: a virtual handset that lives inside this app.
 *
 * <p>What "running" means here, concretely:
 * <ul>
 *   <li>the device's sandbox tree is created
 *       ({@code filesDir/vm/<uuid>/{files,cache,prefs,databases,downloads}});</li>
 *   <li>its encrypted identity is written into that sandbox so an isolated
 *       browser process can boot the device on its own after being killed;</li>
 *   <li>a slot ({@code :vm0}…{@code :vm3}) is reserved, which is what gives the
 *       device its own Chromium profile — cookies, localStorage, IndexedDB,
 *       service workers and HTTP cache;</li>
 *   <li>the active-device pointer is published.</li>
 * </ul>
 *
 * <p>What it is <b>not</b>: a second kernel. Native apps installed on the phone
 * still read the real {@code android.os.Build}, because that is a field in their
 * own process and only a hook framework can rewrite it. For those, the
 * {@code hook} module in this app does the job on a device with LSPosed — see
 * {@link com.neurio.vm.hook.NeurioHook}.
 */
public final class SandboxBackend implements VmBackend {

    public static final String ID = "sandbox";

    @Override public String id() { return ID; }

    @Override public String name() { return "In-app sandbox"; }

    @Override
    public String tagline() {
        return "A second handset inside this app: own storage, own browser profile, own identity.";
    }

    @Override
    public String detail() {
        return "Creates an isolated runtime for one synthetic device. Files, preferences, "
                + "databases, downloads and the whole Chromium profile (cookies, localStorage, "
                + "IndexedDB, service workers, cache) are kept per device, and every web API a "
                + "fingerprinting script reads is rewritten to match the identity: User-Agent, "
                + "Client Hints, screen geometry, timezone, WebGL vendor/renderer, canvas and "
                + "audio hashes, battery, network and WebRTC local addresses.\n\n"
                + "Up to " + SlotTable.SLOTS + " devices can run at the same time, each in its own "
                + "process. This backend needs no permission, no root and no external binary, and "
                + "it is the only one that works on a stock retail phone.\n\n"
                + "Limit: it changes what *web* content sees. A natively installed app still reads "
                + "the real android.os.Build in its own process — rewriting that needs the LSPosed "
                + "hook module, and the console tells you whether it is active.";
    }

    @Override public Requirement requirement() { return Requirement.NONE; }

    @Override public boolean isAvailable(Capability c) { return true; }

    @Override
    public String verdict(Capability c) {
        if (c == null) return "Available.";
        if (!c.webViewSuffixApi) {
            return "Available, but degraded: Android " + c.release + " (API " + c.sdkInt + ") has no "
                    + "WebView.setDataDirectorySuffix, so cookies and localStorage cannot be kept "
                    + "per device. File, preference and identity isolation still apply.";
        }
        return "Available. " + SlotTable.SLOTS + " concurrent isolated browser profiles.";
    }

    @Override
    public void start(VmSession s) {
        DeviceIdentity d = s.device();
        s.log("bringing up the in-app sandbox for " + d.displayName());
        Sandbox.ensure(s.context(), d);
        Sandbox.saveIdentity(s.context(), d);
        Sandbox.writeActivePointer(s.context(), d.id);

        int slot = SlotTable.acquire(s.context(), d.id);
        if (slot < 0) {
            throw new IllegalStateException("could not reserve an isolated browser slot");
        }
        s.setSlot(slot);
        s.log("sandbox root: " + Sandbox.dir(s.context(), d));
        s.log("isolated browser process: :vm" + slot
                + "  (WebView profile suffix '" + Sandbox.webViewSuffix(d) + "')");
        s.log("storage in use by this device: " + Io.humanBytes(Sandbox.size(s.context(), d)));

        if (!ProcessBridge.isolationSupported()) {
            s.setState(VmSession.State.DEGRADED,
                    "WebView profile isolation needs API 28; this device reports API "
                            + android.os.Build.VERSION.SDK_INT);
            return;
        }
        s.log("device is up — launch the browser to use it");
        s.setState(VmSession.State.RUNNING);
    }

    @Override
    public void stop(VmSession s) {
        s.log("sandbox released; the device's data stays on disk");
        s.setProcess(null);
        s.setState(VmSession.State.STOPPED);
    }
}
