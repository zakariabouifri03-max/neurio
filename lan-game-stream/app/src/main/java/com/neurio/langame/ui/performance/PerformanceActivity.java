package com.neurio.langame.ui.performance;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;

import com.neurio.langame.R;
import com.neurio.langame.client.ClientStatsHolder;
import com.neurio.langame.client.StreamClient;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Utils;
import com.neurio.langame.host.HostStreamService;
import com.neurio.langame.host.StreamServer;
import com.neurio.langame.ui.views.UiKit;

import java.util.List;
import java.util.Locale;

/**
 * Live performance screen.
 *
 * <p>Every number here comes from a real measurement: the encoder's own frame
 * counters, the socket's RTT/jitter estimates, the decoder's render callbacks and
 * the host's process CPU time. Nothing is synthesised. When a value genuinely
 * cannot be measured on this device (core temperature on most phones, for
 * example) the row says so instead of inventing a number.</p>
 */
public class PerformanceActivity extends Activity
        implements ClientStatsHolder.Watcher {

    private static final long POLL_MS = 500L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean verboseLog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_performance);
        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_log_clear).setOnClickListener(v -> {
            verboseLog = !verboseLog;
            UiKit.toast(this, verboseLog ? "Showing 60 lines" : "Showing 30 lines");
            updateLog();
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        ClientStatsHolder.addWatcher(this);
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            service.addListener(hostListener);
        }
        handler.post(poll);
    }

    @Override
    protected void onStop() {
        ClientStatsHolder.removeWatcher(this);
        HostStreamService service = HostStreamService.get();
        if (service != null) {
            service.removeListener(hostListener);
        }
        handler.removeCallbacks(poll);
        super.onStop();
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            refresh();
            handler.postDelayed(this, POLL_MS);
        }
    };

    private final HostStreamService.Listener hostListener = new HostStreamService.Listener() {
        @Override
        public void onState(StreamServer.State state, String message) {
            refresh();
        }

        @Override
        public void onClientConnected(String name, String device) {
            refresh();
        }

        @Override
        public void onClientDisconnected(String reason) {
            refresh();
        }

        @Override
        public void onStats(StreamServer.Stats stats) {
            applyHostStats(stats);
        }

        @Override
        public void onWarning(String message) {
        }
    };

    /* ------------------------------------------------------------------ */

    private void refresh() {
        HostStreamService service = HostStreamService.get();
        StreamClient.Stats clientStats = ClientStatsHolder.snapshot();
        boolean host = service != null && service.state() != StreamServer.State.IDLE;
        boolean client = clientStats != null;

        if (host) {
            setText(R.id.perf_role, getString(R.string.perf_role_host));
            applyHostStats(service.stats());
        } else if (client) {
            setText(R.id.perf_role, getString(R.string.perf_role_client));
            applyClientStats(clientStats);
        } else {
            setText(R.id.perf_role, getString(R.string.not_available));
            UiKit.setVisible(findViewById(R.id.perf_empty), true);
            clearValues();
        }
        updateLog();
    }

    @Override
    public void onClientStats(StreamClient.Stats stats) {
        applyClientStats(stats);
    }

    @Override
    public void onClientEnded() {
        UiKit.setVisible(findViewById(R.id.perf_empty), true);
    }

    /* ------------------------------------------------------------------ */

    private void applyHostStats(StreamServer.Stats stats) {
        UiKit.setVisible(findViewById(R.id.perf_empty), false);
        setText(R.id.perf_fps_value, String.format(Locale.US, "%.1f fps", stats.fps));
        setText(R.id.perf_encoder_fps_value, String.format(Locale.US, "%.1f fps", stats.fps));
        setText(R.id.perf_bitrate_value, Utils.formatBitrate(stats.bitrateBps));
        setText(R.id.perf_rtt_value, String.format(Locale.US, "%.0f ms", stats.networkRttMs));
        setText(R.id.perf_jitter_value, String.format(Locale.US, "%.1f ms", stats.jitterMs));
        setText(R.id.perf_loss_value, String.format(Locale.US, "%.1f %%", stats.packetLossPercent));
        setText(R.id.perf_enc_latency_value,
                String.format(Locale.US, "%.1f ms", stats.encodeLatencyMs));
        setText(R.id.perf_dec_latency_value, String.format(Locale.US,
                "client queue %d", stats.clientDecoderQueue));
        setText(R.id.perf_glass_value, String.format(Locale.US, "≈ %.0f ms",
                stats.encodeLatencyMs + stats.networkRttMs / 2f + stats.inputLatencyMs / 2f));
        setText(R.id.perf_cpu_value, String.format(Locale.US, "%.0f %%", stats.cpuPercent));
        setText(R.id.perf_thermal_value, stats.thermalText);
        setText(R.id.perf_resolution_value, stats.profile == null ? getString(R.string.dash)
                : String.format(Locale.US, "%d×%d @ %d fps", stats.profile.width,
                stats.profile.height, stats.profile.fps));
        setText(R.id.perf_dropped_value, String.format(Locale.US, "encoder %d",
                stats.droppedFrames));
        setText(R.id.perf_queue_value, String.format(Locale.US, "%d frames", stats.clientDecoderQueue));
        setText(R.id.perf_packets_value, String.format(Locale.US, "%d sent · %s",
                stats.packetsSent, Utils.formatBytes(stats.videoBytesSent)));
        setText(R.id.perf_retransmit_value, String.format(Locale.US, "%d retx · %d nack",
                stats.retransmissions, stats.nacks));
        setText(R.id.perf_session_value, formatSeconds(stats.sessionSeconds()));
        setText(R.id.perf_audio_value, stats.audioActive
                ? getString(R.string.connected) + (stats.audioNote.isEmpty() ? "" : " · " + stats.audioNote)
                : getString(R.string.audio_mode_none));
        setText(R.id.perf_input_value, stats.inputActive
                ? String.format(Locale.US, "%.0f ms · %d events",
                stats.inputLatencyMs, stats.inputEventsApplied)
                : getString(R.string.input_mode_disabled));
    }

    private void applyClientStats(StreamClient.Stats stats) {
        UiKit.setVisible(findViewById(R.id.perf_empty), false);
        setText(R.id.perf_role, getString(R.string.perf_role_client));
        setText(R.id.perf_fps_value, String.format(Locale.US, "%.1f fps", stats.fps));
        setText(R.id.perf_encoder_fps_value, String.format(Locale.US, "%.1f fps (host)", stats.hostFps));
        setText(R.id.perf_bitrate_value, UiKit.formatMbps(stats.bitrateMbps));
        setText(R.id.perf_rtt_value, String.format(Locale.US, "%.0f ms", stats.rttMs));
        setText(R.id.perf_jitter_value, String.format(Locale.US, "%.1f ms", stats.jitterMs));
        setText(R.id.perf_loss_value, String.format(Locale.US, "%.1f %%", stats.lossPercent));
        setText(R.id.perf_enc_latency_value, String.format(Locale.US, "%d ms (host)",
                stats.hostEncodeLatencyMs));
        setText(R.id.perf_dec_latency_value, UiKit.formatMs(stats.decodeLatencyMs));
        setText(R.id.perf_glass_value, String.format(Locale.US, "≈ %.0f ms",
                stats.latencyBudgetMs()));
        setText(R.id.perf_cpu_value, getString(R.string.not_available)
                + " (host only)");
        setText(R.id.perf_thermal_value, Float.isNaN(stats.hostThermalHeadroom)
                ? DeviceInfo.thermalLabel(DeviceInfo.thermalStatus(this))
                : String.format(Locale.US, "%s · headroom %.0f %%",
                DeviceInfo.thermalLabel(stats.hostThermalStatus),
                stats.hostThermalHeadroom * 100f));
        setText(R.id.perf_resolution_value, stats.profile == null ? getString(R.string.dash)
                : String.format(Locale.US, "%d×%d @ %d fps", stats.profile.width,
                stats.profile.height, stats.profile.fps));
        setText(R.id.perf_dropped_value, String.format(Locale.US, "decoder %d · host %d",
                stats.framesDropped, stats.hostDroppedFrames));
        setText(R.id.perf_queue_value, String.format(Locale.US, "%d frames", stats.decoderQueue));
        setText(R.id.perf_packets_value, String.format(Locale.US, "decoded %d · lost %d",
                stats.framesDecoded, stats.framesLost));
        setText(R.id.perf_retransmit_value, String.format(Locale.US, "%d nack · %d keyframe req",
                stats.nacksSent, stats.keyframeRequests));
        setText(R.id.perf_session_value, formatSeconds(stats.sessionSeconds));
        setText(R.id.perf_audio_value, stats.audioActive
                ? getString(R.string.connected) + (stats.audioNote.isEmpty() ? "" : " · " + stats.audioNote)
                : getString(R.string.audio_mode_none));
        setText(R.id.perf_input_value, String.format(Locale.US, "%d events sent",
                stats.inputEventsSent));
    }

    private void clearValues() {
        int[] ids = {R.id.perf_fps_value, R.id.perf_encoder_fps_value, R.id.perf_bitrate_value,
                R.id.perf_rtt_value, R.id.perf_jitter_value, R.id.perf_loss_value,
                R.id.perf_enc_latency_value, R.id.perf_dec_latency_value, R.id.perf_glass_value,
                R.id.perf_cpu_value, R.id.perf_thermal_value, R.id.perf_resolution_value,
                R.id.perf_dropped_value,
                R.id.perf_queue_value, R.id.perf_packets_value, R.id.perf_retransmit_value,
                R.id.perf_session_value, R.id.perf_audio_value, R.id.perf_input_value};
        for (int id : ids) {
            setText(id, getString(R.string.dash));
        }
    }

    private void updateLog() {
        List<String> lines = Logger.tail(verboseLog ? 60 : 30);
        StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            sb.append(line).append('\n');
        }
        if (sb.length() == 0) {
            sb.append("(no log lines yet)");
        }
        setText(R.id.perf_log, sb.toString());
    }

    private static String formatSeconds(long seconds) {
        long minutes = seconds / 60;
        long rest = seconds % 60;
        return minutes > 0
                ? String.format(Locale.US, "%d m %02d s", minutes, rest)
                : String.format(Locale.US, "%d s", rest);
    }

    private void setText(int id, CharSequence text) {
        TextView view = findViewById(id);
        if (view != null) {
            view.setText(text);
        }
    }
}
