package com.neurio.langame.client;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Tiny publish/subscribe bus for client-side statistics.
 *
 * <p>The stream activity owns the {@link StreamClient}; the performance screen is a
 * separate activity. Instead of duplicating the engine (or leaking an activity),
 * the live snapshot is published here and whoever is watching reads it.</p>
 */
public final class ClientStatsHolder {

    /** Implemented by the performance screen. */
    public interface Watcher {
        void onClientStats(StreamClient.Stats stats);

        void onClientEnded();
    }

    private static final CopyOnWriteArrayList<Watcher> WATCHERS = new CopyOnWriteArrayList<>();
    private static volatile StreamClient.Stats latest;
    private static volatile boolean streaming;

    private ClientStatsHolder() {
    }

    public static void publish(StreamClient.Stats stats) {
        latest = stats;
        streaming = stats != null && stats.state == StreamClient.State.STREAMING;
        for (Watcher watcher : WATCHERS) {
            watcher.onClientStats(stats);
        }
    }

    public static void clear() {
        latest = null;
        streaming = false;
        for (Watcher watcher : WATCHERS) {
            watcher.onClientEnded();
        }
    }

    /** Copy of the newest snapshot, so a reader cannot tear a mutating object. */
    public static StreamClient.Stats snapshot() {
        StreamClient.Stats source = latest;
        if (source == null) {
            return null;
        }
        StreamClient.Stats copy = new StreamClient.Stats();
        copy.state = source.state;
        copy.gameName = source.gameName;
        copy.hostName = source.hostName;
        copy.hostDevice = source.hostDevice;
        copy.profile = source.profile;
        copy.sessionFingerprint = source.sessionFingerprint;
        copy.sessionSeconds = source.sessionSeconds;
        copy.rttMs = source.rttMs;
        copy.jitterMs = source.jitterMs;
        copy.lossPercent = source.lossPercent;
        copy.bitrateMbps = source.bitrateMbps;
        copy.framesLost = source.framesLost;
        copy.nacksSent = source.nacksSent;
        copy.keyframeRequests = source.keyframeRequests;
        copy.fps = source.fps;
        copy.decodeLatencyMs = source.decodeLatencyMs;
        copy.glassToGlassMs = source.glassToGlassMs;
        copy.decoderQueue = source.decoderQueue;
        copy.framesDecoded = source.framesDecoded;
        copy.framesDropped = source.framesDropped;
        copy.hostEncodeLatencyMs = source.hostEncodeLatencyMs;
        copy.hostFps = source.hostFps;
        copy.hostBitrateBps = source.hostBitrateBps;
        copy.hostDroppedFrames = source.hostDroppedFrames;
        copy.hostThermalStatus = source.hostThermalStatus;
        copy.hostThermalHeadroom = source.hostThermalHeadroom;
        copy.audioActive = source.audioActive;
        copy.audioNote = source.audioNote;
        copy.inputEventsSent = source.inputEventsSent;
        return copy;
    }

    public static boolean isStreaming() {
        return streaming;
    }

    public static void addWatcher(Watcher watcher) {
        WATCHERS.addIfAbsent(watcher);
    }

    public static void removeWatcher(Watcher watcher) {
        WATCHERS.remove(watcher);
    }
}
