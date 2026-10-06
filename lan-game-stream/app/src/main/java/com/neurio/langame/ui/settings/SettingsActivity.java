package com.neurio.langame.ui.settings;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;

import com.neurio.langame.BuildConfig;
import com.neurio.langame.R;
import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.host.AudioCapture;
import com.neurio.langame.host.input.InputAdapterFactory;
import com.neurio.langame.ui.views.UiKit;

/**
 * Settings for video, audio and input.
 *
 * <p>Every option here is honest about its consequences: the input section spells
 * out that remote input needs either the accessibility service or root, and the
 * audio section says out loud that internal audio capture can be refused by the
 * game itself.</p>
 */
public class SettingsActivity extends Activity {

    private AppSettings settings;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        settings = new AppSettings(this);

        findViewById(R.id.btn_back).setOnClickListener(v -> finish());

        buildCodecRow();
        buildResolutionRow();
        buildFpsRow();
        buildBitrateRow();
        buildInputRow();

        Switch adaptive = findViewById(R.id.sw_adaptive);
        adaptive.setChecked(settings.adaptive());
        adaptive.setOnCheckedChangeListener((button, checked) -> {
            settings.setAdaptive(checked);
            saved();
        });

        Switch audio = findViewById(R.id.sw_audio);
        audio.setChecked(settings.captureAudio());
        audio.setOnCheckedChangeListener((button, checked) -> {
            settings.setCaptureAudio(checked);
            saved();
            updateAudioNote();
        });

        Switch haptics = findViewById(R.id.sw_haptics);
        haptics.setChecked(settings.haptics());
        haptics.setOnCheckedChangeListener((button, checked) -> {
            settings.setHaptics(checked);
            saved();
        });

        Switch keepOn = findViewById(R.id.sw_keep_screen_on);
        keepOn.setChecked(settings.keepScreenOn());
        keepOn.setOnCheckedChangeListener((button, checked) -> {
            settings.setKeepScreenOn(checked);
            saved();
        });

        findViewById(R.id.btn_accessibility).setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception e) {
                UiKit.toast(this, "Accessibility settings are not available on this device");
            }
        });

        findViewById(R.id.btn_reset_layout).setOnClickListener(v -> {
            settings.setControllerLayoutJson("");
            UiKit.toast(this, getString(R.string.settings_clear_layouts));
            saved();
        });

        TextView version = findViewById(R.id.about_version);
        version.setText(getString(R.string.app_name) + " " + BuildConfig.VERSION_NAME
                + " · protocol v" + Configuration.PROTOCOL_VERSION
                + " · ports " + Configuration.PORT_CONTROL + "/" + Configuration.PORT_INPUT
                + "/" + Configuration.PORT_VIDEO + "/" + Configuration.PORT_AUDIO);
        updateAudioNote();
    }

    private void saved() {
        TextView view = findViewById(R.id.settings_saved);
        view.setVisibility(TextView.VISIBLE);
        view.setAlpha(0f);
        view.animate().alpha(1f).setDuration(150).withEndAction(() ->
                view.animate().alpha(0f).setStartDelay(1200).setDuration(400).start()).start();
    }

    private void buildCodecRow() {
        LinearLayout row = findViewById(R.id.row_codec);
        String[] labels = {getString(R.string.settings_codec_h264), getString(R.string.settings_codec_h265)};
        Configuration.Codec[] codecs = {Configuration.Codec.AVC, Configuration.Codec.HEVC};
        Runnable rebuild = () -> {
            row.removeAllViews();
            for (int i = 0; i < codecs.length; i++) {
                final Configuration.Codec codec = codecs[i];
                boolean selected = settings.codec() == codec;
                if (codec == Configuration.Codec.HEVC
                        && com.neurio.langame.common.DeviceInfo.findCodec("video/hevc", true,
                        1280, 720, 30) == null) {
                    continue;   // this phone has no HEVC encoder — do not offer it
                }
                UiKit.addChip(row, UiKit.chip(this, labels[i], selected, v -> {
                    settings.setCodec(codec);
                    saved();
                }));
            }
        };
        rebuild.run();
        row.setTag(rebuild);
    }

    private void buildResolutionRow() {
        LinearLayout row = findViewById(R.id.row_resolution);
        int[] caps = {1080, 720, 480};
        String[] labels = {getString(R.string.settings_resolution_1080),
                getString(R.string.settings_resolution_720),
                getString(R.string.settings_resolution_480)};
        for (int i = 0; i < caps.length; i++) {
            final int cap = caps[i];
            boolean selected = settings.resolutionCap() == cap;
            UiKit.addChip(row, UiKit.chip(this, labels[i], selected, v -> {
                settings.setResolutionCap(cap);
                saved();
                recreate();
            }));
        }
    }

    private void buildFpsRow() {
        LinearLayout row = findViewById(R.id.row_fps);
        int[] values = {60, 30};
        for (int value : values) {
            final int fps = value;
            boolean selected = settings.targetFps() == fps;
            UiKit.addChip(row, UiKit.chip(this, fps + " fps", selected, v -> {
                settings.setTargetFps(fps);
                saved();
                recreate();
            }));
        }
    }

    private void buildBitrateRow() {
        LinearLayout row = findViewById(R.id.row_bitrate);
        int[] caps = {0, 4, 8, 12, 20};
        String[] labels = {"Auto", "4 Mbps", "8 Mbps", "12 Mbps", "20 Mbps"};
        for (int i = 0; i < caps.length; i++) {
            final int cap = caps[i];
            boolean selected = settings.bitrateCapMbps() == cap;
            UiKit.addChip(row, UiKit.chip(this, labels[i], selected, v -> {
                settings.setBitrateCapMbps(cap);
                saved();
                recreate();
            }));
        }
    }

    private void buildInputRow() {
        LinearLayout row = findViewById(R.id.row_input);
        TextView note = findViewById(R.id.input_note);
        Configuration.InputMode[] modes = {Configuration.InputMode.DISABLED,
                Configuration.InputMode.ACCESSIBILITY,
                Configuration.InputMode.ROOT_SHELL,
                Configuration.InputMode.LOCAL_SELFTEST};
        String[] labels = {getString(R.string.input_mode_disabled),
                getString(R.string.input_mode_accessibility),
                getString(R.string.input_mode_root),
                getString(R.string.input_mode_selftest)};
        Runnable rebuild = () -> {
            row.removeAllViews();
            for (int i = 0; i < modes.length; i++) {
                final Configuration.InputMode mode = modes[i];
                if (mode == Configuration.InputMode.ROOT_SHELL
                        && !new com.neurio.langame.host.input.RootShellInputAdapter()
                        .isAvailable(this)) {
                    continue;   // hide an option that cannot work on this phone
                }
                boolean selected = settings.inputMode() == mode;
                UiKit.addChip(row, UiKit.chip(this, labels[i], selected, v -> {
                    settings.setInputMode(mode);
                    saved();
                    buildInputRow();
                }));
            }
            Configuration.InputMode mode = settings.inputMode();
            note.setText(describeInputMode(mode) + "  " + InputAdapterFactory.explainFailure(this, mode));
        };
        row.removeAllViews();
        rebuild.run();
    }

    private String describeInputMode(Configuration.InputMode mode) {
        switch (mode) {
            case ACCESSIBILITY:
                return getString(R.string.input_note_accessibility);
            case ROOT_SHELL:
                return getString(R.string.input_note_root);
            case LOCAL_SELFTEST:
                return "Sends events only inside this app to verify the protocol end to end. "
                        + "Not a way to control games remotely.";
            case DISABLED:
            default:
                return getString(R.string.input_note_disabled);
        }
    }

    private void updateAudioNote() {
        TextView note = findViewById(R.id.audio_mode);
        boolean playback = AudioCapture.supportsPlaybackCapture();
        if (!settings.captureAudio()) {
            note.setText(getString(R.string.audio_mode_none));
        } else if (playback) {
            note.setText(getString(R.string.audio_mode_playback) + " · "
                    + getString(R.string.audio_note_playback));
        } else {
            note.setText(getString(R.string.audio_mode_mic) + " — this Android version has no "
                    + "AudioPlaybackCapture (needs Android 10+), so the microphone is used instead.");
        }
        note.setTextColor(playback || !settings.captureAudio() ? UiKit.TEXT_SECONDARY : UiKit.WARN);
    }

    /** Kept for future use: shows the live tier classification of the current link. */
    static String tierLabel(NetworkStats stats) {
        return stats.classify().label;
    }
}
