package com.neurio.vm.runtime;

import android.webkit.JavascriptInterface;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.util.Log;

/**
 * The native side of the guest page: {@code window.NeurioVM}.
 *
 * <p>Deliberately tiny and read-only. A JavascriptInterface is a trust boundary
 * in the wrong direction — guest code can call it — so it exposes only what a
 * page is already allowed to see through the spoofed DOM APIs, plus a log
 * channel that {@code spoof.js} uses to report which layers it managed to
 * install. Nothing that mutates the sandbox is reachable from JavaScript.
 */
public final class Bridge {

    private static final String TAG = "Bridge";

    private final DeviceIdentity device;

    public Bridge(DeviceIdentity device) {
        this.device = device;
    }

    @JavascriptInterface
    public String getDevice() {
        return device == null ? "unknown" : device.displayName();
    }

    @JavascriptInterface
    public String getAndroidId() {
        return device == null ? "" : device.androidId;
    }

    @JavascriptInterface
    public String getFingerprint() {
        return device == null ? "" : device.fingerprint;
    }

    @JavascriptInterface
    public boolean isolationActive() {
        return ProcessBridge.isolationSupported() && ProcessBridge.suffix() != null;
    }

    /** Which isolated profile this process claimed, e.g. {@code nvm0}. */
    @JavascriptInterface
    public String getProfile() {
        String s = ProcessBridge.suffix();
        return s == null ? "shared" : s;
    }

    /** spoof.js calls this to report which layers it installed. */
    @JavascriptInterface
    public void log(String message) {
        Log.i(TAG, "[guest] " + message);
    }
}
