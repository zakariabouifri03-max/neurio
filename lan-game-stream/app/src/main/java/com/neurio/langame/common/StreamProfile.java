package com.neurio.langame.common;

import java.util.Locale;

/**
 * An immutable description of the video stream shape: codec, resolution, frame
 * rate and bitrate ceiling. Profiles are what the adaptive controller switches
 * between and what the host announces to a client during the handshake.
 */
public final class StreamProfile {

    public final Configuration.Codec codec;
    public final int width;
    public final int height;
    public final int fps;
    public final int bitrateBps;

    public StreamProfile(Configuration.Codec codec, int width, int height, int fps, int bitrateBps) {
        this.codec = codec;
        this.width = width;
        this.height = height;
        this.fps = fps;
        this.bitrateBps = bitrateBps;
    }

    public int shortSide() {
        return Math.min(width, height);
    }

    /** "720p60 · 8.0 Mbps" */
    public String describe() {
        return String.format(Locale.US, "%dp%d · %.1f Mbps · %s",
                height, fps, bitrateBps / 1_000_000f, codec.label);
    }

    public String shortLabel() {
        return String.format(Locale.US, "%dp%d", height, fps);
    }

    public StreamProfile withBitrate(int newBitrateBps) {
        return new StreamProfile(codec, width, height, fps, newBitrateBps);
    }

    public StreamProfile withShape(int newWidth, int newHeight, int newFps) {
        return new StreamProfile(codec, newWidth, newHeight, newFps, bitrateBps);
    }

    @Override
    public String toString() {
        return describe();
    }

    /* ------------------------------------------------------------------ *
     *  Built-in ladder — the four documented quality levels
     * ------------------------------------------------------------------ */

    /** 1080p60 — used when the LAN is quiet and the SoC is not thermally throttled. */
    public static StreamProfile excellent(Configuration.Codec codec, boolean lowBitrateLan) {
        return new StreamProfile(codec, 1920, 1080, 60, lowBitrateLan ? 12_000_000 : 20_000_000);
    }

    /** 720p60 — the primary target of the prototype. */
    public static StreamProfile good(Configuration.Codec codec) {
        return new StreamProfile(codec, 1280, 720, 60, 8_000_000);
    }

    /** 720p30 — first fallback when the radio or the SoC struggles. */
    public static StreamProfile weak(Configuration.Codec codec) {
        return new StreamProfile(codec, 1280, 720, 30, 4_500_000);
    }

    /** 480p30 — keeps input latency usable on a congested 2.4 GHz band. */
    public static StreamProfile veryWeak(Configuration.Codec codec) {
        return new StreamProfile(codec, 854, 480, 30, 2_000_000);
    }

    public static StreamProfile forTier(Configuration.QualityTier tier,
                                        Configuration.Codec codec,
                                        boolean lowBitrateLan) {
        switch (tier) {
            case EXCELLENT:
                return excellent(codec, lowBitrateLan);
            case GOOD:
                return good(codec);
            case WEAK:
                return weak(codec);
            case VERY_WEAK:
            default:
                return veryWeak(codec);
        }
    }

    public Configuration.QualityTier tier() {
        if (width >= 1920 && fps >= 60) {
            return Configuration.QualityTier.EXCELLENT;
        }
        if (fps >= 60) {
            return Configuration.QualityTier.GOOD;
        }
        if (width >= 1280) {
            return Configuration.QualityTier.WEAK;
        }
        return Configuration.QualityTier.VERY_WEAK;
    }
}
