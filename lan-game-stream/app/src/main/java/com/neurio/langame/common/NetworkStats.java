package com.neurio.langame.common;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Rolling measurements of everything the adaptive controller and the
 * Performance screen care about.
 *
 * <p>The same class is used on both sides of the link: the host fills in the
 * encoder-side numbers, the client fills in the network + decoder numbers, and
 * the client periodically ships a compact report back over the control channel
 * so the host can adapt.</p>
 *
 * <p>Nothing here blocks or allocates in the packet path: counters are atomics
 * and the heavier maths (EWMA, windows) runs on the ~4 Hz statistics tick.</p>
 */
public final class NetworkStats {

    /** Immutable view for the UI. */
    public static final class Snapshot {
        public float rttMs;
        public float jitterMs;
        public float oneWayLatencyMs;
        public float lossPercent;
        public float bitrateMbps;
        public float fps;
        public int decodeQueueDepth;
        public int packetsReceived;
        public int packetsLost;
        public int framesDecoded;
        public int framesDropped;
        public int framesLost;
        public int encoderLatencyMs;
        public int droppedFromEncoder;
        public Configuration.QualityTier tier = Configuration.QualityTier.EXCELLENT;

        /** Compact single line used by the stream HUD. */
        public String hudLine() {
            return String.format(Locale.US, "%d ms · %.1f Mbps · %.0f FPS · %.1f%% loss",
                    Math.round(rttMs), bitrateMbps, fps, lossPercent);
        }
    }

    private final boolean clientSide;

    private final AtomicInteger packetsReceived = new AtomicInteger();
    private final AtomicInteger packetsLost = new AtomicInteger();
    private final AtomicInteger framesDecoded = new AtomicInteger();
    private final AtomicInteger framesDropped = new AtomicInteger();
    private final AtomicInteger framesLost = new AtomicInteger();
    private final AtomicInteger encoderLatencyMs = new AtomicInteger();
    private final AtomicInteger droppedFromEncoder = new AtomicInteger();
    private final AtomicLong receivedBytes = new AtomicLong();
    private final AtomicInteger receiveBitsPerSecond = new AtomicInteger();

    private volatile float rttMs = -1f;
    private volatile float oneWayLatencyMs = -1f;
    private volatile float jitterMs;
    private volatile float lossPercent;
    private volatile int decodeQueueDepth;
    private volatile float frameRate;
    private volatile Configuration.QualityTier tier = Configuration.QualityTier.EXCELLENT;

    // Internal windows.
    private long windowStartMs = System.currentTimeMillis();
    private int windowBytes;
    private int windowPacketsReceived;
    private int windowPacketsLost;
    private int windowFrames;
    private int lastRttSample;
    private float jitterEstimate;
    private long lastFrameId = -1;

    public NetworkStats(boolean clientSide) {
        this.clientSide = clientSide;
    }

    public boolean isClientSide() {
        return clientSide;
    }

    /* ----------------------------- counters ----------------------------- */

    public void onPacketsReceived(int count, int bytes) {
        packetsReceived.addAndGet(count);
        receivedBytes.addAndGet(bytes);
        windowPacketsReceived += count;
        windowBytes += bytes;
    }

    public void onPacketsLost(int count) {
        if (count > 0) {
            packetsLost.addAndGet(count);
            windowPacketsLost += count;
        }
    }

    public void onFrameDecoded() {
        framesDecoded.incrementAndGet();
        windowFrames++;
    }

    public void onFrameDropped() {
        framesDropped.incrementAndGet();
    }

    public void onFrameLost() {
        framesLost.incrementAndGet();
    }

    public void onEncoderLatency(int millis) {
        encoderLatencyMs.set(millis);
    }

    public void onEncoderDrop() {
        droppedFromEncoder.incrementAndGet();
    }

    public void setDecodeQueueDepth(int depth) {
        decodeQueueDepth = depth;
    }

    public void onFrameId(long frameId) {
        long previous = lastFrameId;
        lastFrameId = frameId;
        if (previous > 0 && frameId > previous + 1) {
            int gap = (int) Math.min(frameId - previous - 1, Configuration.MAX_FRAME_ID_GAP);
            framesLost.addAndGet(gap);
            onPacketsLost(gap);
        }
    }

    /** RTT sample in milliseconds (from the control channel PING/PONG). */
    public void onRttSample(float sampleMs) {
        if (rttMs < 0) {
            rttMs = sampleMs;
        } else {
            rttMs = rttMs * 0.8f + sampleMs * 0.2f;   // EWMA
        }
        lastRttSample = Math.round(sampleMs);
    }

    /** Inter-arrival jitter estimate (RFC 3550 style, in milliseconds). */
    public void onArrivalDelta(float deltaMs) {
        float d = Math.abs(deltaMs);
        jitterEstimate += (d - jitterEstimate) / 16f;
        jitterMs = jitterEstimate;
    }

    public void setOneWayLatencyMs(float value) {
        oneWayLatencyMs = oneWayLatencyMs < 0 ? value : oneWayLatencyMs * 0.85f + value * 0.15f;
    }

    public float rttMs() {
        return rttMs;
    }

    public int lastRttSample() {
        return lastRttSample;
    }

    public float lossPercent() {
        return lossPercent;
    }

    public int receiveBitrateBps() {
        return receiveBitsPerSecond.get();
    }

    public float fps() {
        return frameRate;
    }

    public Configuration.QualityTier tier() {
        return tier;
    }

    public int decodeQueueDepth() {
        return decodeQueueDepth;
    }

    /**
     * Called ~4×/second: folds the current window into the displayed numbers and
     * recomputes the quality tier that drives adaptive streaming.
     */
    public Snapshot tick() {
        long now = System.currentTimeMillis();
        long elapsed = Math.max(1, now - windowStartMs);
        int total = windowPacketsReceived + windowPacketsLost;
        if (total > 0) {
            lossPercent = windowPacketsLost * 100f / total;
        } else {
            lossPercent = 0f;
        }
        receiveBitsPerSecond.set((int) (windowBytes * 8000L / elapsed));
        frameRate = frameRate * 0.5f + (windowFrames * 1000f / elapsed) * 0.5f;
        tier = classify();

        windowStartMs = now;
        windowBytes = 0;
        windowPacketsReceived = 0;
        windowPacketsLost = 0;
        windowFrames = 0;
        return snapshot();
    }

    public Configuration.QualityTier classify() {
        float rtt = rttMs < 0 ? 0 : rttMs;
        if (lossPercent > 6f || rtt > 120f || jitterMs > 40f) {
            return Configuration.QualityTier.VERY_WEAK;
        }
        if (lossPercent > 2f || rtt > 60f || jitterMs > 20f) {
            return Configuration.QualityTier.WEAK;
        }
        if (lossPercent > 0.4f || rtt > 30f || jitterMs > 8f) {
            return Configuration.QualityTier.GOOD;
        }
        return Configuration.QualityTier.EXCELLENT;
    }

    public Snapshot snapshot() {
        Snapshot s = new Snapshot();
        s.rttMs = rttMs < 0 ? 0 : rttMs;
        s.jitterMs = jitterMs;
        s.oneWayLatencyMs = oneWayLatencyMs < 0 ? s.rttMs / 2f : oneWayLatencyMs;
        s.lossPercent = lossPercent;
        s.bitrateMbps = receiveBitsPerSecond.get() / 1_000_000f;
        s.fps = frameRate;
        s.decodeQueueDepth = decodeQueueDepth;
        s.packetsReceived = packetsReceived.get();
        s.packetsLost = packetsLost.get();
        s.framesDecoded = framesDecoded.get();
        s.framesDropped = framesDropped.get();
        s.framesLost = framesLost.get();
        s.encoderLatencyMs = encoderLatencyMs.get();
        s.droppedFromEncoder = droppedFromEncoder.get();
        s.tier = tier;
        return s;
    }

    /**
     * Encodes the client's view of the link into the CLIENT_REPORT body —
     * this is what closes the loop for adaptive streaming on the host.
     */
    public void writeReportBody(java.nio.ByteBuffer out, int requestedWidth, int requestedHeight,
                                int requestedFps, long framesReceived) {
        Snapshot s = snapshot();
        out.putInt((int) Math.min(framesReceived, Integer.MAX_VALUE));
        out.putInt(s.framesDecoded);
        out.putInt(s.framesDropped);
        out.putInt(s.framesLost);
        out.putInt(s.packetsReceived);
        out.putInt(s.packetsLost);
        out.putFloat(s.jitterMs);
        out.putFloat(s.rttMs);
        out.putInt(s.decodeQueueDepth);
        out.putInt(receiveBitsPerSecond.get());
        out.putShort((short) requestedWidth);
        out.putShort((short) requestedHeight);
        out.putShort((short) requestedFps);
        out.put((byte) s.tier.ordinal());
        out.put((byte) 0);
    }

    /** Reads a report produced by {@link #writeReportBody} into a snapshot. */
    public static Snapshot readReportBody(java.nio.ByteBuffer in) {
        Snapshot s = new Snapshot();
        in.getInt();                                  // frames received (informational)
        s.framesDecoded = in.getInt();
        s.framesDropped = in.getInt();
        s.framesLost = in.getInt();
        s.packetsReceived = in.getInt();
        s.packetsLost = in.getInt();
        s.jitterMs = in.getFloat();
        s.rttMs = in.getFloat();
        s.decodeQueueDepth = in.getInt();
        s.bitrateMbps = in.getInt() / 1_000_000f;
        in.getShort();                                // requested width
        in.getShort();                                // requested height
        in.getShort();                                // requested fps
        int tierIndex = in.get() & 0xFF;
        in.get();
        Configuration.QualityTier[] tiers = Configuration.QualityTier.values();
        s.tier = tierIndex >= 0 && tierIndex < tiers.length ? tiers[tierIndex] : Configuration.QualityTier.GOOD;
        return s;
    }
}
