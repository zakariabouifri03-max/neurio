package com.neurio.langame.network;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Protocol.ControlFrame;
import com.neurio.langame.common.StreamProfile;
import com.neurio.langame.common.Utils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Host-side session state machine: accepts exactly one paired client at a time,
 * owns the control channel, publishes statistics and forwards the client's
 * feedback (loss/jitter/decoder queue/keyframe requests) to the streaming engine.
 */
public final class SessionManager {

    private static final String TAG = "Session";

    public interface Listener {
        /** A client finished the handshake and wants video. */
        void onClientConnected(PairingService.HandshakeResult session);

        /** The client went away (or was rejected) — stop streaming to it. */
        void onClientDisconnected(String reason);

        /** Periodic link report from the client (drives adaptive streaming). */
        void onClientReport(NetworkStats.Snapshot snapshot, int requestedWidth,
                            int requestedHeight, int requestedFps);

        /** The client's decoder could not recover and asked for an I-frame. */
        void onKeyframeRequested();

        /** A frame with a bad MAC arrived (someone else is talking to us). */
        void onAuthenticationFailure(String reason);
    }

    /** Supplies the live encoder numbers that go into HOST_STATS. */
    public interface StatsProvider {
        int encodedFrames();

        int droppedFrames();

        int bitrateBps();

        float encodeLatencyMs();

        float fps();

        int keyframes();

        int thermalStatus();

        float thermalHeadroom();
    }

    private final Listener listener;
    private final String hostName;
    private final boolean audioAvailable;
    private final java.util.function.Supplier<String> pairingCodeSupplier;
    private final java.util.function.Supplier<StreamProfile> proposalSupplier;
    private final java.util.function.Supplier<StatsProvider> statsSupplier;

    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean clientConnected = new AtomicBoolean();
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private Thread statsThread;

    private volatile ControlChannel channel;
    private volatile PairingService.HandshakeResult session;
    private volatile long lastReportMs;
    private volatile int wrongCodeAttempts;

    public SessionManager(Listener listener,
                          String hostName,
                          boolean audioAvailable,
                          java.util.function.Supplier<String> pairingCodeSupplier,
                          java.util.function.Supplier<StreamProfile> proposalSupplier,
                          java.util.function.Supplier<StatsProvider> statsSupplier) {
        this.listener = listener;
        this.hostName = hostName;
        this.audioAvailable = audioAvailable;
        this.pairingCodeSupplier = pairingCodeSupplier;
        this.proposalSupplier = proposalSupplier;
        this.statsSupplier = statsSupplier;
    }

    /* ------------------------------------------------------------------ */

    public void start(int port) throws IOException {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(port));
        Logger.i(TAG, "Control server listening on " + port);

        acceptThread = Utils.startThread("lgs-control-accept", Thread.NORM_PRIORITY + 1,
                this::acceptLoop);
        statsThread = Utils.startThread("lgs-host-stats", Thread.NORM_PRIORITY, this::statsLoop);
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket socket = serverSocket.accept();
                if (clientConnected.get()) {
                    Logger.w(TAG, "Refusing extra client from " + socket.getInetAddress());
                    Utils.closeQuietly(socket);
                    continue;
                }
                socket.setTcpNoDelay(true);
                handleClient(socket);
            } catch (IOException e) {
                if (running.get()) {
                    Logger.w(TAG, "Accept failed: " + e.getMessage());
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        ControlChannel newChannel = null;
        try {
            newChannel = ControlChannel.accept(socket);
            String code = pairingCodeSupplier == null ? "" : pairingCodeSupplier.get();
            StreamProfile proposal = proposalSupplier == null ? null : proposalSupplier.get();
            if (proposal == null) {
                proposal = new StreamProfile(Configuration.Codec.AVC, 1280, 720, 60, 8_000_000);
            }
            Logger.i(TAG, "Client connected from " + newChannel.remoteAddress()
                    + " — starting handshake");

            PairingService.HandshakeResult result = PairingService.accept(
                    newChannel, code, hostName, "", proposal, audioAvailable,
                    Configuration.PAIRING_TIMEOUT_MS, android.os.SystemClock.uptimeMillis());

            this.channel = newChannel;
            this.session = result;
            clientConnected.set(true);
            lastReportMs = System.currentTimeMillis();
            newChannel.start(new ControlChannel.Listener() {
                @Override
                public void onFrame(ControlFrame frame) {
                    onControlFrame(frame);
                }

                @Override
                public void onClosed(String reason) {
                    Logger.i(TAG, "Control channel closed: " + reason);
                    if (clientConnected.get()) {
                        closeSession("connection lost: " + reason);
                    }
                }
            });
            if (listener != null) {
                listener.onClientConnected(result);
            }
        } catch (PairingService.PairingRequiredException e) {
            Logger.w(TAG, "Client needs a pairing code");
            Utils.closeQuietly(newChannel);
        } catch (IOException e) {
            Logger.w(TAG, "Handshake failed: " + e.getMessage());
            Utils.closeQuietly(newChannel);
            if (e.getMessage() != null && e.getMessage().contains("wrong pairing code")) {
                wrongCodeAttempts++;
                if (wrongCodeAttempts >= 3) {
                    Logger.w(TAG, "Too many wrong pairing codes — regenerating the code");
                    listener.onAuthenticationFailure("too many wrong pairing codes");
                    wrongCodeAttempts = 0;
                }
            }
        } catch (Throwable t) {
            Logger.e(TAG, "Handshake crashed", t);
            Utils.closeQuietly(newChannel);
        }
    }

    private void onControlFrame(ControlFrame frame) {
        switch (frame.type) {
            case Protocol.MSG_CLIENT_REPORT: {
                lastReportMs = System.currentTimeMillis();
                try {
                    ByteBuffer in = ByteBuffer.wrap(frame.body);
                    long framesReceived = in.getInt() & 0xFFFFFFFFL;
                    NetworkStats.Snapshot snapshot = NetworkStats.readReportBody(in);
                    int width = in.getShort() & 0xFFFF;
                    int height = in.getShort() & 0xFFFF;
                    int fps = in.getShort() & 0xFFFF;
                    if (listener != null) {
                        listener.onClientReport(snapshot, width, height, fps);
                    }
                } catch (Exception e) {
                    Logger.w(TAG, "Malformed client report: " + e.getMessage());
                }
                break;
            }
            case Protocol.MSG_KEYFRAME_REQUEST:
                if (listener != null) {
                    listener.onKeyframeRequested();
                }
                break;
            case Protocol.MSG_BYE:
                Logger.i(TAG, "Client said goodbye: " + PairingService.describeBye(frame.body));
                closeSession("client left");
                break;
            default:
                Logger.w(TAG, "Unhandled control frame " + frame.type);
        }
    }

    private void statsLoop() {
        while (running.get()) {
            Utils.sleepQuietly(400);
            ControlChannel current = channel;
            if (current == null || current.isClosed() || !clientConnected.get()) {
                continue;
            }
            if (System.currentTimeMillis() - lastReportMs > 4000) {
                closeSession("client stopped reporting");
                continue;
            }
            StatsProvider provider = statsSupplier == null ? null : statsSupplier.get();
            if (provider == null) {
                continue;
            }
            try {
                ByteBuffer body = Protocol.newBuffer(64);
                body.putInt(provider.encodedFrames());
                body.putInt(provider.droppedFrames());
                body.putInt(provider.bitrateBps());
                body.putFloat(provider.encodeLatencyMs());
                body.putFloat(provider.fps());
                body.put((byte) provider.keyframes());
                body.put((byte) provider.thermalStatus());
                body.putShort((short) 0);
                body.putFloat(provider.thermalHeadroom());
                if (current.isAuthenticated()) {
                    current.send(Protocol.MSG_HOST_STATS, Protocol.toBytes(body));
                } else {
                    current.sendRaw(Protocol.MSG_HOST_STATS, Protocol.toBytes(body));
                }
            } catch (Exception e) {
                Logger.w(TAG, "Could not send host stats: " + e.getMessage());
            }
        }
    }

    /** Ships codec specific data (SPS/PPS) to the client after an encoder start. */
    public void sendCsd(byte[] csd) {
        ControlChannel current = channel;
        if (current == null || current.isClosed() || csd == null || csd.length == 0) {
            return;
        }
        try {
            if (current.isAuthenticated()) {
                current.send(Protocol.MSG_CSD, csd);
            } else {
                current.sendRaw(Protocol.MSG_CSD, csd);
            }
        } catch (Exception e) {
            Logger.w(TAG, "CSD send failed: " + e.getMessage());
        }
    }

    /** Tells the client that the profile changed (adaptive resolution/fps switch). */
    public void sendProfileUpdate(StreamProfile profile, boolean audioEnabled) {
        ControlChannel current = channel;
        if (current == null || current.isClosed()) {
            return;
        }
        ByteBuffer body = Protocol.newBuffer(64);
        body.put((byte) profile.codec.ordinal());
        body.putShort((short) profile.width);
        body.putShort((short) profile.height);
        body.putShort((short) profile.fps);
        body.putInt(profile.bitrateBps);
        body.put((byte) (audioEnabled ? 1 : 0));
        body.putShort((short) 0);
        try {
            if (current.isAuthenticated()) {
                current.send(Protocol.MSG_SESSION_OFFER, Protocol.toBytes(body));
            } else {
                current.sendRaw(Protocol.MSG_SESSION_OFFER, Protocol.toBytes(body));
            }
        } catch (Exception e) {
            Logger.w(TAG, "Profile update failed: " + e.getMessage());
        }
    }

    /* ------------------------------------------------------------------ */

    public boolean isClientConnected() {
        return clientConnected.get();
    }

    public PairingService.HandshakeResult session() {
        return session;
    }

    /** RTT of the control channel in milliseconds ({@code -1} when not paired). */
    public float statsRtt() {
        ControlChannel current = channel;
        return current == null ? -1f : current.rttMs();
    }

    public void closeSession(String reason) {
        if (!clientConnected.compareAndSet(true, false)) {
            ControlChannel current = channel;
            Utils.closeQuietly(current);
            channel = null;
            session = null;
            return;
        }
        Logger.i(TAG, "Session closed: " + reason);
        ControlChannel current = channel;
        if (current != null && !current.isClosed()) {
            try {
                ByteBuffer body = Protocol.newBuffer(64);
                Protocol.putString(body, reason);
                if (current.isAuthenticated()) {
                    current.send(Protocol.MSG_BYE, Protocol.toBytes(body));
                } else {
                    current.sendRaw(Protocol.MSG_BYE, Protocol.toBytes(body));
                }
            } catch (Exception ignored) {
            }
            Utils.closeQuietly(current);
        }
        channel = null;
        session = null;
        if (listener != null) {
            listener.onClientDisconnected(reason);
        }
    }

    public void stop() {
        running.set(false);
        closeSession("host stopped");
        if (serverSocket != null) {
            Utils.closeQuietly(serverSocket);
            serverSocket = null;
        }
    }
}
