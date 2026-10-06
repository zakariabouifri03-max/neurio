package com.neurio.langame.host;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.DeviceInfo;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.StreamProfile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Hardware H.264/H.265 encoder fed directly by the {@link ScreenCapture} virtual
 * display surface.
 *
 * <p>Latency decisions baked in here:</p>
 * <ul>
 *   <li>{@code COLOR_FormatSurface} input — the compositor writes straight into
 *       the encoder's graphic buffers; no CPU copy ever touches a frame.</li>
 *   <li>Asynchronous mode with a dedicated {@code HandlerThread} so output is
 *       picked up the moment the hardware is done.</li>
 *   <li>{@code KEY_PRIORITY = 0} (realtime), {@code KEY_OPERATING_RATE = fps} and
 *       {@code KEY_LATENCY = 0} (API 30+) — the vendor encoder is told explicitly
 *       that this is an interactive workload, not a file transcode.</li>
 *   <li>SPS/PPS are prepended to every IDR frame, so a client joining mid-stream
 *       can start decoding immediately.</li>
 *   <li>Bitrate follows the adaptive controller instantly through
 *       {@code setParameters}; resolution/frame-rate changes recreate the codec.</li>
 * </ul>
 */
public final class VideoEncoder {

    private static final String TAG = "VideoEncoder";

    public interface Listener {
        /** Called from the encoder thread with one encoded frame. */
        void onEncodedFrame(ByteBuffer data, boolean keyframe, long presentationTimeUs,
                            int totalBytes);

        /** Codec specific data (SPS/PPS) — sent to the client out of band. */
        void onCodecConfig(byte[] csd);

        /** Fatal encoder error; the engine should rebuild the pipeline. */
        void onEncoderError(String message);
    }

    private final StreamProfile profile;
    private final Listener listener;
    private final HandlerThread thread;
    private final Handler handler;

    private MediaCodec codec;
    private Surface inputSurface;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean keyframeRequestedPending = new AtomicBoolean();

    private final AtomicInteger framesEncoded = new AtomicInteger();
    private final AtomicInteger bytesEncoded = new AtomicInteger();
    private final AtomicInteger droppedFrames = new AtomicInteger();
    private final AtomicInteger keyframeCount = new AtomicInteger();
    private volatile float encodeLatencyMs;
    private long lastFrameAtMs;
    private float fpsEstimate;
    private volatile int currentBitrateBps;
    private volatile byte[] codecConfig;

    public VideoEncoder(StreamProfile profile, Listener listener) {
        this.profile = profile;
        this.listener = listener;
        this.thread = new HandlerThread("lgs-encoder", android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY);
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    /* ------------------------------------------------------------------ */

    public Surface inputSurface() {
        return inputSurface;
    }

    public StreamProfile profile() {
        return profile;
    }

    public boolean isRunning() {
        return running.get();
    }

    public byte[] codecConfig() {
        return codecConfig;
    }

    /** Creates and starts the codec. The input surface is ready afterwards. */
    public void start() throws IOException {
        String mime = profile.codec.mime;
        MediaCodecInfo info = DeviceInfo.findCodec(mime, true, profile.width, profile.height, profile.fps);
        if (info == null) {
            throw new IOException("No " + profile.codec.label
                    + " encoder supports " + profile.width + "×" + profile.height);
        }
        Logger.i(TAG, "Using encoder " + info.getName() + " for " + profile);

        MediaFormat format = MediaFormat.createVideoFormat(mime, profile.width, profile.height);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        format.setInteger(MediaFormat.KEY_BIT_RATE, profile.bitrateBps);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, profile.fps);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,
                (int) (Configuration.KEYFRAME_INTERVAL_US / 1_000_000L));
        format.setInteger(MediaFormat.KEY_PRIORITY, 0);                 // realtime (API 23+)
        format.setInteger(MediaFormat.KEY_OPERATING_RATE, profile.fps); // API 23+
        try {
            format.setInteger(MediaFormat.KEY_LATENCY, 0);              // API 30+
        } catch (Exception ignored) {
            // Older platforms simply do not expose the key.
        }
        try {
            format.setInteger(MediaFormat.KEY_PREPEND_HEADER_TO_SYNC_FRAMES, 1);
        } catch (Exception ignored) {
        }
        applyBitrateMode(format, info, mime);
        applyProfileAndLevel(format, info, mime);

        codec = MediaCodec.createByCodecName(info.getName());
        codec.setCallback(new CodecCallback(), handler);
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        inputSurface = codec.createInputSurface();
        codec.start();
        running.set(true);
        currentBitrateBps = profile.bitrateBps;
        lastFrameAtMs = System.currentTimeMillis();
        Logger.i(TAG, "Encoder started (" + profile.width + "×" + profile.height + "@"
                + profile.fps + ", " + profile.bitrateBps / 1_000_000f + " Mbps, "
                + profile.codec.label + ")");
    }

    private void applyBitrateMode(MediaFormat format, MediaCodecInfo info, String mime) {
        try {
            MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
            MediaCodecInfo.EncoderCapabilities encoderCaps = caps.getEncoderCapabilities();
            if (encoderCaps != null
                    && encoderCaps.isBitrateModeSupported(
                    MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)) {
                format.setInteger(MediaFormat.KEY_BITRATE_MODE,
                        MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR);
            } else if (encoderCaps != null && encoderCaps.isBitrateModeSupported(
                    MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)) {
                format.setInteger(MediaFormat.KEY_BITRATE_MODE,
                        MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR);
            }
        } catch (Exception e) {
            Logger.w(TAG, "Could not set bitrate mode: " + e.getMessage());
        }
    }

    private void applyProfileAndLevel(MediaFormat format, MediaCodecInfo info, String mime) {
        try {
            if (Configuration.Codec.AVC == profile.codec) {
                format.setInteger(MediaFormat.KEY_PROFILE,
                        MediaCodecInfo.CodecProfileLevel.AVCProfileHigh);
                format.setInteger(MediaFormat.KEY_LEVEL,
                        MediaCodecInfo.CodecProfileLevel.AVCLevel41);
            } else {
                format.setInteger(MediaFormat.KEY_PROFILE,
                        MediaCodecInfo.CodecProfileLevel.HEVCProfileMain);
                format.setInteger(MediaFormat.KEY_LEVEL,
                        MediaCodecInfo.CodecProfileLevel.HEVCMainTierLevel41);
            }
        } catch (Exception e) {
            Logger.w(TAG, "Profile/level not settable for " + info.getName() + ": " + e.getMessage());
        }
    }

    /** Instant bitrate change used by the adaptive controller. */
    public void setBitrate(int bitrateBps) {
        MediaCodec local = codec;
        if (local == null || !running.get()) {
            return;
        }
        int clamped = Math.max(300_000, Math.min(bitrateBps, 60_000_000));
        if (clamped == currentBitrateBps) {
            return;
        }
        try {
            Bundle params = new Bundle();
            params.putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, clamped);
            local.setParameters(params);
            currentBitrateBps = clamped;
            Logger.i(TAG, "Bitrate → " + (clamped / 1_000_000f) + " Mbps");
        } catch (Exception e) {
            Logger.w(TAG, "setBitrate failed: " + e.getMessage());
        }
    }

    /** Asks the hardware for an immediate IDR (used on client request / recovery). */
    public void requestKeyframe() {
        MediaCodec local = codec;
        if (local == null || !running.get()) {
            return;
        }
        if (!keyframeRequestedPending.compareAndSet(false, true)) {
            return;
        }
        try {
            Bundle params = new Bundle();
            params.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
            local.setParameters(params);
        } catch (Exception e) {
            keyframeRequestedPending.set(false);
            Logger.w(TAG, "requestKeyframe failed: " + e.getMessage());
        }
    }

    public void stop() {
        running.set(false);
        MediaCodec local = codec;
        codec = null;
        if (local != null) {
            try {
                local.stop();
            } catch (Exception ignored) {
            }
            try {
                local.release();
            } catch (Exception ignored) {
            }
        }
        if (inputSurface != null) {
            try {
                inputSurface.release();
            } catch (Exception ignored) {
            }
            inputSurface = null;
        }
        Logger.i(TAG, "Encoder stopped");
    }

    public void release() {
        stop();
        try {
            thread.quitSafely();
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */

    private final class CodecCallback extends MediaCodec.Callback {
        @Override
        public void onInputBufferAvailable(MediaCodec codec, int index) {
            // Surface input: nothing to feed manually.
        }

        @Override
        public void onOutputBufferAvailable(MediaCodec codec, int index, MediaCodec.BufferInfo info) {
            try {
                ByteBuffer buffer = codec.getOutputBuffer(index);
                if (buffer == null) {
                    codec.releaseOutputBuffer(index, false);
                    return;
                }
                buffer.position(info.offset);
                buffer.limit(info.offset + info.size);
                int size = info.size;

                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                    byte[] config = new byte[size];
                    buffer.get(config);
                    codecConfig = config;
                    Listener l = listener;
                    if (l != null) {
                        l.onCodecConfig(config);
                    }
                    codec.releaseOutputBuffer(index, false);
                    return;
                }

                boolean keyframe = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                if (keyframe) {
                    keyframeCount.incrementAndGet();
                    keyframeRequestedPending.set(false);
                }
                framesEncoded.incrementAndGet();
                bytesEncoded.addAndGet(size);

                // Capture→encode latency: for surface input the codec timestamps
                // frames with the monotonic clock, so the difference to now is the
                // end-to-end delay inside the device (a lower bound of the truth,
                // because nothing can measure the compositor's own queue).
                long nowUs = System.nanoTime() / 1000L;
                long latencyUs = nowUs - info.presentationTimeUs;
                if (latencyUs > 0 && latencyUs < 1_000_000L) {
                    encodeLatencyMs = encodeLatencyMs * 0.8f + (latencyUs / 1000f) * 0.2f;
                }
                long nowMs = System.currentTimeMillis();
                long delta = Math.max(1, nowMs - lastFrameAtMs);
                lastFrameAtMs = nowMs;
                float instantFps = 1000f / delta;
                fpsEstimate = fpsEstimate * 0.9f + instantFps * 0.1f;
                if (latencyUs > 200_000L) {
                    droppedFrames.incrementAndGet();
                }

                Listener l = listener;
                if (l != null) {
                    // The listener copies this frame into datagrams synchronously, so
                    // the buffer can be released immediately afterwards.
                    l.onEncodedFrame(buffer, keyframe, info.presentationTimeUs, size);
                }
            } catch (IllegalStateException e) {
                Logger.w(TAG, "Encoder output raced with stop(): " + e.getMessage());
            } finally {
                try {
                    codec.releaseOutputBuffer(index, false);
                } catch (IllegalStateException ignored) {
                }
            }
        }

        @Override
        public void onError(MediaCodec codec, MediaCodec.CodecException e) {
            Logger.e(TAG, "Encoder error", e);
            Listener l = listener;
            if (l != null) {
                l.onEncoderError(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }

        @Override
        public void onOutputFormatChanged(MediaCodec codec, MediaFormat format) {
            Logger.i(TAG, "Encoder output format: " + format);
            ByteBuffer csd0 = format.getByteBuffer("csd-0");
            ByteBuffer csd1 = format.getByteBuffer("csd-1");
            int total = (csd0 == null ? 0 : csd0.remaining()) + (csd1 == null ? 0 : csd1.remaining());
            if (total > 0) {
                byte[] config = new byte[total];
                int offset = 0;
                if (csd0 != null) {
                    csd0.get(config, 0, csd0.remaining());
                    offset = csd0.remaining();
                }
                if (csd1 != null) {
                    csd1.get(config, offset, csd1.remaining());
                }
                codecConfig = config;
                Listener l = listener;
                if (l != null) {
                    l.onCodecConfig(config);
                }
            }
        }
    }

    /* ------------------------------ stats ------------------------------ */

    public int framesEncoded() {
        return framesEncoded.get();
    }

    public int bytesEncoded() {
        return bytesEncoded.get();
    }

    public int droppedFrames() {
        return droppedFrames.get();
    }

    public int keyframes() {
        return keyframeCount.get();
    }

    public float encodeLatencyMs() {
        return encodeLatencyMs;
    }

    public float fps() {
        return fpsEstimate;
    }

    public int currentBitrateBps() {
        return currentBitrateBps;
    }
}
