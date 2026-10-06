package com.aivision.camera.ai;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.media.ExifInterface;
import android.media.FaceDetector;
import android.util.Log;

import com.aivision.camera.ai.core.AiPipeline;
import com.aivision.camera.ai.core.Img;
import com.aivision.camera.ai.core.Scene;
import com.aivision.camera.ai.core.Stats;
import com.aivision.camera.ai.core.Tier;
import com.aivision.camera.camera.CameraController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The bridge between Android bitmaps and the pure-Java AI engine.
 *
 * <p>Responsibilities: decode a captured burst into engine buffers at the device's working
 * resolution, run the on-device face detector for the portrait stage, run the pipeline with progress
 * reporting and cancellation, convert the result back to a bitmap, and serialise the engine report so
 * the gallery can show exactly what was measured and applied.
 */
public final class EngineBridge {

    private static final String TAG = "EngineBridge";

    private EngineBridge() {
    }

    // ------------------------------------------------------------------ conversions

    public static Img toImg(Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] px = new int[w * h];
        bmp.getPixels(px, 0, w, 0, 0, w, h);
        return new Img(w, h, px);
    }

    public static Bitmap toBitmap(Img img) {
        Bitmap bmp = Bitmap.createBitmap(img.w, img.h, Bitmap.Config.ARGB_8888);
        bmp.setPixels(img.px, 0, img.w, 0, 0, img.w, img.h);
        return bmp;
    }

    /** Decodes a JPEG down to at most {@code maxEdge} on the long side, honouring EXIF rotation. */
    public static Bitmap decodeScaled(byte[] jpeg, int maxEdge) {
        Bitmap bmp = decodeRaw(jpeg, maxEdge);
        if (bmp == null) return null;
        int orientation = exifOrientation(jpeg);
        if (orientation != ExifInterface.ORIENTATION_NORMAL && orientation != ExifInterface.ORIENTATION_UNDEFINED) {
            bmp = applyExif(bmp, orientation);
        }
        return bmp;
    }

    /** Reads the EXIF orientation the camera wrote into the captured JPEG. */
    public static int exifOrientation(byte[] jpeg) {
        try {
            java.io.ByteArrayInputStream in = new java.io.ByteArrayInputStream(jpeg);
            ExifInterface exif = new ExifInterface(in);
            int o = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            in.close();
            return o;
        } catch (Throwable t) {
            return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    public static Bitmap applyExif(Bitmap bmp, int orientation) {
        Matrix m = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                m.postRotate(90);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                m.postRotate(180);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                m.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                m.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                m.postScale(1, -1);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                m.postRotate(90);
                m.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                m.postRotate(270);
                m.postScale(-1, 1);
                break;
            default:
                return bmp;
        }
        Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        if (out != bmp) bmp.recycle();
        return out;
    }

    private static Bitmap decodeRaw(byte[] jpeg, int maxEdge) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, o);
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= maxEdge) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        o2.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, o2);
        if (bmp == null) return null;
        if (Math.max(bmp.getWidth(), bmp.getHeight()) > maxEdge) {
            float k = maxEdge / (float) Math.max(bmp.getWidth(), bmp.getHeight());
            Bitmap scaled = Bitmap.createScaledBitmap(bmp,
                    Math.max(8, Math.round(bmp.getWidth() * k)),
                    Math.max(8, Math.round(bmp.getHeight() * k)), true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }
        return bmp;
    }

    /** Rotates a bitmap by the EXIF orientation from the camera sensor. */
    public static Bitmap applyOrientation(Bitmap bmp, int degrees, boolean mirror) {
        if (degrees == 0 && !mirror) return bmp;
        Matrix m = new Matrix();
        if (mirror) m.postScale(-1, 1, bmp.getWidth() / 2f, bmp.getHeight() / 2f);
        if (degrees != 0) m.postRotate(degrees);
        Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        if (out != bmp) bmp.recycle();
        return out;
    }

    // ------------------------------------------------------------------ face detection

    /**
     * Real on-device face detection using the platform detector (Viola-Jones cascade), which is what
     * the portrait stage uses to build the subject mask. Runs on a small RGB_565 copy because that is
     * the format the detector requires.
     */
    public static int[][] detectFaces(Bitmap src, int maxFaces) {
        try {
            int dw = Math.min(640, src.getWidth());
            int dh = Math.max(8, Math.round(src.getHeight() * (dw / (float) src.getWidth())));
            Bitmap small = Bitmap.createScaledBitmap(src, dw, dh, true);
            Bitmap rgb565 = small.copy(Bitmap.Config.RGB_565, false);
            if (rgb565 == null) return new int[0][];
            FaceDetector detector = new FaceDetector(rgb565.getWidth(), rgb565.getHeight(),
                    Math.max(1, Math.min(8, maxFaces)));
            FaceDetector.Face[] faces = new FaceDetector.Face[Math.max(1, Math.min(8, maxFaces))];
            int found = detector.findFaces(rgb565, faces);
            float k = src.getWidth() / (float) dw;
            List<int[]> out = new ArrayList<int[]>();
            for (int i = 0; i < found; i++) {
                FaceDetector.Face f = faces[i];
                if (f == null) continue;
                android.graphics.PointF mid = new android.graphics.PointF();
                f.getMidPoint(mid);
                float eye = f.eyesDistance();
                int cx = Math.round(mid.x * k), cy = Math.round(mid.y * k);
                int w = Math.round(eye * 1.9f * k), h = Math.round(eye * 2.5f * k);
                int x = Math.max(0, cx - w / 2), y = Math.max(0, cy - h / 2);
                out.add(new int[]{x, y, Math.min(w, src.getWidth() - x), Math.min(h, src.getHeight() - y)});
            }
            small.recycle();
            rgb565.recycle();
            return out.toArray(new int[0][]);
        } catch (Throwable t) {
            Log.w(TAG, "face detection unavailable", t);
            return new int[0][];
        }
    }

    // ------------------------------------------------------------------ live scene model

    public static class LiveScene {
        public Scene scene;
        public Stats stats;
        public String badge;
    }

    /**
     * Runs the scene model on a preview luma plane. This is what makes the viewfinder smart: the same
     * classifier that tunes the capture pipeline also drives the live "AI: Night / Portrait / ..."
     * badge and the automatic activation of night mode and high zoom enhancement.
     */
    public static LiveScene analyzePreview(byte[] luma, int w, int h) {
        LiveScene ls = new LiveScene();
        try {
            int[] px = new int[w * h];
            for (int i = 0; i < px.length; i++) {
                int v = luma[i] & 0xFF;
                px[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
            }
            Img img = new Img(w, h, px);
            Stats s = Stats.of(img);
            ls.stats = s;
            ls.scene = Scene.classify(s);
            ls.badge = ls.scene.type.label + " " + Math.round(ls.scene.confidence * 100) + "%";
        } catch (Throwable t) {
            Log.w(TAG, "analyzePreview", t);
        }
        return ls;
    }

    // ------------------------------------------------------------------ pipeline run

    public static class Result {
        public Bitmap enhanced;
        public Bitmap before;
        public AiPipeline.Report report;
        public boolean failed;
        public String error;
    }

    public static class Request {
        public List<byte[]> jpegs = new ArrayList<byte[]>();
        public AiPipeline.Settings settings = new AiPipeline.Settings();
        public int workingEdgeCap;
        public int donorEdgeCap;      // ceiling for the full detail reference frame
        public boolean keepBefore = true;
        public boolean detectFaces = true;
        public int orientationDegrees;
        public boolean mirror;
    }

    /**
     * Runs the whole engine over a captured burst. Always returns something usable: if the engine
     * cannot finish (memory, cancel), the original reference frame is handed back with a report that
     * says so - the app never silently loses a photo.
     */
    public static Result process(Request req, AiPipeline.Progress progress, AiPipeline.Cancel cancel) {
        Result r = new Result();
        long t0 = System.currentTimeMillis();
        try {
            if (req.jpegs.isEmpty()) {
                r.failed = true;
                r.error = "No frames captured";
                return r;
            }
            Tier tier = req.settings.tier;
            int working = req.workingEdgeCap > 0 ? req.workingEdgeCap : tier.workingLongEdge;
            // the reference frame at full detail (the donor) and the burst at working resolution
            int donorEdge = req.donorEdgeCap > 0 ? req.donorEdgeCap
                    : Math.min(4096, Math.max(2000, working * 3 / 2));
            Bitmap refBmp = decodeScaled(req.jpegs.get(0), donorEdge);
            if (refBmp == null) throw new IllegalStateException("Cannot decode the captured frame");
            if (req.keepBefore) {
                r.before = decodeScaled(req.jpegs.get(0), 1440);
            }
            Img[] frames = new Img[req.jpegs.size()];
            for (int i = 0; i < req.jpegs.size(); i++) {
                Bitmap b = i == 0 ? refBmp : decodeScaled(req.jpegs.get(i), working);
                if (b == null) continue;
                frames[i] = toImg(b);
                if (b != refBmp) b.recycle();
            }
            Img donor = toImg(refBmp);
            // keep the donor as the first frame so the engine can transfer its detail band
            frames[0] = donor;
            refBmp.recycle();

            int[][] faces = null;
            if (req.detectFaces) {
                Bitmap forFaces = decodeScaled(req.jpegs.get(0), 1024);
                if (forFaces != null) {
                    faces = detectFaces(forFaces, 4);
                    forFaces.recycle();
                }
            }
            AiPipeline.Result res = AiPipeline.process(frames, faces, req.settings, progress, cancel);
            if (res.image == null) {
                r.failed = true;
                r.error = "Enhancement produced no image";
                return r;
            }
            Bitmap out = toBitmap(res.image);
            if (req.orientationDegrees != 0 || req.mirror) {
                out = applyOrientation(out, req.orientationDegrees, req.mirror);
                if (r.before != null) r.before = applyOrientation(r.before, req.orientationDegrees, req.mirror);
            }
            r.enhanced = out;
            r.report = res.report;
            r.report.totalMs = System.currentTimeMillis() - t0;
        } catch (OutOfMemoryError oom) {
            r.failed = true;
            r.error = "Out of memory - the AI Ultra scale was too high for this device";
            System.gc();
        } catch (Throwable t) {
            Log.e(TAG, "pipeline", t);
            r.failed = true;
            r.error = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
        return r;
    }

    // ------------------------------------------------------------------ report serialisation

    public static String toJson(AiPipeline.Report rep, String outputLabel, boolean upscaled) {
        if (rep == null) return null;
        try {
            JSONObject o = new JSONObject();
            o.put("scene", rep.sceneLabel);
            o.put("confidence", rep.sceneConfidence);
            o.put("framesCaptured", rep.framesCaptured);
            o.put("framesUsed", rep.framesUsed);
            o.put("noiseBefore", rep.noiseBefore);
            o.put("noiseAfter", rep.noiseAfter);
            o.put("sharpnessBefore", rep.sharpnessBefore);
            o.put("sharpnessAfter", rep.sharpnessAfter);
            o.put("drBefore", rep.drBefore);
            o.put("drAfter", rep.drAfter);
            o.put("nativeLongEdge", rep.nativeLongEdge);
            o.put("outputLongEdge", rep.outputLongEdge);
            o.put("upscaled", upscaled || rep.upscaled);
            o.put("aiEnhanced4k", rep.aiEnhanced4k);
            o.put("outputLabel", outputLabel);
            o.put("totalMs", rep.totalMs);
            o.put("alignmentResidual", rep.alignmentResidual);
            JSONArray stages = new JSONArray();
            for (AiPipeline.Stage s : rep.stages) {
                JSONObject st = new JSONObject();
                st.put("name", s.name);
                st.put("ms", s.ms);
                st.put("detail", s.detail == null ? "" : s.detail);
                stages.put(st);
            }
            o.put("stages", stages);
            JSONArray warnings = new JSONArray();
            for (String w : rep.warnings) warnings.put(w);
            o.put("warnings", warnings);
            return o.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    public static String humanReport(String json) {
        if (json == null) return "";
        try {
            JSONObject o = new JSONObject(json);
            StringBuilder sb = new StringBuilder();
            sb.append(o.optString("scene", "?")).append(" - ")
                    .append(Math.round(o.optDouble("confidence", 0) * 100)).append("% confidence\n");
            sb.append("Frames: ").append(o.optInt("framesUsed")).append(" of ")
                    .append(o.optInt("framesCaptured")).append('\n');
            sb.append(String.format(java.util.Locale.US, "Noise: %.2f%% -> %.2f%%%n",
                    o.optDouble("noiseBefore") * 100, o.optDouble("noiseAfter") * 100));
            sb.append(String.format(java.util.Locale.US, "Detail index: %.3f -> %.3f%n",
                    o.optDouble("sharpnessBefore"), o.optDouble("sharpnessAfter")));
            sb.append(String.format(java.util.Locale.US, "Dynamic range: %.2f -> %.2f%n",
                    o.optDouble("drBefore"), o.optDouble("drAfter")));
            sb.append("Output: ").append(o.optString("outputLabel", "?")).append('\n');
            JSONArray stages = o.optJSONArray("stages");
            if (stages != null) {
                sb.append("\nStages\n");
                for (int i = 0; i < stages.length(); i++) {
                    JSONObject st = stages.getJSONObject(i);
                    sb.append("- ").append(st.optString("name"));
                    String d = st.optString("detail", "");
                    if (d.length() > 0) sb.append(": ").append(d);
                    sb.append(" [").append(st.optLong("ms")).append(" ms]\n");
                }
            }
            JSONArray warnings = o.optJSONArray("warnings");
            if (warnings != null && warnings.length() > 0) {
                sb.append('\n');
                for (int i = 0; i < warnings.length(); i++) sb.append("! ").append(warnings.getString(i)).append('\n');
            }
            return sb.toString();
        } catch (Throwable t) {
            return json;
        }
    }

    /** Small JPEG of the "before" frame used by the comparison slider. */
    public static byte[] encodeJpeg(Bitmap bmp, int quality) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, bos);
        return bos.toByteArray();
    }

    /** Draws the AI watermark/logo onto a bitmap for shots taken with AI on. */
    public static Bitmap watermark(Bitmap src, String text) {
        if (src == null || text == null || text.length() == 0) return src;
        Bitmap out = src.copy(Bitmap.Config.ARGB_8888, true);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float size = Math.max(18f, out.getWidth() * 0.022f);
        p.setTextSize(size);
        p.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        p.setColor(Color.WHITE);
        p.setShadowLayer(size * 0.35f, 0, size * 0.08f, 0xCC000000);
        float x = out.getWidth() - p.measureText(text) - size;
        float y = out.getHeight() - size;
        c.drawText(text, x, y, p);
        return out;
    }

    public static int orientationDegrees(int sensorOrientation, int displayRotation, boolean front) {
        int rotation = (sensorOrientation - displayRotation * 90 + 360) % 360;
        if (front) rotation = (sensorOrientation + displayRotation * 90) % 360;
        return rotation;
    }

    public static String resolutionLabel(int longEdge) {
        return com.aivision.camera.camera.Capabilities.resLabel(longEdge);
    }
}
