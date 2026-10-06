package com.neurio.langame.host;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.neurio.langame.R;
import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Utils;
import com.neurio.langame.host.input.InputAdapterFactory;
import com.neurio.langame.host.input.NeurioAccessibilityService;
import com.neurio.langame.network.NetworkUtils;
import com.neurio.langame.ui.views.UiKit;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Host screen: pick the game, start the stream, watch the numbers.
 *
 * <p>The phone keeps running the game in the foreground exactly as it normally
 * would; what this screen orchestrates is the capture/encode/transport service
 * behind it.</p>
 */
public class HostActivity extends Activity implements HostStreamService.Listener {

    private static final int REQ_PROJECTION = 4101;
    private static final int REQ_NOTIFICATIONS = 4102;
    private static final int REQ_MICROPHONE = 4103;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private AppSettings settings;
    private List<GameDetector.GameApp> allApps = new ArrayList<>();
    private GameDetector.GameApp selected;
    private boolean gamesOnly = true;
    private String query = "";
    private Runnable pendingAfterPermission;

    private TextView hostLink;
    private TextView stateChip;
    private TextView stateText;
    private TextView pairingCodeView;
    private TextView fpsView;
    private TextView bitrateView;
    private TextView pingView;
    private TextView videoLine;
    private TextView clientView;
    private TextView portsView;
    private TextView inputStatus;
    private TextView audioStatus;
    private TextView warning;
    private Button startStopButton;
    private Button launchButton;
    private ImageView gameIcon;
    private TextView gameName;
    private TextView gamePackage;
    private LinearLayout gameList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_host);
        settings = new AppSettings(this);

        hostLink = findViewById(R.id.host_link);
        stateChip = findViewById(R.id.host_state_chip);
        stateText = findViewById(R.id.host_state);
        pairingCodeView = findViewById(R.id.host_pairing_code);
        fpsView = findViewById(R.id.host_fps);
        bitrateView = findViewById(R.id.host_bitrate);
        pingView = findViewById(R.id.host_ping);
        videoLine = findViewById(R.id.host_video_line);
        clientView = findViewById(R.id.host_client);
        portsView = findViewById(R.id.host_ports);
        inputStatus = findViewById(R.id.host_input_status);
        audioStatus = findViewById(R.id.host_audio_status);
        warning = findViewById(R.id.host_warning);
        startStopButton = findViewById(R.id.btn_start_stop);
        launchButton = findViewById(R.id.btn_launch);
        gameIcon = findViewById(R.id.host_game_icon);
        gameName = findViewById(R.id.host_game_name);
        gamePackage = findViewById(R.id.host_game_package);
        gameList = findViewById(R.id.host_game_list);

        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_regenerate).setOnClickListener(v -> {
            HostStreamService service = HostStreamService.get();
            if (service != null) {
                service.regeneratePairingCode();
                showPairingCode();
                UiKit.toast(this, getString(R.string.host_regenerate_code));
            }
        });
        findViewById(R.id.btn_input).setOnClickListener(v -> openAccessibilitySettings());
        startStopButton.setOnClickListener(v -> toggleStream());
        launchButton.setOnClickListener(v -> launchSelectedGame());

        EditText search = findViewById(R.id.host_search);
        search.addTextChangedListener(new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                query = s == null ? "" : s.toString().trim().toLowerCase(Locale.US);
                renderGameList();
            }

            @Override
            public void afterTextChanged(android.text.Editable s) {
            }
        });

        findViewById(R.id.host_filter).setOnClickListener(v -> {
            gamesOnly = !gamesOnly;
            ((Button) v).setText(gamesOnly
                    ? R.string.host_show_games_only : R.string.host_show_all_apps);
            renderGameList();
        });

        loadGames();
        refreshStaticInfo();
    }

    @Override
    protected void onStart() {
        super.onStart();
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            service.addListener(this);
            onStats(service.stats());
            onState(service.state(), service.stateMessage());
        }
    }

    @Override
    protected void onStop() {
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            service.removeListener(this);
        }
        super.onStop();
    }

    /* ------------------------------------------------------------------ *
     *  Game library
     * ------------------------------------------------------------------ */

    private void loadGames() {
        gameList.removeAllViews();
        gameList.addView(UiKit.caption(this, "Scanning installed apps…"));
        Utils.startThread("lgs-game-scan", Thread.NORM_PRIORITY, () -> {
            final List<GameDetector.GameApp> apps = GameDetector.detect(this);
            handler.post(() -> {
                allApps = apps;
                preselectKnownGame();
                renderGameList();
            });
        });
    }

    private void preselectKnownGame() {
        if (selected != null) {
            return;
        }
        for (String known : GameDetector.KNOWN_GAME_PACKAGES) {
            for (GameDetector.GameApp app : allApps) {
                if (known.equals(app.packageName)) {
                    select(app);
                    return;
                }
            }
        }
    }

    private void renderGameList() {
        gameList.removeAllViews();
        int shown = 0;
        for (GameDetector.GameApp app : allApps) {
            if (gamesOnly && !app.isGame) {
                continue;
            }
            if (!query.isEmpty() && !app.label.toLowerCase(Locale.US).contains(query)
                    && !app.packageName.toLowerCase(Locale.US).contains(query)) {
                continue;
            }
            if (shown++ >= 80) {
                gameList.addView(UiKit.caption(this, "…narrow the search to see more."));
                break;
            }
            boolean isSelected = selected != null && selected.packageName.equals(app.packageName);
            LinearLayout row = UiKit.listRow(this, app.icon, app.label, app.subtitle(),
                    isSelected ? "SELECTED" : (app.isGame ? "GAME" : "APP"),
                    isSelected ? UiKit.ACCENT : UiKit.TEXT_TERTIARY,
                    v -> select(app));
            gameList.addView(row);
        }
        if (shown == 0) {
            gameList.addView(UiKit.caption(this, getString(R.string.no_games_found)));
        }
    }

    private void select(GameDetector.GameApp app) {
        selected = app;
        gameName.setText(app.label);
        gamePackage.setText(app.subtitle());
        if (app.icon != null) {
            gameIcon.setImageBitmap(app.icon);
        }
        renderGameList();
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            // The client shows this in its stream HUD.
            service.setGameName(app.label);
        }
    }

    private void launchSelectedGame() {
        if (selected == null) {
            UiKit.toast(this, getString(R.string.host_no_selection));
            return;
        }
        if (!GameLauncher.launch(this, selected.packageName)) {
            UiKit.toast(this, getString(R.string.host_launch_failed, selected.label));
            return;
        }
        UiKit.toast(this, getString(R.string.host_launched, selected.label));
        handler.postDelayed(() -> {
            boolean foreground = GameLauncher.isForeground(selected.packageName);
            if (!GameLauncher.canObserveForeground()) {
                warning.setText(getString(R.string.warn_no_injection));
            } else if (!foreground) {
                Logger.w("HostActivity", "Game not observed in the foreground");
            }
        }, 2500);
    }

    /* ------------------------------------------------------------------ *
     *  Stream control
     * ------------------------------------------------------------------ */

    private void toggleStream() {
        if (HostStreamService.isRunning()) {
            HostStreamService.stop(this);
            handler.postDelayed(this::refreshFromService, 400);
            return;
        }
        if (settings.inputMode() != Configuration.InputMode.DISABLED) {
            String failure = InputAdapterFactory.explainFailure(this, settings.inputMode());
            if (failure != null && failure.length() > 0) {
                warning.setText(failure);
                UiKit.setVisible(warning, true);
            }
        }
        startProjectionFlow();
    }

    private void startProjectionFlow() {
        ensurePermission(Manifest.permission.POST_NOTIFICATIONS, REQ_NOTIFICATIONS,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU, () ->
                        ensurePermission(Manifest.permission.RECORD_AUDIO, REQ_MICROPHONE, true,
                                this::requestProjection));
    }

    private void ensurePermission(String permission, int requestCode, boolean needed,
                                  Runnable onGranted) {
        if (!needed || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            onGranted.run();
            return;
        }
        pendingAfterPermission = onGranted;
        requestPermissions(new String[]{permission}, requestCode);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (!granted && requestCode == REQ_MICROPHONE) {
            // Audio is optional: say so and continue with video only.
            settings.setCaptureAudio(false);
            UiKit.toast(this, getString(R.string.warn_no_audio));
        }
        Runnable next = pendingAfterPermission;
        pendingAfterPermission = null;
        if (next != null) {
            next.run();
        }
    }

    private void requestProjection() {
        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            UiKit.toast(this, getString(R.string.capture_permission_needed));
            return;
        }
        try {
            startActivityForResult(manager.createScreenCaptureIntent(), REQ_PROJECTION);
        } catch (Exception e) {
            Logger.e("HostActivity", "Projection consent failed", e);
            UiKit.toast(this, getString(R.string.capture_permission_needed));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PROJECTION) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            UiKit.toast(this, getString(R.string.capture_permission_needed));
            return;
        }
        String game = selected == null ? "" : selected.label;
        HostStreamService.start(this, resultCode, data, game);
        handler.postDelayed(this::refreshFromService, 600);
    }

    private void refreshFromService() {
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            service.addListener(this);
            onState(service.state(), service.stateMessage());
            onStats(service.stats());
            showPairingCode();
        } else {
            stateChip.setText(R.string.host_state_idle);
            stateText.setText(R.string.host_state_idle);
            startStopButton.setText(R.string.host_start_stream);
            startStopButton.setBackgroundResource(R.drawable.bg_button_primary);
        }
    }

    /* ------------------------------------------------------------------ *
     *  Static info panels
     * ------------------------------------------------------------------ */

    private void refreshStaticInfo() {
        NetworkUtils.LinkInfo link = NetworkUtils.inspect(this);
        hostLink.setText(NetworkUtils.activeLinkDescription(this) + " · "
                + NetworkUtils.signalLabel(link));
        portsView.setText(getString(R.string.host_ports_line, HostStreamService.portSummary()));
        refreshInputStatus();
        refreshAudioStatus();
        refreshThermal();
        handler.postDelayed(this::refreshStaticInfo, 4000);
    }

    private void refreshInputStatus() {
        Configuration.InputMode mode = settings.inputMode();
        boolean accessibilityOn = NeurioAccessibilityService.isConnected();
        String failure = InputAdapterFactory.explainFailure(this, mode);
        String text;
        if (mode == Configuration.InputMode.DISABLED) {
            text = getString(R.string.input_note_disabled);
            inputStatus.setTextColor(UiKit.TEXT_SECONDARY);
        } else if (mode == Configuration.InputMode.ACCESSIBILITY && accessibilityOn) {
            text = getString(R.string.host_input_ready, mode.label)
                    + " · " + getString(R.string.accessibility_service_label) + " is on";
            inputStatus.setTextColor(UiKit.ACCENT);
        } else if (failure == null || failure.isEmpty()) {
            text = getString(R.string.host_input_ready, mode.label);
            inputStatus.setTextColor(UiKit.ACCENT);
        } else {
            text = getString(R.string.host_input_missing, failure);
            inputStatus.setTextColor(UiKit.WARN);
        }
        inputStatus.setText(text);
        Button inputButton = findViewById(R.id.btn_input);
        inputButton.setText(accessibilityOn
                ? getString(R.string.accessibility_service_label) + " ✓"
                : getString(R.string.host_enable_accessibility));
    }

    private void refreshAudioStatus() {
        boolean playback = AudioCapture.supportsPlaybackCapture();
        boolean enabled = settings.captureAudio();
        if (!enabled) {
            audioStatus.setText(getString(R.string.audio_mode_none));
            audioStatus.setTextColor(UiKit.TEXT_SECONDARY);
            return;
        }
        audioStatus.setText(playback
                ? getString(R.string.host_audio_ok) + "\n" + getString(R.string.audio_note_playback)
                : getString(R.string.host_audio_limited));
        audioStatus.setTextColor(playback ? UiKit.TEXT_SECONDARY : UiKit.WARN);
    }

    private void refreshThermal() {
        TextView view = findViewById(R.id.host_thermal_or_cpu);
        if (view == null) {
            return;
        }
        String thermal = DeviceInfo.thermalLabel(DeviceInfo.thermalStatus(this));
        view.setText(getString(R.string.host_thermal_line, thermal));
    }

    private void showPairingCode() {
        HostStreamService service = HostStreamService.get();
        String code = service == null ? "" : service.pairingCode();
        pairingCodeView.setText(code == null || code.isEmpty()
                ? getString(R.string.placeholder_code) : code);
    }

    private void openAccessibilitySettings() {
        if (NeurioAccessibilityService.isConnected()) {
            UiKit.toast(this, getString(R.string.accessibility_service_label) + " is already on");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            startActivity(intent);
        } catch (Exception e) {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.host_enable_accessibility)
                    .setMessage(getString(R.string.accessibility_enable_hint))
                    .setPositiveButton(R.string.done, null)
                    .show();
        }
    }

    /* ------------------------------------------------------------------ *
     *  HostStreamService.Listener (called on the main thread)
     * ------------------------------------------------------------------ */

    @Override
    public void onState(StreamServer.State state, String message) {
        stateText.setText(message == null ? state.name() : message);
        switch (state) {
            case STREAMING:
                stateChip.setText(R.string.streaming_now);
                stateChip.setTextColor(UiKit.ACCENT);
                startStopButton.setText(R.string.host_stop_stream);
                startStopButton.setBackgroundResource(R.drawable.bg_button_danger);
                break;
            case WAITING_FOR_CLIENT:
                stateChip.setText(R.string.waiting_for_client);
                stateChip.setTextColor(UiKit.WARN);
                startStopButton.setText(R.string.host_stop_stream);
                startStopButton.setBackgroundResource(R.drawable.bg_button_danger);
                break;
            case ERROR:
                stateChip.setText(R.string.state_error_short);
                stateChip.setTextColor(UiKit.DANGER);
                break;
            case IDLE:
            default:
                stateChip.setText(R.string.host_state_idle);
                stateChip.setTextColor(UiKit.TEXT_SECONDARY);
                startStopButton.setText(R.string.host_start_stream);
                startStopButton.setBackgroundResource(R.drawable.bg_button_primary);
                break;
        }
        showPairingCode();
    }

    @Override
    public void onClientConnected(String name, String device) {
        clientView.setText(getString(R.string.connected_client) + ": " + name
                + (device.isEmpty() ? "" : " · " + device));
        // Honest limitation reporting: injected touch is not universally accepted.
        if (settings.inputMode() != Configuration.InputMode.DISABLED) {
            warning.setText(getString(R.string.warn_anticheat));
            UiKit.setVisible(warning, true);
        }
        UiKit.toast(this, name + " connected");
    }

    @Override
    public void onClientDisconnected(String reason) {
        clientView.setText(getString(R.string.host_client_label) + ": "
                + getString(R.string.host_none_connected));
        stateText.setText(reason == null ? getString(R.string.host_state_waiting) : reason);
    }

    @Override
    public void onStats(StreamServer.Stats stats) {
        if (stats == null) {
            return;
        }
        fpsView.setText(String.format(Locale.US, "%.0f", stats.fps));
        bitrateView.setText(Utils.formatBitrate(stats.bitrateBps));
        pingView.setText(String.format(Locale.US, "%.0f ms", stats.networkRttMs));
        int width = stats.profile == null ? 0 : stats.profile.width;
        int height = stats.profile == null ? 0 : stats.profile.height;
        int fps = stats.profile == null ? 0 : stats.profile.fps;
        videoLine.setText(getString(R.string.host_video_line,
                stats.profile == null ? "—" : stats.profile.codec.label, width, height, fps,
                stats.qualityTier));
        clientView.setText(getString(R.string.connected_client) + ": "
                + (stats.clientName.isEmpty() ? getString(R.string.host_none_connected)
                : stats.clientName + " · " + stats.clientDevice)
                + (stats.sessionFingerprint.isEmpty() ? "" : " · " + stats.sessionFingerprint));
        TextView cpuView = findViewById(R.id.host_thermal_or_cpu);
        if (cpuView != null) {
            cpuView.setText(getString(R.string.host_thermal_line, stats.thermalText) + " · "
                    + getString(R.string.host_cpu_line, Math.round(stats.cpuPercent)));
        }
        showPairingCode();
    }

    @Override
    public void onWarning(String message) {
        warning.setText(message);
        UiKit.setVisible(warning, message != null && !message.isEmpty());
    }
}
