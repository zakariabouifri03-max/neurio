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
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The input path: client controller events → host.
 *
 * <p>Why UDP with repetition instead of a reliable stream: an input event is
 * worth nothing once it is a frame or two old, so waiting for a retransmission
 * is worse than losing it. Every packet is therefore sent
 * {@link Configuration#INPUT_REDUNDANCY} times in a row with the same sequence
 * number; the host keeps a small ring of recently seen sequence numbers and
 * applies each packet exactly once. On a clean LAN nothing is lost; on a noisy
 * one, three copies give a loss probability of p³ for a single event.</p>
 */
public final class InputTransport {

    private static final String TAG = "InputTx";

    private InputTransport() {
    }

    /* ================================================================== *
     *  Sender (client)
     * ================================================================== */

    public static final class Sender implements Closeable {
        private final DatagramSocket socket;
        private final InetAddress hostAddress;
        private final int hostPort = Configuration.PORT_INPUT;
        private final int sessionTag;
        private final AtomicBoolean closed = new AtomicBoolean();
        private final AtomicInteger sequence = new AtomicInteger();
        private final AtomicInteger packetsSent = new AtomicInteger();
        private final AtomicInteger eventsSent = new AtomicInteger();
        private final ByteBuffer scratch = Protocol.newBuffer(1024);

        public Sender(String hostAddress, int sessionTag) throws IOException {
            this.hostAddress = InetAddress.getByName(hostAddress);
            this.sessionTag = sessionTag;
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setSendBufferSize(256 * 1024);
            socket.bind(new InetSocketAddress(0));
        }

        /**
         * Sends one batch of events (already written into a buffer by
         * {@code InputSender}). The buffer must start with the input header.
         */
        public void sendBatch(byte[] payload, int length, int eventCount) {
            sendBatch(payload, length, eventCount, System.currentTimeMillis());
        }

        /**
         * @param clientSendMs the client's estimate of the <b>host's</b> uptime clock
         *                     for this batch (see {@code PairingService.HandshakeResult
         *                     #clockOffsetMs}). The host reconstructs it to measure a
         *                     real end-to-end input latency.
         */
        public void sendBatch(byte[] payload, int length, int eventCount, long clientSendMs) {
            if (length <= 0 || closed.get()) {
                return;
            }
            int seq = sequence.incrementAndGet() & 0xFFFF;
            ByteBuffer header = ByteBuffer.wrap(payload);
            Protocol.writeInputHeader(header, sessionTag, seq, clientSendMs, eventCount);
            for (int copy = 0; copy < Configuration.INPUT_REDUNDANCY; copy++) {
                try {
                    socket.send(new DatagramPacket(payload, length, hostAddress, hostPort));
                    packetsSent.incrementAndGet();
                } catch (IOException e) {
                    if (!closed.get()) {
                        Logger.w(TAG, "Input send failed: " + e.getMessage());
                    }
                    return;
                }
            }
            eventsSent.addAndGet(eventCount);
        }

        public int packetsSent() {
            return packetsSent.get();
        }

        public int eventsSent() {
            return eventsSent.get();
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                socket.close();
            }
        }
    }

    /* ================================================================== *
     *  Receiver (host)
     * ================================================================== */

    public static final class Receiver implements Closeable {

        public interface Listener {
            /**
             * One input event.
             *
             * @param type         {@code Protocol.INPUT_*}
             * @param pointerId    logical pointer
             * @param code         button / key / axis id
             * @param x            normalised 0..1 (or axis value)
             * @param y            normalised 0..1 (or axis value)
             * @param clientSendMs client uptime when the event was generated
             */
            void onEvent(int type, int pointerId, int code, float x, float y, long clientSendMs);
        }

        private final DatagramSocket socket;
        private final int sessionTag;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Listener listener;
        private Thread thread;

        /** Ring of recently applied sequence numbers for deduplication. */
        private final boolean[] seenSequences = new boolean[1024];
        private int highestSequence = -1;

        private final AtomicInteger packetsReceived = new AtomicInteger();
        private final AtomicInteger packetsDropped = new AtomicInteger();
        private final AtomicInteger eventsApplied = new AtomicInteger();
        private final AtomicInteger duplicates = new AtomicInteger();

        public Receiver(int sessionTag) throws IOException {
            this.sessionTag = sessionTag;
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setReceiveBufferSize(512 * 1024);
            socket.bind(new InetSocketAddress(Configuration.PORT_INPUT));
            socket.setSoTimeout(250);
        }

        public void setListener(Listener listener) {
            this.listener = listener;
        }

        public void start() {
            thread = Utils.startThread("lgs-input-rx", Thread.MAX_PRIORITY, this::loop);
        }

        private void loop() {
            byte[] buffer = new byte[1024];
            Protocol.InputHeader header = new Protocol.InputHeader();
            while (!closed.get()) {
                try {
                    DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
                    socket.receive(datagram);
                    packetsReceived.incrementAndGet();
                    ByteBuffer in = ByteBuffer.wrap(datagram.getData(), datagram.getOffset(),
                            datagram.getLength());
                    if (!Protocol.readInputHeader(in, header) || header.sessionTag != sessionTag) {
                        packetsDropped.incrementAndGet();
                        continue;
                    }
                    if (isDuplicate(header.sequence)) {
                        duplicates.incrementAndGet();
                        continue;
                    }
                    Listener l = listener;
                    for (int i = 0; i < header.eventCount && in.remaining() >= Protocol.INPUT_EVENT_SIZE; i++) {
                        int type = in.get() & 0xFF;
                        int pointerId = in.get() & 0xFF;
                        int code = in.getShort();
                        float x = in.getFloat();
                        float y = in.getFloat();
                        int timeOffset = in.getInt();
                        if (l != null) {
                            l.onEvent(type, pointerId, code, x, y, header.clientSendMs + timeOffset);
                        }
                        eventsApplied.incrementAndGet();
                    }
                } catch (SocketTimeoutException ignored) {
                    // keep looping
                } catch (SocketException e) {
                    return;
                } catch (IOException e) {
                    if (!closed.get()) {
                        Logger.w(TAG, "Input receive error: " + e.getMessage());
                    }
                }
            }
        }

        /** True when this packet was already applied (the redundancy copies). */
        private boolean isDuplicate(int sequence) {
            if (highestSequence < 0) {
                highestSequence = sequence;
                seenSequences[sequence % seenSequences.length] = true;
                return false;
            }
            int forward = (sequence - highestSequence) & 0xFFFF;
            if (forward == 0) {
                return true;
            }
            if (forward < 0x8000) {
                // Newer than anything seen: advance and clear the slots we skipped.
                for (int i = 1; i <= Math.min(forward, seenSequences.length); i++) {
                    seenSequences[((highestSequence + i) & 0xFFFF) % seenSequences.length] = false;
                }
                highestSequence = sequence;
                seenSequences[sequence % seenSequences.length] = true;
                return false;
            }
            // Older: only a duplicate if we still remember it.
            return seenSequences[sequence % seenSequences.length];
        }

        public int packetsReceived() {
            return packetsReceived.get();
        }

        public int eventsApplied() {
            return eventsApplied.get();
        }

        public int duplicatePackets() {
            return duplicates.get();
        }

        public int packetsDropped() {
            return packetsDropped.get();
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                socket.close();
            }
        }
    }

    /** Utility used by both sides when writing a batch. */
    public static byte[] newBatchBuffer(int maxEvents) {
        return new byte[Protocol.INPUT_HEADER_SIZE + maxEvents * Protocol.INPUT_EVENT_SIZE];
    }

    /** Package-private helper for diagnostics. */
    static String describe(byte[] payload) {
        return "payload=" + payload.length + " " + Arrays.toString(Arrays.copyOf(payload,
                Math.min(8, payload.length)));
    }
}
