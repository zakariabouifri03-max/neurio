package com.neurio.vm;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Log;
import com.neurio.vm.util.Ui;
import com.neurio.vm.vm.ProcessRunner;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A shell that belongs to the virtual device.
 *
 * <p>Each command runs as its own {@code sh -c} process whose environment is the
 * device's: {@code HOME} and {@code TMPDIR} point into the sandbox, {@code TZ} is
 * the device's IANA zone, and the identifiers are exported as {@code NEURIO_*}
 * so a script can branch on which handset it is "running on". With the root box
 * ticked the command goes through {@code su -c} instead.
 *
 * <p>This is the escape hatch the other screens do not have: everything a
 * backend writes to disk (qemu launch scripts, redroid boot scripts, AVF
 * configs) can be read, edited and executed by hand from here.
 */
public final class TerminalActivity extends Activity {

    private static final String TAG = "Terminal";

    private DeviceIdentity device;
    private TextView out;
    private ScrollView scroll;
    private EditText input;
    private CheckBox asRoot;
    private final StringBuilder buffer = new StringBuilder();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_terminal);
        device = ProfileStore.get(this).get(getIntent().getStringExtra(DeviceActivity.EXTRA_DEVICE));
        if (device == null) {
            Ui.toast(this, getString(R.string.browser_no_device));
            finish();
            return;
        }

        out = findViewById(R.id.t_out);
        scroll = findViewById(R.id.t_scroll);
        input = findViewById(R.id.t_in);
        asRoot = findViewById(R.id.t_root);

        ((TextView) findViewById(R.id.t_device)).setText(
                device.displayName() + " · " + Sandbox.dir(this, device));

        banner();

        input.setOnEditorActionListener((TextView v, int actionId, KeyEvent event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                run();
                return true;
            }
            return false;
        });
        findViewById(R.id.t_run).setOnClickListener(v -> run());
        findViewById(R.id.t_clear).setOnClickListener(v -> {
            buffer.setLength(0);
            out.setText("");
        });
    }

    private void banner() {
        append("$ # " + device.displayName() + " — " + device.fingerprint + "\n");
        append("$ # HOME=" + Sandbox.files(this, device) + "  TZ=" + device.timezoneId + "\n");
        append("$ # " + getString(R.string.terminal_env) + "\n\n");
    }

    private void run() {
        final String cmd = input.getText().toString();
        input.setText("");
        if (cmd.trim().isEmpty()) return;

        append("$ " + cmd + "\n");
        Ui.bg(() -> execute(cmd, asRoot.isChecked()));
    }

    private void execute(String cmd, boolean root) {
        File home = Sandbox.files(this, device);
        Sandbox.ensure(this, device);

        List<String> argv = new ArrayList<>(3);
        if (root) {
            argv.add("su");
            argv.add("-c");
            argv.add(cmd);
        } else {
            argv.add("/system/bin/sh");
            argv.add("-c");
            argv.add(cmd);
        }

        ProcessBuilder pb = new ProcessBuilder(argv);
        pb.directory(home);
        Map<String, String> env = pb.environment();
        env.put("HOME", home.getPath());
        env.put("TMPDIR", Sandbox.cache(this, device).getPath());
        env.put("TZ", device.timezoneId);
        env.put("LANG", device.localeTag() + ".UTF-8");
        env.put("NEURIO_DEVICE", device.displayName());
        env.put("NEURIO_DEVICE_ID", device.id);
        env.put("NEURIO_MODEL", device.model);
        env.put("NEURIO_BRAND", device.brand);
        env.put("NEURIO_MANUFACTURER", device.manufacturer);
        env.put("NEURIO_FINGERPRINT", device.fingerprint);
        env.put("NEURIO_ANDROID_ID", device.androidId);
        env.put("NEURIO_IMEI", device.imei);
        env.put("NEURIO_SERIAL", device.serial);
        env.put("NEURIO_TIMEZONE", device.timezoneId);
        env.put("NEURIO_LOCALE", device.localeTag());
        env.put("NEURIO_SCREEN", device.screenWidth + "x" + device.screenHeight + "@" + device.densityDpi);
        env.put("NEURIO_SANDBOX", Sandbox.dir(this, device).getPath());
        env.put("NEURIO_DOWNLOADS", Sandbox.downloads(this, device).getPath());

        Process p = null;
        try {
            p = pb.start();
        } catch (Exception e) {
            Log.e(TAG, "could not start the shell", e);
            append("! " + e.getClass().getSimpleName() + ": " + e.getMessage() + "\n");
            return;
        }

        final Process proc = p;
        drain(proc.getInputStream(), "");
        drain(proc.getErrorStream(), "! ");
        try {
            int code = proc.waitFor();
            append("\n[exit " + code + "]\n\n");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            append("\n[interrupted]\n\n");
        }
    }

    private void drain(java.io.InputStream in, final String prefix) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                append(prefix + line + "\n");
            }
        } catch (Exception ignored) { }
    }

    /** Appends on the UI thread and keeps the view pinned to the newest line. */
    private void append(final String text) {
        Ui.ui(() -> {
            buffer.append(text);
            if (buffer.length() > 200_000) buffer.delete(0, buffer.length() - 200_000);
            out.setText(buffer.toString());
            scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
        });
    }
}
