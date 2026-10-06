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
import java.util.concurrent.atomic.AtomicLong;

/**
 * The UDP video path: fragmentation, reassembly, NACK-based repair and
 * keyframe requests.
 *
 * <p>Design choices, and why:</p>
 * <ul>
 *   <li><b>UDP, never TCP.</b> A lost packet must never stall the interactive
 *       path; a partially received frame is dropped instead of being waited for
 *       forever.</li>
 *   <li><b>Per-frame fragmentation with a frame id.</b> The receiver knows
 *       exactly which fragments of which frame are missing.</li>
 *   <li><b>Selective NACK.</b> The client asks only for the missing fragments of
 *       the frame it is about to display; the sender answers from a small retransmit
 *       ring. On a LAN this repairs a lost packet in well under one frame time.</li>
 *   <li><b>Keyframe request.</b> If a frame cannot be repaired in time the client
 *       asks the host for a fresh I-frame, which bounds the visible corruption to
 *       one GOP at the very worst.</li>
 * </ul>
 */
public final class VideoTransport {

    private static final String TAG = "VideoTx";

    /** Datagram payload size that keeps the whole packet inside a 1500 byte MTU. */
    public static final int CHUNK = Configuration.VIDEO_CHUNK_PAYLOAD;

    private VideoTransport() {
    }

    /* ================================================================== *
     *  Sender (host)
     * ================================================================== */

    public static final class Sender implements Closeable {

        public interface FeedbackListener {
            /** Client reports lost fragments (loss signal for adaptive streaming). */
            void onNack(int frameId, int missingCount);

            /** Client wants a fresh I-frame now (decoder could not recover). */
            void onKeyframeRequest();
        }

        private final DatagramSocket socket;
        private final InetAddress clientAddress;
        private final int clientPort;
        private final int sessionTag;
        private volatile FeedbackListener feedbackListener;

        private final AtomicBoolean closed = new AtomicBoolean();
        private final AtomicInteger frameId = new AtomicInteger();
        private final AtomicInteger packetsSent = new AtomicInteger();
        private final AtomicInteger packetsRetransmitted = new AtomicInteger();
        private final AtomicLong bytesSent = new AtomicLong();
        private final AtomicInteger nackCount = new AtomicInteger();

        /** Retransmit ring: the last few encoded frames, kept whole. */
        private final Object cacheLock = new Object();
        private final CachedFrame[] cache = new CachedFrame[32];
        private int cacheWrites;
        private Thread receiveThread;

        private static final class CachedFrame {
            int frameId = -1;
            byte[][] fragments;
            int fragmentCount;
        }

        public Sender(String clientAddress, int clientPort, int sessionTag) throws IOException {
            this.clientAddress = InetAddress.getByName(clientAddress);
            this.clientPort = clientPort;
            this.sessionTag = sessionTag;

            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(false);
            socket.setSendBufferSize(Configuration.SOCKET_SEND_BUFFER);
            socket.setReceiveBufferSize(Configuration.SOCKET_RECEIVE_BUFFER);
            socket.bind(new InetSocketAddress(Configuration.PORT_VIDEO));
            for (int i = 0; i < cache.length; i++) {
                cache[i] = new CachedFrame();
            }
        }

        public void setFeedbackListener(FeedbackListener listener) {
            this.feedbackListener = listener;
        }

        /** Starts the thread that listens for NACK / keyframe-request datagrams. */
        public void start() {
            receiveThread = Utils.startThread("lgs-video-feedback", Thread.NORM_PRIORITY + 2, () -> {
                byte[] buffer = new byte[2048];
                while (!closed.get()) {
                    try {
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        socket.receive(packet);
                        handleFeedback(packet);
                    } catch (SocketException e) {
                        return;   // socket closed
                    } catch (IOException e) {
                        if (!closed.get()) {
                            Logger.w(TAG, "Feedback loop error: " + e.getMessage());
                        }
                    }
                }
            });
        }

        private void handleFeedback(DatagramPacket packet) {
            ByteBuffer in = ByteBuffer.wrap(packet.getData(), packet.getOffset(), packet.getLength());
            if (packet.getLength() < 12) {
                return;
            }
            if (in.getInt() != Protocol.MAGIC_VIDEO) {
                return;
            }
            int tag = in.getShort() & 0xFFFF;
            int message = in.getShort() & 0xFFFF;
            int frame = in.getInt();
            if (tag != sessionTag) {
                return;
            }
            if (message == Protocol.MSG_KEYFRAME_REQUEST) {
                FeedbackListener l = feedbackListener;
                if (l != null) {
                    l.onKeyframeRequest();
                }
                return;
            }
            if (message != Protocol.MSG_NACK) {
                return;
            }
            int count = in.getShort() & 0xFFFF;
            in.getShort();
            int[] missing = new int[Math.min(count, Protocol.NACK_MAX_ENTRIES)];
            for (int i = 0; i < missing.length; i++) {
                missing[i] = in.getShort() & 0xFFFF;
            }
            nackCount.incrementAndGet();
            FeedbackListener l = feedbackListener;
            if (l != null) {
                l.onNack(frame, missing.length);
            }
            retransmit(frame, missing);
        }

        /**
         * Fragments one encoded frame and transmits it.
         *
         * @param data     the encoder output, positioned/limited to this frame
         * @param keyframe whether the frame is an IDR (starts a new GOP)
         */
        public void sendFrame(ByteBuffer data, boolean keyframe, long presentationTimeUs) {
            int size = data.remaining();
            if (size <= 0) {
                return;
            }
            int id = frameId.incrementAndGet();
            int fragmentCount = (size + CHUNK - 1) / CHUNK;

            byte[][] fragments = new byte[fragmentCount][];
            for (int index = 0; index < fragmentCount; index++) {
                int offset = index * CHUNK;
                int length = Math.min(CHUNK, size - offset);
                byte[] fragment = new byte[Protocol.VIDEO_HEADER_SIZE + length];

                int flags = 0;
                if (keyframe) {
                    flags |= Protocol.VFLAG_KEYFRAME;
                }
                if (index == fragmentCount - 1) {
                    flags |= Protocol.VFLAG_LAST_FRAGMENT;
                }
                ByteBuffer header = ByteBuffer.wrap(fragment);
                Protocol.writeVideoHeader(header, sessionTag, id, presentationTimeUs, index,
                        fragmentCount, size, flags);
                data.position(offset);
                data.get(fragment, Protocol.VIDEO_HEADER_SIZE, length);
                fragments[index] = fragment;
            }

            putInCache(id, fragments);

            for (int index = 0; index < fragmentCount; index++) {
                transmit(fragments[index], false);
            }
        }

        private void retransmit(int frame, int[] missingIndices) {
            CachedFrame cached;
            synchronized (cacheLock) {
                cached = null;
                for (CachedFrame candidate : cache) {
                    if (candidate.frameId == frame) {
                        cached = candidate;
                        break;
                    }
                }
            }
            if (cached == null || cached.fragments == null) {
                return;   // too old to repair: the client will ask for a keyframe
            }
            for (int index : missingIndices) {
                if (index >= 0 && index < cached.fragments.length) {
                    byte[] fragment = cached.fragments[index];
                    if (fragment != null) {
                        transmit(fragment, true);
                    }
                }
            }
        }

        private void putInCache(int id, byte[][] fragments) {
            synchronized (cacheLock) {
                CachedFrame slot = cache[cacheWrites % cache.length];
                cacheWrites++;
                slot.frameId = id;
                slot.fragments = fragments;
                slot.fragmentCount = fragments.length;
            }
        }

        private void transmit(byte[] payload, boolean isRetransmit) {
            try {
                socket.send(new DatagramPacket(payload, payload.length, clientAddress, clientPort));
                packetsSent.incrementAndGet();
                bytesSent.addAndGet(payload.length);
                if (isRetransmit) {
                    packetsRetransmitted.incrementAndGet();
                }
            } catch (IOException e) {
                if (!closed.get()) {
                    Logger.w(TAG, "Video send failed: " + e.getMessage());
                }
            }
        }

        public int packetsSent() {
            return packetsSent.get();
        }

        public int retransmissionCount() {
            return packetsRetransmitted.get();
        }

        public int nackCount() {
            return nackCount.get();
        }

        public long bytesSent() {
            return bytesSent.get();
        }

        public int lastFrameId() {
            return frameId.get();
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

    public static final class Receiver implements Closeable {

        /** A complete, reassembled frame (buffer is pooled — return it!). */
        public static final class Frame {
            public byte[] data;
            public int length;
            public int frameId;
            public boolean keyframe;
            public long receivedAtMs;
            /** Host presentation time (microseconds, host monotonic clock). */
            public long presentationTimeUs;
            /** Client reception time on the uptime clock, used for latency stats. */
            public long receivedAtUptimeMs;
        }

        public interface Listener {
            /** Called on the receiver thread with a complete frame. */
            void onFrame(Frame frame);

            /** Reported when a frame had to be abandoned (loss feedback). */
            void onFrameDropped(int frameId);
        }

        private final DatagramSocket socket;
        private volatile int sessionTag;
        private final InetAddress hostAddress;
        private final int hostPort = Configuration.PORT_VIDEO;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Listener listener;

        // Reassembly state for the frame currently being received.
        private int currentFrameId = -1;
        private byte[][] fragments;
        private int fragmentCount;
        private int fragmentsReceived;
        private int frameSize;
        private boolean frameKeyframe;
        private long firstFragmentAtMs;
        private long lastPacketAtMs;
        private long currentFramePresentationUs;
        private int repairPasses;
        private final int[] missingScratch = new int[Protocol.NACK_MAX_ENTRIES];

        // Statistics.
        private final AtomicInteger framesCompleted = new AtomicInteger();
        private final AtomicInteger framesDropped = new AtomicInteger();
        private final AtomicInteger packetsReceived = new AtomicInteger();
        private final AtomicInteger nacksSent = new AtomicInteger();
        private final AtomicInteger keyframeRequests = new AtomicInteger();
        private Thread receiveThread;
        private final java.util.concurrent.ArrayBlockingQueue<Frame> pool =
                new java.util.concurrent.ArrayBlockingQueue<>(8);

        public Receiver(String hostAddress) throws IOException {
            this(hostAddress, 0);
        }

        public Receiver(String hostAddress, int sessionTag) throws IOException {
            this.hostAddress = InetAddress.getByName(hostAddress);
            this.sessionTag = sessionTag;
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setReceiveBufferSize(Configuration.SOCKET_RECEIVE_BUFFER);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(200);
        }

        public void setListener(Listener listener) {
            this.listener = listener;
        }

        /** The session tag is only known after the handshake. */
        public void setSessionTag(int sessionTag) {
            this.sessionTag = sessionTag;
        }

        /** Port the host must send video to (announced over the control channel). */
        public int localPort() {
            return socket.getLocalPort();
        }

        public void start() {
            receiveThread = Utils.startThread("lgs-video-rx", Thread.MAX_PRIORITY, this::loop);
        }

        private void loop() {
            byte[] packetBuffer = new byte[2048];
            Protocol.VideoHeader header = new Protocol.VideoHeader();
            while (!closed.get()) {
                try {
                    DatagramPacket packet = new DatagramPacket(packetBuffer, packetBuffer.length);
                    socket.receive(packet);
                    packetsReceived.incrementAndGet();
                    lastPacketAtMs = System.currentTimeMillis();
                    ByteBuffer in = ByteBuffer.wrap(packet.getData(), packet.getOffset(),
                            packet.getLength());
                    if (!Protocol.readVideoHeader(in, header)) {
                        continue;
                    }
                    if (header.sessionTag != sessionTag) {
                        continue;   // stale session / foreign sender
                    }
                    if (header.frameId < currentFrameId) {
                        continue;   // already displayed (or a late repair we no longer need)
                    }
                    if ((header.flags & Protocol.VFLAG_HEVC) != 0) {
                        // Reserved: the host currently signals HEVC through the profile.
                    }
                    onFragment(header, in);
                } catch (SocketTimeoutException ignored) {
                    // Periodic tick: use it to repair an incomplete frame.
                    maybeRepair();
                } catch (SocketException e) {
                    return;
                } catch (IOException e) {
                    if (!closed.get()) {
                        Logger.w(TAG, "Video receive error: " + e.getMessage());
                    }
                }
            }
        }

        private void onFragment(Protocol.VideoHeader header, ByteBuffer payload) {
            long now = System.currentTimeMillis();
            if (header.frameId != currentFrameId) {
                // Starting a new frame: abandon whatever was incomplete.
                if (currentFrameId >= 0 && fragmentsReceived < fragmentCount) {
                    framesDropped.incrementAndGet();
                    Listener l = listener;
                    if (l != null) {
                        l.onFrameDropped(currentFrameId);
                    }
                    requestKeyframe();
                }
                currentFrameId = header.frameId;
                currentFramePresentationUs = header.frameTimestampUs;
                fragmentCount = Math.max(1, header.fragmentCount);
                frameSize = Math.max(1, header.frameSize);
                frameKeyframe = header.isKeyframe();
                fragments = new byte[fragmentCount][];
                fragmentsReceived = 0;
                firstFragmentAtMs = now;
                repairPasses = 0;
            }

            int index = header.fragmentIndex;
            if (index < 0 || index >= fragmentCount) {
                return;
            }
            int available = payload.remaining();
            byte[] fragment = fragments[index];
            if (fragment == null) {
                fragment = new byte[available];
                fragments[index] = fragment;
                fragmentsReceived++;
            } else {
                return;   // duplicate (common: retransmission)
            }
            payload.get(fragment, 0, Math.min(available, fragment.length));

            if (fragmentsReceived == fragmentCount) {
                complete(now);
            } else if (index == fragmentCount - 1) {
                maybeRepair();
            }
        }

        /** Sends a NACK for the missing fragments of the current frame. */
        private void maybeRepair() {
            if (closed.get() || currentFrameId < 0 || fragments == null) {
                return;
            }
            if (fragmentsReceived >= fragmentCount) {
                return;
            }
            long idle = System.currentTimeMillis() - lastPacketAtMs;
            if (idle < Configuration.NACK_DELAY_MS) {
                return;
            }
            if (repairPasses >= Configuration.MAX_RETRANSMIT_PASSES) {
                // Give up on this frame: drop it and ask for a fresh keyframe so the
                // decoder can resynchronise instead of showing artifacts forever.
                framesDropped.incrementAndGet();
                Listener l = listener;
                if (l != null) {
                    l.onFrameDropped(currentFrameId);
                }
                requestKeyframe();
                currentFrameId = -1;
                fragments = null;
                fragmentsReceived = 0;
                return;
            }
            repairPasses++;

            int missingCount = 0;
            for (int i = 0; i < fragmentCount && missingCount < missingScratch.length; i++) {
                if (fragments[i] == null) {
                    missingScratch[missingCount++] = i;
                }
            }
            if (missingCount == 0) {
                return;
            }
            ByteBuffer out = Protocol.newBuffer(Protocol.NACK_HEADER_SIZE
                    + missingCount * 2 + 8);
            Protocol.writeNack(out, sessionTag, currentFrameId, missingScratch, missingCount);
            sendFeedback(Protocol.toBytes(out));
            nacksSent.incrementAndGet();
        }

        /** Asks the host for a fresh I-frame (used after giving up on a frame). */
        public void requestKeyframe() {
            ByteBuffer out = Protocol.newBuffer(Protocol.NACK_HEADER_SIZE + 8);
            Protocol.writeKeyframeRequest(out, sessionTag);
            sendFeedback(Protocol.toBytes(out));
            keyframeRequests.incrementAndGet();
        }

        private void sendFeedback(byte[] payload) {
            try {
                socket.send(new DatagramPacket(payload, payload.length, hostAddress, hostPort));
            } catch (IOException e) {
                if (!closed.get()) {
                    Logger.w(TAG, "Feedback send failed: " + e.getMessage());
                }
            }
        }

        private void complete(long now) {
            int total = 0;
            for (byte[] fragment : fragments) {
                total += fragment == null ? 0 : fragment.length;
            }
            Frame frame = pool.poll();
            if (frame == null || frame.data == null || frame.data.length < total) {
                frame = new Frame();
                frame.data = new byte[Math.max(total, 64 * 1024)];
            }
            int offset = 0;
            for (byte[] fragment : fragments) {
                if (fragment != null) {
                    System.arraycopy(fragment, 0, frame.data, offset, fragment.length);
                    offset += fragment.length;
                }
            }
            frame.length = offset;
            frame.frameId = currentFrameId;
            frame.keyframe = frameKeyframe;
            frame.receivedAtMs = now;
            frame.presentationTimeUs = currentFramePresentationUs;
            frame.receivedAtUptimeMs = android.os.SystemClock.uptimeMillis();
            framesCompleted.incrementAndGet();

            Listener l = listener;
            if (l != null) {
                l.onFrame(frame);
            } else {
                recycle(frame);
            }

            currentFrameId = -1;
            fragments = null;
            fragmentsReceived = 0;
        }

        /** Returns a frame buffer to the pool once the decoder has consumed it. */
        public void recycle(Frame frame) {
            if (frame != null && frame.data != null) {
                frame.length = 0;
                if (!pool.offer(frame)) {
                    // Pool is full: let GC take it.
                }
            }
        }

        public int framesCompleted() {
            return framesCompleted.get();
        }

        public int framesDropped() {
            return framesDropped.get();
        }

        public int packetsReceived() {
            return packetsReceived.get();
        }

        public int nacksSent() {
            return nacksSent.get();
        }

        public int keyframeRequestsSent() {
            return keyframeRequests.get();
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                socket.close();
            }
        }
    }
}
