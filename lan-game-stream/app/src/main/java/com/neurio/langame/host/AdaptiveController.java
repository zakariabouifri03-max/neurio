package com.neurio.langame.host;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.common.StreamProfile;

/**
 * Decides when the stream shape should change.
 *
 * <p>Rules of engagement (deliberately conservative — a resolution change costs
 * a codec restart and a visible glitch, so it must be worth it):</p>
 * <ul>
 *   <li><b>Bitrate</b> is adjusted every tick. It is free: one
 *       {@code setParameters} call, no keyframe, no visible interruption.</li>
 *   <li><b>Resolution / frame rate</b> only change after
 *       {@link Configuration#ADAPT_MIN_INTERVAL_MS} with a consistent signal, and
 *       only one step at a time.</li>
 *   <li>The ladder is Excellent (1080p60) → Good (720p60) → Weak (720p30) →
 *       Very weak (480p30). The goal is smooth input, not pretty pixels.</li>
 * </ul>
 */
public final class AdaptiveController {

    private static final String TAG = "Adaptive";

    public interface Listener {
        /** The encoder bitrate should change now (instant, no restart). */
        void onBitrateChange(int bitrateBps);

        /** The stream must be rebuilt at a new shape (codec restart + keyframe). */
        void onProfileChange(StreamProfile profile);
    }

    private final Listener listener;
    private final boolean enabled;
    private final int bitrateCapBps;

    private StreamProfile currentProfile;
    private Configuration.QualityTier lastTier = Configuration.QualityTier.EXCELLENT;
    private long lastChangeMs;
    private int consistentTicks;
    private Configuration.QualityTier pendingTier;
    private int thermalStatus = -1;
    private float thermalHeadroom = Float.NaN;

    public AdaptiveController(Listener listener, StreamProfile initialProfile, boolean enabled,
                              int bitrateCapBps) {
        this.listener = listener;
        this.currentProfile = initialProfile;
        this.enabled = enabled;
        this.bitrateCapBps = bitrateCapBps;
    }

    public StreamProfile currentProfile() {
        return currentProfile;
    }

    public void onProfileReplaced(StreamProfile profile) {
        this.currentProfile = profile;
        this.lastChangeMs = System.currentTimeMillis();
    }

    public void onThermal(int status, float headroom) {
        this.thermalStatus = status;
        this.thermalHeadroom = headroom;
    }

    /**
     * Called ~4×/second with the freshest client report plus encoder-side numbers.
     */
    public void update(NetworkStats.Snapshot report, float encoderFps, boolean encoderBehind) {
        if (!enabled || listener == null) {
            return;
        }
        Configuration.QualityTier tier = classify(report, encoderFps, encoderBehind);
        long now = System.currentTimeMillis();

        if (tier != pendingTier) {
            pendingTier = tier;
            consistentTicks = 0;
            return;
        }
        consistentTicks++;
        if (consistentTicks < 6) {          // ~1.5 s of agreement before acting
            return;
        }

        // Bitrate first: always safe, always available.
        int target = targetBitrate(tier, report);
        if (target != currentProfile.bitrateBps) {
            StreamProfile updated = currentProfile.withBitrate(target);
            currentProfile = updated;
            listener.onBitrateChange(target);
            Logger.i(TAG, "Adaptive bitrate → " + (target / 1_000_000f) + " Mbps (" + tier.label + ")");
        }

        // Shape changes are expensive: one step, at most every few seconds.
        if (tier != lastTier && now - lastChangeMs > Configuration.ADAPT_MIN_INTERVAL_MS) {
            StreamProfile target2 = reshape(tier);
            if (target2.width != currentProfile.width || target2.fps != currentProfile.fps) {
                lastChangeMs = now;
                lastTier = tier;
                currentProfile = target2;
                Logger.i(TAG, "Adaptive profile → " + target2 + " (" + tier.label + ")");
                listener.onProfileChange(target2);
                return;
            }
            lastTier = tier;
        }
    }

    private Configuration.QualityTier classify(NetworkStats.Snapshot report, float encoderFps,
                                               boolean encoderBehind) {
        float loss = report.lossPercent;
        float rtt = report.rttMs;
        float jitter = report.jitterMs;

        // A hot SoC or an encoder that cannot keep up means the *host* is the
        // bottleneck: lowering the resolution is then the only thing that helps.
        boolean hostBound = encoderBehind
                || encoderFps < currentProfile.fps * 0.8f
                || (thermalStatus >= android.os.PowerManager.THERMAL_STATUS_SEVERE)
                || (!Float.isNaN(thermalHeadroom) && thermalHeadroom > 0.9f);

        if (hostBound) {
            return currentProfile.height > 720
                    ? Configuration.QualityTier.WEAK
                    : Configuration.QualityTier.VERY_WEAK;
        }
        if (loss > 6f || rtt > 120f || jitter > 40f) {
            return Configuration.QualityTier.VERY_WEAK;
        }
        if (loss > 2f || rtt > 60f || jitter > 20f) {
            return Configuration.QualityTier.WEAK;
        }
        if (loss > 0.5f || rtt > 30f || jitter > 8f) {
            return Configuration.QualityTier.GOOD;
        }
        return Configuration.QualityTier.EXCELLENT;
    }

    private int targetBitrate(Configuration.QualityTier tier, NetworkStats.Snapshot report) {
        int desired = currentProfile.bitrateBps;
        switch (tier) {
            case EXCELLENT:
                desired = Math.max(desired, (int) (currentProfile.width * currentProfile.height
                        * currentProfile.fps * 0.09f));
                break;
            case GOOD:
                desired = Math.max(4_000_000, desired - 1_000_000);
                break;
            case WEAK:
                desired = Math.max(1_500_000, (int) (desired * 0.7f));
                break;
            case VERY_WEAK:
            default:
                desired = Math.max(700_000, (int) (desired * 0.55f));
                break;
        }
        // Loss means the link is saturated: pull back below what it just proved.
        if (report.lossPercent > 1f && report.bitrateMbps > 0) {
            int observed = (int) (report.bitrateMbps * 1_000_000);
            desired = Math.min(desired, (int) (observed * 0.9f));
        }
        desired = Math.min(desired, bitrateCapBps);
        desired = Math.max(desired, 500_000);
        // Quantise so tiny changes do not spam the encoder.
        return (desired / 250_000) * 250_000;
    }

    private StreamProfile reshape(Configuration.QualityTier tier) {
        switch (tier) {
            case EXCELLENT:
                return currentProfile.height >= 1080
                        ? currentProfile
                        : StreamProfile.excellent(currentProfile.codec, false)
                        .withBitrate(Math.min(currentProfile.bitrateBps, bitrateCapBps));
            case GOOD:
                return currentProfile.height == 720 && currentProfile.fps == 60
                        ? currentProfile
                        : StreamProfile.good(currentProfile.codec)
                        .withBitrate(Math.min(currentProfile.bitrateBps, bitrateCapBps));
            case WEAK:
                return StreamProfile.weak(currentProfile.codec)
                        .withBitrate(Math.min(currentProfile.bitrateBps, bitrateCapBps));
            case VERY_WEAK:
            default:
                return StreamProfile.veryWeak(currentProfile.codec);
        }
    }
}
