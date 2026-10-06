package com.aivision.camera.media;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.Image;
import android.util.Log;

import com.aivision.camera.ai.core.AiPipeline;
import com.aivision.camera.ai.core.Img;
import com.aivision.camera.ai.core.Tier;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A real AI video pass: the recorded file is decoded on device, every frame is run through the same
 * computational photography engine used for photos, and the result is re-encoded at up to 4K with the
 * audio track copied through untouched.
 *
 * <p>If the device's encoder cannot accept raw frames, or anything else fails, the original recording
 * is left exactly as it is and the caller is told why - the app never replaces a good video with a
 * broken one, and it never labels an upscale as native.
 */
public final class VideoEnhancer {

    private static final String TAG = "VideoEnhancer";
    private static final int TIMEOUT_US = 10000;

    public interface Progress {
        void onProgress(float fraction, String stage);
    }

    public interface Done {
        void onDone(File output, String label, String error);
    }

    public static class Config {
        public int targetLongEdge = 3840;
        public int bitrate = 0;              // 0 = derive from resolution
        public boolean ultra = true;
        public boolean withAudio = true;
        public Tier tier = Tier.HIGH;
        public int workingLongEdge = 960;     // per frame AI working resolution
        public int maxFrames = 0;             // 0 = all frames
    }

    private VideoEnhancer() {
    }

    public static void enhance(File in, File out, Config cfg, Progress progress, Done done,
                               AtomicBoolean cancel) {
        MediaExtractor vEx = new MediaExtractor();
        MediaExtractor aEx = null;
        MediaCodec dec = null;
        MediaCodec enc = null;
        MediaMuxer mux = null;
        String error = null;
        String label = null;
        File result = null;
        try {
            vEx.setDataSource(in.getAbsolutePath());
            int vTrack = -1;
            for (int i = 0; i < vEx.getTrackCount(); i++) {
                MediaFormat f = vEx.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    vTrack = i;
                    break;
                }
            }
            if (vTrack < 0) throw new IllegalStateException("No video track in the recording");
            MediaFormat vFormat = vEx.getTrackFormat(vTrack);
            vEx.selectTrack(vTrack);
            int srcW = vFormat.getInteger(MediaFormat.KEY_WIDTH);
            int srcH = vFormat.getInteger(MediaFormat.KEY_HEIGHT);
            int rotation = vFormat.containsKey(MediaFormat.KEY_ROTATION)
                    ? vFormat.getInteger(MediaFormat.KEY_ROTATION) : 0;
            long durationUs = vFormat.containsKey(MediaFormat.KEY_DURATION)
                    ? vFormat.getLong(MediaFormat.KEY_DURATION) : 0L;

            // the encoder works at a target size; the AI does the upscaling on the way there
            int longEdge = Math.max(srcW, srcH);
            int outLong = Math.max(longEdge, align2(cfg.targetLongEdge));
            float k = outLong / (float) longEdge;
            int outW = align2((int) (srcW * k)), outH = align2((int) (srcH * k));
            int workEdge = Math.min(longEdge, Math.max(480, cfg.workingLongEdge));
            float wk = workEdge / (float) longEdge;
            int workW = align2((int) (srcW * wk)), workH = align2((int) (srcH * wk));
            int frameRate = vFormat.containsKey(MediaFormat.KEY_FRAME_RATE)
                    ? vFormat.getInteger(MediaFormat.KEY_FRAME_RATE) : 30;
            if (frameRate <= 0) frameRate = 30;

            if (progress != null) progress.onProgress(0f, "Decoding " + srcW + "x" + srcH);

            // ---- audio track (copied bit for bit)
            MediaFormat aFormat = null;
            if (cfg.withAudio) {
                aEx = new MediaExtractor();
                aEx.setDataSource(in.getAbsolutePath());
                for (int i = 0; i < aEx.getTrackCount(); i++) {
                    MediaFormat f = aEx.getTrackFormat(i);
                    String mime = f.getString(MediaFormat.KEY_MIME);
                    if (mime != null && mime.startsWith("audio/")) {
                        aFormat = f;
                        aEx.selectTrack(i);
                        break;
                    }
                }
                if (aFormat == null && aEx != null) {
                    aEx.release();
                    aEx = null;
                }
            }

            // ---- decoder
            dec = MediaCodec.createDecoderByType(vFormat.getString(MediaFormat.KEY_MIME));
            dec.configure(vFormat, null, null, 0);
            dec.start();

            // ---- encoder
            String encMime = "video/avc";
            enc = MediaCodec.createEncoderByType(encMime);
            MediaFormat ef = MediaFormat.createVideoFormat(encMime, outW, outH);
            ef.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar);
            int bitrate = cfg.bitrate > 0 ? cfg.bitrate : bitrateFor(outW, outH, frameRate);
            ef.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
            ef.setInteger(MediaFormat.KEY_FRAME_RATE, frameRate);
            ef.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2);
            enc.configure(ef, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            enc.start();

            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if (rotation != 0) {
                try {
                    mux.setOrientationHint(rotation);
                } catch (Throwable ignored) {
                }
            }
            int aMuxTrack = -1;
            if (aFormat != null) {
                try {
                    aMuxTrack = mux.addTrack(aFormat);
                } catch (Throwable t) {
                    Log.w(TAG, "audio track not accepted", t);
                }
            }

            AiPipeline.Settings st = new AiPipeline.Settings();
            st.tier = cfg.tier;
            st.enhance = true;
            st.useBurst = false;
            st.requestedFrames = 1;
            st.keepFullResolution = false;
            st.workingLongEdge = workEdge;
            st.maxOutputLongEdge = outLong;
            st.ultra = cfg.ultra && outLong > workEdge;
            st.ultraScale = outLong > workEdge ? (int) clampScale(outLong / (float) workEdge, cfg.tier) : 1;
            st.autoHaze = true;
            st.strength = 1f;

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inEos = false, outEos = false;
            int videoTrack = -1;
            long frames = 0, processed = 0;
            byte[] nv12 = new byte[outW * outH * 3 / 2];

            while (!outEos && !(cancel != null && cancel.get())) {
                if (!inEos) {
                    int inIdx = dec.dequeueInputBuffer(TIMEOUT_US);
                    if (inIdx >= 0) {
                        ByteBuffer buf = dec.getInputBuffer(inIdx);
                        int size = vEx.readSampleData(buf, 0);
                        if (size < 0) {
                            dec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inEos = true;
                        } else {
                            dec.queueInputBuffer(inIdx, 0, size, vEx.getSampleTime(), 0);
                            vEx.advance();
                        }
                    }
                }
                int outIdx = dec.dequeueOutputBuffer(info, TIMEOUT_US);
                if (outIdx >= 0) {
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outEos = true;
                    if (info.size > 0 || true) {
                        Image img = null;
                        try {
                            img = dec.getOutputImage(outIdx);
                        } catch (Throwable t) {
                            Log.w(TAG, "decoder image unavailable", t);
                        }
                        if (img != null) {
                            Img frame = yuvToImg(img, workW, workH);
                            if (frame != null && (cfg.maxFrames == 0 || frames < cfg.maxFrames)) {
                                AiPipeline.Result res = AiPipeline.process(new Img[]{frame}, null, st, null, null);
                                Img outp = res != null && res.image != null ? res.image : frame;
                                if (outp.w != outW || outp.h != outH) outp = outp.scaled(outW, outH);
                                nv12 = imgToNv12(outp, nv12);
                                if (!encodeFrame(enc, nv12, outW, outH, info.presentationTimeUs, outW * outH))
                                    throw new IllegalStateException("Encoder rejected a frame");
                                processed++;
                            }
                            frames++;
                            if (progress != null && durationUs > 0) {
                                progress.onProgress(Math.min(0.98f, info.presentationTimeUs / (float) durationUs),
                                        "AI frame " + processed + "  (" + outW + "x" + outH + ")");
                            }
                        }
                    }
                    dec.releaseOutputBuffer(outIdx, false);
                }
                // drain the encoder
                while (true) {
                    MediaCodec.BufferInfo ei = new MediaCodec.BufferInfo();
                    int idx = enc.dequeueOutputBuffer(ei, 0);
                    if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) break;
                    if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        videoTrack = mux.addTrack(enc.getOutputFormat());
                        mux.start();
                        continue;
                    }
                    if (idx < 0) continue;
                    if (videoTrack < 0) {
                        // some encoders emit data before the format change; start the muxer now
                        videoTrack = mux.addTrack(enc.getOutputFormat());
                        mux.start();
                    }
                    ByteBuffer eb = enc.getOutputBuffer(idx);
                    if (eb != null && ei.size > 0 && (ei.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        eb.position(ei.offset);
                        eb.limit(ei.offset + ei.size);
                        mux.writeSampleData(videoTrack, eb, ei);
                    }
                    enc.releaseOutputBuffer(idx, false);
                    if ((ei.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outEos = true;
                        break;
                    }
                }
                if (cancel != null && cancel.get()) break;
            }

            if (cancel != null && cancel.get()) {
                error = "Cancelled";
            } else {
                // flush the encoder
                int idx = enc.dequeueInputBuffer(TIMEOUT_US * 10);
                if (idx >= 0) enc.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                long guard = System.currentTimeMillis() + 15000;
                while (System.currentTimeMillis() < guard) {
                    MediaCodec.BufferInfo ei = new MediaCodec.BufferInfo();
                    int oi = enc.dequeueOutputBuffer(ei, TIMEOUT_US);
                    if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (videoTrack < 0) {
                            videoTrack = mux.addTrack(enc.getOutputFormat());
                            mux.start();
                        }
                        continue;
                    }
                    if (oi < 0) {
                        if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) break;
                        continue;
                    }
                    ByteBuffer eb = enc.getOutputBuffer(oi);
                    if (eb != null && ei.size > 0 && (ei.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && videoTrack >= 0) {
                        eb.position(ei.offset);
                        eb.limit(ei.offset + ei.size);
                        mux.writeSampleData(videoTrack, eb, ei);
                    }
                    enc.releaseOutputBuffer(oi, false);
                    if ((ei.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                }

                // ---- copy the audio samples through
                if (aEx != null && aMuxTrack >= 0) {
                    if (progress != null) progress.onProgress(0.99f, "Copying audio");
                    ByteBuffer ab = ByteBuffer.allocate(512 * 1024);
                    MediaCodec.BufferInfo ai = new MediaCodec.BufferInfo();
                    while (true) {
                        int size = aEx.readSampleData(ab, 0);
                        if (size < 0) break;
                        ai.set(0, size, aEx.getSampleTime(),
                                (aEx.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                                        ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0);
                        ab.position(0);
                        ab.limit(size);
                        mux.writeSampleData(aMuxTrack, ab, ai);
                        aEx.advance();
                    }
                }
                label = (outLong >= 3800 ? "4K" : (outLong >= 2500 ? "2K" : (outLong >= 1800 ? "1080p" : outW + "x" + outH)));
                if (outLong > longEdge) label = "AI Enhanced " + label + " (upscaled from " + (longEdge >= 3800 ? "4K" : longEdge >= 2500 ? "2K" : longEdge >= 1800 ? "1080p" : longEdge + "p") + ")";
                result = out;
                if (progress != null) progress.onProgress(1f, "Done - " + label);
            }
        } catch (Throwable t) {
            Log.e(TAG, "enhance failed", t);
            error = t.getClass().getSimpleName() + ": " + t.getMessage();
        } finally {
            try {
                if (enc != null) {
                    enc.stop();
                    enc.release();
                }
            } catch (Throwable ignored) {
            }
            try {
                if (dec != null) {
                    dec.stop();
                    dec.release();
                }
            } catch (Throwable ignored) {
            }
            try {
                if (mux != null) mux.stop();
            } catch (Throwable ignored) {
            }
            try {
                if (mux != null) mux.release();
            } catch (Throwable ignored) {
            }
            try {
                vEx.release();
            } catch (Throwable ignored) {
            }
            try {
                if (aEx != null) aEx.release();
            } catch (Throwable ignored) {
            }
            if (error != null && result != null) {
                result.delete();
                result = null;
            }
            if (done != null) done.onDone(result, label, error);
        }
    }

    private static boolean encodeFrame(MediaCodec enc, byte[] nv12, int w, int h, long ptsUs, int ySize) {
        int idx = enc.dequeueInputBuffer(TIMEOUT_US * 10);
        if (idx < 0) return false;
        ByteBuffer buf = enc.getInputBuffer(idx);
        if (buf == null) return false;
        buf.clear();
        int need = w * h * 3 / 2;
        if (buf.capacity() < need) return false;
        buf.put(nv12, 0, Math.min(need, nv12.length));
        enc.queueInputBuffer(idx, 0, need, ptsUs, 0);
        return true;
    }

    private static int align2(int v) {
        return Math.max(2, (v / 2) * 2);
    }

    private static int bitrateFor(int w, int h, int fps) {
        // about 0.09 bits per pixel per frame, clamped to something sane for phones
        long bps = (long) (w * (long) h * fps * 0.09);
        bps = Math.max(6_000_000L, Math.min(80_000_000L, bps));
        return (int) bps;
    }

    private static float clampScale(float scale, Tier tier) {
        return Math.max(1f, Math.min(tier.maxUltraScale, scale));
    }

    /** Reads a decoder output image (any YUV420 layout) into a packed RGB engine image. */
    public static Img yuvToImg(Image image, int outW, int outH) {
        try {
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer yB = planes[0].getBuffer();
            int yRow = planes[0].getRowStride(), yPix = planes[0].getPixelStride();
            ByteBuffer uB, vB;
            int uRow, uPix, vRow, vPix;
            if (planes.length == 1) {
                // semi planar packed in one plane: UV follows Y
                uB = yB;
                uRow = yRow;
                uPix = 2;
                vB = yB;
                vRow = yRow;
                vPix = 2;
            } else if (planes.length == 2) {
                uB = planes[1].getBuffer();
                uRow = planes[1].getRowStride();
                uPix = Math.max(1, planes[1].getPixelStride());
                vB = uB;
                vRow = uRow;
                vPix = uPix;
            } else {
                uB = planes[1].getBuffer();
                uRow = planes[1].getRowStride();
                uPix = Math.max(1, planes[1].getPixelStride());
                vB = planes[2].getBuffer();
                vRow = planes[2].getRowStride();
                vPix = Math.max(1, planes[2].getPixelStride());
            }
            int srcW = image.getWidth(), srcH = image.getHeight();
            int[] px = new int[outW * outH];
            for (int y = 0; y < outH; y++) {
                int sy = (int) ((long) y * srcH / outH);
                for (int x = 0; x < outW; x++) {
                    int sx = (int) ((long) x * srcW / outW);
                    int yy = yB.get(Math.min(yB.capacity() - 1, sy * yRow + sx * yPix)) & 0xFF;
                    int uu = uB.get(Math.min(uB.capacity() - 1, (sy / 2) * uRow + (sx / 2) * uPix)) & 0xFF;
                    int vv = vB.get(Math.min(vB.capacity() - 1, (sy / 2) * vRow + (sx / 2) * vPix)) & 0xFF;
                    int c = yy - 16, d = uu - 128, e = vv - 128;
                    if (c < 0) c = 0;
                    int r = (298 * c + 409 * e + 128) >> 8;
                    int g = (298 * c - 100 * d - 208 * e + 128) >> 8;
                    int b = (298 * c + 516 * d + 128) >> 8;
                    px[y * outW + x] = Img.rgb(Img.clamp255(r), Img.clamp255(g), Img.clamp255(b));
                }
            }
            return new Img(outW, outH, px);
        } catch (Throwable t) {
            Log.w(TAG, "yuvToImg", t);
            return null;
        }
    }

    /** Packs an RGB image into NV12 (the layout phone encoders accept for raw input). */
    public static byte[] imgToNv12(Img img, byte[] reuse) {
        int w = img.w, h = img.h;
        int need = w * h * 3 / 2;
        byte[] out = (reuse != null && reuse.length >= need) ? reuse : new byte[need];
        int ySize = w * h;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int c = img.px[y * w + x];
                int r = Img.R(c), g = Img.G(c), b = Img.B(c);
                int yy = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                out[y * w + x] = (byte) Img.clamp255(yy);
            }
        }
        for (int y = 0; y < h; y += 2) {
            for (int x = 0; x < w; x += 2) {
                int r = 0, g = 0, b = 0, n = 0;
                for (int dy = 0; dy < 2 && y + dy < h; dy++) {
                    for (int dx = 0; dx < 2 && x + dx < w; dx++) {
                        int c = img.px[(y + dy) * w + (x + dx)];
                        r += Img.R(c);
                        g += Img.G(c);
                        b += Img.B(c);
                        n++;
                    }
                }
                r /= n;
                g /= n;
                b /= n;
                int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                int base = ySize + (y / 2) * w + x;
                if (base < need) out[base] = (byte) Img.clamp255(u);
                if (base + 1 < need) out[base + 1] = (byte) Img.clamp255(v);
            }
        }
        return out;
    }
}
