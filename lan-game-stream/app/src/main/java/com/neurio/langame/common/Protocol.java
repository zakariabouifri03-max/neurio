package com.neurio.langame.common;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.BufferUnderflowException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * The LAN Game Stream wire protocol.
 *
 * <p>Three transports share this file:</p>
 * <ul>
 *   <li><b>Control (TCP)</b> — length prefixed, optionally HMAC authenticated
 *       messages (pairing, session negotiation, statistics, quality commands).</li>
 *   <li><b>Video / Audio (UDP)</b> — small fixed headers followed by payload
 *       fragments, tuned so a packet never exceeds the Ethernet MTU.</li>
 *   <li><b>Input (UDP)</b> — compact 16-byte events, repeated
 *       {@link Configuration#INPUT_REDUNDANCY} times so a lost datagram does not
 *       swallow a button press.</li>
 * </ul>
 *
 * <p>All multi-byte fields are big endian (network order). The protocol carries
 * <i>only</i> video, audio, input and session metadata — never APKs, OBBs or any
 * other game data. That is a deliberate design constraint of the project.</p>
 */
public final class Protocol {

    private Protocol() {
    }

    /* ------------------------------------------------------------------ *
     *  Control channel
     * ------------------------------------------------------------------ */

    public static final int MSG_HELLO = 0x01;
    public static final int MSG_HELLO_ACK = 0x02;
    public static final int MSG_PAIR_REQUEST = 0x03;
    public static final int MSG_PAIR_RESULT = 0x04;
    public static final int MSG_SESSION_OFFER = 0x05;
    public static final int MSG_SESSION_ACCEPT = 0x06;
    public static final int MSG_SESSION_START = 0x07;
    public static final int MSG_CLIENT_REPORT = 0x08;
    public static final int MSG_HOST_STATS = 0x09;
    public static final int MSG_QUALITY_COMMAND = 0x0A;
    public static final int MSG_KEYFRAME_REQUEST = 0x0B;
    public static final int MSG_CSD = 0x0C;
    public static final int MSG_BYE = 0x0D;
    public static final int MSG_PING = 0x0E;
    public static final int MSG_PONG = 0x0F;

    /** flags bit 0: an HMAC-SHA256 trailer is present. */
    public static final int FLAG_AUTHENTICATED = 0x01;
    /** flags bit 1: the peer must answer with PONG. */
    public static final int FLAG_PING = 0x02;

    /** type(1) + flags(1) + timestamp(8) + counter(4). */
    public static final int CONTROL_HEADER_SIZE = 14;
    public static final int HMAC_SIZE = 32;
    /** Hard cap so a hostile/broken peer cannot make us allocate gigabytes. */
    public static final int MAX_CONTROL_FRAME = 1 << 20;

    /** One decoded (or to-be-encoded) control frame. */
    public static final class ControlFrame {
        public int type;
        public int flags;
        public long timestampMs;
        public int counter;
        public byte[] body = new byte[0];
        /** MAC trailer for authenticated frames (filled by {@link #readControlFrame}). */
        public byte[] tag;

        public ControlFrame() {
        }

        public ControlFrame(int type, long timestampMs, int counter, byte[] body) {
            this.type = type;
            this.timestampMs = timestampMs;
            this.counter = counter;
            this.body = body == null ? new byte[0] : body;
        }

        public boolean isAuthenticated() {
            return (flags & FLAG_AUTHENTICATED) != 0;
        }
    }

    /**
     * Serializes a frame and writes it to the stream.
     *
     * @param mac optional MAC (already keyed and reset) used when the frame must be
     *            authenticated; {@code null} for the handshake frames.
     */
    public static void writeControlFrame(OutputStream out, ControlFrame frame, javax.crypto.Mac mac)
            throws IOException {
        int bodyLen = frame.body.length;
        int total = CONTROL_HEADER_SIZE + bodyLen + (mac != null ? HMAC_SIZE : 0);
        ByteBuffer buf = ByteBuffer.allocate(4 + total).order(ByteOrder.BIG_ENDIAN);
        buf.putInt(total);
        buf.put((byte) frame.type);
        buf.put((byte) frame.flags);
        buf.putLong(frame.timestampMs);
        buf.putInt(frame.counter);
        buf.put(frame.body);
        byte[] raw = buf.array();

        if (mac != null) {
            mac.reset();
            mac.update(raw, 4, CONTROL_HEADER_SIZE + bodyLen);
            byte[] tag = mac.doFinal();
            System.arraycopy(tag, 0, raw, 4 + CONTROL_HEADER_SIZE + bodyLen, HMAC_SIZE);
        }
        // Single write(): the control channel is latency sensitive and we do not
        // want Nagle-style coalescing surprises (the socket is also TCP_NODELAY).
        out.write(raw);
        out.flush();
    }

    /**
     * Reads one frame. The MAC (when the frame is authenticated) is <i>not</i>
     * verified here: the caller owns the key and calls
     * {@link #verifyControlFrame}.
     */
    public static ControlFrame readControlFrame(InputStream in) throws IOException {
        byte[] len = readFully(in, 4);
        if (len == null) {
            return null;
        }
        int total = ByteBuffer.wrap(len).getInt();
        if (total < CONTROL_HEADER_SIZE || total > MAX_CONTROL_FRAME) {
            throw new IOException("Bad control frame length: " + total);
        }
        byte[] payload = readFully(in, total);
        if (payload == null) {
            throw new EOFException("Truncated control frame");
        }
        ByteBuffer buf = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN);
        ControlFrame frame = new ControlFrame();
        frame.type = buf.get() & 0xFF;
        frame.flags = buf.get() & 0xFF;
        frame.timestampMs = buf.getLong();
        frame.counter = buf.getInt();
        int bodyLen = total - CONTROL_HEADER_SIZE - (frame.isAuthenticated() ? HMAC_SIZE : 0);
        if (bodyLen < 0) {
            throw new IOException("Bad body length");
        }
        frame.body = new byte[bodyLen];
        buf.get(frame.body);
        if (frame.isAuthenticated()) {
            byte[] tag = new byte[HMAC_SIZE];
            buf.get(tag);
            // Re-frame so the verifier can recompute over header+body.
            frame.tag = tag;
        }
        return frame;
    }

    /**
     * Verifies the HMAC of an authenticated frame.
     */
    public static boolean verifyControlFrame(ControlFrame frame, javax.crypto.Mac mac) {
        if (!frame.isAuthenticated() || frame.tag == null) {
            return false;
        }
        ByteBuffer buf = ByteBuffer.allocate(CONTROL_HEADER_SIZE + frame.body.length)
                .order(ByteOrder.BIG_ENDIAN);
        buf.put((byte) frame.type);
        buf.put((byte) frame.flags);
        buf.putLong(frame.timestampMs);
        buf.putInt(frame.counter);
        buf.put(frame.body);
        mac.reset();
        byte[] expected = mac.doFinal(buf.array());
        return Security.constantTimeEquals(expected, frame.tag);
    }

    /* ------------------------------------------------------------------ *
     *  Body (de)serialization helpers
     * ------------------------------------------------------------------ */

    public static ByteBuffer newWriter(int capacity) {
        return ByteBuffer.allocate(capacity).order(ByteOrder.BIG_ENDIAN);
    }

    public static byte[] toBytes(ByteBuffer buf) {
        byte[] out = new byte[buf.position()];
        buf.rewind();
        buf.get(out);
        return out;
    }

    public static void putString(ByteBuffer buf, String value) {
        byte[] utf8 = (value == null ? "" : value).getBytes(StandardCharsets.UTF_8);
        int len = Math.min(utf8.length, 0xFFFF);
        buf.putShort((short) len);
        buf.put(utf8, 0, len);
    }

    public static String getString(ByteBuffer buf) {
        int len = buf.getShort() & 0xFFFF;
        byte[] utf8 = new byte[len];
        buf.get(utf8);
        return new String(utf8, StandardCharsets.UTF_8);
    }

    public static void putBytes(ByteBuffer buf, byte[] value) {
        byte[] v = value == null ? new byte[0] : value;
        buf.putShort((short) v.length);
        buf.put(v);
    }

    public static byte[] getBytes(ByteBuffer buf) {
        int len = buf.getShort() & 0xFFFF;
        byte[] v = new byte[len];
        buf.get(v);
        return v;
    }

    /* ------------------------------------------------------------------ *
     *  Video datagrams
     * ------------------------------------------------------------------ */

    /** "LGS1" video, "LGA1" audio, "LGI1" input, "LGD1" discovery. */
    public static final int MAGIC_VIDEO = 0x4C475331;
    public static final int MAGIC_AUDIO = 0x4C474131;
    public static final int MAGIC_INPUT = 0x4C474931;
    public static final int MAGIC_DISCOVERY = 0x4C474431;

    public static final int VIDEO_HEADER_SIZE = 32;
    public static final int AUDIO_HEADER_SIZE = 24;
    public static final int INPUT_HEADER_SIZE = 16;
    public static final int INPUT_EVENT_SIZE = 16;

    public static final int VFLAG_KEYFRAME = 0x01;
    public static final int VFLAG_HEVC = 0x02;
    public static final int VFLAG_LAST_FRAGMENT = 0x04;

    /** Mutable holder: the receive path fills this instead of allocating per packet. */
    public static final class VideoHeader {
        public int magic;
        public int sessionTag;
        public int frameId;
        public long frameTimestampUs;
        public int fragmentIndex;
        public int fragmentCount;
        public int frameSize;
        public int flags;
        public int headerSize = VIDEO_HEADER_SIZE;

        public boolean isKeyframe() {
            return (flags & VFLAG_KEYFRAME) != 0;
        }

        public boolean isLastFragment() {
            return (flags & VFLAG_LAST_FRAGMENT) != 0 || fragmentIndex == fragmentCount - 1;
        }

        public int payloadLength(ByteBuffer packet) {
            return packet.limit() - packet.position();
        }
    }

    public static void writeVideoHeader(ByteBuffer out,
                                        int sessionTag,
                                        int frameId,
                                        long frameTimestampUs,
                                        int fragmentIndex,
                                        int fragmentCount,
                                        int frameSize,
                                        int flags) {
        out.putInt(MAGIC_VIDEO);
        out.putShort((short) sessionTag);
        out.putShort((short) 0);              // reserved (future: FEC/track id)
        out.putInt(frameId);
        out.putLong(frameTimestampUs);
        out.putShort((short) fragmentIndex);
        out.putShort((short) fragmentCount);
        out.putInt(frameSize);
        out.put((byte) flags);
        out.put((byte) 0);                    // reserved (future: layer id)
        out.putShort((short) 0);              // reserved
    }

    /** Reads a video header into {@code into}; returns false when the packet is not ours. */
    public static boolean readVideoHeader(ByteBuffer packet, VideoHeader into) {
        packet.order(ByteOrder.BIG_ENDIAN);
        try {
            int start = packet.position();
            int magic = packet.getInt();
            if (magic != MAGIC_VIDEO) {
                return false;
            }
            into.magic = magic;
            into.sessionTag = packet.getShort() & 0xFFFF;
            packet.getShort();                                  // reserved
            into.frameId = packet.getInt();
            into.frameTimestampUs = packet.getLong();
            into.fragmentIndex = packet.getShort() & 0xFFFF;
            into.fragmentCount = packet.getShort() & 0xFFFF;
            into.frameSize = packet.getInt();
            into.flags = packet.get() & 0xFF;
            packet.get();                                        // reserved
            packet.getShort();                                   // reserved
            into.headerSize = packet.position() - start;
            return true;
        } catch (BufferUnderflowException e) {
            return false;
        }
    }

    /** Compact feedback back to the host: "I am missing these fragments of frame X". */
    public static final int MSG_NACK = 0x20;
    public static final int NACK_HEADER_SIZE = 4 + 2 + 2 + 4;
    /** How many lost fragments one NACK datagram can carry. */
    public static final int NACK_MAX_ENTRIES = 96;

    public static void writeNack(ByteBuffer out, int sessionTag, int frameId,
                                 int[] missingIndices, int count) {
        out.putInt(MAGIC_VIDEO);
        out.putShort((short) sessionTag);
        out.putShort((short) MSG_NACK);
        out.putInt(frameId);
        out.putShort((short) count);
        out.putShort((short) 0);
        for (int i = 0; i < count; i++) {
            out.putShort((short) missingIndices[i]);
        }
    }

    public static void writeKeyframeRequest(ByteBuffer out, int sessionTag) {
        out.putInt(MAGIC_VIDEO);
        out.putShort((short) sessionTag);
        out.putShort((short) MSG_KEYFRAME_REQUEST);
        out.putInt(0);
        out.putShort((short) 0);
        out.putShort((short) 0);
    }

    /* ------------------------------------------------------------------ *
     *  Audio datagrams
     * ------------------------------------------------------------------ */

    public static final int AFLAG_CODEC_CONFIG = 0x01;

    public static final class AudioHeader {
        public int sessionTag;
        public int sequence;
        public long timestampUs;
        public int payloadSize;
        public int flags;
        public int headerSize = AUDIO_HEADER_SIZE;

        public boolean isConfig() {
            return (flags & AFLAG_CODEC_CONFIG) != 0;
        }
    }

    public static void writeAudioHeader(ByteBuffer out, int sessionTag, int sequence,
                                        long timestampUs, int payloadSize, int flags) {
        out.putInt(MAGIC_AUDIO);
        out.putShort((short) sessionTag);
        out.putShort((short) (sequence & 0xFFFF));
        out.putLong(timestampUs);
        out.putInt(payloadSize);
        out.put((byte) flags);
        out.put((byte) 0);
        out.putShort((short) 0);
    }

    public static boolean readAudioHeader(ByteBuffer packet, AudioHeader into) {
        packet.order(ByteOrder.BIG_ENDIAN);
        try {
            int start = packet.position();
            if (packet.getInt() != MAGIC_AUDIO) {
                return false;
            }
            into.sessionTag = packet.getShort() & 0xFFFF;
            into.sequence = packet.getShort() & 0xFFFF;
            into.timestampUs = packet.getLong();
            into.payloadSize = packet.getInt();
            into.flags = packet.get() & 0xFF;
            packet.get();
            packet.getShort();
            into.headerSize = packet.position() - start;
            return true;
        } catch (BufferUnderflowException e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ *
     *  Input datagrams
     * ------------------------------------------------------------------ */

    /** Event kinds — keep in sync with ui/views/ControllerInput & GameInputAdapter. */
    public static final int INPUT_DOWN = 0;
    public static final int INPUT_MOVE = 1;
    public static final int INPUT_UP = 2;
    public static final int INPUT_KEY_DOWN = 3;
    public static final int INPUT_KEY_UP = 4;
    public static final int INPUT_AXIS = 5;
    public static final int INPUT_SWIPE_SEQUENCE = 6;   // reserved for gesture batching

    public static void writeInputHeader(ByteBuffer out, int sessionTag, int sequence,
                                        long clientSendMs, int eventCount) {
        out.putInt(MAGIC_INPUT);
        out.putShort((short) sessionTag);
        out.putShort((short) (sequence & 0xFFFF));
        out.putInt((int) (clientSendMs & 0xFFFFFFFFL));
        out.putShort((short) eventCount);
        out.putShort((short) 0);
    }

    public static final class InputHeader {
        public int sessionTag;
        public int sequence;
        public long clientSendMs;
        public int eventCount;
    }

    public static boolean readInputHeader(ByteBuffer packet, InputHeader into) {
        packet.order(ByteOrder.BIG_ENDIAN);
        try {
            if (packet.getInt() != MAGIC_INPUT) {
                return false;
            }
            into.sessionTag = packet.getShort() & 0xFFFF;
            into.sequence = packet.getShort() & 0xFFFF;
            into.clientSendMs = packet.getInt() & 0xFFFFFFFFL;
            into.eventCount = packet.getShort() & 0xFFFF;
            packet.getShort();
            return true;
        } catch (BufferUnderflowException e) {
            return false;
        }
    }

    /**
     * @param type     one of {@code INPUT_*}
     * @param pointerId logical pointer/joystick id
     * @param code     button id, key code or axis id (see ClientInputSource)
     * @param x        normalised 0..1 X where applicable, else 0
     * @param y        normalised 0..1 Y where applicable, else 0
     * @param timeOffsetMs milliseconds since the client session started
     */
    public static void writeInputEvent(ByteBuffer out, int type, int pointerId, int code,
                                       float x, float y, int timeOffsetMs) {
        out.put((byte) type);
        out.put((byte) pointerId);
        out.putShort((short) code);
        out.putFloat(x);
        out.putFloat(y);
        out.putInt(timeOffsetMs);
    }

    /* ------------------------------------------------------------------ *
     *  Discovery beacon
     * ------------------------------------------------------------------ */

    /**
     * UDP fallback discovery payload (NSD/mDNS is preferred, see DiscoveryService):
     * {@code MAGIC|version|controlPort|name|gameName|status}.
     */
    public static ByteBuffer writeDiscoveryBeacon(int controlPort, String hostName,
                                                  String gameName, int status,
                                                  String hostAddress) {
        ByteBuffer buf = newBuffer(1024);
        buf.putInt(MAGIC_DISCOVERY);
        buf.put((byte) Configuration.PROTOCOL_VERSION);
        buf.put((byte) status);
        buf.putShort((short) controlPort);
        putString(buf, hostName);
        putString(buf, gameName);
        putString(buf, hostAddress);
        return buf;
    }

    public static ByteBuffer newBuffer(int capacity) {
        return ByteBuffer.allocate(capacity).order(ByteOrder.BIG_ENDIAN);
    }

    /** Small helper shared by the discovery code paths. */
    public static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] buffer = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(buffer, read, length - read);
            if (n < 0) {
                if (read == 0) {
                    return null;
                }
                throw new EOFException("Truncated read: " + read + "/" + length);
            }
            read += n;
        }
        return buffer;
    }
}
