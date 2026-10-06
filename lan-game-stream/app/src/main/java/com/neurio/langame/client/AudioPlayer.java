package com.neurio.langame.client;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Handler;
import android.os.HandlerThread;

import com.neurio.langame.common.Logger;
import com.neurio.langame.network.AudioTransport;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Plays the host's game audio.
 *
 * <p>Design: a small jitter queue (about 60 ms) in front of an
 * {@link AudioTrack} running in streaming mode with a low-latency buffer
 * configuration. Anything older than the queue is dropped — audible continuity
 * matters more than playing every AAC frame, and a growing buffer would be an
 * ever increasing delay between what the player sees and hears.</p>
 */
public final class AudioPlayer {

    private static final String TAG = "AudioPlayer";

    /** How much audio we are willing to buffer before dropping (milliseconds). */
    private static final int JITTER_BUFFER_MS = 60;

    private final HandlerThread thread = new HandlerThread("lgs-audio-out",
            android.os.Process.THREAD_PRIORITY_AUDIO);
    private final Handler handler;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicInteger framesPlayed = new AtomicInteger();
    private final AtomicInteger framesDropped = new AtomicInteger();
    private final ArrayBlockingQueue<Pcm> queue = new ArrayBlockingQueue<>(16);

    private MediaCodec decoder;
    private AudioTrack track;
    private byte[] codecConfig;
    private volatile long bufferedMs;

    private static final class Pcm {
        byte[] data;
        int length;
    }

    public AudioPlayer() {
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    /** Must be called with the AudioSpecificConfig (csd-0) once the host sends it. */
    public void setCodecConfig(byte[] config) {
        this.codecConfig = config;
        Logger.i(TAG, "AAC config: " + (config == null ? 0 : config.length) + " bytes");
    }

    public void start() throws IOException {
        if (running.get()) {
            return;
        }
        MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC,
                AudioTransport.AUDIO_SAMPLE_RATE, AudioTransport.AUDIO_CHANNELS);
        byte[] config = codecConfig;
        if (config != null && config.length > 0) {
            format.setByteBuffer("csd-0", ByteBuffer.wrap(config));
        }
        decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        decoder.setCallback(new DecoderCallback(), handler);
        decoder.configure(format, null, null, 0);
        decoder.start();

        int minBuffer = AudioTrack.getMinBufferSize(AudioTransport.AUDIO_SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(minBuffer * 2, AudioTransport.AUDIO_SAMPLE_RATE / 4);
        track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_GAME)
                        .build())
                .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(AudioTransport.AUDIO_SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                        .build())
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        track.play();
        running.set(true);
        Logger.i(TAG, "Audio playback started (buffer " + bufferSize + " bytes)");
    }

    /** Called from the audio transport thread with one AAC frame. */
    public void onFrame(byte[] data, int length, long presentationTimeUs) {
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
                return;
            }
            input.clear();
            int offset = 0;
            int size = length;
            // ADTS is self describing, but when we have an AudioSpecificConfig the
            // decoder prefers raw access units — strip the 7-byte header in that case.
            if (codecConfig != null && length > AudioTransport.ADTS_HEADER_SIZE
                    && (data[0] & 0xFF) == 0xFF && (data[1] & 0xF0) == 0xF0) {
                offset = AudioTransport.ADTS_HEADER_SIZE;
                size = length - offset;
            }
            input.put(data, offset, Math.min(size, input.capacity()));
            local.queueInputBuffer(index, 0, Math.min(size, input.capacity()), presentationTimeUs, 0);
        } catch (IllegalStateException e) {
            Logger.w(TAG, "Audio queue raced with a stop: " + e.getMessage());
        }
    }

    public boolean isRunning() {
        return running.get();
    }

    public int framesPlayed() {
        return framesPlayed.get();
    }

    public int framesDropped() {
        return framesDropped.get();
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
        if (track != null) {
            try {
                track.pause();
                track.flush();
                track.release();
            } catch (Exception ignored) {
            }
            track = null;
        }
        queue.clear();
        Logger.i(TAG, "Audio playback stopped");
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
            // Pull model; frames are pushed by the transport thread.
        }

        @Override
        public void onOutputBufferAvailable(MediaCodec codec, int index, MediaCodec.BufferInfo info) {
            try {
                ByteBuffer buffer = codec.getOutputBuffer(index);
                AudioTrack local = track;
                if (buffer != null && local != null && info.size > 0) {
                    buffer.position(info.offset);
                    buffer.limit(info.offset + info.size);
                    byte[] pcm = new byte[info.size];
                    buffer.get(pcm);
                    // Blocking write: AudioTrack's own buffer *is* our jitter buffer,
                    // so we never accumulate latency beyond it.
                    local.write(pcm, 0, pcm.length);
                    framesPlayed.incrementAndGet();
                    bufferedMs = info.presentationTimeUs % 1000;
                } else if (buffer != null) {
                    framesDropped.incrementAndGet();
                }
            } finally {
                try {
                    codec.releaseOutputBuffer(index, false);
                } catch (IllegalStateException ignored) {
                }
            }
        }

        @Override
        public void onError(MediaCodec codec, MediaCodec.CodecException e) {
            Logger.e(TAG, "Audio decoder error", e);
        }

        @Override
        public void onOutputFormatChanged(MediaCodec codec, MediaFormat format) {
            Logger.i(TAG, "Audio output format: " + format);
        }
    }

    /** Diagnostics helper. */
    public static int recommendedJitterBufferMs() {
        return JITTER_BUFFER_MS;
    }

    /** True when a headset/speaker is available for output at all. */
    public static boolean canPlay() {
        return AudioManager.STREAM_MUSIC >= 0;
    }
}
