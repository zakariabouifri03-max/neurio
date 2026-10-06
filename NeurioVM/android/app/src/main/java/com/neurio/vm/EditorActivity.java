package com.neurio.vm;

import android.app.Activity;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;

import com.neurio.vm.core.DeviceCatalog;
import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.IdentityFactory;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.spoof.UserAgents;
import com.neurio.vm.util.Ui;

/**
 * The identity editor: every field a fingerprint is built from, in one form.
 *
 * <p>Two deliberate design choices:
 * <ul>
 *   <li><b>The preset spinners write, the text fields win.</b> Picking a handset
 *       or a carrier overwrites the related fields, but anything you type after
 *       that is yours — the form is the source of truth on save.</li>
 *   <li><b>A new device starts life already consistent.</b> The draft is a fully
 *       generated retail identity, so saving without touching anything still
 *       produces a plausible handset rather than a half-empty one.</li>
 * </ul>
 *
 * <p>The live preview shows the derived fingerprint and the exact User-Agent
 * the browser will send, because those two strings are what a service sees
 * first and are the hardest to keep consistent by hand.
 */
public final class EditorActivity extends Activity {

    public static final String EXTRA_DEVICE = "deviceId";

    private ProfileStore store;
    private DeviceIdentity.Builder builder;
    private boolean editing;
    /**
     * A Spinner fires onItemSelected once during its first layout, which would
     * overwrite a device being edited with preset #0. Ignored until the initial
     * population has settled.
     */
    private boolean spinnersLive;
    private String existingId;
    private long createdAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_editor);
        store = ProfileStore.get(this);

        String id = getIntent().getStringExtra(EXTRA_DEVICE);
        DeviceIdentity existing = id == null ? null : store.get(id);
        if (existing != null) {
            builder = existing.toBuilder();
            existingId = existing.id;
            createdAt = existing.createdAt;
            editing = true;
        } else {
            builder = IdentityFactory.randomRetail().toBuilder();
            editing = false;
        }

        ((TextView) findViewById(R.id.h_title)).setText(editing
                ? getString(R.string.editor_title_edit)
                : getString(R.string.editor_title_new));

        wireSpinners();
        writeFields();
        wireButtons();
        wireLayers();
        wirePreview();
        refreshPreview();

        // the spinners settle asynchronously; arm them one frame later
        findViewById(android.R.id.content).post(() -> spinnersLive = true);
    }

    // ── spinners ───────────────────────────────────────────────────────────

    private void wireSpinners() {
        Spinner preset = findViewById(R.id.e_preset);
        DeviceCatalog.Preset[] presets = DeviceCatalog.all();
        ArrayAdapter<CharSequence> pa = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, DeviceCatalog.names());
        pa.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        preset.setAdapter(pa);
        preset.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long i) {
                if (!spinnersLive) return;
                DeviceCatalog.Preset p = presets[position];
                p.apply(builder);
                builder.label = p.name;
                applyCarrierFrom(builder);
                writeFields();
                refreshPreview();
            }

            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        Spinner carrier = findViewById(R.id.e_carrier);
        ArrayAdapter<IdentityFactory.Carrier> ca = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, IdentityFactory.CARRIERS);
        ca.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        carrier.setAdapter(ca);
        carrier.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long i) {
                if (!spinnersLive) return;
                IdentityFactory.Carrier c = IdentityFactory.CARRIERS[position];
                builder.timezoneId = c.timezone;
                builder.language = c.language;
                builder.country = c.country.isEmpty() ? "US" : c.country;
                builder.operatorName = c.name;
                builder.operatorMccMnc = c.mccMnc;
                builder.simCountry = c.country;
                writeFields();
                refreshPreview();
            }

            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
    }

    /** Points the carrier spinner at whichever carrier matches the draft. */
    private void applyCarrierFrom(DeviceIdentity.Builder b) {
        Spinner carrier = findViewById(R.id.e_carrier);
        for (int i = 0; i < IdentityFactory.CARRIERS.length; i++) {
            if (IdentityFactory.CARRIERS[i].mccMnc.equals(b.operatorMccMnc)) {
                carrier.setSelection(i);
                return;
            }
        }
    }

    // ── field <-> builder ──────────────────────────────────────────────────

    private void writeFields() {
        set(R.id.e_label, builder.label);
        set(R.id.e_manufacturer, builder.manufacturer);
        set(R.id.e_brand, builder.brand);
        set(R.id.e_model, builder.model);
        set(R.id.e_device, builder.device);
        set(R.id.e_board, builder.board);
        set(R.id.e_hardware, builder.hardware);
        set(R.id.e_release, builder.release);
        set(R.id.e_sdk, String.valueOf(builder.sdkInt));
        set(R.id.e_buildid, builder.buildId);
        set(R.id.e_patch, builder.securityPatch);
        set(R.id.e_width, String.valueOf(builder.screenWidth));
        set(R.id.e_height, String.valueOf(builder.screenHeight));
        set(R.id.e_dpi, String.valueOf(builder.densityDpi));
        set(R.id.e_timezone, builder.timezoneId);
        set(R.id.e_language, builder.language);
        set(R.id.e_country, builder.country);
        set(R.id.e_chrome, String.valueOf(builder.chromeMajor));

        ((SeekBar) findViewById(R.id.e_battery)).setProgress(builder.batteryLevel);

        ((CheckBox) findViewById(R.id.c_build)).setChecked(builder.spoofBuild);
        ((CheckBox) findViewById(R.id.c_settings)).setChecked(builder.spoofSettings);
        ((CheckBox) findViewById(R.id.c_telephony)).setChecked(builder.spoofTelephony);
        ((CheckBox) findViewById(R.id.c_webview)).setChecked(builder.spoofWebView);
        ((CheckBox) findViewById(R.id.c_js)).setChecked(builder.spoofJsApi);
        ((CheckBox) findViewById(R.id.c_webgl)).setChecked(builder.spoofWebGl);
        ((CheckBox) findViewById(R.id.c_canvas)).setChecked(builder.spoofCanvas);
        ((CheckBox) findViewById(R.id.c_battery)).setChecked(builder.spoofBattery);
    }

    private void set(int viewId, String value) {
        ((EditText) findViewById(viewId)).setText(value == null ? "" : value);
    }

    private String get(int viewId) {
        return ((EditText) findViewById(viewId)).getText().toString().trim();
    }

    private int getInt(int viewId, int fallback) {
        try {
            return Integer.parseInt(get(viewId));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void readFields() {
        builder.label = get(R.id.e_label);
        builder.manufacturer = get(R.id.e_manufacturer);
        builder.brand = get(R.id.e_brand);
        builder.model = get(R.id.e_model);
        builder.device = get(R.id.e_device);
        builder.board = get(R.id.e_board);
        builder.hardware = get(R.id.e_hardware);
        builder.product = builder.device;
        builder.release = get(R.id.e_release);
        builder.sdkInt = getInt(R.id.e_sdk, 34);
        builder.buildId = get(R.id.e_buildid);
        builder.securityPatch = get(R.id.e_patch);
        builder.screenWidth = getInt(R.id.e_width, 1080);
        builder.screenHeight = getInt(R.id.e_height, 2400);
        builder.densityDpi = getInt(R.id.e_dpi, 420);
        builder.timezoneId = get(R.id.e_timezone);
        builder.language = get(R.id.e_language);
        builder.country = get(R.id.e_country);
        builder.chromeMajor = getInt(R.id.e_chrome, 128);
        builder.batteryLevel = ((SeekBar) findViewById(R.id.e_battery)).getProgress();
        builder.fingerprint = null; // always re-derive from what was just typed

        builder.spoofBuild = ((CheckBox) findViewById(R.id.c_build)).isChecked();
        builder.spoofSettings = ((CheckBox) findViewById(R.id.c_settings)).isChecked();
        builder.spoofTelephony = ((CheckBox) findViewById(R.id.c_telephony)).isChecked();
        builder.spoofWebView = ((CheckBox) findViewById(R.id.c_webview)).isChecked();
        builder.spoofJsApi = ((CheckBox) findViewById(R.id.c_js)).isChecked();
        builder.spoofWebGl = ((CheckBox) findViewById(R.id.c_webgl)).isChecked();
        builder.spoofCanvas = ((CheckBox) findViewById(R.id.c_canvas)).isChecked();
        builder.spoofBattery = ((CheckBox) findViewById(R.id.c_battery)).isChecked();
    }

    // ── buttons / layers / preview ─────────────────────────────────────────

    private void wireButtons() {
        findViewById(R.id.b_rand_all).setOnClickListener(v -> {
            DeviceIdentity fresh = IdentityFactory.randomRetail();
            builder = fresh.toBuilder();
            writeFields();
            refreshPreview();
        });
        findViewById(R.id.b_rand_ids).setOnClickListener(v -> {
            readFields();
            DeviceIdentity draft = builder.build();
            builder = IdentityFactory.reissue(draft).toBuilder();
            Ui.toast(this, getString(R.string.device_reissued, draft.displayName()));
        });
        findViewById(R.id.b_cancel).setOnClickListener(v -> finish());
        findViewById(R.id.b_save).setOnClickListener(v -> save());

        ((SeekBar) findViewById(R.id.e_battery)).setOnSeekBarChangeListener(
                new SeekBar.OnSeekBarChangeListener() {
                    @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                        builder.batteryLevel = progress;
                    }

                    @Override public void onStartTrackingTouch(SeekBar bar) { }
                    @Override public void onStopTrackingTouch(SeekBar bar) { }
                });
    }

    private void wireLayers() {
        int[] boxes = {R.id.c_build, R.id.c_settings, R.id.c_telephony, R.id.c_webview,
                R.id.c_js, R.id.c_webgl, R.id.c_canvas, R.id.c_battery};
        for (int id : boxes) {
            ((CheckBox) findViewById(id)).setOnCheckedChangeListener((buttonView, isChecked) -> {
                readFields();
                refreshPreview();
            });
        }
    }

    private void wirePreview() {
        TextWatcher watcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }

            @Override
            public void afterTextChanged(Editable s) {
                readFields();
                refreshPreview();
            }
        };
        int[] fields = {R.id.e_manufacturer, R.id.e_brand, R.id.e_model, R.id.e_device,
                R.id.e_release, R.id.e_buildid};
        for (int id : fields) {
            ((EditText) findViewById(id)).addTextChangedListener(watcher);
        }
    }

    private void refreshPreview() {
        DeviceIdentity draft = builder.build();
        ((TextView) findViewById(R.id.p_fp)).setText(draft.fingerprint);
        ((TextView) findViewById(R.id.p_ua)).setText(UserAgents.chrome(draft));

        boolean known = false;
        for (DeviceCatalog.Preset p : DeviceCatalog.all()) {
            if (p.brand.equals(draft.brand) && p.device.equals(draft.device)) {
                known = true;
                break;
            }
        }
        findViewById(R.id.p_warn).setVisibility(known ? View.GONE : View.VISIBLE);
    }

    // ── save ───────────────────────────────────────────────────────────────

    private void save() {
        readFields();
        if (builder.model == null || builder.model.isEmpty()) {
            Ui.toast(this, getString(R.string.error));
            return;
        }
        if (editing) {
            builder.id = existingId;
            builder.createdAt = createdAt;
            store.update(builder.build());
        } else {
            store.add(builder.build());
        }
        finish();
    }
}
