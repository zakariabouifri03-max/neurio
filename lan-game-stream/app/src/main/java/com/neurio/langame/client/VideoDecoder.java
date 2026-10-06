package com.neurio.langame.client;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.StreamProfile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Hardware video decoder rendering straight into the client's {@link Surface}.
 *
 * <pre>
 *   UDP fragments → reassembled frame → MediaCodec (hardware) → SurfaceView
 * </pre>
 *
 * <p>Latency decisions:</p>
 * <ul>
 *   <li>Frames are queued with a zero-timeout dequeue: if the decoder has no free
 *       input buffer the frame is <b>dropped</b> instead of growing a queue. On a
 *       game stream, a skipped frame beats 60 ms of added delay.</li>
 *   <li>{@code KEY_LOW_LATENCY = 1} (API 30+) tells the vendor decoder to render
 *       as soon as it has a picture instead of buffering a pipeline's worth.</li>
 *   <li>Output is released with {@code render = true} immediately from the codec
 *       callback, and {@code OnFrameRenderedListener} gives us the real
 *       glass-to-glass render time for the HUD.</li>
 * </ul>
 */
public final class VideoDecoder {

    private static final String TAG = "VideoDecoder";

    public interface Listener {
        /** A frame reached the display (renderTimeNs uses the monotonic clock). */
        void onFrameRendered(long renderTimeNs, float decodedFps);

        /** The decoder is unhappy: the engine should request a keyframe / rebuild. */
        void onDecoderError(String message);

        /** The decoder reported a new picture size (adaptive resolution switch). */
        void onFormatChanged(int width, int height);
    }

    private final Surface surface;
    private final Listener listener;
    private final HandlerThread thread;
    private final Handler handler;

    private MediaCodec decoder;
    private volatile StreamProfile profile;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicInteger framesQueued = new AtomicInteger();
    private final AtomicInteger framesDropped = new AtomicInteger();
    private final AtomicLong lastRenderAtNs = new AtomicLong();
    private volatile float decodedFps;
    private volatile float decodeLatencyMs = -1f;
    private volatile byte[] codecConfig;
    private long lastFrameAtMs;
    private volatile long lastQueuedAtUptimeMs;
    private volatile long lastQueuedPtsUs = -1;

    public VideoDecoder(Surface surface, StreamProfile profile, Listener listener) {
        this.surface = surface;
        this.profile = profile;
        this.listener = listener;
        this.thread = new HandlerThread("lgs-decoder",
                android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY);
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    public void configure(StreamProfile profile) throws IOException {
        this.profile = profile;
        MediaFormat format = MediaFormat.createVideoFormat(profile.codec.mime,
                profile.width, profile.height);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
            } catch (Exception ignored) {
                // Not every platform level accepts the key.
            }
        }
        try {
            format.setInteger(MediaFormat.KEY_PRIORITY, 0);
        } catch (Exception ignored) {
        }
        byte[] config = codecConfig;
        if (config != null && config.length > 0) {
            format.setByteBuffer("csd-0", ByteBuffer.wrap(config));
        }
        decoder = MediaCodec.createDecoderByType(profile.codec.mime);
        decoder.setCallback(new DecoderCallback(), handler);
        decoder.configure(format, surface, null, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            decoder.setOnFrameRenderedListener(this::onFrameRenderedInternal, handler);
        }
        decoder.start();
        running.set(true);
        Logger.i(TAG, "Decoder started (" + profile.codec.label + " " + profile.width + "×"
                + profile.height + ")");
    }

    /** Feeds one reassembled frame; drops it when the decoder has no room. */
    public void queueFrame(byte[] data, int length, long presentationTimeUs, boolean keyframe) {
        MediaCodec local = decoder;
        if (local == null || !running.get() || length <= 0) {
            return;
        }
        try {
            int index = local.dequeueInputBuffer(0);
            if (index < 0) {
                framesDropped.incrementAndGet();
                return;
            }
            ByteBuffer input = local.getInputBuffer(index);
            if (input == null) {
                framesDropped.incrementAndGet();
                return;
            }
            input.clear();
            input.put(data, 0, Math.min(length, input.capacity()));
            local.queueInputBuffer(index, 0, Math.min(length, input.capacity()),
                    presentationTimeUs, keyframe ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0);
            lastQueuedAtUptimeMs = android.os.SystemClock.uptimeMillis();
            lastQueuedPtsUs = presentationTimeUs;
            framesQueued.incrementAndGet();
        } catch (IllegalStateException e) {
            Logger.w(TAG, "Decoder queue raced with a stop: " + e.getMessage());
        }
    }

    public void setCodecConfig(byte[] csd) {
        this.codecConfig = csd;
        Logger.i(TAG, "Codec config received (" + (csd == null ? 0 : csd.length) + " bytes)");
    }

    public void requestKeyFrame() {
        // The decoder cannot ask for a keyframe itself; the session sends the request
        // to the host through its transport (see StreamClient#requestKeyframe).
    }

    private void onFrameRenderedInternal(MediaCodec codec, long presentationTimeUs,
                                         long renderTimeNs) {
        long now = System.currentTimeMillis();
        long delta = Math.max(1, now - lastFrameAtMs);
        lastFrameAtMs = now;
        float instant = 1000f / delta;
        decodedFps = decodedFps * 0.9f + instant * 0.1f;
        lastRenderAtNs.set(renderTimeNs);

        // Decoder + compositor latency for the picture that just reached the display.
        // Decode order matches queue order, so the most recently queued frame is a
        // good proxy for this render callback (and costs no per-frame allocation).
        long queuedAt = lastQueuedAtUptimeMs;
        if (lastQueuedPtsUs == presentationTimeUs && queuedAt > 0) {
            long wait = android.os.SystemClock.uptimeMillis() - queuedAt;
            if (wait >= 0 && wait < 2000) {
                decodeLatencyMs = decodeLatencyMs < 0 ? wait
                        : decodeLatencyMs * 0.85f + wait * 0.15f;
            }
        }
        Listener l = listener;
        if (l != null) {
            l.onFrameRendered(renderTimeNs, decodedFps);
        }
    }

    public boolean isRunning() {
        return running.get();
    }

    public int framesQueued() {
        return framesQueued.get();
    }

    public int framesDropped() {
        return framesDropped.get();
    }

    public float fps() {
        return decodedFps;
    }

    /** Frames arriving at the display per second (EMA). */
    public float decodeLatencyMs() {
        return decodeLatencyMs;
    }

    public StreamProfile profile() {
        return profile;
    }

    public void stop() {
        running.set(false);
        MediaCodec local = decoder;
        decoder = null;
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
        Logger.i(TAG, "Decoder stopped (queued " + framesQueued.get() + ", dropped "
                + framesDropped.get() + ")");
    }

    public void release() {
        stop();
        try {
            thread.quitSafely();
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */

    private final class DecoderCallback extends MediaCodec.Callback {
        @Override
        public void onInputBufferAvailable(MediaCodec codec, int index) {
            // Pull model: frames arrive from the transport thread.
        }

        @Override
        public void onOutputBufferAvailable(MediaCodec codec, int index, MediaCodec.BufferInfo info) {
            try {
                // render = true: hand the picture to the compositor as soon as the
                // hardware has produced it — never wait for a "presentation time".
                codec.releaseOutputBuffer(index, true);
            } catch (IllegalStateException ignored) {
            }
        }

        @Override
        public void onError(MediaCodec codec, MediaCodec.CodecException e) {
            Logger.e(TAG, "Decoder error", e);
            Listener l = listener;
            if (l != null) {
                l.onDecoderError(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }

        @Override
        public void onOutputFormatChanged(MediaCodec codec, MediaFormat format) {
            int width = format.containsKey(MediaFormat.KEY_WIDTH)
                    ? format.getInteger(MediaFormat.KEY_WIDTH) : profile.width;
            int height = format.containsKey(MediaFormat.KEY_HEIGHT)
                    ? format.getInteger(MediaFormat.KEY_HEIGHT) : profile.height;
            Logger.i(TAG, "Decoder format: " + width + "×" + height);
            Listener l = listener;
            if (l != null) {
                l.onFormatChanged(width, height);
            }
        }
    }

    /** Exposed for the HUD: how far behind the newest decoded picture is. */
    public float renderDelayMs() {
        long last = lastRenderAtNs.get();
        if (last <= 0) {
            return -1f;
        }
        return (System.nanoTime() - last) / 1_000_000f;
    }

    /** Rough measure used by the adaptive report. */
    public int queueDepth() {
        return framesQueued.get() - framesDropped.get() > Configuration.CLIENT_MAX_QUEUED_FRAMES
                ? Configuration.CLIENT_MAX_QUEUED_FRAMES
                : Math.max(0, framesQueued.get() - framesDropped.get());
    }
}
