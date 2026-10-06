package com.neurio.langame.network;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Protocol.ControlFrame;
import com.neurio.langame.common.Security;
import com.neurio.langame.common.StreamProfile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;

/**
 * The pairing + session handshake, shared by host and client.
 *
 * <pre>
 *   client                                   host
 *     │  HELLO (nonce, device, screen)  ─────▶ │
 *     │ ◀─────  HELLO_ACK (salt, nonce, game)  │
 *     │  PAIR_REQUEST (PBKDF2 proof)   ─────▶  │   code checked here
 *     │ ◀─────────────  PAIR_RESULT (ok?)      │
 *     │  SESSION_ACCEPT (decoder caps,         │
 *     │   UDP ports, wants-audio)      ─────▶  │
 *     │ ◀──────  SESSION_START (profile, tag)  │
 * </pre>
 *
 * <p>Everything after the pairing result is HMAC-SHA256 authenticated with the
 * session key derived from the 6-digit code, so a third phone on the same Wi-Fi
 * cannot hijack another client's session.</p>
 *
 * <p>The whole handshake runs synchronously on the control channel before the
 * asynchronous reader thread is started; that keeps ordering trivially correct.</p>
 */
public final class PairingService {

    private static final String TAG = "Pairing";

    /** Raised when the host requires a code and the client did not supply one. */
    public static final class PairingRequiredException extends IOException {
        public final String hostName;
        public final String gameName;

        PairingRequiredException(String hostName, String gameName) {
            super("Pairing code required");
            this.hostName = hostName;
            this.gameName = gameName;
        }
    }

    /** Outcome of a successful handshake. */
    public static final class HandshakeResult {
        public byte[] sessionKey;
        public int sessionTag;
        public String peerName = "";
        public String peerDevice = "";
        public String gameName = "";
        public StreamProfile profile;
        public boolean audioEnabled;
        /** Client::to-host clock offset in ms (host uptime ≈ client uptime + offset). */
        public long clockOffsetMs;
        /** Host only: where to send video/audio. */
        public String clientAddress = "";
        public int clientVideoPort;
        public int clientAudioPort;
        public boolean clientWantsAudio;
        /** Host only: client decoder limits. */
        public int clientMaxWidth;
        public int clientMaxHeight;
        public int clientMaxFps;
        public String clientDecoderName = "";
        public float handshakeRttMs;
    }

    private PairingService() {
    }

    /* ================================================================== *
     *  Client side
     * ================================================================== */

    /**
     * @param code         6-digit pairing code, or {@code null} to just probe the host
     * @param videoPort    local UDP port the client will receive video on
     * @param audioPort    local UDP port the client will receive audio on
     * @param wantsAudio   whether the client wants the audio stream at all
     */
    public static HandshakeResult connect(ControlChannel channel,
                                          String clientName,
                                          String code,
                                          int videoPort,
                                          int audioPort,
                                          boolean wantsAudio,
                                          int maxWidth,
                                          int maxHeight,
                                          int maxFps,
                                          String decoderName,
                                          long timeoutMs) throws IOException {
        HandshakeResult result = new HandshakeResult();
        long startMs = System.currentTimeMillis();

        byte[] clientNonce = Security.randomBytes(16);
        ByteBuffer hello = Protocol.newBuffer(512);
        hello.put((byte) Configuration.PROTOCOL_VERSION);
        Protocol.putString(hello, clientName);
        Protocol.putString(hello, DeviceInfo.deviceName());
        hello.putShort((short) Math.min(maxWidth, 10000));
        hello.putShort((short) Math.min(maxHeight, 10000));
        Protocol.putBytes(hello, clientNonce);

        channel.setReadTimeout((int) timeoutMs);
        channel.sendRaw(Protocol.MSG_HELLO, Protocol.toBytes(hello));

        ControlFrame ack = readExpecting(channel, Protocol.MSG_HELLO_ACK, timeoutMs);
        ByteBuffer in = ByteBuffer.wrap(ack.body);
        int version = in.get() & 0xFF;
        if (version != Configuration.PROTOCOL_VERSION) {
            throw new IOException("Host speaks protocol v" + version + ", we speak v"
                    + Configuration.PROTOCOL_VERSION);
        }
        result.peerName = Protocol.getString(in);
        result.peerDevice = Protocol.getString(in);
        result.gameName = Protocol.getString(in);
        boolean pairingRequired = (in.get() & 0xFF) != 0;
        byte[] salt = Protocol.getBytes(in);
        byte[] hostNonce = Protocol.getBytes(in);
        long hostUptimeMs = in.getInt() & 0xFFFFFFFFL;

        long rttEstimate = System.currentTimeMillis() - startMs;
        result.handshakeRttMs = rttEstimate;

        if (pairingRequired && (code == null || code.isEmpty())) {
            throw new PairingRequiredException(result.peerName, result.gameName);
        }

        if (pairingRequired) {
            byte[] sessionKey;
            try {
                byte[] pairingKey = Security.deriveKeyFromCode(code, salt);
                byte[] proof = Security.pairingProof(pairingKey, clientNonce, hostNonce);
                ByteBuffer request = Protocol.newBuffer(128);
                Protocol.putBytes(request, proof);
                Protocol.putString(request, clientName);
                channel.sendRaw(Protocol.MSG_PAIR_REQUEST, Protocol.toBytes(request));

                ControlFrame pairResult = readExpecting(channel, Protocol.MSG_PAIR_RESULT, timeoutMs);
                ByteBuffer body = ByteBuffer.wrap(pairResult.body);
                boolean ok = (body.get() & 0xFF) != 0;
                String reason = Protocol.getString(body);
                if (!ok) {
                    throw new IOException("Host rejected the pairing code" + (reason.isEmpty()
                            ? "" : ": " + reason));
                }
                sessionKey = Security.deriveSessionKey(pairingKey, clientNonce, hostNonce);
            } catch (GeneralSecurityException e) {
                throw new IOException("Crypto unavailable: " + e.getMessage(), e);
            }
            channel.setSessionKey(sessionKey);
            result.sessionKey = sessionKey;
        }

        // Clock offset: host clock ≈ client clock + offset (used for input latency).
        result.clockOffsetMs = hostUptimeMs + (rttEstimate / 2) - System.currentTimeMillis();

        ByteBuffer accept = Protocol.newBuffer(256);
        accept.putShort((short) videoPort);
        accept.putShort((short) audioPort);
        accept.put((byte) (wantsAudio ? 1 : 0));
        accept.putShort((short) maxWidth);
        accept.putShort((short) maxHeight);
        accept.putShort((short) maxFps);
        Protocol.putString(accept, decoderName);
        Protocol.putString(accept, DeviceInfo.deviceName());

        ControlFrame startFrame;
        if (channel.isAuthenticated()) {
            channel.send(Protocol.MSG_SESSION_ACCEPT, Protocol.toBytes(accept));
            startFrame = readExpecting(channel, Protocol.MSG_SESSION_START, timeoutMs);
        } else {
            // Pairing was not required by the host ("open" mode): the session tag
            // still gives us a filter for stray datagrams.
            channel.sendRaw(Protocol.MSG_SESSION_ACCEPT, Protocol.toBytes(accept));
            startFrame = readExpecting(channel, Protocol.MSG_SESSION_START, timeoutMs);
        }

        ByteBuffer start = ByteBuffer.wrap(startFrame.body);
        int codecOrdinal = start.get() & 0xFF;
        Configuration.Codec[] codecs = Configuration.Codec.values();
        Configuration.Codec codec = codecOrdinal < codecs.length
                ? codecs[codecOrdinal] : Configuration.Codec.AVC;
        int width = start.getShort() & 0xFFFF;
        int height = start.getShort() & 0xFFFF;
        int fps = start.getShort() & 0xFFFF;
        int bitrate = start.getInt();
        result.profile = new StreamProfile(codec, width, height, fps, bitrate);
        result.sessionTag = start.getShort() & 0xFFFF;
        result.audioEnabled = (start.get() & 0xFF) != 0;
        result.gameName = Protocol.getString(start);

        channel.setReadTimeout(0);   // reader thread will now block properly
        Logger.i(TAG, "Paired with " + result.peerName + " · " + result.profile
                + " · tag=0x" + Integer.toHexString(result.sessionTag));
        return result;
    }

    /* ================================================================== *
     *  Host side
     * ================================================================== */

    /**
     * Runs the host half of the handshake on an accepted control channel.
     *
     * @param pairingCode      the code currently displayed on the host screen
     * @param proposal         the profile the host would like to stream
     * @param audioAvailable   whether host audio capture is actually working
     */
    public static HandshakeResult accept(ControlChannel channel,
                                         String pairingCode,
                                         String hostName,
                                         String gameName,
                                         StreamProfile proposal,
                                         boolean audioAvailable,
                                         long timeoutMs,
                                         long hostUptimeMs) throws IOException {
        HandshakeResult result = new HandshakeResult();
        channel.setReadTimeout((int) timeoutMs);

        ControlFrame hello = readExpecting(channel, Protocol.MSG_HELLO, timeoutMs);
        ByteBuffer in = ByteBuffer.wrap(hello.body);
        int version = in.get() & 0xFF;
        if (version != Configuration.PROTOCOL_VERSION) {
            sendRaw(channel, Protocol.MSG_HELLO_ACK, encodeHelloAck(hostName, gameName, false,
                    new byte[16], new byte[16], hostUptimeMs));
            throw new IOException("Client speaks protocol v" + version);
        }
        result.peerName = Protocol.getString(in);
        result.peerDevice = Protocol.getString(in);
        result.clientMaxWidth = in.getShort() & 0xFFFF;
        result.clientMaxHeight = in.getShort() & 0xFFFF;
        byte[] clientNonce = Protocol.getBytes(in);
        result.clientAddress = channel.remoteAddress();

        byte[] salt = Security.randomBytes(16);
        byte[] hostNonce = Security.randomBytes(16);
        boolean pairingRequired = pairingCode != null && !pairingCode.isEmpty();

        channel.sendRaw(Protocol.MSG_HELLO_ACK, encodeHelloAck(hostName, gameName, pairingRequired,
                salt, hostNonce, hostUptimeMs));

        if (pairingRequired) {
            ControlFrame request = readExpecting(channel, Protocol.MSG_PAIR_REQUEST, timeoutMs);
            ByteBuffer body = ByteBuffer.wrap(request.body);
            byte[] proof = Protocol.getBytes(body);
            String clientName = Protocol.getString(body);
            if (!clientName.isEmpty()) {
                result.peerName = clientName;
            }

            boolean ok;
            byte[] sessionKey = null;
            try {
                byte[] pairingKey = Security.deriveKeyFromCode(pairingCode, salt);
                byte[] expected = Security.pairingProof(pairingKey, clientNonce, hostNonce);
                ok = Security.constantTimeEquals(expected, proof);
                if (ok) {
                    sessionKey = Security.deriveSessionKey(pairingKey, clientNonce, hostNonce);
                }
            } catch (GeneralSecurityException e) {
                ok = false;
                Logger.e(TAG, "Pairing crypto failed", e);
            }

            ByteBuffer answer = Protocol.newBuffer(64);
            answer.put((byte) (ok ? 1 : 0));
            Protocol.putString(answer, ok ? "" : "wrong code");
            channel.sendRaw(Protocol.MSG_PAIR_RESULT, Protocol.toBytes(answer));

            if (!ok) {
                throw new IOException("Client presented a wrong pairing code");
            }
            channel.setSessionKey(sessionKey);
            result.sessionKey = sessionKey;
            Logger.i(TAG, "Client " + result.peerName + " paired ("
                    + Security.fingerprint(sessionKey) + ")");
        }

        ControlFrame acceptFrame = readExpecting(channel, Protocol.MSG_SESSION_ACCEPT, timeoutMs);
        if (acceptFrame.isAuthenticated()) {
            // Verified by readExpecting(): a bad MAC throws before we get here.
            Logger.i(TAG, "Session accept authenticated");
        }
        ByteBuffer accept = ByteBuffer.wrap(acceptFrame.body);
        result.clientVideoPort = accept.getShort() & 0xFFFF;
        result.clientAudioPort = accept.getShort() & 0xFFFF;
        result.clientWantsAudio = (accept.get() & 0xFF) != 0;
        result.clientMaxWidth = accept.getShort() & 0xFFFF;
        result.clientMaxHeight = accept.getShort() & 0xFFFF;
        result.clientMaxFps = accept.getShort() & 0xFFFF;
        result.clientDecoderName = Protocol.getString(accept);
        // Second string (device name) is informational.
        try {
            String device = Protocol.getString(accept);
            if (!device.isEmpty()) {
                result.peerDevice = device;
            }
        } catch (Exception ignored) {
            // Older clients send only one string.
        }

        StreamProfile negotiated = negotiate(proposal, result.clientMaxWidth,
                result.clientMaxHeight, result.clientMaxFps);
        result.profile = negotiated;
        result.sessionTag = Security.newSessionTag();
        result.audioEnabled = audioAvailable && result.clientWantsAudio;

        ByteBuffer start = Protocol.newBuffer(128);
        start.put((byte) negotiated.codec.ordinal());
        start.putShort((short) negotiated.width);
        start.putShort((short) negotiated.height);
        start.putShort((short) negotiated.fps);
        start.putInt(negotiated.bitrateBps);
        start.putShort((short) result.sessionTag);
        start.put((byte) (result.audioEnabled ? 1 : 0));
        Protocol.putString(start, gameName == null ? "" : gameName);
        if (channel.isAuthenticated()) {
            channel.send(Protocol.MSG_SESSION_START, Protocol.toBytes(start));
        } else {
            channel.sendRaw(Protocol.MSG_SESSION_START, Protocol.toBytes(start));
        }
        channel.setReadTimeout(0);

        Logger.i(TAG, "Session started for " + result.peerName + " · " + negotiated
                + " · audio=" + result.audioEnabled);
        return result;
    }

    private static byte[] encodeHelloAck(String hostName, String gameName, boolean pairingRequired,
                                         byte[] salt, byte[] hostNonce, long hostUptimeMs) {
        ByteBuffer out = Protocol.newBuffer(256);
        out.put((byte) Configuration.PROTOCOL_VERSION);
        Protocol.putString(out, hostName);
        Protocol.putString(out, DeviceInfo.deviceName());
        Protocol.putString(out, gameName == null ? "" : gameName);
        out.put((byte) (pairingRequired ? 1 : 0));
        Protocol.putBytes(out, salt);
        Protocol.putBytes(out, hostNonce);
        out.putInt((int) (hostUptimeMs & 0xFFFFFFFFL));
        return Protocol.toBytes(out);
    }

    /** Downgrades the proposal to something the client's decoder admits to support. */
    public static StreamProfile negotiate(StreamProfile proposal, int maxWidth, int maxHeight,
                                          int maxFps) {
        int width = proposal.width;
        int height = proposal.height;
        int fps = proposal.fps;
        if (maxWidth > 0 && maxHeight > 0) {
            while (width > maxWidth || height > maxHeight) {
                if (height > 720) {
                    height = 720;
                    width = 1280;
                } else if (height > 480) {
                    height = 480;
                    width = 854;
                } else {
                    break;
                }
            }
        }
        if (maxFps > 0 && fps > maxFps) {
            fps = maxFps >= 60 ? 60 : (maxFps >= 30 ? 30 : maxFps);
        }
        if (width == proposal.width && height == proposal.height && fps == proposal.fps) {
            return proposal;
        }
        return proposal.withShape(width, height, fps);
    }

    private static ControlFrame readExpecting(ControlChannel channel, int expectedType,
                                              long timeoutMs) throws IOException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (true) {
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0) {
                throw new IOException("Handshake timed out waiting for message " + expectedType);
            }
            ControlFrame frame = channel.readFrameSync();
            if (frame == null) {
                throw new IOException("Peer closed the control channel during the handshake");
            }
            if (frame.type == Protocol.MSG_PING) {
                channel.sendRaw(Protocol.MSG_PONG, frame.body);
                continue;
            }
            if (frame.type == Protocol.MSG_BYE) {
                throw new IOException("Peer cancelled: " + describeBye(frame.body));
            }
            if (frame.isAuthenticated()) {
                javax.crypto.Mac mac = channel.macOrNull();
                if (mac == null || !Protocol.verifyControlFrame(frame, mac)) {
                    throw new IOException("Unauthenticated frame rejected (type=" + frame.type + ")");
                }
            }
            if (frame.type != expectedType) {
                Logger.w(TAG, "Ignoring unexpected handshake frame " + frame.type);
                continue;
            }
            return frame;
        }
    }

    private static void sendRaw(ControlChannel channel, int type, byte[] body) {
        channel.sendRaw(type, body);
    }

    public static String describeBye(byte[] body) {
        try {
            return Protocol.getString(ByteBuffer.wrap(body));
        } catch (Exception e) {
            return "unknown reason";
        }
    }
}
