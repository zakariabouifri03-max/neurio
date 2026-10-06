package com.neurio.langame.common;

/**
 * Global, compile-time configuration for the LAN Game Stream prototype.
 *
 * <p>Every magic number that matters for latency lives here so that the whole
 * pipeline can be reasoned about (and tuned) from one place.</p>
 */
public final class Configuration {

    private Configuration() {
    }

    /* ------------------------------------------------------------------ *
     *  Network endpoints (all on the local network, no cloud involved)
     * ------------------------------------------------------------------ */

    /** Reliable control channel (TCP): pairing, session start/stop, quality reports. */
    public static final int PORT_CONTROL = 47777;
    /** Unreliable low-latency input channel (UDP, redundant packets). */
    public static final int PORT_INPUT = 47778;
    /** Unreliable video channel (UDP, fragment + NACK). */
    public static final int PORT_VIDEO = 47779;
    /** Unreliable audio channel (UDP). */
    public static final int PORT_AUDIO = 47780;
    /** UDP broadcast/multicast discovery fallback (NSD is used first). */
    public static final int PORT_DISCOVERY = 47781;

    /** NSD/mDNS service type advertised by a host. */
    public static final String NSD_SERVICE_TYPE = "_neurio-lgs._tcp.";
    /** UDP discovery beacon magic — also doubles as a cheap version gate. */
    public static final String DISCOVERY_MAGIC = "NEURIO-LGS";
    /** Bumped whenever the wire format changes incompatibly. */
    public static final int PROTOCOL_VERSION = 1;

    /* ------------------------------------------------------------------ *
     *  Transport tuning
     * ------------------------------------------------------------------ */

    /** Safe payload for a 1500-byte Ethernet MTU once IP+UDP headers are excluded. */
    public static final int VIDEO_CHUNK_PAYLOAD = 1316;
    public static final int AUDIO_PACKET_PAYLOAD = 480;
    public static final int SOCKET_SEND_BUFFER = 4 * 1024 * 1024;
    public static final int SOCKET_RECEIVE_BUFFER = 4 * 1024 * 1024;

    /** How long the receiver waits for a missing fragment before asking again. */
    public static final long NACK_DELAY_MS = 6L;
    /** Retransmission passes per fragment before the frame is abandoned. */
    public static final int MAX_RETRANSMIT_PASSES = 2;
    /** Input events are repeated N times on the wire to survive single losses. */
    public static final int INPUT_REDUNDANCY = 3;
    /** Drop input packets older than this (keeps the latency budget honest). */
    public static final long INPUT_STALE_MS = 250L;

    /* ------------------------------------------------------------------ *
     *  Video pipeline
     * ------------------------------------------------------------------ */

    /** Android asks the encoder for an I-frame at least this often. */
    public static final long KEYFRAME_INTERVAL_US = 1_500_000L;
    /** Decoder output is considered "catching up" above this queue depth. */
    public static final int DECODER_QUEUE_HIGH_WATER = 3;
    /** Client-side queue cap before frames are dropped to protect latency. */
    public static final int CLIENT_MAX_QUEUED_FRAMES = 4;
    /** Host re-encodes at most once per this interval when adapting. */
    public static final long ADAPT_MIN_INTERVAL_MS = 4_000L;
    /** Adaptive controller needs this many samples before acting. */
    public static final int ADAPT_MIN_SAMPLES = 30;

    /* ------------------------------------------------------------------ *
     *  Timing / timeouts
     * ------------------------------------------------------------------ */

    public static final long PAIRING_TIMEOUT_MS = 60_000L;
    public static final long CONTROL_KEEPALIVE_MS = 1_000L;
    public static final long CONTROL_TIMEOUT_MS = 5_000L;
    public static final long REPLAY_WINDOW_MS = 30_000L;
    public static final int MAX_FRAME_ID_GAP = 120;

    /* ------------------------------------------------------------------ *
     *  Store keys (SharedPreferences) — see AppSettings
     * ------------------------------------------------------------------ */

    public static final String PREFS = "lan_game_stream";
    public static final String KEY_CODEC = "codec";
    public static final String KEY_RESOLUTION = "resolution";
    public static final String KEY_FPS = "fps";
    public static final String KEY_BITRATE = "bitrate_kbps";
    public static final String KEY_ADAPTIVE = "adaptive";
    public static final String KEY_CAPTURE_AUDIO = "capture_audio";
    public static final String KEY_HAPTICS = "haptics";
    public static final String KEY_KEEP_SCREEN_ON = "keep_screen_on";
    public static final String KEY_INPUT_MODE = "input_mode";
    public static final String KEY_HOTSPOT_MODE = "hotspot_mode";
    public static final String KEY_LAST_HOST_IP = "last_host_ip";
    public static final String KEY_CONTROLLER_LAYOUT = "controller_layout";

    /* ------------------------------------------------------------------ *
     *  Enumerations used across host and client
     * ------------------------------------------------------------------ */

    /** Hardware video codecs the prototype supports. */
    public enum Codec {
        /** H.264/AVC — universally supported, lowest latency on older SoCs. */
        AVC("H.264", "video/avc"),
        /** H.265/HEVC — ~35 % smaller bitrate for the same quality. */
        HEVC("H.265", "video/hevc");

        public final String label;
        public final String mime;

        Codec(String label, String mime) {
            this.label = label;
            this.mime = mime;
        }
    }

    /** Network + pipeline health, drives the adaptive ladder. */
    public enum QualityTier {
        EXCELLENT("Excellent"),
        GOOD("Good"),
        WEAK("Weak"),
        VERY_WEAK("Very weak");

        public final String label;

        QualityTier(String label) {
            this.label = label;
        }
    }

    /** Which mechanism is allowed to push input into the game on the host. */
    public enum InputMode {
        /** Never inject anything (video-only / debugging). */
        DISABLED("Disabled"),
        /** AccessibilityService#dispatchGesture — works on stock, non-rooted devices. */
        ACCESSIBILITY("Accessibility (stock)"),
        /** `su -c input ...` — only on rooted devices or an adb shell daemon. */
        ROOT_SHELL("Root shell"),
        /** No injection at all: events are applied to the host's own surface (self-test). */
        LOCAL_SELFTEST("Local self-test");

        public final String label;

        InputMode(String label) {
            this.label = label;
        }
    }
}
