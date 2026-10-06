package com.aivision.camera.ui;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * Vector icon set drawn directly on the canvas. No image assets, no icon font: every glyph is a path
 * in a 24x24 design space scaled to the requested size, so the UI stays crisp at any density and the
 * APK stays tiny.
 */
public final class Icons {

    private Icons() {
    }

    public static final String SHUTTER = "shutter";
    public static final String RECORD = "record";
    public static final String STOP = "stop";
    public static final String FLASH_AUTO = "flash_auto";
    public static final String FLASH_ON = "flash_on";
    public static final String FLASH_OFF = "flash_off";
    public static final String TORCH = "torch";
    public static final String SWITCH = "switch";
    public static final String GALLERY = "gallery";
    public static final String SETTINGS = "settings";
    public static final String GRID = "grid";
    public static final String TIMER = "timer";
    public static final String CLOSE = "close";
    public static final String CHECK = "check";
    public static final String TRASH = "trash";
    public static final String SHARE = "share";
    public static final String INFO = "info";
    public static final String COMPARE = "compare";
    public static final String ENHANCE = "enhance";
    public static final String ULTRA = "ultra";
    public static final String PHOTO = "photo";
    public static final String VIDEO = "video";
    public static final String PRO = "pro";
    public static final String NIGHT = "night";
    public static final String AI = "ai";
    public static final String PANORAMA = "panorama";
    public static final String DOC = "doc";
    public static final String MACRO = "macro";
    public static final String TIMELAPSE = "timelapse";
    public static final String PORTRAIT = "portrait";
    public static final String ZOOM_IN = "zoom_in";
    public static final String ZOOM_OUT = "zoom_out";
    public static final String LOCK = "lock";
    public static final String CHEVRON_LEFT = "chevron_left";
    public static final String CHEVRON_RIGHT = "chevron_right";
    public static final String DOWNLOAD = "download";
    public static final String PLAY = "play";
    public static final String EXPOSURE = "exposure";
    public static final String FOCUS = "focus";
    public static final String WB = "wb";
    public static final String SPEED = "speed";
    public static final String ISO = "iso";
    public static final String SAVE = "save";
    public static final String RAW = "raw";
    public static final String HDR = "hdr";

    /** Draws {@code name} centred in a {@code size x size} box whose top-left is (0,0). */
    public static void draw(Canvas c, String name, float size, Paint p) {
        c.save();
        float k = size / 24f;
        c.scale(k, k);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.9f);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        deliver(c, name, p);
        c.restore();
    }

    private static void deliver(Canvas c, String n, Paint p) {
        Path path = new Path();
        if (SHUTTER.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 8.2f, p);
            c.drawCircle(12, 12, 4.0f, p);
            path.moveTo(12, 3.8f);
            path.lineTo(12, 0.8f);
            c.drawPath(path, p);
            return;
        }
        if (RECORD.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            c.drawCircle(12, 12, 7.6f, p);
            return;
        }
        if (STOP.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            c.drawRoundRect(new RectF(7.5f, 7.5f, 16.5f, 16.5f), 2f, 2f, p);
            return;
        }
        if (FLASH_AUTO.equals(n) || FLASH_ON.equals(n) || FLASH_OFF.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            path.moveTo(14f, 2f);
            path.lineTo(7f, 13f);
            path.lineTo(11f, 13f);
            path.lineTo(9.6f, 22f);
            path.lineTo(17f, 10.5f);
            path.lineTo(12.8f, 10.5f);
            path.close();
            c.drawPath(path, p);
            if (FLASH_OFF.equals(n)) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(2.1f);
                c.drawLine(3.5f, 20.5f, 20.5f, 3.5f, p);
            } else if (FLASH_AUTO.equals(n)) {
                p.setStyle(Paint.Style.STROKE);
                p.setTextSize(9f);
                c.drawText("A", 17.5f, 8.5f, p);
            }
            return;
        }
        if (TORCH.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            path.moveTo(8f, 2f);
            path.lineTo(16f, 2f);
            path.lineTo(15f, 8f);
            path.lineTo(14.2f, 22f);
            path.lineTo(9.8f, 22f);
            path.lineTo(9f, 8f);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (SWITCH.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 8.4f, p);
            p.setStyle(Paint.Style.FILL);
            path.addCircle(10.4f, 12f, 4.6f, Path.Direction.CW);
            c.save();
            c.clipPath(path);
            c.drawCircle(13.6f, 12f, 4.6f, p);
            c.restore();
            p.setStyle(Paint.Style.STROKE);
            path.reset();
            path.moveTo(3.4f, 12f);
            path.lineTo(20.6f, 12f);
            c.drawPath(path, p);
            return;
        }
        if (GALLERY.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRoundRect(new RectF(3f, 4.4f, 21f, 19.6f), 2.4f, 2.4f, p);
            p.setStyle(Paint.Style.FILL);
            path.moveTo(6f, 16.6f);
            path.lineTo(10.4f, 11.2f);
            path.lineTo(13.6f, 15.2f);
            path.lineTo(16.2f, 12.6f);
            path.lineTo(18.4f, 16.6f);
            path.close();
            c.drawPath(path, p);
            c.drawCircle(16.6f, 8.6f, 1.5f, p);
            return;
        }
        if (SETTINGS.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 3.3f, p);
            for (int i = 0; i < 8; i++) {
                double a = Math.PI * i / 4.0;
                float x1 = (float) (12 + Math.cos(a) * 6.2), y1 = (float) (12 + Math.sin(a) * 6.2);
                float x2 = (float) (12 + Math.cos(a) * 8.9), y2 = (float) (12 + Math.sin(a) * 8.9);
                c.drawLine(x1, y1, x2, y2, p);
            }
            return;
        }
        if (GRID.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRect(3.5f, 3.5f, 20.5f, 20.5f, p);
            c.drawLine(9.2f, 3.5f, 9.2f, 20.5f, p);
            c.drawLine(14.8f, 3.5f, 14.8f, 20.5f, p);
            c.drawLine(3.5f, 9.2f, 20.5f, 9.2f, p);
            c.drawLine(3.5f, 14.8f, 20.5f, 14.8f, p);
            return;
        }
        if (TIMER.equals(n) || TIMELAPSE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 13.6f, 7.4f, p);
            c.drawLine(12, 9.6f, 12, 13.8f, p);
            c.drawLine(12, 13.8f, 15f, 15.6f, p);
            c.drawLine(9.4f, 3.2f, 14.6f, 3.2f, p);
            if (TIMELAPSE.equals(n)) {
                c.drawLine(12, 3.2f, 12, 5.6f, p);
                for (int i = 0; i < 3; i++) c.drawCircle(18 + i * 2.6f, 6f + i * 2.3f, 0.7f, p);
            } else {
                path.moveTo(18.4f, 5.4f);
                path.lineTo(20.4f, 7.4f);
                path.lineTo(18.4f, 9.4f);
                c.drawPath(path, p);
            }
            return;
        }
        if (CLOSE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.2f);
            c.drawLine(5.5f, 5.5f, 18.5f, 18.5f, p);
            c.drawLine(18.5f, 5.5f, 5.5f, 18.5f, p);
            return;
        }
        if (CHECK.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.4f);
            path.moveTo(4.6f, 12.8f);
            path.lineTo(9.8f, 18f);
            path.lineTo(19.4f, 6.4f);
            c.drawPath(path, p);
            return;
        }
        if (TRASH.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(4.5f, 6.6f, 19.5f, 6.6f, p);
            c.drawRoundRect(new RectF(6.4f, 6.6f, 17.6f, 20.4f), 1.8f, 1.8f, p);
            c.drawLine(9.6f, 3.6f, 14.4f, 3.6f, p);
            c.drawLine(10.2f, 10f, 10.2f, 17f, p);
            c.drawLine(13.8f, 10f, 13.8f, 17f, p);
            return;
        }
        if (SHARE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(6.2f, 12f, 2.6f, p);
            c.drawCircle(17.4f, 6.2f, 2.6f, p);
            c.drawCircle(17.4f, 17.8f, 2.6f, p);
            c.drawLine(8.5f, 10.8f, 15.2f, 7.4f, p);
            c.drawLine(8.5f, 13.2f, 15.2f, 16.6f, p);
            return;
        }
        if (INFO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 8.6f, p);
            p.setStyle(Paint.Style.FILL);
            c.drawCircle(12, 7.6f, 1.15f, p);
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(12, 10.8f, 12, 16.6f, p);
            return;
        }
        if (COMPARE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRect(3.2f, 5f, 20.8f, 19f, p);
            c.drawLine(12, 5f, 12, 19f, p);
            p.setStyle(Paint.Style.FILL);
            path.moveTo(6.5f, 15.5f);
            path.lineTo(10f, 11f);
            path.lineTo(10f, 15.5f);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (ENHANCE.equals(n) || ULTRA.equals(n) || AI.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            sparkle(c, p, 8.6f, 9.4f, ULTRA.equals(n) ? 5.6f : 5.0f);
            sparkle(c, p, 16.4f, 15.6f, ULTRA.equals(n) ? 3.6f : 3.2f);
            sparkle(c, p, 15.2f, 6.4f, 2.2f);
            if (ULTRA.equals(n)) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(2.0f);
                path.moveTo(12, 21.6f);
                path.lineTo(12, 16.4f);
                path.moveTo(9.4f, 18.6f);
                path.lineTo(12, 16.2f);
                path.lineTo(14.6f, 18.6f);
                c.drawPath(path, p);
            }
            return;
        }
        if (PHOTO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12.6f, 7.4f, p);
            c.drawLine(9.6f, 2.6f, 14.4f, 2.6f, p);
            c.drawLine(12, 2.8f, 12, 5.4f, p);
            return;
        }
        if (VIDEO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRoundRect(new RectF(2.6f, 6.4f, 15.4f, 17.6f), 2.4f, 2.4f, p);
            path.moveTo(16.6f, 10.6f);
            path.lineTo(21.4f, 7.4f);
            path.lineTo(21.4f, 16.6f);
            path.lineTo(16.6f, 13.4f);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (PRO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(4f, 7.4f, 20f, 7.4f, p);
            c.drawLine(4f, 16.6f, 20f, 16.6f, p);
            p.setStyle(Paint.Style.FILL);
            c.drawCircle(9f, 7.4f, 2.4f, p);
            c.drawCircle(15.4f, 16.6f, 2.4f, p);
            return;
        }
        if (NIGHT.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            path.addCircle(13.4f, 12f, 7.6f, Path.Direction.CW);
            path.addCircle(9.4f, 9.4f, 6.6f, Path.Direction.CCW);
            c.drawPath(path, p);
            p.setStyle(Paint.Style.STROKE);
            sparkle(c, p, 18.4f, 6.2f, 2.0f);
            return;
        }
        if (PANORAMA.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            path.moveTo(3.4f, 9.2f);
            path.cubicTo(7.6f, 6.4f, 16.4f, 6.4f, 20.6f, 9.2f);
            path.lineTo(20.6f, 15.2f);
            path.cubicTo(16.4f, 12.4f, 7.6f, 12.4f, 3.4f, 15.2f);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (DOC.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            path.moveTo(6.4f, 2.8f);
            path.lineTo(15f, 2.8f);
            path.lineTo(18.6f, 6.6f);
            path.lineTo(18.6f, 21.2f);
            path.lineTo(6.4f, 21.2f);
            path.close();
            c.drawPath(path, p);
            c.drawLine(9.2f, 10.4f, 15.8f, 10.4f, p);
            c.drawLine(9.2f, 14f, 15.8f, 14f, p);
            c.drawLine(9.2f, 17.4f, 13.4f, 17.4f, p);
            return;
        }
        if (MACRO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(11f, 11f, 6.2f, p);
            c.drawLine(15.6f, 15.6f, 21f, 21f, p);
            c.drawLine(8.4f, 11f, 13.6f, 11f, p);
            return;
        }
        if (PORTRAIT.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 8.6f, 3.8f, p);
            path.moveTo(4.8f, 20.4f);
            path.cubicTo(5.6f, 15.4f, 8.4f, 13.4f, 12f, 13.4f);
            path.cubicTo(15.6f, 13.4f, 18.4f, 15.4f, 19.2f, 20.4f);
            c.drawPath(path, p);
            return;
        }
        if (ZOOM_IN.equals(n) || ZOOM_OUT.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(10.6f, 10.6f, 6.6f, p);
            c.drawLine(15.4f, 15.4f, 21f, 21f, p);
            c.drawLine(7.6f, 10.6f, 13.6f, 10.6f, p);
            if (ZOOM_IN.equals(n)) c.drawLine(10.6f, 7.6f, 10.6f, 13.6f, p);
            return;
        }
        if (LOCK.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRoundRect(new RectF(5.6f, 10.4f, 18.4f, 21f), 2f, 2f, p);
            path.moveTo(8.6f, 10.4f);
            path.lineTo(8.6f, 7.8f);
            path.cubicTo(8.6f, 4.2f, 15.4f, 4.2f, 15.4f, 7.8f);
            path.lineTo(15.4f, 10.4f);
            c.drawPath(path, p);
            return;
        }
        if (CHEVRON_LEFT.equals(n) || CHEVRON_RIGHT.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.4f);
            boolean left = CHEVRON_LEFT.equals(n);
            path.moveTo(left ? 15.4f : 8.6f, 4.6f);
            path.lineTo(left ? 8.6f : 15.4f, 12f);
            path.lineTo(left ? 15.4f : 8.6f, 19.4f);
            c.drawPath(path, p);
            return;
        }
        if (DOWNLOAD.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(12, 3.2f, 12, 14.4f, p);
            path.moveTo(7.4f, 10.2f);
            path.lineTo(12, 14.8f);
            path.lineTo(16.6f, 10.2f);
            c.drawPath(path, p);
            c.drawLine(4.6f, 19.4f, 19.4f, 19.4f, p);
            return;
        }
        if (PLAY.equals(n)) {
            p.setStyle(Paint.Style.FILL);
            path.moveTo(7.6f, 4.6f);
            path.lineTo(19f, 12f);
            path.lineTo(7.6f, 19.4f);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (EXPOSURE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 8.4f, p);
            c.drawLine(4.4f, 12f, 19.6f, 12f, p);
            p.setStyle(Paint.Style.FILL);
            c.drawCircle(8.2f, 8.4f, 1.5f, p);
            c.drawCircle(16.4f, 15.2f, 1.5f, p);
            return;
        }
        if (FOCUS.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            corner(c, p, 3.4f, 3.4f, 1f, 1f);
            corner(c, p, 20.6f, 3.4f, -1f, 1f);
            corner(c, p, 3.4f, 20.6f, 1f, -1f);
            corner(c, p, 20.6f, 20.6f, -1f, -1f);
            return;
        }
        if (WB.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12, 8.2f, p);
            p.setStyle(Paint.Style.FILL);
            path.addArc(new RectF(3.8f, 3.8f, 20.2f, 20.2f), -90, 180);
            path.close();
            c.drawPath(path, p);
            return;
        }
        if (SPEED.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(12, 12.6f, 7.8f, p);
            c.drawLine(12, 12.6f, 16.2f, 8.6f, p);
            c.drawLine(6.4f, 3.4f, 17.6f, 3.4f, p);
            return;
        }
        if (ISO.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            p.setTextSize(11f);
            c.drawText("ISO", 2.6f, 15.6f, p);
            return;
        }
        if (SAVE.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            path.moveTo(4.6f, 3.4f);
            path.lineTo(16.4f, 3.4f);
            path.lineTo(20.4f, 7.4f);
            path.lineTo(20.4f, 20.6f);
            path.lineTo(4.6f, 20.6f);
            path.close();
            c.drawPath(path, p);
            c.drawRect(8.4f, 3.4f, 15f, 8.4f, p);
            c.drawRect(8f, 13.2f, 17f, 20.6f, p);
            return;
        }
        if (RAW.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawRect(3.4f, 4.6f, 20.6f, 19.4f, p);
            p.setStyle(Paint.Style.FILL);
            p.setTextSize(9.4f);
            c.drawText("RAW", 6.2f, 15.6f, p);
            return;
        }
        if (HDR.equals(n)) {
            p.setStyle(Paint.Style.STROKE);
            c.drawCircle(8.6f, 12f, 5.4f, p);
            c.drawCircle(15.4f, 12f, 5.4f, p);
            return;
        }
        // fallback: a dot so a missing icon is never invisible
        p.setStyle(Paint.Style.FILL);
        c.drawCircle(12, 12, 3f, p);
    }

    private static void corner(Canvas c, Paint p, float x, float y, float sx, float sy) {
        Path path = new Path();
        path.moveTo(x + sx * 4.6f, y);
        path.lineTo(x, y);
        path.lineTo(x, y + sy * 4.6f);
        c.drawPath(path, p);
    }

    private static void sparkle(Canvas c, Paint p, float x, float y, float r) {
        Path path = new Path();
        path.moveTo(x, y - r);
        path.quadTo(x + r * 0.18f, y - r * 0.18f, x + r, y);
        path.quadTo(x + r * 0.18f, y + r * 0.18f, x, y + r);
        path.quadTo(x - r * 0.18f, y + r * 0.18f, x - r, y);
        path.quadTo(x - r * 0.18f, y - r * 0.18f, x, y - r);
        path.close();
        c.drawPath(path, p);
    }

    /** Convenience: a Drawable wrapper so icons can be used anywhere a Drawable is expected. */
    public static class IconDrawable extends android.graphics.drawable.Drawable {
        private final String name;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int color = Color.WHITE;
        private float strokeScale = 1f;

        public IconDrawable(String name) {
            this.name = name;
        }

        public IconDrawable color(int c) {
            color = c;
            return this;
        }

        public IconDrawable stroke(float s) {
            strokeScale = s;
            return this;
        }

        @Override
        public void draw(Canvas canvas) {
            android.graphics.Rect b = getBounds();
            int size = Math.min(b.width(), b.height());
            canvas.save();
            canvas.translate(b.left + (b.width() - size) / 2f, b.top + (b.height() - size) / 2f);
            paint.setColor(color);
            paint.setAlpha(getAlpha());
            paint.setStrokeWidth(1.9f * strokeScale);
            paint.setStyle(Paint.Style.STROKE);
            Icons.draw(canvas, name, size, paint);
            canvas.restore();
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(android.graphics.ColorFilter cf) {
            paint.setColorFilter(cf);
        }

        @Override
        public int getOpacity() {
            return android.graphics.PixelFormat.TRANSLUCENT;
        }
    }

    /** Simple dashed-line helper used by the level indicator and rule-of-thirds guides. */
    public static void dashedLine(Canvas c, float x1, float y1, float x2, float y2, Paint p) {
        DashPathEffect eff = new DashPathEffect(new float[]{6f, 8f}, 0f);
        Path path = new Path();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        p.setStyle(Paint.Style.STROKE);
        p.setPathEffect(eff);
        c.drawPath(path, p);
        p.setPathEffect(null);
    }

    public static RectF rect(float l, float t, float r, float b) {
        return new RectF(l, t, r, b);
    }
}
