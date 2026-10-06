package com.neurio.vm;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.CompoundButton;
import android.widget.Switch;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.IdentityFactory;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.hook.HookConfig;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.runtime.SlotTable;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;
import com.neurio.vm.util.Ui;
import com.neurio.vm.vm.Backends;
import com.neurio.vm.vm.VmBackend;
import com.neurio.vm.vm.VmManager;
import com.neurio.vm.vm.VmService;
import com.neurio.vm.vm.VmSession;

/**
 * One virtual handset: what it claims to be, where its data lives, and the
 * buttons that put it to work.
 *
 * <p>The status card polls once a second while visible — cheap, and it keeps
 * uptime and backend state honest without a service binding.
 */
public final class DeviceActivity extends Activity {

    public static final String EXTRA_DEVICE = "deviceId";
    private static final String TAG = "DeviceActivity";
    private static final int REQUEST_EXPORT = 43;

    private ProfileStore store;
    private DeviceIdentity device;
    private String pendingExport;
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private boolean visible;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_device);
        store = ProfileStore.get(this);
        device = store.get(getIntent().getStringExtra(EXTRA_DEVICE));
        if (device == null) {
            Ui.toast(this, getString(R.string.browser_no_device));
            finish();
            return;
        }
        wire();
    }

    @Override
    protected void onResume() {
        super.onResume();
        device = store.get(device.id); // pick up edits made in the editor
        visible = true;
        render();
        tick();
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        ticker.removeCallbacksAndMessages(null);
    }

    private void tick() {
        if (!visible) return;
        renderStatus();
        ticker.postDelayed(this::tick, 1000);
    }

    // ── wiring ─────────────────────────────────────────────────────────────

    private void wire() {
        findViewById(R.id.b_start).setOnClickListener(v -> startVm());
        findViewById(R.id.b_stop).setOnClickListener(v -> stopVm());
        findViewById(R.id.b_browser).setOnClickListener(v -> openBrowser());
        findViewById(R.id.b_terminal).setOnClickListener(v -> {
            Intent i = new Intent(this, TerminalActivity.class);
            i.putExtra(EXTRA_DEVICE, device.id);
            startActivity(i);
        });
        findViewById(R.id.b_edit).setOnClickListener(v -> {
            Intent i = new Intent(this, EditorActivity.class);
            i.putExtra(EditorActivity.EXTRA_DEVICE, device.id);
            startActivity(i);
        });
        findViewById(R.id.b_reissue).setOnClickListener(v -> Ui.confirm(this,
                device.displayName(), getString(R.string.device_confirm_reissue, device.displayName()),
                () -> Ui.bg(() -> {
                    DeviceIdentity next = IdentityFactory.reissue(device);
                    store.update(next);
                    device = next;
                    Ui.ui(() -> {
                        Ui.toast(this, getString(R.string.device_reissued, device.displayName()));
                        render();
                    });
                })));
        findViewById(R.id.b_clone).setOnClickListener(v -> Ui.bg(() -> {
            DeviceIdentity copy = store.add(IdentityFactory.clone(device, null));
            Ui.ui(() -> Ui.toast(this, getString(R.string.device_cloned, copy.displayName())));
        }));
        findViewById(R.id.b_delete).setOnClickListener(v -> Ui.confirm(this,
                getString(R.string.device_delete), getString(R.string.device_confirm_delete, device.displayName()),
                () -> Ui.bg(() -> {
                    SlotTable.release(this, device.id);
                    store.remove(device.id);
                    Ui.ui(this::finish);
                })));
        findViewById(R.id.b_export).setOnClickListener(v -> export());

        final Switch hook = findViewById(R.id.hook_switch);
        HookConfig cfg = HookConfig.load(this);
        hook.setChecked(cfg != null && cfg.enabled && device.id.equals(
                cfg.identity == null ? null : cfg.identity.id));
        hook.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                publishHook(isChecked, hook);
            }
        });
        findViewById(R.id.b_hook_apps).setOnClickListener(v -> {
            Intent i = new Intent(this, HookAppsActivity.class);
            i.putExtra(EXTRA_DEVICE, device.id);
            startActivity(i);
        });
    }

    private void publishHook(boolean enabled, Switch hook) {
        HookConfig existing = HookConfig.load(this);
        java.util.Set<String> pkgs = existing == null
                ? new java.util.HashSet<>() : new java.util.HashSet<>(existing.packages);
        HookConfig.publish(this, device, pkgs, enabled);
        Ui.toast(this, getString(R.string.hook_saved));
        renderHook();
    }

    // ── lifecycle of the VM ────────────────────────────────────────────────

    private void startVm() {
        VmManager mgr = VmManager.get(this);
        mgr.probe(c -> {
            VmBackend b = Backends.preferred(c, mgr.settings());
            Ui.ui(() -> Ui.toast(this, getString(R.string.device_backend, b.name())
                    + "\n" + Backends.tier(b)));
            mgr.start(device, b.id(), (session, error) -> Ui.ui(() -> {
                if (error != null) {
                    Ui.alert(this, getString(R.string.state_failed), session.failure());
                }
                renderStatus();
            }));
            VmService.start(this, device, b.id());
        }, false);
    }

    private void stopVm() {
        VmService.stopDevice(this, device);
        VmManager.get(this).stop(device);
        renderStatus();
    }

    /**
     * Binds this device to an isolated browser process and opens it.
     * The slot choice is what gives the device its own Chromium profile.
     */
    private void openBrowser() {
        Ui.bg(() -> {
            final int slot = SlotTable.acquire(this, device.id);
            Ui.ui(() -> {
                if (slot < 0) {
                    Ui.toast(this, getString(R.string.error));
                    return;
                }
                Sandbox.writeActivePointer(this, device.id);
                Intent i = new Intent(this, BrowserActivity.slotClass(slot));
                startActivity(i);
            });
        });
    }

    // ── rendering ──────────────────────────────────────────────────────────

    private void render() {
        if (device == null) return;
        ((TextView) findViewById(R.id.h_title)).setText(device.displayName());
        ((TextView) findViewById(R.id.h_sub)).setText(
                device.manufacturer + " · " + device.model + " · Android " + device.release
                        + " (API " + device.sdkInt + ")");
        ((TextView) findViewById(R.id.h_fp)).setText(device.fingerprint);

        ((TextView) findViewById(R.id.i_build)).setText(
                "MODEL        " + device.model + "\n"
                        + "BRAND        " + device.brand + "\n"
                        + "MANUFACTURER " + device.manufacturer + "\n"
                        + "DEVICE       " + device.device + "\n"
                        + "PRODUCT      " + device.product + "\n"
                        + "BOARD        " + device.board + "\n"
                        + "HARDWARE     " + device.hardware + "\n"
                        + "BOOTLOADER   " + device.bootloader + "\n"
                        + "DISPLAY      " + device.displayId + "\n"
                        + "ID           " + device.buildId + "\n"
                        + "FINGERPRINT  " + device.fingerprint + "\n"
                        + "SEC_PATCH    " + device.securityPatch + "\n"
                        + "KERNEL       " + device.kernel);

        ((TextView) findViewById(R.id.i_ids)).setText(
                "ANDROID_ID    " + device.androidId + "\n"
                        + "GSF_ID        " + device.gsfId + "\n"
                        + "AD_ID         " + device.advertisingId + "\n"
                        + "SERIAL        " + device.serial + "\n"
                        + "IMEI          " + device.imei + "  (valid Luhn)\n"
                        + "MEID          " + device.meid + "\n"
                        + "IMSI          " + device.imsi + "\n"
                        + "ICCID         " + device.simSerial + "\n"
                        + "OPERATOR      " + device.operatorName + " (" + device.operatorMccMnc + ")\n"
                        + "WIFI_MAC      " + device.wifiMac + "\n"
                        + "BT_MAC        " + device.bluetoothMac);

        ((TextView) findViewById(R.id.i_display)).setText(
                "SCREEN     " + device.screenWidth + "×" + device.screenHeight
                        + " px @ " + device.densityDpi + " dpi\n"
                        + "CSS_SIZE   " + device.screenWidthDp() + "×" + device.screenHeightDp()
                        + " dp  (dpr " + String.format(java.util.Locale.US, "%.2f", device.densityFactor()) + ")\n"
                        + "TIMEZONE   " + device.timezoneId + "\n"
                        + "LOCALE     " + device.localeTag() + "\n"
                        + "CHROME     " + device.chromeMajor
                        + "  →  " + com.neurio.vm.spoof.UserAgents.fullVersion(device));

        renderHook();
        renderStatus();
    }

    private void renderHook() {
        HookConfig cfg = HookConfig.load(this);
        TextView note = findViewById(R.id.hook_note);
        TextView status = findViewById(R.id.hook_status);
        boolean lsp = lspActive();
        note.setText(lsp ? "" : getString(R.string.hook_not_active));

        if (cfg == null || !cfg.enabled || cfg.identity == null) {
            status.setText(getString(R.string.main_hook, getString(R.string.main_hook_off)));
        } else if (!device.id.equals(cfg.identity.id)) {
            status.setText("publishing " + cfg.identity.displayName() + " (a different device)");
        } else {
            String where = "all".equals(cfg.mode) ? "all apps" : cfg.packages.size() + " app(s)";
            status.setText("→ " + where);
        }
    }

    /**
     * A cheap, honest signal for whether LSPosed is loading this module: the
     * framework exposes itself through {@code XposedBridge} system properties
     * and, more reliably, through the module log. Without root we cannot be
     * sure, so we report the best available evidence and never claim success.
     */
    private boolean lspActive() {
        try {
            String prop = System.getProperty("xposed.version");
            if (prop != null) return true;
        } catch (Throwable ignored) { }
        return Io.exists("/data/adb/lspd") || Io.exists("/data/adb/modules/zygisk_lsposed")
                || Io.exists("/data/adb/lspd/log");
    }

    private void renderStatus() {
        VmManager mgr = VmManager.get(this);
        VmSession s = mgr.sessionOf(device.id);
        VmBackend backend = Backends.preferred(mgr.capability(), mgr.settings());

        ((TextView) findViewById(R.id.s_backend)).setText(
                getString(R.string.device_backend, s == null ? backend.name() + " (auto)" : backend.name()));
        ((TextView) findViewById(R.id.s_state)).setText(
                getString(R.string.device_state, s == null ? getString(R.string.state_stopped) : stateText(s.state())));
        ((TextView) findViewById(R.id.s_uptime)).setText(
                getString(R.string.device_uptime, s == null ? "--:--:--" : s.uptimeText()));
        int slot = SlotTable.slotOf(this, device.id);
        ((TextView) findViewById(R.id.s_slot)).setText(getString(R.string.device_slot, Math.max(slot, 0)));
        ((TextView) findViewById(R.id.s_size)).setText(
                getString(R.string.device_size, Io.humanBytes(Sandbox.size(this, device))));

        boolean running = s != null && (s.state() == VmSession.State.RUNNING
                || s.state() == VmSession.State.DEGRADED || s.state() == VmSession.State.STARTING);
        findViewById(R.id.b_start).setVisibility(running ? View.GONE : View.VISIBLE);
        findViewById(R.id.b_stop).setVisibility(running ? View.VISIBLE : View.GONE);
    }

    private String stateText(VmSession.State st) {
        switch (st) {
            case STARTING: return getString(R.string.state_starting);
            case RUNNING: return getString(R.string.state_running);
            case DEGRADED: return getString(R.string.state_degraded);
            case FAILED: return getString(R.string.state_failed);
            default: return getString(R.string.state_stopped);
        }
    }

    // ── export ────────────────────────────────────────────────────────────

    private void export() {
        try {
            pendingExport = ProfileStore.exportOne(device);
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, "neuriovm-" + device.id.substring(0, 8) + ".json");
            startActivityForResult(i, REQUEST_EXPORT);
        } catch (Exception e) {
            Ui.toast(this, getString(R.string.error) + ": " + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_EXPORT || resultCode != RESULT_OK || data == null) return;
        Uri target = data.getData();
        String json = pendingExport;
        pendingExport = null;
        if (target == null || json == null) return;
        final Uri u = target;
        final String j = json;
        Ui.bg(() -> {
            try (java.io.OutputStream out = getContentResolver().openOutputStream(u)) {
                if (out != null) out.write(j.getBytes(Io.UTF8));
            } catch (Exception e) {
                Log.e(TAG, "export write failed", e);
            }
            Ui.ui(() -> Ui.toast(this, getString(R.string.export_secret)));
        });
    }
}
