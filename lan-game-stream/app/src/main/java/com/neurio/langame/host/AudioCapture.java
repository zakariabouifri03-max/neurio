package com.neurio.langame.host;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.os.Build;

import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Utils;

import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Captures the audio the game is playing.
 *
 * <p><b>What actually works on stock Android (API 29+):</b> playback capture via
 * {@link AudioPlaybackCaptureConfiguration}. It is the supported, non-root way to
 * grab another app's audio, and it is subject to two rules imposed by the
 * platform that we cannot and do not try to bypass:</p>
 * <ol>
 *   <li>The source app can opt out by setting
 *       {@code android:allowAudioPlaybackCapture="false"} in its manifest. If a
 *       game does that, the capture stream is simply silent.</li>
 *   <li>Only usages the capturer asks for are captured (we ask for
 *       {@code USAGE_GAME} and {@code USAGE_MEDIA}).</li>
 * </ol>
 *
 * <p>Below API 29 there is no playback capture at all. Instead of pretending,
 * the host UI reports "audio unavailable" and the session continues video-only.
 * An optional microphone fallback exists for completeness, but it is clearly
 * labelled in the UI because it records the room, not the game.</p>
 */
public final class AudioCapture {

    private static final String TAG = "AudioCapture";

    public static final int SAMPLE_RATE = 48_000;

    public interface Listener {
        /** PCM 16-bit interleaved stereo. */
        void onPcm(ByteBuffer data, int size, long presentationTimeUs);

        /** Capture could not start (or died) — the session continues video-only. */
        void onAudioUnavailable(String reason);

        /**
         * The capture stream has produced nothing but silence for a while, which
         * usually means the game opted out of playback capture.
         */
        void onSilenceDetected();
    }

    public enum Source {PLAYBACK_CAPTURE, MICROPHONE}

    private final Context context;
    private final Listener listener;
    private final Source source;
    private AudioRecord record;
    private Thread thread;
    private final AtomicBoolean running = new AtomicBoolean();
    private long framesCaptured;
    private boolean silenceReported;

    public AudioCapture(Context context, Source source, Listener listener) {
        this.context = context.getApplicationContext();
        this.source = source;
        this.listener = listener;
    }

    /** True when the platform can capture internal audio (API 29+). */
    public static boolean supportsPlaybackCapture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    /**
     * @param projection the live MediaProjection (required for playback capture)
     */
    public boolean start(MediaProjection projection) {
        if (running.get()) {
            return true;
        }
        try {
            int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
            int bufferSize = Math.max(minBuffer * 2, SAMPLE_RATE / 2);   // ~250 ms headroom

            AudioRecord.Builder builder = new AudioRecord.Builder()
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                            .build())
                    .setBufferSizeInBytes(bufferSize);

            if (source == Source.PLAYBACK_CAPTURE) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    listener.onAudioUnavailable("internal audio capture needs Android 10+");
                    return false;
                }
                if (projection == null) {
                    listener.onAudioUnavailable("no MediaProjection available for audio capture");
                    return false;
                }
                AudioPlaybackCaptureConfiguration config =
                        new AudioPlaybackCaptureConfiguration.Builder(projection)
                                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                                .build();
                builder.setAudioPlaybackCaptureConfig(config);
            } else {
                if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    listener.onAudioUnavailable("microphone permission not granted");
                    return false;
                }
                builder.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
            }

            record = builder.build();
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                listener.onAudioUnavailable("AudioRecord failed to initialise");
                release();
                return false;
            }
            record.startRecording();
            running.set(true);
            thread = Utils.startThread("lgs-audio-capture", Thread.NORM_PRIORITY + 1, this::readLoop);
            Logger.i(TAG, "Audio capture started (" + source + ")");
            return true;
        } catch (Throwable t) {
            Logger.e(TAG, "Audio capture failed to start", t);
            listener.onAudioUnavailable(describe(t));
            release();
            return false;
        }
    }

    private static String describe(Throwable t) {
        String message = t.getMessage();
        return t.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private void readLoop() {
        ByteBuffer buffer = ByteBuffer.allocateDirect(SAMPLE_RATE / 20 * 4);   // 50 ms of stereo PCM
        long silenceSince = 0;
        while (running.get()) {
            buffer.clear();
            int read;
            try {
                read = record.read(buffer, buffer.capacity());
            } catch (Exception e) {
                if (running.get()) {
                    Logger.w(TAG, "AudioRecord.read failed: " + e.getMessage());
                }
                break;
            }
            if (read <= 0) {
                Utils.sleepQuietly(5);
                continue;
            }
            buffer.limit(read);
            long presentationTimeUs = framesCaptured * 1_000_000L / SAMPLE_RATE;
            framesCaptured += read / 4;    // 2 channels × 16 bit
            listener.onPcm(buffer, read, presentationTimeUs);

            // Honest silence detection: a game that opted out of playback capture
            // yields an endless stream of digital silence.
            if (!silenceReported && source == Source.PLAYBACK_CAPTURE) {
                if (isSilent(buffer, read)) {
                    if (silenceSince == 0) {
                        silenceSince = System.currentTimeMillis();
                    } else if (System.currentTimeMillis() - silenceSince > 4000) {
                        silenceReported = true;
                        listener.onSilenceDetected();
                    }
                } else {
                    silenceSince = 0;
                }
            }
        }
        Logger.i(TAG, "Audio capture loop ended");
    }

    private static boolean isSilent(ByteBuffer buffer, int size) {
        int peak = 0;
        int position = buffer.position();
        for (int i = 0; i + 1 < size; i += 2) {
            int sample = (short) ((buffer.get(position + i + 1) << 8) | (buffer.get(position + i) & 0xFF));
            peak = Math.max(peak, Math.abs(sample));
        }
        return peak < 8;
    }

    public boolean isRunning() {
        return running.get();
    }

    public void stop() {
        running.set(false);
        if (record != null) {
            try {
                record.stop();
            } catch (Exception ignored) {
            }
        }
        release();
    }

    private void release() {
        if (record != null) {
            try {
                record.release();
            } catch (Exception ignored) {
            }
            record = null;
        }
    }
}
