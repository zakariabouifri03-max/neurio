package com.neurio.langame.host;

import android.content.Context;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.Looper;

import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.common.Security;
import com.neurio.langame.common.StreamProfile;
import com.neurio.langame.common.Utils;
import com.neurio.langame.host.input.GameInputAdapter;
import com.neurio.langame.host.input.InputAdapterFactory;
import com.neurio.langame.network.AudioTransport;
import com.neurio.langame.network.DiscoveryService;
import com.neurio.langame.network.HostInfo;
import com.neurio.langame.network.NetworkUtils;
import com.neurio.langame.network.PairingService;
import com.neurio.langame.network.SessionManager;
import com.neurio.langame.network.VideoTransport;

import java.nio.ByteBuffer;
import java.util.Locale;

/**
 * The host streaming engine.
 *
 * <pre>
 *   game ─▶ display ─▶ MediaProjection ─▶ VirtualDisplay ─▶ Surface
 *        ─▶ MediaCodec (H.264/H.265, hardware) ─▶ UDP fragments (+NACK)
 *        ─▶ client
 *
 *   client input ─▶ UDP ─▶ InputReceiver ─▶ GameInputAdapter ─▶ game
 * </pre>
 *
 * <p>Lifecycle: the engine advertises and waits for a client; the capture and
 * encoder are only created once a client has actually paired (there is no point
 * burning GPU and battery encoding to nobody), and they are torn down again when
 * the client leaves while the engine keeps listening for the next one.</p>
 */
public final class StreamServer {

    private static final String TAG = "StreamServer";

    public enum State {IDLE, WAITING_FOR_CLIENT, STREAMING, ERROR}

    /** Immutable statistics snapshot for the UI (posted ~3×/s). */
    public static final class Stats {
        public State state = State.IDLE;
        public StreamProfile profile;
        public String clientName = "";
        public String clientDevice = "";
        public String sessionFingerprint = "";
        public float fps;
        public int bitrateBps;
        public float encodeLatencyMs;
        public float inputLatencyMs;
        public float networkRttMs;
        public float packetLossPercent;
        public float jitterMs;
        public int thermalStatus = -1;
        public String thermalText = "n/a";
        public float cpuPercent;
        public long framesSent;
        public int packetsSent;
        public int retransmissions;
        public int nacks;
        public long videoBytesSent;
        public boolean audioActive;
        public String audioNote = "";
        public boolean inputActive;
        public String inputNote = "";
        public long inputEventsApplied;
        public int captureWidth;
        public int captureHeight;
        public int clientDecoderQueue;
        public int droppedFrames;
        public int keyframes;
        public long sessionStartedAtMs;
        public String qualityTier = Configuration.QualityTier.EXCELLENT.label;

        public long sessionSeconds() {
            return sessionStartedAtMs <= 0 ? 0
                    : (System.currentTimeMillis() - sessionStartedAtMs) / 1000;
        }
    }

    public interface Listener {
        void onState(State state, String message);

        void onClientConnected(String name, String device);

        void onClientDisconnected(String reason);

        void onStats(Stats stats);

        void onWarning(String message);
    }

    private final Context context;
    private final Listener listener;
    private final AppSettings settings;
    private final MediaProjection projection;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final PerformanceMonitor performanceMonitor;
    private final Stats stats = new Stats();

    private SessionManager sessionManager;
    private DiscoveryService discovery;
    private ScreenCapture capture;
    private VideoEncoder encoder;
    private VideoTransport.Sender videoSender;
    private AudioCapture audioCapture;
    private AudioEncoder audioEncoder;
    private AudioTransport.Sender audioSender;
    private InputReceiver inputReceiver;
    private AdaptiveController adaptive;
    private PairingService.HandshakeResult session;
    /** The profile currently being encoded (adapts during the session). */
    private volatile StreamProfile currentProfile;
    private GameInputAdapter inputAdapter;

    private String pairingCode = Security.newPairingCode();
    private volatile String gameName = "";
    private volatile State state = State.IDLE;
    private volatile boolean running;
    private Thread statsThread;
    private int encoderRestarts;

    public StreamServer(Context context, Listener listener, MediaProjection projection) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.projection = projection;
        this.settings = new AppSettings(this.context);
        this.performanceMonitor = new PerformanceMonitor(this.context);
        this.stats.thermalStatus = DeviceInfo.thermalStatus(this.context);
    }

    /* ------------------------------------------------------------------ *
     *  Lifecycle
     * ------------------------------------------------------------------ */

    public void start() {
        if (running) {
            return;
        }
        running = true;
        stats.sessionStartedAtMs = 0;

        String hostName = DeviceInfo.deviceName();
        sessionManager = new SessionManager(new SessionListener(), hostName,
                AudioCapture.supportsPlaybackCapture(),
                () -> pairingCode,
                () -> settings.defaultProfile(),
                () -> statsProvider);
        try {
            sessionManager.start(Configuration.PORT_CONTROL);
        } catch (Exception e) {
            fail("Cannot open the control port " + Configuration.PORT_CONTROL + ": " + e.getMessage());
            return;
        }

        discovery = new DiscoveryService(context, new DiscoveryListener());
        discovery.setAdvertisedState(gameName, 1, profileSummary());
        discovery.startAdvertising(hostName, Configuration.PORT_CONTROL);

        statsThread = Utils.startThread("lgs-host-stats-tick", Thread.NORM_PRIORITY, this::statsLoop);
        setState(State.WAITING_FOR_CLIENT, "Waiting for a client — pairing code "
                + pairingCode);
    }

    public void stop() {
        running = false;
        teardownClientPipeline("host stopped");
        if (sessionManager != null) {
            sessionManager.stop();
            sessionManager = null;
        }
        if (discovery != null) {
            discovery.close();
            discovery = null;
        }
        setState(State.IDLE, "Stopped");
    }

    public State state() {
        return state;
    }

    public Stats stats() {
        return stats;
    }

    public String pairingCode() {
        return pairingCode;
    }

    public void regeneratePairingCode() {
        pairingCode = Security.newPairingCode();
        Logger.i(TAG, "New pairing code generated");
        if (discovery != null) {
            discovery.setAdvertisedState(gameName, state == State.STREAMING ? 2 : 1,
                    profileSummary());
        }
        setState(state, "New pairing code " + pairingCode);
    }

    public void setGameName(String name) {
        this.gameName = name == null ? "" : name;
        if (discovery != null) {
            discovery.setAdvertisedState(gameName, state == State.STREAMING ? 2 : 1,
                    profileSummary());
        }
    }

    public float networkRttMs() {
        return sessionManager == null || sessionManager.session() == null
                ? -1f
                : stats.networkRttMs;
    }

    /* ------------------------------------------------------------------ *
     *  Client pipeline
     * ------------------------------------------------------------------ */

    private final class SessionListener implements SessionManager.Listener {
        @Override
        public void onClientConnected(PairingService.HandshakeResult handshake) {
            session = handshake;
            currentProfile = handshake.profile;
            stats.profile = currentProfile;
            startClientPipeline(handshake);
        }

        @Override
        public void onClientDisconnected(String reason) {
            session = null;
            currentProfile = null;
            teardownClientPipeline(reason);
        }

        @Override
        public void onClientReport(NetworkStats.Snapshot snapshot, int requestedWidth,
                                   int requestedHeight, int requestedFps) {
            stats.networkRttMs = snapshot.rttMs;
            stats.packetLossPercent = snapshot.lossPercent;
            stats.jitterMs = snapshot.jitterMs;
            stats.clientDecoderQueue = snapshot.decodeQueueDepth;
            stats.qualityTier = snapshot.tier.label;
            if (adaptive != null && encoder != null) {
                adaptive.onThermal(performanceMonitor.thermalStatus(),
                        performanceMonitor.thermalHeadroom());
                boolean encoderBehind = encoder.encodeLatencyMs() > 45f
                        || encoder.fps() < adaptive.currentProfile().fps * 0.8f;
                adaptive.update(snapshot, encoder.fps(), encoderBehind);
            }
        }

        @Override
        public void onKeyframeRequested() {
            if (encoder != null) {
                encoder.requestKeyframe();
                Logger.i(TAG, "Keyframe requested by the client");
            }
        }

        @Override
        public void onAuthenticationFailure(String reason) {
            leave("authentication: " + reason);
            regeneratePairingCode();
        }

    }

    private void startClientPipeline(PairingService.HandshakeResult handshake) {
        StreamProfile profile = handshake.profile;
        stats.profile = profile;
        stats.clientName = handshake.peerName;
        stats.clientDevice = handshake.peerDevice;
        stats.sessionFingerprint = handshake.sessionKey == null ? "open"
                : Security.fingerprint(handshake.sessionKey);
        stats.sessionStartedAtMs = System.currentTimeMillis();
        stats.framesSent = 0;
        stats.packetsSent = 0;
        stats.retransmissions = 0;
        stats.nacks = 0;
        stats.videoBytesSent = 0;
        stats.droppedFrames = 0;
        stats.keyframes = 0;

        Logger.i(TAG, "Client " + handshake.peerName + " (" + handshake.peerDevice
                + ") connected → " + profile);

        // ---- input first: it is what makes the stream playable ----
        inputAdapter = InputAdapterFactory.create(context, settings.inputMode());
        if (inputAdapter == null) {
            stats.inputActive = false;
            stats.inputNote = InputAdapterFactory.explainFailure(context, settings.inputMode());
            warn(stats.inputNote);
        } else {
            try {
                inputReceiver = new InputReceiver(context, inputAdapter, handshake.sessionTag,
                        new InputListener());
                inputReceiver.start();
                stats.inputActive = true;
                stats.inputNote = inputAdapter.status();
            } catch (Exception e) {
                stats.inputActive = false;
                stats.inputNote = "input channel failed: " + e.getMessage();
                warn(stats.inputNote);
            }
        }

        // ---- video ----
        try {
            videoSender = new VideoTransport.Sender(handshake.clientAddress,
                    handshake.clientVideoPort, handshake.sessionTag);
            videoSender.setFeedbackListener(new VideoFeedbackListener());
            videoSender.start();
            startEncoder(profile);
        } catch (Exception e) {
            fail("Could not start video: " + e.getMessage());
            leave("video pipeline failed");
            return;
        }

        // ---- audio (only when the platform actually supports capturing) ----
        startAudio(handshake);

        adaptive = new AdaptiveController(new AdaptiveListener(), profile, settings.adaptive(),
                settings.bitrateCapMbps() * 1_000_000);
        setState(State.STREAMING, handshake.peerName + " connected");
        if (listener != null) {
            listener.onClientConnected(handshake.peerName, handshake.peerDevice);
        }
    }

    private void startEncoder(StreamProfile profile) throws Exception {
        encoder = new VideoEncoder(profile, new EncoderListener());
        encoder.start();
        capture = new ScreenCapture(context, projection);
        capture.start(encoder.inputSurface(), profile.width, profile.height);
        stats.captureWidth = capture.width();
        stats.captureHeight = capture.height();
        Logger.i(TAG, "Pipeline running: capture " + capture.width() + "×" + capture.height()
                + " → encoder " + profile.width + "×" + profile.height);
    }

    private void startAudio(PairingService.HandshakeResult handshake) {
        stats.audioActive = false;
        if (!handshake.audioEnabled || !settings.captureAudio()) {
            stats.audioNote = !settings.captureAudio()
                    ? "disabled in settings"
                    : "the client did not request audio";
            return;
        }
        try {
            audioSender = new AudioTransport.Sender(handshake.clientAddress,
                    handshake.clientAudioPort, handshake.sessionTag);
            audioEncoder = new AudioEncoder(new AudioEncoderListener());
            audioEncoder.start();
            audioCapture = new AudioCapture(context, AudioCapture.Source.PLAYBACK_CAPTURE,
                    new AudioCaptureListener());
            if (audioCapture.start(projection)) {
                stats.audioActive = true;
                stats.audioNote = "internal audio capture (API 29+ playback capture)";
            } else {
                stats.audioActive = false;
            }
        } catch (Throwable t) {
            stats.audioActive = false;
            stats.audioNote = "audio unavailable: " + t.getMessage();
            Logger.w(TAG, "Audio pipeline not started: " + t.getMessage());
            stopAudio();
        }
    }

    private void stopAudio() {
        if (audioCapture != null) {
            audioCapture.stop();
            audioCapture = null;
        }
        if (audioEncoder != null) {
            audioEncoder.release();
            audioEncoder = null;
        }
        if (audioSender != null) {
            audioSender.close();
            audioSender = null;
        }
    }

    private void teardownClientPipeline(String reason) {
        if (inputReceiver != null) {
            inputReceiver.close();
            inputReceiver = null;
        }
        inputAdapter = null;
        stopAudio();
        if (capture != null) {
            capture.release();
            capture = null;
        }
        if (encoder != null) {
            encoder.release();
            encoder = null;
        }
        if (videoSender != null) {
            videoSender.close();
            videoSender = null;
        }
        adaptive = null;
        stats.audioActive = false;
        stats.inputActive = false;
        stats.sessionStartedAtMs = 0;
        if (running) {
            setState(State.WAITING_FOR_CLIENT, "Waiting for a client — pairing code "
                    + pairingCode);
        }
        if (listener != null && !reason.isEmpty()) {
            listener.onClientDisconnected(reason);
        }
    }

    private void leave(String reason) {
        if (sessionManager != null) {
            sessionManager.closeSession(reason);
        }
    }

    /* ------------------------------------------------------------------ *
     *  Callbacks from the pipeline
     * ------------------------------------------------------------------ */

    private final class EncoderListener implements VideoEncoder.Listener {
        @Override
        public void onEncodedFrame(ByteBuffer data, boolean keyframe, long presentationTimeUs,
                                   int totalBytes) {
            VideoTransport.Sender sender = videoSender;
            if (sender != null) {
                // Zero extra copies: fragmentation reads straight from the codec buffer.
                sender.sendFrame(data, keyframe, presentationTimeUs);
                stats.framesSent++;
                stats.videoBytesSent += totalBytes;
                if (keyframe) {
                    stats.keyframes++;
                }
            }
        }

        @Override
        public void onCodecConfig(byte[] csd) {
            if (sessionManager != null) {
                sessionManager.sendCsd(csd);
            }
        }

        @Override
        public void onEncoderError(String message) {
            Logger.e(TAG, "Encoder error: " + message);
            // One automatic rebuild, then give up and tell the truth to the user.
            if (encoderRestarts < 1 && session != null) {
                encoderRestarts++;
                mainHandler.post(() -> rebuildPipeline(currentProfile, "encoder recovery"));
            } else {
                leave("encoder error: " + message);
                setState(State.ERROR, "Encoder failed: " + message);
            }
        }
    }

    private final class VideoFeedbackListener implements VideoTransport.Sender.FeedbackListener {
        @Override
        public void onNack(int frameId, int missingCount) {
            stats.nacks++;
            stats.retransmissions = videoSender == null ? 0 : videoSender.retransmissionCount();
        }

        @Override
        public void onKeyframeRequest() {
            if (encoder != null) {
                encoder.requestKeyframe();
            }
        }
    }

    private final class AudioEncoderListener implements AudioEncoder.Listener {
        @Override
        public void onEncodedFrame(byte[] adtsFrame, long presentationTimeUs) {
            AudioTransport.Sender sender = audioSender;
            if (sender != null) {
                sender.sendFrame(ByteBuffer.wrap(adtsFrame), presentationTimeUs);
            }
        }

        @Override
        public void onCodecConfig(byte[] audioSpecificConfig) {
            AudioTransport.Sender sender = audioSender;
            if (sender != null) {
                sender.sendCodecConfig(audioSpecificConfig);
            }
        }

        @Override
        public void onError(String message) {
            Logger.w(TAG, "Audio encoder error: " + message);
            stats.audioActive = false;
            stats.audioNote = "audio encoder failed: " + message;
            stopAudio();
        }
    }

    private final class AudioCaptureListener implements AudioCapture.Listener {
        @Override
        public void onPcm(ByteBuffer data, int size, long presentationTimeUs) {
            AudioEncoder enc = audioEncoder;
            if (enc != null) {
                enc.offerPcm(data, size, presentationTimeUs);
            }
        }

        @Override
        public void onAudioUnavailable(String reason) {
            stats.audioActive = false;
            stats.audioNote = reason;
            warn("Audio: " + reason);
            stopAudio();
        }

        @Override
        public void onSilenceDetected() {
            stats.audioNote = "capture is silent — the game opted out of playback capture";
            warn("This game does not allow internal audio capture; streaming video only. "
                    + "Everything else keeps working.");
            stopAudio();
        }
    }

    private final class InputListener implements InputReceiver.Listener {
        @Override
        public void onInputStats(float latencyMs, long applied, long dropped, String adapterStatus) {
            stats.inputLatencyMs = latencyMs;
            stats.inputEventsApplied = applied;
            stats.inputNote = adapterStatus;
        }

        @Override
        public void onInputUnavailable(String reason) {
            stats.inputActive = false;
            stats.inputNote = reason;
            warn(reason);
        }
    }

    private final class AdaptiveListener implements AdaptiveController.Listener {
        @Override
        public void onBitrateChange(int bitrateBps) {
            if (encoder != null) {
                encoder.setBitrate(bitrateBps);
                stats.bitrateBps = bitrateBps;
                StreamProfile active = currentProfile;
                if (active != null) {
                    currentProfile = new StreamProfile(active.codec, active.width, active.height,
                            active.fps, bitrateBps);
                    stats.profile = currentProfile;
                }
            }
        }

        @Override
        public void onProfileChange(StreamProfile profile) {
            mainHandler.post(() -> rebuildPipeline(profile, "adaptive"));
        }
    }

    /** One-line shape shown to clients in their host list ("1280x720 @ 60 fps"). */
    private String profileSummary() {
        StreamProfile profile = currentProfile;
        return profile == null ? ""
                : profile.width + "x" + profile.height + " @" + profile.fps + " fps";
    }

    /** Rebuilds capture + encoder at a new shape, keeping the session intact. */
    private void rebuildPipeline(StreamProfile profile, String cause) {
        if (session == null || !running) {
            return;
        }
        Logger.i(TAG, "Rebuilding pipeline (" + cause + ") → " + profile);
        try {
            if (capture != null) {
                capture.release();
                capture = null;
            }
            if (encoder != null) {
                encoder.release();
                encoder = null;
            }
            if (sessionManager != null) {
                sessionManager.sendProfileUpdate(profile, stats.audioActive);
            }
            startEncoder(profile);
            currentProfile = profile;
            stats.profile = currentProfile;
            if (adaptive != null) {
                adaptive.onProfileReplaced(profile);
            }
        } catch (Exception e) {
            Logger.e(TAG, "Pipeline rebuild failed", e);
            fail("Could not switch to " + profile.shortLabel() + ": " + e.getMessage());
            leave("rebuild failed");
        }
    }

    private final class DiscoveryListener implements DiscoveryService.Listener {
        @Override
        public void onHostFound(HostInfo host) {
            // A host does not browse for hosts.
        }

        @Override
        public void onHostLost(String hostKey) {
        }

        @Override
        public void onState(String message) {
            Logger.i(TAG, "Discovery: " + message);
        }
    }

    /* ------------------------------------------------------------------ *
     *  Statistics
     * ------------------------------------------------------------------ */

    private final SessionManager.StatsProvider statsProvider = new SessionManager.StatsProvider() {
        @Override
        public int encodedFrames() {
            return encoder == null ? 0 : encoder.framesEncoded();
        }

        @Override
        public int droppedFrames() {
            return encoder == null ? 0 : encoder.droppedFrames();
        }

        @Override
        public int bitrateBps() {
            return encoder == null ? 0 : encoder.currentBitrateBps();
        }

        @Override
        public float encodeLatencyMs() {
            return encoder == null ? 0 : encoder.encodeLatencyMs();
        }

        @Override
        public float fps() {
            return encoder == null ? 0 : encoder.fps();
        }

        @Override
        public int keyframes() {
            return encoder == null ? 0 : encoder.keyframes();
        }

        @Override
        public int thermalStatus() {
            return performanceMonitor.thermalStatus();
        }

        @Override
        public float thermalHeadroom() {
            return performanceMonitor.thermalHeadroom();
        }
    };

    private void statsLoop() {
        while (running) {
            Utils.sleepQuietly(330);
            performanceMonitor.sample();
            VideoEncoder enc = encoder;
            VideoTransport.Sender sender = videoSender;
            if (enc != null) {
                stats.fps = enc.fps();
                stats.encodeLatencyMs = enc.encodeLatencyMs();
                stats.bitrateBps = enc.currentBitrateBps();
                stats.droppedFrames = enc.droppedFrames();
                stats.keyframes = enc.keyframes();
            } else {
                stats.fps = 0;
                stats.bitrateBps = 0;
            }
            if (sender != null) {
                stats.packetsSent = sender.packetsSent();
                stats.retransmissions = sender.retransmissionCount();
                stats.videoBytesSent = sender.bytesSent();
            }
            if (sessionManager != null) {
                float rtt = sessionManager.session() == null ? stats.networkRttMs
                        : sessionManager.statsRtt();
                stats.networkRttMs = rtt;
            }
            stats.cpuPercent = performanceMonitor.cpuPercent();
            stats.thermalStatus = performanceMonitor.thermalStatus();
            stats.thermalText = performanceMonitor.describeThermal();
            stats.state = state;
            if (listener != null) {
                listener.onStats(stats);
            }
        }
    }

    /* ------------------------------------------------------------------ */

    private void setState(State newState, String message) {
        state = newState;
        stats.state = newState;
        if (discovery != null) {
            discovery.setAdvertisedState(gameName, newState == State.STREAMING ? 2 : 1,
                    profileSummary());
        }
        Logger.i(TAG, "State → " + newState + " (" + message + ")");
        if (listener != null) {
            mainHandler.post(() -> listener.onState(newState, message));
        }
    }

    private void warn(String message) {
        Logger.w(TAG, message);
        if (listener != null) {
            mainHandler.post(() -> listener.onWarning(message));
        }
    }

    private void fail(String message) {
        Logger.e(TAG, message);
        setState(State.ERROR, message);
        warn(message);
    }

    /** Convenience for the UI. */
    public String describeLink() {
        NetworkUtils.LinkInfo link = NetworkUtils.inspect(context);
        return String.format(Locale.US, "%s · %s · %s", link.localIp, link.band(),
                NetworkUtils.signalLabel(link));
    }
}
