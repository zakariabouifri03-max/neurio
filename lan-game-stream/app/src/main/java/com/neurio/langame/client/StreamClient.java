package com.neurio.langame.client;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Protocol.ControlFrame;
import com.neurio.langame.common.Security;
import com.neurio.langame.common.StreamProfile;
import com.neurio.langame.common.Utils;
import com.neurio.langame.network.AudioTransport;
import com.neurio.langame.network.ControlChannel;
import com.neurio.langame.network.PairingService;
import com.neurio.langame.network.VideoTransport;

import java.io.Closeable;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * The client engine: connect → pair → decode → play → report.
 *
 * <p>The client is deliberately thin. It never receives a game file, never
 * installs anything and does not need to know what the game is — it gets a video
 * stream, an audio stream and pushes input back. Everything it knows about the
 * host's game comes from the handshake.</p>
 */
public final class StreamClient implements Closeable {

    private static final String TAG = "StreamClient";

    public enum State {DISCONNECTED, CONNECTING, PAIRING, STREAMING, ERROR}

    public interface Listener {
        void onState(State state, String message);

        /** Handshake finished: the UI can show the game name and the negotiated profile. */
        void onSessionReady(PairingService.HandshakeResult session);

        void onStats(Stats stats);

        /** The host wants a pairing code (or rejected the one we sent). */
        void onPairingRequired(String hostName);

        /** Video keeps working; audio could not be played. */
        void onAudioUnavailable(String reason);
    }

    /** Everything the HUD and the performance screen need, refreshed ~2×/second. */
    public static final class Stats {
        public State state = State.DISCONNECTED;
        public String gameName = "";
        public String hostName = "";
        public String hostDevice = "";
        public StreamProfile profile;
        public String sessionFingerprint = "";
        public long sessionSeconds;

        /** Network. */
        public float rttMs;
        public float jitterMs;
        public float lossPercent;
        public float bitrateMbps;
        public int framesLost;
        public int nacksSent;
        public int keyframeRequests;

        /** Video. */
        public float fps;
        public float decodeLatencyMs = -1f;
        public float glassToGlassMs = -1f;
        public int decoderQueue;
        public int framesDecoded;
        public int framesDropped;

        /** Host telemetry (arrives over the control channel). */
        public int hostEncodeLatencyMs;
        public float hostFps;
        public int hostBitrateBps;
        public int hostDroppedFrames;
        public int hostThermalStatus;
        public float hostThermalHeadroom = Float.NaN;

        /** Audio + input. */
        public boolean audioActive;
        public String audioNote = "";
        public int inputEventsSent;

        /** Best available latency estimate: encode + half the RTT + decode/render. */
        public float latencyBudgetMs() {
            float budget = hostEncodeLatencyMs + rttMs / 2f;
            if (decodeLatencyMs >= 0) {
                budget += decodeLatencyMs;
            }
            return budget;
        }
    }

    private final Context context;
    private final Listener listener;
    private final AppSettings settings;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private final NetworkStats networkStats = new NetworkStats(true);
    private final Stats stats = new Stats();

    private ControlChannel control;
    private VideoTransport.Receiver videoReceiver;
    private AudioTransport.Receiver audioReceiver;
    private VideoDecoder decoder;
    private AudioPlayer audioPlayer;
    private InputSender inputSender;
    private PairingService.HandshakeResult session;
    private Surface surface;
    private volatile State state = State.DISCONNECTED;
    private volatile boolean running;
    private byte[] audioConfig;
    private Thread worker;
    private Thread reportThread;
    private long sessionStartedAtMs;

    public StreamClient(Context context, Listener listener, AppSettings settings) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.settings = settings;
    }

    /* ------------------------------------------------------------------ *
     *  Connect / disconnect
     * ------------------------------------------------------------------ */

    public void connect(String address, int controlPort, String pairingCode, Surface surface) {
        disconnect();
        synchronized (lock) {
            this.surface = surface;
            running = true;
        }
        worker = Utils.startThread("lgs-client-connect", Thread.NORM_PRIORITY + 2,
                () -> connectInternal(address, controlPort, pairingCode));
    }

    private void connectInternal(String address, int controlPort, String pairingCode) {
        setState(State.CONNECTING, "Connecting to " + address + "…");
        try {
            VideoTransport.Receiver video = new VideoTransport.Receiver(address);
            AudioTransport.Receiver audio = new AudioTransport.Receiver(0);

            ControlChannel channel = ControlChannel.connect(address, controlPort, 6000);
            channel.setReadTimeout(0);

            boolean wantsAudio = settings.captureAudio() && AudioPlayer.canPlay();
            android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            PairingService.HandshakeResult handshake = PairingService.connect(channel,
                    DeviceInfo.deviceName(), pairingCode, video.localPort(), audio.localPort(),
                    wantsAudio, metrics.widthPixels, metrics.heightPixels, settings.targetFps(),
                    decoderName(), Configuration.PAIRING_TIMEOUT_MS);

            synchronized (lock) {
                session = handshake;
                control = channel;
                video.setSessionTag(handshake.sessionTag);
                video.setListener(new VideoListener());
                videoReceiver = video;
                audio.setSessionTag(handshake.sessionTag);
                audio.setListener(new AudioListener());
                audioReceiver = audio;
                stats.gameName = handshake.gameName;
                stats.hostName = handshake.peerName;
                stats.hostDevice = handshake.peerDevice;
                stats.profile = handshake.profile;
                stats.sessionFingerprint = handshake.sessionKey == null
                        ? "unencrypted" : Security.fingerprint(handshake.sessionKey);
                stats.audioNote = handshake.audioEnabled
                        ? (settings.captureAudio() ? "receiving" : "receiving (muted locally)")
                        : "host is not sending audio";
                sessionStartedAtMs = System.currentTimeMillis();
            }

            channel.start(new ControlListener());
            video.start();
            audio.start();
            inputSender = new InputSender(address, handshake.sessionTag, handshake.clockOffsetMs);
            prepareDecoder(handshake.profile);
            requestKeyframe();

            if (!handshake.audioEnabled) {
                notifyAudio(stats.audioNote);
            }

            setState(State.STREAMING, handshake.gameName.isEmpty()
                    ? "Streaming from " + handshake.peerName
                    : "Playing " + handshake.gameName);
            if (listener != null) {
                mainHandler.post(() -> listener.onSessionReady(handshake));
            }
            startReportLoop();
        } catch (PairingService.PairingRequiredException e) {
            setState(State.PAIRING, "Pairing code required by " + e.hostName);
            if (listener != null) {
                mainHandler.post(() -> listener.onPairingRequired(e.hostName));
            }
            teardown();
        } catch (Exception e) {
            Logger.e(TAG, "Connect failed", e);
            setState(State.ERROR, "Could not connect: " + describe(e));
            teardown();
        }
    }

    private static String describe(Throwable t) {
        String message = t.getMessage();
        return t.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private String decoderName() {
        try {
            android.media.MediaCodecInfo info = DeviceInfo.findCodec(
                    Configuration.Codec.AVC.mime, false, 1920, 1080, 60);
            return info == null ? "" : info.getName();
        } catch (Exception e) {
            return "";
        }
    }

    /* ------------------------------------------------------------------ *
     *  Surface + decoder lifecycle
     * ------------------------------------------------------------------ */

    public void setSurface(Surface surface) {
        PairingService.HandshakeResult current;
        synchronized (lock) {
            this.surface = surface;
            current = session;
        }
        if (current != null && surface != null) {
            prepareDecoder(current.profile);
            requestKeyframe();
        }
    }

    public void clearSurface() {
        VideoDecoder local;
        synchronized (lock) {
            surface = null;
            local = decoder;
            decoder = null;
        }
        if (local != null) {
            local.release();
        }
    }

    /** (Re)builds the hardware decoder. Safe to call on every adapted profile. */
    private void prepareDecoder(StreamProfile profile) {
        Surface target;
        synchronized (lock) {
            target = surface;
        }
        if (target == null || !running) {
            return;   // the activity calls back through setSurface() when it is ready
        }
        VideoDecoder previous;
        synchronized (lock) {
            previous = decoder;
            decoder = null;
        }
        if (previous != null) {
            previous.release();
        }
        try {
            VideoDecoder fresh = new VideoDecoder(target, profile, new DecoderListener());
            fresh.configure(profile);
            synchronized (lock) {
                decoder = fresh;
                stats.profile = profile;
            }
        } catch (IOException e) {
            Logger.e(TAG, "Decoder could not be created", e);
            setState(State.ERROR, "No decoder for " + profile.codec.label + ": " + e.getMessage());
        }
    }

    private void startReportLoop() {
        reportThread = Utils.startThread("lgs-client-report", Thread.NORM_PRIORITY, () -> {
            while (running) {
                Utils.sleepQuietly(450);
                ControlChannel channel;
                synchronized (lock) {
                    channel = control;
                }
                if (channel == null || channel.isClosed()) {
                    continue;
                }
                try {
                    VideoTransport.Receiver receiver;
                    VideoDecoder dec;
                    synchronized (lock) {
                        receiver = videoReceiver;
                        dec = decoder;
                    }
                    int queue = dec == null ? 0 : dec.queueDepth();
                    networkStats.setDecodeQueueDepth(queue);
                    NetworkStats.Snapshot snapshot = networkStats.tick();
                    ByteBuffer body = Protocol.newBuffer(64);
                    networkStats.writeReportBody(body, stats.profile == null ? 0 : stats.profile.width,
                            stats.profile == null ? 0 : stats.profile.height,
                            stats.profile == null ? 0 : stats.profile.fps,
                            receiver == null ? 0 : receiver.framesCompleted());
                    byte[] payload = Protocol.toBytes(body);
                    if (channel.isAuthenticated()) {
                        channel.send(Protocol.MSG_CLIENT_REPORT, payload);
                    } else {
                        channel.sendRaw(Protocol.MSG_CLIENT_REPORT, payload);
                    }
                    updateStats(snapshot, queue, dec);
                } catch (Exception e) {
                    Logger.w(TAG, "Report failed: " + e.getMessage());
                }
            }
        });
    }

    private void updateStats(NetworkStats.Snapshot snapshot, int queue, VideoDecoder dec) {
        InputSender sender;
        AudioPlayer player;
        VideoTransport.Receiver receiver;
        synchronized (lock) {
            sender = inputSender;
            player = audioPlayer;
            receiver = videoReceiver;
            stats.state = state;
            stats.rttMs = snapshot.rttMs;
            stats.lossPercent = snapshot.lossPercent;
            stats.jitterMs = snapshot.jitterMs;
            stats.bitrateMbps = snapshot.bitrateMbps;
            stats.fps = dec == null ? 0 : dec.fps();
            stats.decodeLatencyMs = dec == null ? -1 : dec.decodeLatencyMs();
            stats.decoderQueue = queue;
            stats.framesDecoded = dec == null ? 0 : dec.framesQueued();
            stats.framesDropped = dec == null ? 0 : dec.framesDropped();
            stats.framesLost = receiver == null ? 0 : receiver.framesDropped();
            stats.nacksSent = receiver == null ? 0 : receiver.nacksSent();
            stats.keyframeRequests = receiver == null ? 0 : receiver.keyframeRequestsSent();
            stats.audioActive = player != null && player.isRunning();
            stats.inputEventsSent = sender == null ? 0 : sender.eventsSent();
            stats.sessionSeconds = sessionStartedAtMs == 0 ? 0
                    : (System.currentTimeMillis() - sessionStartedAtMs) / 1000;
            float budget = stats.hostEncodeLatencyMs + stats.rttMs / 2f
                    + (stats.decodeLatencyMs < 0 ? 0 : stats.decodeLatencyMs);
            stats.glassToGlassMs = budget;
        }
        if (listener != null) {
            mainHandler.post(() -> listener.onStats(stats));
        }
    }

    /* ------------------------------------------------------------------ *
     *  Transport callbacks
     * ------------------------------------------------------------------ */

    private final class VideoListener implements VideoTransport.Receiver.Listener {
        @Override
        public void onFrame(VideoTransport.Receiver.Frame frame) {
            networkStats.onFrameId(frame.frameId);
            networkStats.onPacketsReceived(1, frame.length);
            VideoDecoder dec;
            VideoTransport.Receiver receiver;
            synchronized (lock) {
                dec = decoder;
                receiver = videoReceiver;
            }
            if (dec != null) {
                dec.queueFrame(frame.data, frame.length, frame.presentationTimeUs, frame.keyframe);
            }
            if (receiver != null) {
                receiver.recycle(frame);   // mandatory: the frame buffer goes back to the pool
            }
        }

        @Override
        public void onFrameDropped(int frameId) {
            networkStats.onFrameLost();
        }
    }

    private final class DecoderListener implements VideoDecoder.Listener {
        @Override
        public void onFrameRendered(long renderTimeNs, float decodedFps) {
            networkStats.onFrameDecoded();
        }

        @Override
        public void onDecoderError(String message) {
            Logger.w(TAG, "Decoder error: " + message);
            requestKeyframe();
        }

        @Override
        public void onFormatChanged(int width, int height) {
            Logger.i(TAG, "Picture size " + width + "×" + height);
        }
    }

    private final class AudioListener implements AudioTransport.Receiver.Listener {
        @Override
        public void onCodecConfig(byte[] config) {
            synchronized (lock) {
                audioConfig = config;
                if (audioPlayer != null) {
                    audioPlayer.setCodecConfig(config);
                }
            }
        }

        @Override
        public void onFrame(byte[] data, int length, long timestampUs) {
            AudioPlayer player;
            synchronized (lock) {
                if (audioPlayer == null && running) {
                    try {
                        AudioPlayer fresh = new AudioPlayer();
                        fresh.setCodecConfig(audioConfig);
                        fresh.start();
                        audioPlayer = fresh;
                    } catch (IOException e) {
                        Logger.e(TAG, "Audio playback failed to start", e);
                        notifyAudio("Audio output unavailable: " + e.getMessage());
                        return;
                    }
                }
                player = audioPlayer;
            }
            if (player != null) {
                player.onFrame(data, length, timestampUs);
            }
        }

        @Override
        public void onStats(int received, int lost) {
            // Audio loss is folded into the client's own statistics above.
        }
    }

    private final class ControlListener implements ControlChannel.Listener {
        @Override
        public void onFrame(ControlFrame frame) {
            switch (frame.type) {
                case Protocol.MSG_SESSION_OFFER:
                    onProfileUpdate(frame.body);
                    break;
                case Protocol.MSG_HOST_STATS:
                    onHostStats(frame.body);
                    break;
                case Protocol.MSG_CSD:
                    synchronized (lock) {
                        if (decoder != null) {
                            decoder.setCodecConfig(frame.body);
                        }
                    }
                    requestKeyframe();
                    break;
                case Protocol.MSG_BYE:
                    Logger.i(TAG, "Host ended the session: " + PairingService.describeBye(frame.body));
                    setState(State.DISCONNECTED,
                            "Host closed the stream: " + PairingService.describeBye(frame.body));
                    break;
                case Protocol.MSG_PING:
                case Protocol.MSG_PONG:
                    break;
                default:
                    break;
            }
        }

        @Override
        public void onClosed(String reason) {
            if (running) {
                setState(State.ERROR, "Connection lost: " + reason);
            }
        }
    }

    private void onProfileUpdate(byte[] body) {
        try {
            ByteBuffer in = ByteBuffer.wrap(body);
            Configuration.Codec[] codecs = Configuration.Codec.values();
            int ordinal = in.get() & 0xFF;
            Configuration.Codec codec = ordinal < codecs.length
                    ? codecs[ordinal] : Configuration.Codec.AVC;
            int width = in.getShort() & 0xFFFF;
            int height = in.getShort() & 0xFFFF;
            int fps = in.getShort() & 0xFFFF;
            int bitrate = in.getInt();
            boolean audioEnabled = (in.get() & 0xFF) != 0;
            StreamProfile updated = new StreamProfile(codec, width, height, fps, bitrate);
            synchronized (lock) {
                stats.profile = updated;
                stats.audioNote = audioEnabled ? "receiving" : "host is not sending audio";
            }
            Logger.i(TAG, "Host switched to " + updated.describe());
            prepareDecoder(updated);
            requestKeyframe();
        } catch (Exception e) {
            Logger.w(TAG, "Bad profile update: " + e.getMessage());
        }
    }

    private void onHostStats(byte[] body) {
        try {
            ByteBuffer in = ByteBuffer.wrap(body);
            in.getInt();                                   // encoded frames
            stats.hostDroppedFrames = in.getInt();
            stats.hostBitrateBps = in.getInt();
            stats.hostEncodeLatencyMs = (int) in.getFloat();
            stats.hostFps = in.getFloat();
            stats.hostThermalStatus = in.get() & 0xFF;
            in.get();                                      // keyframe counter
            in.getShort();                                 // padding
            stats.hostThermalHeadroom = in.getFloat();
        } catch (Exception e) {
            Logger.w(TAG, "Bad host stats frame: " + e.getMessage());
        }
    }

    /* ------------------------------------------------------------------ *
     *  Public control surface
     * ------------------------------------------------------------------ */

    public InputSender input() {
        synchronized (lock) {
            return inputSender;
        }
    }

    public void requestKeyframe() {
        VideoTransport.Receiver receiver;
        synchronized (lock) {
            receiver = videoReceiver;
        }
        if (receiver != null) {
            receiver.requestKeyframe();
        }
    }

    public Stats stats() {
        return stats;
    }

    public State state() {
        return state;
    }

    public boolean isRunning() {
        return running;
    }

    /* ------------------------------------------------------------------ */

    private void setState(State newState, String message) {
        state = newState;
        stats.state = newState;
        Logger.i(TAG, "Client state → " + newState + " (" + message + ")");
        if (listener != null) {
            mainHandler.post(() -> listener.onState(newState, message));
        }
    }

    private void notifyAudio(String reason) {
        if (listener != null) {
            mainHandler.post(() -> listener.onAudioUnavailable(reason));
        }
    }

    /** Stops everything that carries a session but keeps the object reusable. */
    private void teardown() {
        ControlChannel channel;
        VideoTransport.Receiver video;
        AudioTransport.Receiver audio;
        InputSender sender;
        VideoDecoder dec;
        AudioPlayer player;
        synchronized (lock) {
            channel = control;
            video = videoReceiver;
            audio = audioReceiver;
            sender = inputSender;
            dec = decoder;
            player = audioPlayer;
            control = null;
            videoReceiver = null;
            audioReceiver = null;
            inputSender = null;
            decoder = null;
            audioPlayer = null;
            session = null;
            audioConfig = null;
        }
        Utils.closeQuietly(channel);
        if (video != null) {
            video.close();
        }
        if (audio != null) {
            audio.close();
        }
        if (sender != null) {
            sender.close();
        }
        if (dec != null) {
            dec.release();
        }
        if (player != null) {
            player.release();
        }
    }

    public void disconnect() {
        running = false;
        teardown();
        setState(State.DISCONNECTED, "Disconnected");
    }

    @Override
    public void close() {
        disconnect();
    }
}
