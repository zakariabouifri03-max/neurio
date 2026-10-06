package com.neurio.langame.network;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Utils;

import java.io.Closeable;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The UDP audio path.
 *
 * <p>Audio is deliberately kept dumb: one encoded AAC frame per datagram (they
 * are only a few hundred bytes), a sequence number for de-duplication, and a
 * small jitter queue on the client so a 20 ms hiccup does not click. Audio is
 * allowed to be lossy — a dropped 20 ms frame is far less damaging than a stalled
 * video pipeline, so nothing is retransmitted.</p>
 *
 * <p>If the host cannot capture playback audio (the game opted out of
 * {@code allowAudioPlaybackCapture}, or the device predates API 29) the audio
 * transport is simply never started and the session continues video-only. That
 * is reported to the user instead of being faked — see
 * {@code HostStreamService}.</p>
 */
public final class AudioTransport {

    private static final String TAG = "AudioTx";

    /** ADTS framing so the client decoder can self-configure. */
    public static final int ADTS_HEADER_SIZE = 7;
    public static final int AUDIO_SAMPLE_RATE = 48_000;
    public static final int AUDIO_CHANNELS = 2;
    public static final int AUDIO_BITRATE = 128_000;

    private AudioTransport() {
    }

    /* ================================================================== *
     *  Sender (host)
     * ================================================================== */

    public static final class Sender implements Closeable {
        private final DatagramSocket socket;
        private final InetAddress clientAddress;
        private final int clientPort;
        private final int sessionTag;
        private final AtomicBoolean closed = new AtomicBoolean();
        private int sequence;
        private final AtomicInteger packetsSent = new AtomicInteger();

        public Sender(String clientAddress, int clientPort, int sessionTag) throws IOException {
            this.clientAddress = InetAddress.getByName(clientAddress);
            this.clientPort = clientPort;
            this.sessionTag = sessionTag;
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setSendBufferSize(512 * 1024);
            socket.bind(new InetSocketAddress(0));
        }

        /** Sends an encoder output buffer, already ADTS framed. */
        public void sendFrame(ByteBuffer data, long presentationTimeUs) {
            int size = data.remaining();
            if (size <= 0) {
                return;
            }
            byte[] payload = new byte[Protocol.AUDIO_HEADER_SIZE + size];
            ByteBuffer packet = ByteBuffer.wrap(payload);
            Protocol.writeAudioHeader(packet, sessionTag, sequence++, presentationTimeUs, size, 0);
            data.get(payload, Protocol.AUDIO_HEADER_SIZE, size);
            try {
                socket.send(new DatagramPacket(payload, payload.length, clientAddress, clientPort));
                packetsSent.incrementAndGet();
            } catch (IOException e) {
                if (!closed.get()) {
                    Logger.w(TAG, "Audio send failed: " + e.getMessage());
                }
            }
        }

        /** Sends the AudioSpecificConfig so the client can configure its decoder. */
        public void sendCodecConfig(byte[] audioSpecificConfig) {
            byte[] payload = new byte[Protocol.AUDIO_HEADER_SIZE + audioSpecificConfig.length];
            ByteBuffer packet = ByteBuffer.wrap(payload);
            Protocol.writeAudioHeader(packet, sessionTag, sequence++, 0L,
                    audioSpecificConfig.length, Protocol.AFLAG_CODEC_CONFIG);
            packet.put(audioSpecificConfig);
            try {
                socket.send(new DatagramPacket(payload, payload.length, clientAddress, clientPort));
                Logger.i(TAG, "Sent AAC config (" + audioSpecificConfig.length + " bytes)");
            } catch (IOException e) {
                Logger.w(TAG, "Audio config send failed: " + e.getMessage());
            }
        }

        public int packetsSent() {
            return packetsSent.get();
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                socket.close();
            }
        }
    }

    /* ================================================================== *
     *  Receiver (client)
     * ================================================================== */

    public static final class Packet {
        public byte[] data = new byte[2048];
        public int length;
        public long timestampUs;
        public int sequence;
        public boolean config;
    }

    public static final class Receiver implements Closeable {

        public interface Listener {
            /** Codec specific data received (AudioSpecificConfig). */
            void onCodecConfig(byte[] config);

            /** One AAC frame ready to be decoded/played. */
            void onFrame(byte[] data, int length, long timestampUs);

            /** Reported so the UI can show that audio is flowing. */
            void onStats(int received, int lost);
        }

        private final DatagramSocket socket;
        private volatile int sessionTag;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Listener listener;
        private int lastSequence = -1;
        private final AtomicInteger received = new AtomicInteger();
        private final AtomicInteger lost = new AtomicInteger();
        private Thread thread;
        private long lastStatsAtMs = System.currentTimeMillis();
        private final ArrayBlockingQueue<Packet> pool = new ArrayBlockingQueue<>(16);

        public Receiver(int sessionTag) throws IOException {
            this.sessionTag = sessionTag;
            // The tag may be updated with setSessionTag() before start().
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setReceiveBufferSize(Configuration.SOCKET_RECEIVE_BUFFER);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(200);
        }

        public int localPort() {
            return socket.getLocalPort();
        }

        public void setListener(Listener listener) {
            this.listener = listener;
        }

        /** The session tag is only known after the handshake. */
        public void setSessionTag(int sessionTag) {
            this.sessionTag = sessionTag;
        }

        public void start() {
            thread = Utils.startThread("lgs-audio-rx", Thread.NORM_PRIORITY + 1, this::loop);
        }

        private void loop() {
            byte[] buffer = new byte[2048];
            Protocol.AudioHeader header = new Protocol.AudioHeader();
            while (!closed.get()) {
                try {
                    DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
                    socket.receive(datagram);
                    ByteBuffer in = ByteBuffer.wrap(datagram.getData(), datagram.getOffset(),
                            datagram.getLength());
                    if (!Protocol.readAudioHeader(in, header) || header.sessionTag != sessionTag) {
                        continue;
                    }
                    int payloadLength = Math.min(header.payloadSize, in.remaining());
                    if (payloadLength <= 0) {
                        continue;
                    }
                    trackLoss(header.sequence);
                    received.incrementAndGet();

                    Listener l = listener;
                    if (header.isConfig()) {
                        byte[] config = new byte[payloadLength];
                        in.get(config);
                        if (l != null) {
                            l.onCodecConfig(config);
                        }
                    } else if (l != null) {
                        byte[] frame = new byte[payloadLength];
                        in.get(frame);
                        l.onFrame(frame, payloadLength, header.timestampUs);
                    }

                    long now = System.currentTimeMillis();
                    if (now - lastStatsAtMs > 1000) {
                        lastStatsAtMs = now;
                        if (l != null) {
                            l.onStats(received.get(), lost.get());
                        }
                    }
                } catch (SocketTimeoutException ignored) {
                    // Fine: keep looping.
                } catch (SocketException e) {
                    return;
                } catch (IOException e) {
                    if (!closed.get()) {
                        Logger.w(TAG, "Audio receive error: " + e.getMessage());
                    }
                }
            }
        }

        private void trackLoss(int sequence) {
            if (lastSequence < 0) {
                lastSequence = sequence;
                return;
            }
            int expected = (lastSequence + 1) & 0xFFFF;
            if (sequence != expected) {
                int gap = (sequence - expected) & 0xFFFF;
                if (gap > 0 && gap < 400) {
                    lost.addAndGet(gap);
                }
            }
            lastSequence = sequence;
        }

        public int packetsReceived() {
            return received.get();
        }

        public int packetsLost() {
            return lost.get();
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                socket.close();
            }
        }
    }

    /* ------------------------------------------------------------------ *
     *  ADTS framing helpers (encoder output → self describing frames)
     * ------------------------------------------------------------------ */

    /**
     * Wraps a raw AAC access unit in an ADTS header.
     *
     * @param frame       raw AAC payload
     * @param sampleRate  e.g. 48000
     * @param channels    1 or 2
     * @param aacProfile  1 = AAC-LC (what Android encoders emit)
     */
    public static byte[] addAdtsHeader(byte[] frame, int sampleRate, int channels, int aacProfile) {
        int profile = aacProfile - 1;                    // ADTS wants profile minus one
        int frequencyIndex = frequencyIndex(sampleRate);
        int frameLength = frame.length + ADTS_HEADER_SIZE;
        byte[] out = new byte[frameLength];
        out[0] = (byte) 0xFF;
        out[1] = (byte) 0xF1;                            // MPEG-4, layer 0, no CRC
        out[2] = (byte) (((profile & 0x03) << 6) | ((frequencyIndex & 0x0F) << 2)
                | ((channels >> 2) & 0x01));
        out[3] = (byte) (((channels & 0x03) << 6) | ((frameLength >> 11) & 0x03));
        out[4] = (byte) ((frameLength >> 3) & 0xFF);
        out[5] = (byte) (((frameLength & 0x07) << 5) | 0x1F);
        out[6] = (byte) 0xFC;
        System.arraycopy(frame, 0, out, ADTS_HEADER_SIZE, frame.length);
        return out;
    }

    /** Builds the 2-byte AudioSpecificConfig carried to the client. */
    public static byte[] audioSpecificConfig(int sampleRate, int channels, int aacProfile) {
        int profile = aacProfile - 1;
        int frequencyIndex = frequencyIndex(sampleRate);
        int value = (profile << 11) | (frequencyIndex << 7) | (channels << 3);
        return new byte[]{(byte) ((value >> 8) & 0xFF), (byte) (value & 0xFF)};
    }

    private static int frequencyIndex(int sampleRate) {
        switch (sampleRate) {
            case 96000:
                return 0;
            case 88200:
                return 1;
            case 64000:
                return 2;
            case 48000:
                return 3;
            case 44100:
                return 4;
            case 32000:
                return 5;
            case 24000:
                return 6;
            case 22050:
                return 7;
            case 16000:
                return 8;
            case 12000:
                return 9;
            case 11025:
                return 10;
            case 8000:
                return 11;
            case 7350:
                return 12;
            default:
                return 4;
        }
    }
}
