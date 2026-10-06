package com.neurio.vm;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.util.Log;
import com.neurio.vm.util.Ui;
import com.neurio.vm.vm.Backends;
import com.neurio.vm.vm.Capability;
import com.neurio.vm.vm.VmBackend;
import com.neurio.vm.vm.VmManager;
import com.neurio.vm.vm.VmService;
import com.neurio.vm.vm.VmSession;
import com.neurio.vm.vm.VmSettings;

import java.util.ArrayList;
import java.util.List;

/**
 * The hypervisor console: what this phone can actually do, and why.
 *
 * <p>This screen exists because "does it work?" has four different answers on
 * four different phones, and every other screen in the app would rather not
 * explain kernel modules. The capability report is printed in full, backends
 * are listed with an honest verdict each, and the session log streams live.
 *
 * <p>It is also where the paths for the backends that need external components
 * (qemu binary, guest image, redroid rootfs) are configured and saved.
 */
public final class ConsoleActivity extends Activity {

    private static final String TAG = "Console";

    private VmManager manager;
    private VmSettings settings;
    private ProfileStore store;
    private Capability capability;

    private TextView headline;
    private TextView caps;
    private TextView backends;
    private TextView sessions;
    private TextView logView;
    private Spinner backendPick;

    private final StringBuilder logBuffer = new StringBuilder();
    private final Log.Listener logListener = line -> Ui.ui(() -> {
        logBuffer.append(line.toString()).append('\n');
        if (logBuffer.length() > 60_000) logBuffer.delete(0, logBuffer.length() - 60_000);
        if (logView != null) logView.setText(logBuffer.toString());
    });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_console);

        manager = VmManager.get(this);
        settings = manager.settings();
        store = ProfileStore.get(this);

        headline = findViewById(R.id.c_headline);
        caps = findViewById(R.id.c_caps);
        backends = findViewById(R.id.c_backends);
        sessions = findViewById(R.id.c_sessions);
        logView = findViewById(R.id.c_log);
        backendPick = findViewById(R.id.c_backend_pick);

        loadSettings();
        populateBackendPicker();
        wire();

        for (Log.Line l : Log.snapshot()) {
            logBuffer.append(l.toString()).append('\n');
        }
        logView.setText(logBuffer.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.addListener(logListener);
        refresh(true);
        renderSessions();
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.removeListener(logListener);
    }

    private void wire() {
        findViewById(R.id.b_probe).setOnClickListener(v -> refresh(true));
        findViewById(R.id.b_start).setOnClickListener(v -> startActive());
        findViewById(R.id.b_stop).setOnClickListener(v -> {
            VmService.stopAll(this);
            manager.stopAll();
            renderSessions();
        });
        findViewById(R.id.b_save_settings).setOnClickListener(v -> saveSettings());
        findViewById(R.id.b_copy_log).setOnClickListener(v ->
                Ui.copy(this, "log", logBuffer.toString()));
        findViewById(R.id.b_share_log).setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, "NeurioVM log");
            i.putExtra(Intent.EXTRA_TEXT, logBuffer.toString());
            startActivity(Intent.createChooser(i, getString(R.string.console_share)));
        });
        findViewById(R.id.b_reset).setOnClickListener(v -> Ui.confirm(this,
                getString(R.string.console_danger), getString(R.string.console_danger_confirm),
                () -> Ui.bg(() -> {
                    store.factoryReset();
                    Ui.ui(this::finish);
                })));
    }

    // ── settings ───────────────────────────────────────────────────────────

    private void loadSettings() {
        ((EditText) findViewById(R.id.f_qemu_bin)).setText(settings.qemuBinary());
        ((EditText) findViewById(R.id.f_qemu_img)).setText(settings.qemuImage());
        ((EditText) findViewById(R.id.f_qemu_extra)).setText(settings.qemuExtraArgs());
        ((EditText) findViewById(R.id.f_qemu_mem)).setText(String.valueOf(settings.qemuMemoryMb()));
        ((EditText) findViewById(R.id.f_qemu_smp)).setText(String.valueOf(settings.qemuSmp()));
        ((CheckBox) findViewById(R.id.f_qemu_kvm)).setChecked(settings.qemuUseKvm());
        ((EditText) findViewById(R.id.f_rootfs)).setText(settings.redroidRootfs());
        ((CheckBox) findViewById(R.id.f_always_su)).setChecked(settings.alwaysUseSu());
        ((EditText) findViewById(R.id.f_home)).setText(settings.browserHome());
    }

    private void saveSettings() {
        settings.qemuBinary(text(R.id.f_qemu_bin));
        settings.qemuImage(text(R.id.f_qemu_img));
        settings.qemuExtraArgs(text(R.id.f_qemu_extra));
        settings.qemuMemoryMb(number(R.id.f_qemu_mem, 2048));
        settings.qemuSmp(number(R.id.f_qemu_smp, 4));
        settings.qemuUseKvm(((CheckBox) findViewById(R.id.f_qemu_kvm)).isChecked());
        settings.redroidRootfs(text(R.id.f_rootfs));
        settings.alwaysUseSu(((CheckBox) findViewById(R.id.f_always_su)).isChecked());
        String home = text(R.id.f_home);
        settings.browserHome(home.isEmpty() ? "https://duckduckgo.com/" : home);
        Ui.toast(this, getString(R.string.editor_save) + " ✓");
        refresh(false);
    }

    private String text(int id) {
        return ((EditText) findViewById(id)).getText().toString().trim();
    }

    private int number(int id, int fallback) {
        try {
            return Integer.parseInt(text(id));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void populateBackendPicker() {
        List<String> names = new ArrayList<>();
        names.add(getString(R.string.console_auto));
        for (VmBackend b : Backends.all(settings)) names.add(b.name());
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, names);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        backendPick.setAdapter(adapter);

        String chosen = settings.preferredBackend();
        if (chosen != null && !chosen.isEmpty()) {
            int idx = 0;
            for (VmBackend b : Backends.all(settings)) {
                idx++;
                if (b.id().equals(chosen)) { backendPick.setSelection(idx); break; }
            }
        }
    }

    private String chosenBackendId() {
        int sel = backendPick.getSelectedItemPosition();
        if (sel <= 0) return ""; // auto
        VmBackend b = Backends.all(settings).get(sel - 1);
        return b.id();
    }

    // ── rendering ──────────────────────────────────────────────────────────

    private void refresh(boolean force) {
        headline.setText(getString(R.string.console_probing));
        manager.probe(this::render, force);
    }

    private void render(Capability c) {
        capability = c;
        Ui.ui(() -> {
            headline.setText(c.headline());
            StringBuilder sb = new StringBuilder();
            for (String line : c.report()) sb.append(line).append('\n');
            caps.setText(sb.toString());

            StringBuilder bb = new StringBuilder();
            for (String line : Backends.describeAll(c, settings)) bb.append(line).append('\n');
            backends.setText(bb.toString());

            renderSessions();
        });
    }

    private void renderSessions() {
        List<VmSession> list = manager.sessions();
        if (list.isEmpty()) {
            sessions.setText(getString(R.string.console_no_sessions));
            return;
        }
        StringBuilder sb = new StringBuilder();
        for (VmSession s : list) {
            sb.append(s.device().displayName())
                    .append("  [").append(s.backendId()).append("]  ")
                    .append(s.state());
            if (s.state() == VmSession.State.RUNNING || s.state() == VmSession.State.DEGRADED) {
                sb.append("  ").append(s.uptimeText());
            }
            if (s.failure() != null) sb.append("  ← ").append(s.failure());
            sb.append('\n');
        }
        sessions.setText(sb.toString());
    }

    // ── starting the active device ─────────────────────────────────────────

    private void startActive() {
        final DeviceIdentity d = store.active();
        if (d == null) {
            Ui.toast(this, getString(R.string.browser_no_device));
            return;
        }
        final String backendId = chosenBackendId();
        manager.start(d, backendId, (session, error) -> Ui.ui(() -> {
            if (error != null) {
                Ui.alert(this, getString(R.string.state_failed), session.failure());
            }
            renderSessions();
        }));
        VmService.start(this, d, backendId);
    }
}
