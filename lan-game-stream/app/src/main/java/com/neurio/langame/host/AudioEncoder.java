package com.neurio.langame.host;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Handler;
import android.os.HandlerThread;

import com.neurio.langame.common.Logger;
import com.neurio.langame.network.AudioTransport;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AAC-LC encoder for the captured game audio.
 *
 * <p>Output frames are ADTS wrapped on the way out, so the client can configure
 * its decoder from the stream itself even if it missed the out-of-band config.
 * The audio path is kept at 48 kHz stereo / 128 kbps: small enough that a 20 ms
 * frame is one datagram, high enough that gunfire does not turn to mush.</p>
 */
public final class AudioEncoder {

    private static final String TAG = "AudioEncoder";

    public interface Listener {
        /** ADTS framed AAC access unit. */
        void onEncodedFrame(byte[] adtsFrame, long presentationTimeUs);

        /** AudioSpecificConfig for the client decoder. */
        void onCodecConfig(byte[] audioSpecificConfig);

        void onError(String message);
    }

    private final Listener listener;
    private final HandlerThread thread;
    private final Handler handler;
    private MediaCodec codec;
    private final AtomicBoolean running = new AtomicBoolean();
    private int framesEncoded;
    private long bytesEncoded;

    public AudioEncoder(Listener listener) {
        this.listener = listener;
        this.thread = new HandlerThread("lgs-audio-encoder",
                android.os.Process.THREAD_PRIORITY_AUDIO);
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    public void start() throws IOException {
        MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC,
                AudioTransport.AUDIO_SAMPLE_RATE, AudioTransport.AUDIO_CHANNELS);
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        format.setInteger(MediaFormat.KEY_BIT_RATE, AudioTransport.AUDIO_BITRATE);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);

        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        codec.setCallback(new EncoderCallback(), handler);
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        codec.start();
        running.set(true);
        Logger.i(TAG, "AAC encoder started (" + AudioTransport.AUDIO_BITRATE / 1000 + " kbps)");
    }

    /** Feeds PCM 16-bit stereo into the encoder (called from the capture thread). */
    public void offerPcm(ByteBuffer data, int size, long presentationTimeUs) {
        MediaCodec local = codec;
        if (local == null || !running.get()) {
            return;
        }
        try {
            int index = local.dequeueInputBuffer(0);
            if (index < 0) {
                return;   // encoder is keeping up; drop the oldest PCM rather than stall
            }
            ByteBuffer input = local.getInputBuffer(index);
            if (input == null) {
                return;
            }
            input.clear();
            int copy = Math.min(size, input.capacity());
            int oldLimit = data.limit();
            data.limit(data.position() + copy);
            input.put(data);
            data.limit(oldLimit);
            local.queueInputBuffer(index, 0, copy, presentationTimeUs, 0);
        } catch (IllegalStateException e) {
            Logger.w(TAG, "Audio input raced with stop(): " + e.getMessage());
        }
    }

    public boolean isRunning() {
        return running.get();
    }

    public int framesEncoded() {
        return framesEncoded;
    }

    public long bytesEncoded() {
        return bytesEncoded;
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
    }

    public void release() {
        stop();
        try {
            thread.quitSafely();
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */

    private final class EncoderCallback extends MediaCodec.Callback {
        @Override
        public void onInputBufferAvailable(MediaCodec codec, int index) {
            // Pull model: PCM is pushed by AudioCapture#offerPcm.
        }

        @Override
        public void onOutputBufferAvailable(MediaCodec codec, int index, MediaCodec.BufferInfo info) {
            try {
                ByteBuffer buffer = codec.getOutputBuffer(index);
                if (buffer == null || info.size <= 0) {
                    codec.releaseOutputBuffer(index, false);
                    return;
                }
                buffer.position(info.offset);
                buffer.limit(info.offset + info.size);

                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                    byte[] config = new byte[info.size];
                    buffer.get(config);
                    Listener l = listener;
                    if (l != null) {
                        l.onCodecConfig(config);
                    }
                    codec.releaseOutputBuffer(index, false);
                    return;
                }

                byte[] raw = new byte[info.size];
                buffer.get(raw);
                byte[] adts = AudioTransport.addAdtsHeader(raw, AudioTransport.AUDIO_SAMPLE_RATE,
                        AudioTransport.AUDIO_CHANNELS, 2 /* AAC-LC */);
                framesEncoded++;
                bytesEncoded += adts.length;
                Listener l = listener;
                if (l != null) {
                    l.onEncodedFrame(adts, info.presentationTimeUs);
                }
            } catch (IllegalStateException e) {
                Logger.w(TAG, "Audio output raced with stop(): " + e.getMessage());
            } finally {
                try {
                    codec.releaseOutputBuffer(index, false);
                } catch (IllegalStateException ignored) {
                }
            }
        }

        @Override
        public void onError(MediaCodec codec, MediaCodec.CodecException e) {
            Logger.e(TAG, "Audio encoder error", e);
            Listener l = listener;
            if (l != null) {
                l.onError(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }

        @Override
        public void onOutputFormatChanged(MediaCodec codec, MediaFormat format) {
            ByteBuffer csd0 = format.getByteBuffer("csd-0");
            if (csd0 != null) {
                byte[] config = new byte[csd0.remaining()];
                csd0.get(config);
                Listener l = listener;
                if (l != null) {
                    l.onCodecConfig(config);
                }
            } else {
                // Some encoders do not publish csd-0; derive the AudioSpecificConfig
                // from the format we asked for instead of leaving the client blind.
                byte[] fallback = AudioTransport.audioSpecificConfig(
                        AudioTransport.AUDIO_SAMPLE_RATE, AudioTransport.AUDIO_CHANNELS,
                        2 /* AAC-LC */);
                Listener l = listener;
                if (l != null) {
                    l.onCodecConfig(fallback);
                }
            }
        }
    }
}
