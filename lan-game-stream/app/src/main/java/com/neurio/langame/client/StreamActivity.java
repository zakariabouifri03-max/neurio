package com.neurio.langame.client;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.RectF;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.neurio.langame.R;
import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.StreamProfile;
import com.neurio.langame.network.PairingService;
import com.neurio.langame.ui.performance.PerformanceActivity;
import com.neurio.langame.ui.views.UiKit;

import java.util.Locale;

/**
 * Fullscreen player.
 *
 * <pre>
 *   SurfaceView (decoded video)
 *     + VirtualController (touch zones / key codes → InputSender)
 *     + HUD (top), control bar (bottom), edit bar, pairing prompt
 * </pre>
 *
 * <p>The controls fade away while playing and come back with a tap, which is what
 * a game stream needs: the screen belongs to the game, not to the UI.</p>
 */
public class StreamActivity extends Activity
        implements StreamClient.Listener, VirtualController.Listener {

    public static final String EXTRA_ADDRESS = "address";
    public static final String EXTRA_PORT = "port";
    public static final String EXTRA_CODE = "code";

    private static final long CONTROLS_TIMEOUT_MS = 4500L;
    private static final int LAYOUT_PRESET_INDEX = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private AppSettings settings;
    private StreamClient client;
    private VirtualController controller;
    private ControllerLayout layout;
    private SurfaceView surfaceView;
    private Surface surface;
    private boolean surfaceReady;

    private LinearLayout hud;
    private LinearLayout bar;
    private LinearLayout editBar;
    private LinearLayout pairingPanel;
    private TextView gameView;
    private TextView statsView;
    private TextView qualityView;
    private TextView messageView;
    private TextView audioNote;
    private TextView hintView;
    private EditText pairingCodeField;
    private TextView pairingError;
    private Button controlsButton;

    private String address;
    private int port;
    private String pairingCode;
    private boolean controlsHidden;
    private boolean editMode;
    private int presetIndex = LAYOUT_PRESET_INDEX;
    private boolean keyMode;
    /** True while we deliberately keep the session alive across an onStop. */
    private boolean keepAlive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_stream);
        settings = new AppSettings(this);

        address = getIntent().getStringExtra(EXTRA_ADDRESS);
        port = getIntent().getIntExtra(EXTRA_PORT, com.neurio.langame.common.Configuration.PORT_CONTROL);
        pairingCode = getIntent().getStringExtra(EXTRA_CODE);
        if (pairingCode == null) {
            pairingCode = "";
        }

        hud = findViewById(R.id.stream_hud);
        bar = findViewById(R.id.stream_bar);
        editBar = findViewById(R.id.stream_edit_bar);
        pairingPanel = findViewById(R.id.stream_pairing_panel);
        gameView = findViewById(R.id.stream_game);
        statsView = findViewById(R.id.stream_stats);
        qualityView = findViewById(R.id.stream_quality);
        messageView = findViewById(R.id.stream_message);
        audioNote = findViewById(R.id.stream_audio_note);
        hintView = findViewById(R.id.stream_hint);
        pairingCodeField = findViewById(R.id.stream_pairing_code);
        pairingError = findViewById(R.id.stream_pairing_error);
        controlsButton = findViewById(R.id.stream_btn_controls);

        layout = ControllerLayout.deserialize(settings.controllerLayoutJson());
        controller = findViewById(R.id.stream_controller);
        controller.setListener(this);
        controller.setHapticsEnabled(settings.haptics());
        rebuildController(layout, presetIndex);

        surfaceView = findViewById(R.id.stream_surface);
        surfaceView.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                surface = holder.getSurface();
                surfaceReady = true;
                if (client != null) {
                    client.setSurface(surface);
                }
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
                surface = holder.getSurface();
                updateVideoRect(width, height);
            }

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {
                surfaceReady = false;
                if (client != null) {
                    client.clearSurface();
                }
            }
        });

        findViewById(R.id.stream_btn_controls).setOnClickListener(v -> toggleControls());
        findViewById(R.id.stream_btn_layout).setOnClickListener(v -> showLayoutDialog());
        findViewById(R.id.stream_btn_edit).setOnClickListener(v -> setEditMode(!editMode));
        findViewById(R.id.stream_btn_perf).setOnClickListener(v -> {
            keepAlive = true;   // the stream keeps running while the numbers are read
            startActivity(new Intent(this, PerformanceActivity.class));
        });
        findViewById(R.id.stream_btn_disconnect).setOnClickListener(v -> disconnect());
        findViewById(R.id.stream_btn_smaller).setOnClickListener(v -> {
            layout.resize(0.9f);
            controller.setEditMode(true);
            controller.invalidate();
            saveLayout();
        });
        findViewById(R.id.stream_btn_bigger).setOnClickListener(v -> {
            layout.resize(1.1f);
            controller.invalidate();
            saveLayout();
        });
        findViewById(R.id.stream_btn_reset).setOnClickListener(v -> {
            layout.resetToPreset(presetIndex);
            controller.invalidate();
            saveLayout();
        });
        findViewById(R.id.stream_btn_edit_done).setOnClickListener(v -> setEditMode(false));
        findViewById(R.id.stream_pairing_cancel).setOnClickListener(v -> disconnect());
        findViewById(R.id.stream_pairing_connect).setOnClickListener(v -> {
            String code = pairingCodeField.getText().toString().trim();
            if (code.length() < 4) {
                UiKit.setVisible(pairingError, true);
                pairingError.setText(R.string.enter_pairing_code);
                return;
            }
            pairingCode = code;
            UiKit.setVisible(pairingPanel, false);
            connect();
        });

        if (settings.keepScreenOn()) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        messageView.setText(getString(R.string.client_connecting_to, address));
        UiKit.setVisible(messageView, true);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (client == null) {
            connect();
        }
    }

    @Override
    protected void onStop() {
        // Opening the performance screen must not kill the session: only a real exit
        // (back/home) disconnects. keepAlive is set right before that navigation.
        if (!keepAlive && !isChangingConfigurations()) {
            if (client != null) {
                client.disconnect();
                client.close();
                client = null;
            }
            ClientStatsHolder.clear();
        }
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        keepAlive = false;
    }

    private void connect() {
        if (client != null) {
            client.close();
        }
        client = new StreamClient(this, this, settings);
        if (surfaceReady && surface != null) {
            client.setSurface(surface);
        }
        client.connect(address, port, pairingCode, surface);
    }

    /* ------------------------------------------------------------------ *
     *  Controller
     * ------------------------------------------------------------------ */

    private void rebuildController(ControllerLayout newLayout, int preset) {
        this.layout = newLayout;
        this.presetIndex = preset;
        controller.setLayout(newLayout);
        controller.setEditMode(false);
        controller.setHapticsEnabled(settings.haptics());
        controller.setKeyMode(keyMode);
        controller.setVideoRect(currentVideoRect());
        controller.invalidate();
    }

    private RectF currentVideoRect() {
        RectF rect = new RectF(0, 0, surfaceView.getWidth(), surfaceView.getHeight());
        StreamProfile profile = null;
        if (client != null && client.stats() != null) {
            profile = client.stats().profile;
        }
        if (profile == null || profile.width <= 0 || profile.height <= 0
                || rect.width() <= 1 || rect.height() <= 1) {
            return rect;
        }
        float videoAspect = (float) profile.width / profile.height;
        float viewAspect = rect.width() / rect.height();
        float width = rect.width();
        float height = rect.height();
        if (viewAspect > videoAspect) {
            width = rect.height() * videoAspect;      // pillarboxed
        } else {
            height = rect.width() / videoAspect;      // letterboxed
        }
        float left = rect.left + (rect.width() - width) / 2f;
        float top = rect.top + (rect.height() - height) / 2f;
        return new RectF(left, top, left + width, top + height);
    }

    private void updateVideoRect(int width, int height) {
        controller.setVideoRect(currentVideoRect());
    }

    private void setEditMode(boolean enabled) {
        editMode = enabled;
        controller.setEditMode(enabled);
        UiKit.setVisible(editBar, enabled);
        UiKit.setVisible(bar, !enabled);
        if (enabled) {
            showControls();
        }
        saveLayout();
    }

    private void saveLayout() {
        settings.setControllerLayoutJson(layout.serialize());
    }

    private void showLayoutDialog() {
        final String[] items = new String[ControllerLayout.PRESET_NAMES.length + 1];
        System.arraycopy(ControllerLayout.PRESET_NAMES, 0, items, 0,
                ControllerLayout.PRESET_NAMES.length);
        items[items.length - 1] = getString(R.string.input_adapter) + ": "
                + (keyMode ? "key events" : "touch zones");
        new AlertDialog.Builder(this)
                .setTitle(R.string.controller_layout)
                .setItems(items, (dialog, which) -> {
                    if (which == items.length - 1) {
                        keyMode = !keyMode;
                        controller.setKeyMode(keyMode);
                        UiKit.toast(this, keyMode
                                ? "Buttons are sent as key events (needs a game that accepts them)"
                                : "Buttons are sent as touches at their own position");
                        return;
                    }
                    rebuildController(ControllerLayout.preset(which), which);
                    saveLayout();
                    UiKit.toast(this, ControllerLayout.PRESET_NAMES[which]);
                })
                .show();
    }

    /* ------------------------------------------------------------------ *
     *  HUD visibility
     * ------------------------------------------------------------------ */

    private void toggleControls() {
        controlsHidden = !controlsHidden;
        UiKit.setVisible(controller, !controlsHidden);
        controlsButton.setText(controlsHidden ? R.string.show_controls : R.string.hide_controls);
        if (controlsHidden) {
            controller.releaseAll();
            hintView.setText(R.string.stream_controls_hidden);
            UiKit.setVisible(hintView, true);
            hideAfterDelay();
        } else {
            UiKit.setVisible(hintView, false);
            showControls();
        }
    }

    private void showControls() {
        UiKit.setVisible(hud, true);
        UiKit.setVisible(bar, true);
        animateAlpha(hud, 1f);
        animateAlpha(bar, 1f);
        hideAfterDelay();
    }

    private void hideAfterDelay() {
        handler.removeCallbacks(hideControls);
        if (editMode || controlsHidden) {
            return;
        }
        handler.postDelayed(hideControls, CONTROLS_TIMEOUT_MS);
    }

    private final Runnable hideControls = () -> {
        if (editMode || controlsHidden) {
            return;
        }
        animateAlpha(hud, 0f);
        animateAlpha(bar, 0f);
    };

    private void animateAlpha(View view, float target) {
        view.animate().alpha(target).setDuration(220)
                .withEndAction(() -> view.setVisibility(target == 0f ? View.INVISIBLE : View.VISIBLE))
                .start();
    }

    /** A tap on the video brings the bar back (buttons keep their own listeners). */
    @Override
    public boolean onTouchEvent(android.view.MotionEvent event) {
        if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) {
            if (bar.getAlpha() < 0.5f && !editMode) {
                showControls();
            }
        }
        return super.onTouchEvent(event);
    }

    /* ------------------------------------------------------------------ *
     *  VirtualController.Listener → InputSender
     * ------------------------------------------------------------------ */

    @Override
    public void onPointerDown(int pointerId, float x, float y) {
        InputSender input = input();
        if (input != null) {
            input.down(pointerId, x, y);
        }
    }

    @Override
    public void onPointerMove(int pointerId, float x, float y) {
        InputSender input = input();
        if (input != null) {
            input.move(pointerId, x, y);
        }
    }

    @Override
    public void onPointerUp(int pointerId, float x, float y) {
        InputSender input = input();
        if (input != null) {
            input.up(pointerId, x, y);
        }
    }

    @Override
    public void onKey(int keyCode, boolean pressed) {
        InputSender input = input();
        if (input == null) {
            return;
        }
        if (pressed) {
            input.keyDown(keyCode);
        } else {
            input.keyUp(keyCode);
        }
    }

    @Override
    public void onLayoutEdited(ControllerLayout layout) {
        saveLayout();
    }

    @Override
    public void onWidgetLongPress(ControllerLayout.Widget widget) {
        setEditMode(!editMode);
    }

    @Override
    public void onTouchOutside() {
        if (bar.getAlpha() < 0.5f && !editMode) {
            showControls();
        }
    }

    private InputSender input() {
        return client == null ? null : client.input();
    }

    /* ------------------------------------------------------------------ *
     *  StreamClient.Listener
     * ------------------------------------------------------------------ */

    @Override
    public void onState(StreamClient.State state, String message) {
        if (state == StreamClient.State.STREAMING) {
            UiKit.setVisible(messageView, false);
            gameView.setText(client.stats().gameName.isEmpty()
                    ? getString(R.string.unknown_game) : client.stats().gameName);
            updateVideoRect(surfaceView.getWidth(), surfaceView.getHeight());
            showControls();
        } else if (state == StreamClient.State.ERROR) {
            messageView.setText(message);
            UiKit.setVisible(messageView, true);
        } else if (state == StreamClient.State.PAIRING) {
            UiKit.setVisible(pairingPanel, true);
            UiKit.setVisible(messageView, false);
            pairingCodeField.setText(pairingCode);
        } else {
            messageView.setText(message);
            UiKit.setVisible(messageView, true);
        }
    }

    @Override
    public void onSessionReady(PairingService.HandshakeResult session) {
        gameView.setText(session.gameName.isEmpty()
                ? getString(R.string.unknown_game) : session.gameName);
        qualityView.setText(session.profile == null ? "" : session.profile.shortLabel());
        UiKit.setVisible(pairingPanel, false);
        updateVideoRect(surfaceView.getWidth(), surfaceView.getHeight());
    }

    @Override
    public void onStats(StreamClient.Stats stats) {
        ClientStatsHolder.publish(stats);
        statsView.setText(String.format(Locale.US, "%s · %.0f fps · %.1f Mbps · %.0f ms",
                stats.profile == null ? "—" : stats.profile.shortLabel(),
                stats.fps, stats.bitrateMbps, stats.rttMs));
        if (stats.profile != null) {
            qualityView.setText(stats.profile.shortLabel());
        }
        qualityView.setTextColor(stats.lossPercent > 3f || stats.rttMs > 80f
                ? UiKit.WARN : UiKit.ACCENT);
    }

    @Override
    public void onPairingRequired(String hostName) {
        UiKit.setVisible(pairingPanel, true);
        pairingPanel.setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.stream_pairing_title)).setText(
                getString(R.string.enter_pairing_code) + " (" + hostName + ")");
    }

    @Override
    public void onAudioUnavailable(String reason) {
        audioNote.setText(reason);
        UiKit.setVisible(audioNote, true);
        handler.postDelayed(() -> UiKit.setVisible(audioNote, false), 6000);
    }

    /* ------------------------------------------------------------------ */

    private void disconnect() {
        if (client != null) {
            client.disconnect();
        }
        ClientStatsHolder.clear();
        finish();
    }

    @Override
    public void onBackPressed() {
        disconnect();
    }

    @Override
    protected void onPause() {
        if (client != null && !isChangingConfigurations()) {
            controller.releaseAll();
        }
        super.onPause();
    }
}
