package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;

import com.aivision.camera.ai.core.Stats;
import com.aivision.camera.camera.Capabilities;

import java.util.ArrayList;
import java.util.List;

/**
 * The viewfinder HUD: focus ring, grid, level, live scene badge, histogram from the real analysis
 * frames, lens pills, the zoom scale with the digital/AI zone marked, recording timer and gesture
 * handling (tap to focus, pinch to zoom, long press to lock, vertical drag for exposure).
 */
public class PreviewOverlay extends View {

    public interface Listener {
        void onTapFocus(float x, float y);

        void onZoomGesture(float newZoom, boolean fromPill);

        void onLensSelected(String lensId, String label);

        void onExposureSwipe(float deltaEv);

        void onLongPressLock(float x, float y);
    }

    private Listener listener;
    private Capabilities caps;

    private float zoom = 1f;
    private float maxZoom = 100f;
    private float minZoom = 1f;
    private float opticalMax = 1f;
    private boolean digitalZone;

    private boolean grid, level = true, histogram = true;
    private String sceneBadge = "";
    private String hint = "";
    private String aiChip = "";
    private boolean aiActive;

    private float ringX, ringY;
    private float ringR;
    private long ringStart;
    private boolean ringActive, ringLocked;
    private float exposureEv;
    private long evShownAt;

    private boolean recording;
    private long recordStartMs;
    private boolean front;

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final List<RectF> pillRects = new ArrayList<RectF>();
    private final List<String> pillIds = new ArrayList<String>();
    private final List<String> pillLabels = new ArrayList<String>();
    private final float[] hist = new float[64];
    private final float[] tilt = {0f};
    private final RectF zoomBar = new RectF();
    private boolean draggingZoom;

    private GestureDetector gestures;
    private ScaleGestureDetector scaleDetector;
    private boolean handlingEv;
    private float evStartY, evStartValue;
    private final Handler handler = new Handler();

    public PreviewOverlay(Context ctx) {
        super(ctx);
        setFocusable(true);
        text.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        gestures = new GestureDetector(ctx, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onSingleTapUp(MotionEvent e) {
                ring(e.getX(), e.getY(), false);
                if (listener != null) listener.onTapFocus(e.getX(), e.getY());
                return true;
            }

            @Override
            public void onLongPress(MotionEvent e) {
                ring(e.getX(), e.getY(), !ringLocked);
                if (listener != null) listener.onLongPressLock(e.getX(), e.getY());
            }
        });
        scaleDetector = new ScaleGestureDetector(ctx, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector d) {
                float nz = zoom * d.getScaleFactor();
                nz = Math.max(minZoom, Math.min(maxZoom, nz));
                if (Math.abs(nz - zoom) > 0.001f) {
                    zoom = nz;
                    if (listener != null) listener.onZoomGesture(zoom, false);
                    invalidate();
                }
                return true;
            }
        });
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void setCapabilities(Capabilities c) {
        caps = c;
        if (c != null) {
            maxZoom = Math.max(1f, c.maxZoomToDisplay);
            minZoom = 1f;
            for (Capabilities.Lens l : c.lenses) minZoom = Math.min(minZoom, l.zoomFactor);
            opticalMax = 1f;
            for (Capabilities.Lens l : c.lenses) opticalMax = Math.max(opticalMax, l.zoomFactor);
            rebuildPills();
        }
        invalidate();
    }

    private void rebuildPills() {
        pillIds.clear();
        pillLabels.clear();
        pillRects.clear();
        if (caps == null) return;
        for (Capabilities.Lens l : caps.lenses) {
            pillIds.add(l.id);
            pillLabels.add(l.label);
        }
        if (caps.lenses.isEmpty()) {
            pillIds.add(null);
            pillLabels.add("1x");
        }
        // plus a couple of digital stops up to the honest ceiling
        float[] stops = {2f, 5f, 10f, 30f, 100f};
        float last = 0f;
        for (Capabilities.Lens l : caps.lenses) last = Math.max(last, l.zoomFactor);
        for (float s : stops) {
            if (s > last * 1.35f && s <= maxZoom) {
                pillIds.add(null);
                pillLabels.add(stopLabel(s));
            }
        }
    }

    private static String stopLabel(float z) {
        if (z >= 10) return Math.round(z) + "x";
        return (z == Math.floor(z) ? String.valueOf((int) z) : String.valueOf(z)) + "x";
    }

    public void setZoom(float z, boolean digital) {
        zoom = z;
        digitalZone = digital;
        invalidate();
    }

    public void setFrontFacing(boolean f) {
        front = f;
        invalidate();
    }

    public void setSceneBadge(String badge) {
        if (badge == null) badge = "";
        if (!badge.equals(sceneBadge)) {
            sceneBadge = badge;
            invalidate();
        }
    }

    public void setAiChip(String chip, boolean active) {
        aiChip = chip == null ? "" : chip;
        aiActive = active;
        invalidate();
    }

    public void setHint(String h) {
        hint = h == null ? "" : h;
        invalidate();
    }

    public void setHistogram(float[] values) {
        if (values == null) return;
        int n = Math.min(hist.length, values.length);
        for (int i = 0; i < n; i++) hist[i] = values[i];
        invalidate();
    }

    public void setStats(Stats s) {
        if (s == null) return;
        // a real 64 bin luma histogram cannot be derived from summary stats, so the overlay shows the
        // measured tone distribution instead: p1/p5/median/p95/p99 as a five point curve
        float[] tone = {s.p1Luma, s.p5Luma, s.medianLuma, s.p95Luma, s.p99Luma};
        for (int i = 0; i < hist.length; i++) {
            float t = i / (float) (hist.length - 1);
            float v = 0f;
            for (int k = 0; k < 4; k++) {
                float a = (k + 1) / 5f, b = (k + 2) / 5f;
                if (t >= a && t <= b) {
                    float f = (t - a) / Math.max(0.0001f, (b - a));
                    v = tone[k] + (tone[k + 1] - tone[k]) * f;
                }
            }
            hist[i] = Math.max(0f, Math.min(1f, 1f - v));
        }
        invalidate();
    }

    public void setLevel(float rollDegrees) {
        tilt[0] = rollDegrees;
        if (level) invalidate();
    }

    public void showGrid(boolean g) {
        grid = g;
        invalidate();
    }

    public void showHistogram(boolean h) {
        histogram = h;
        invalidate();
    }

    public void showLevel(boolean l) {
        level = l;
        invalidate();
    }

    public boolean gridOn() {
        return grid;
    }

    public boolean histogramOn() {
        return histogram;
    }

    public boolean levelOn() {
        return level;
    }

    public void ring(float x, float y, boolean locked) {
        ringX = x;
        ringY = y;
        ringLocked = locked;
        ringStart = System.currentTimeMillis();
        ringActive = true;
        invalidate();
    }

    public void setRecording(boolean rec, boolean frontFacing) {
        recording = rec;
        front = frontFacing;
        if (rec) recordStartMs = System.currentTimeMillis();
        invalidate();
        if (rec) handler.post(ticker);
    }

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (recording) {
                invalidate();
                handler.postDelayed(this, 500);
            }
        }
    };

    public void flashExposure(float ev) {
        exposureEv = ev;
        evShownAt = System.currentTimeMillis();
        invalidate();
    }

    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        handler.removeCallbacks(ticker);
    }

    // ------------------------------------------------------------------ drawing

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;
        float d = getResources().getDisplayMetrics().density;

        if (grid) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(d * 0.8f);
            p.setColor(0x33FFFFFF);
            for (int i = 1; i <= 2; i++) {
                c.drawLine(w * i / 3f, 0, w * i / 3f, h, p);
                c.drawLine(0, h * i / 3f, w, h * i / 3f, p);
            }
        }

        if (level) drawLevel(c, d);

        if (histogram) drawHistogram(c, d, w, h);

        if (ringActive) drawFocusRing(c, d);

        drawBadges(c, d, w, h);

        if (recording) drawRecording(c, d, w);

        drawZoomBar(c, d, w, h);

        if (exposureEv != 0f || System.currentTimeMillis() - evShownAt < 900) drawEv(c, d, w, h);

        if (hint.length() > 0) {
            text.setColor(0xCCFFFFFF);
            text.setTextSize(d * 12.5f);
            text.setTextAlign(Paint.Align.CENTER);
            text.setShadowLayer(d * 4, 0, d, 0xCC000000);
            c.drawText(hint, w / 2f, h * 0.66f, text);
            text.clearShadowLayer();
        }
    }

    private void drawFocusRing(Canvas c, float d) {
        long age = System.currentTimeMillis() - ringStart;
        if (age > 1400 && !ringLocked) {
            ringActive = false;
            return;
        }
        float k = Math.min(1f, age / 220f);
        float r = (d * 34f) * (0.7f + 0.3f * k);
        int alpha = (int) (255 * (age > 900 && !ringLocked ? Math.max(0f, 1f - (age - 900) / 500f) : 1f));
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(d * 1.4f);
        p.setColor(ringLocked ? 0xFF4CE0D2 : 0xFFFFC24B);
        p.setAlpha(alpha);
        strokeCornerRect(c, ringX - r, ringY - r, ringX + r, ringY + r, d * 11f, d * 1.1f);
        if (k < 1f) {
            p.setAlpha((int) (alpha * (1f - k)));
            p.setStrokeWidth(d * 0.8f);
            c.drawCircle(ringX, ringY, r * (1.5f - 0.5f * k), p);
        }
        if (ringLocked) {
            p.setStyle(Paint.Style.FILL);
            p.setColor(0xFF4CE0D2);
            p.setAlpha(alpha);
            Path path = new Path();
            path.moveTo(ringX + r * 0.55f, ringY - r * 0.72f);
            path.lineTo(ringX + r * 0.72f, ringY - r * 0.62f);
            path.lineTo(ringX + r * 0.72f, ringY - r * 0.42f);
            path.lineTo(ringX + r * 0.55f, ringY - r * 0.52f);
            path.close();
            c.drawPath(path, p);
        }
        p.setAlpha(255);
        invalidate();
    }

    private void drawLevel(Canvas c, float d) {
        float roll = tilt[0];
        boolean flat = Math.abs(roll) < 1.2f;
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(d * (flat ? 1.6f : 1f));
        p.setColor(flat ? 0xFF4CE0D2 : 0x66FFFFFF);
        float cy = getHeight() / 2f, cx = getWidth() / 2f;
        float len = Math.min(getWidth() * 0.22f, d * 90);
        c.save();
        c.rotate(roll, cx, cy);
        c.drawLine(cx - len, cy, cx + len, cy, p);
        c.restore();
        if (flat) {
            c.drawCircle(cx, cy, d * 2.2f, p);
        }
    }

    private void drawHistogram(Canvas c, float d, int w, int h) {
        float bw = Math.min(w * 0.28f, d * 110);
        float bh = bw * 0.42f;
        float left = w - bw - d * 14, top = h * 0.30f;
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x33000000);
        c.drawRoundRect(new RectF(left - d * 4, top - d * 4, left + bw + d * 4, top + bh + d * 4), d * 6, d * 6, p);
        p.setColor(0xCC4CE0D2);
        Path path = new Path();
        path.moveTo(left, top + bh);
        for (int i = 0; i < hist.length; i++) {
            float x = left + bw * i / (float) (hist.length - 1);
            float y = top + bh * (1f - Math.max(0.02f, hist[i]));
            path.lineTo(x, y);
        }
        path.lineTo(left + bw, top + bh);
        path.close();
        c.drawPath(path, p);
    }

    private void drawBadges(Canvas c, float d, int w, int h) {
        float pad = d * 12;
        float y = pad + d * 10;
        if (aiChip.length() > 0) {
            text.setTextSize(d * 10.5f);
            float tw = text.measureText(aiChip) + d * 18;
            RectF chip = new RectF(pad, y - d * 9, pad + tw, y + d * 6);
            p.setStyle(Paint.Style.FILL);
            p.setColor(aiActive ? 0x33FFC24B : 0x33000000);
            c.drawRoundRect(chip, d * 10, d * 10, p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(d * 0.8f);
            p.setColor(aiActive ? 0x99FFC24B : 0x44FFFFFF);
            c.drawRoundRect(chip, d * 10, d * 10, p);
            text.setColor(aiActive ? 0xFFFFC24B : 0xCCFFFFFF);
            text.setTextAlign(Paint.Align.LEFT);
            c.drawText(aiChip, chip.left + d * 9, chip.centerY() - (text.descent() + text.ascent()) / 2f, text);
            y = chip.bottom + d * 8;
        }
        if (sceneBadge.length() > 0) {
            text.setTextSize(d * 10.5f);
            text.setColor(0xFFE8E8E8);
            text.setTextAlign(Paint.Align.LEFT);
            p.setStyle(Paint.Style.FILL);
            p.setColor(0x990A0C0F);
            RectF b = new RectF(pad, y - d * 9, pad + text.measureText(sceneBadge) + d * 18, y + d * 6);
            c.drawRoundRect(b, d * 10, d * 10, p);
            c.drawText(sceneBadge, b.left + d * 9, b.centerY() - (text.descent() + text.ascent()) / 2f, text);
        }
    }

    private void drawRecording(Canvas c, float d, int w) {
        long ms = System.currentTimeMillis() - recordStartMs;
        String t = String.format(java.util.Locale.US, "%02d:%02d", (ms / 60000) % 100, (ms / 1000) % 60);
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x990A0C0F);
        float tw = d * 96;
        RectF b = new RectF(w / 2f - tw / 2, d * 16, w / 2f + tw / 2, d * 42);
        c.drawRoundRect(b, d * 13, d * 13, p);
        p.setColor(0xFFFF5A5F);
        c.drawCircle(b.left + d * 15, b.centerY(), d * 4.2f, p);
        text.setColor(Color.WHITE);
        text.setTextSize(d * 13);
        text.setTextAlign(Paint.Align.LEFT);
        c.drawText(t, b.left + d * 26, b.centerY() - (text.descent() + text.ascent()) / 2f, text);
    }

    private void drawZoomBar(Canvas c, float d, int w, int h) {
        float barY = h - d * 128;
        zoomBar.set(d * 30, barY - d * 14, w - d * 30, barY + d * 14);
        pillRects.clear();
        text.setTextSize(d * 11);

        // pills row
        float x = d * 16;
        float py = barY - d * 46;
        for (int i = 0; i < pillLabels.size(); i++) {
            String label = pillLabels.get(i);
            float pw = text.measureText(label) + d * 22;
            if (x + pw > w - d * 16) break;
            RectF r = new RectF(x, py - d * 12, x + pw, py + d * 12);
            boolean activePill = label.equals(currentZoomLabel());
            p.setStyle(Paint.Style.FILL);
            p.setColor(activePill ? 0xFFFFC24B : 0x660A0C0F);
            c.drawRoundRect(r, d * 12, d * 12, p);
            text.setColor(activePill ? 0xFF101214 : 0xE6FFFFFF);
            text.setTextAlign(Paint.Align.CENTER);
            c.drawText(label, r.centerX(), r.centerY() - (text.descent() + text.ascent()) / 2f, text);
            pillRects.add(r);
            x += pw + d * 8;
        }

        // the scale itself, with the optical zone and the AI/digital zone clearly distinguished
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x44000000);
        c.drawRoundRect(zoomBar, d * 8, d * 8, p);
        float optFrac = zoomFraction(opticalMax);
        RectF opt = new RectF(zoomBar.left, zoomBar.top, zoomBar.left + zoomBar.width() * optFrac, zoomBar.bottom);
        p.setColor(0x99FFFFFF);
        c.drawRoundRect(opt, d * 8, d * 8, p);
        float zf = zoomFraction(zoom);
        RectF fill = new RectF(zoomBar.left, zoomBar.top, zoomBar.left + zoomBar.width() * zf, zoomBar.bottom);
        p.setColor(digitalZone ? 0xFF4CE0D2 : 0xFFFFC24B);
        c.drawRoundRect(fill, d * 8, d * 8, p);
        if (digitalZone) {
            text.setColor(0xFF4CE0D2);
            text.setTextSize(d * 9.5f);
            text.setTextAlign(Paint.Align.RIGHT);
            c.drawText("AI zoom", zoomBar.right - d * 6, zoomBar.bottom + d * 14, text);
        }
        // knob
        p.setColor(Color.WHITE);
        c.drawCircle(fill.right, zoomBar.centerY(), d * 7f, p);
        text.setColor(0xFF101214);
        text.setTextSize(d * 8.5f);
        text.setTextAlign(Paint.Align.CENTER);
        c.drawText(zoomLabelShort(), fill.right, zoomBar.centerY() - (text.descent() + text.ascent()) / 2f, text);
    }

    private String zoomLabelShort() {
        if (zoom >= 10f) return String.valueOf(Math.round(zoom));
        return (Math.round(zoom * 10) / 10f) + "";
    }

    private String currentZoomLabel() {
        float best = Float.MAX_VALUE;
        String label = zoomLabelShort() + "x";
        for (int i = 0; i < pillLabels.size(); i++) {
            String l = pillLabels.get(i);
            float v = parseLabel(l);
            if (v <= 0) continue;
            float diff = Math.abs(v - zoom);
            if (diff < best && diff <= Math.max(0.06f * v, 0.12f)) {
                best = diff;
                label = l;
            }
        }
        return label;
    }

    static float parseLabel(String l) {
        try {
            return Float.parseFloat(l.replace("x", "").trim());
        } catch (Throwable t) {
            return 0f;
        }
    }

    private float zoomFraction(float z) {
        // logarithmic scale: matches how zoom feels and gives the digital range fair space
        float lz = (float) (Math.log(z) / Math.log(Math.max(2f, maxZoom)));
        return Math.max(0f, Math.min(1f, lz));
    }

    private void drawEv(Canvas c, float d, int w, int h) {
        long age = System.currentTimeMillis() - evShownAt;
        float alpha = age > 700 ? Math.max(0f, 1f - (age - 700) / 700f) : 1f;
        if (exposureEv == 0f && alpha <= 0f) return;
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x880A0C0F);
        float cx = w - d * 30;
        RectF r = new RectF(cx - d * 20, h * 0.42f, cx + d * 20, h * 0.42f + d * 96);
        c.drawRoundRect(r, d * 12, d * 12, p);
        p.setColor(0x66FFFFFF);
        for (int i = -2; i <= 2; i++) {
            float y = r.centerY() - d * 34 * (i / 2f);
            c.drawRect(cx - d * (i == 0 ? 12 : 7), y - d * 0.8f, cx + d * (i == 0 ? 12 : 7), y + d * 0.8f, p);
        }
        p.setColor(0xFFFFC24B);
        p.setAlpha((int) (255 * alpha));
        float y = r.centerY() - d * 34 * Math.max(-2f, Math.min(2f, exposureEv)) / 2f;
        c.drawCircle(cx, y, d * 5f, p);
        text.setColor(Color.WHITE);
        text.setAlpha((int) (255 * alpha));
        text.setTextSize(d * 9.5f);
        text.setTextAlign(Paint.Align.CENTER);
        c.drawText(String.format(java.util.Locale.US, "%+.1f", exposureEv), cx, r.bottom - d * 8, text);
        p.setAlpha(255);
        text.setAlpha(255);
        if (alpha > 0f && alpha < 1f) invalidate();
    }

    private void strokeCornerRect(Canvas c, float l, float t, float r, float b, float len, float dash) {
        Path path = new Path();
        path.moveTo(l + len, t);
        path.lineTo(l, t);
        path.lineTo(l, t + len);
        path.moveTo(r - len, t);
        path.lineTo(r, t);
        path.lineTo(r, t + len);
        path.moveTo(l, b - len);
        path.lineTo(l, b);
        path.lineTo(l + len, b);
        path.moveTo(r, b - len);
        path.lineTo(r, b);
        path.lineTo(r - len, b);
        c.drawPath(path, p);
    }

    // ------------------------------------------------------------------ gestures

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        scaleDetector.onTouchEvent(e);
        gestures.onTouchEvent(e);
        int action = e.getActionMasked();
        float d = getResources().getDisplayMetrics().density;
        if (action == MotionEvent.ACTION_DOWN) {
            draggingZoom = zoomBar.contains(e.getX(), e.getY());
            handlingEv = !draggingZoom && e.getX() > getWidth() * 0.72f && e.getY() > getHeight() * 0.18f
                    && e.getY() < getHeight() * 0.82f;
            evStartY = e.getY();
            evStartValue = exposureEv;
            if (draggingZoom) setZoomFromTouch(e.getX());
            return true;
        }
        if (action == MotionEvent.ACTION_MOVE) {
            if (draggingZoom) {
                setZoomFromTouch(e.getX());
                return true;
            }
            if (handlingEv) {
                float dy = evStartY - e.getY();
                float ev = evStartValue + dy / (d * 60f);
                ev = Math.max(-2f, Math.min(2f, ev));
                if (Math.abs(ev - exposureEv) > 0.02f) {
                    exposureEv = ev;
                    evShownAt = System.currentTimeMillis();
                    if (listener != null) listener.onExposureSwipe(ev);
                    invalidate();
                }
                return true;
            }
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            if (!draggingZoom && !handlingEv) {
                for (int i = 0; i < pillRects.size(); i++) {
                    if (pillRects.get(i).contains(e.getX(), e.getY())) {
                        String label = pillLabels.get(i);
                        String id = i < pillIds.size() ? pillIds.get(i) : null;
                        if (listener != null) listener.onLensSelected(id, label);
                        return true;
                    }
                }
            }
            draggingZoom = false;
            handlingEv = false;
        }
        return true;
    }

    private void setZoomFromTouch(float x) {
        float f = (x - zoomBar.left) / Math.max(1f, zoomBar.width());
        f = Math.max(0f, Math.min(1f, f));
        float z = (float) Math.exp(f * Math.log(Math.max(2f, maxZoom)));
        z = Math.max(minZoom, Math.min(maxZoom, z));
        zoom = z;
        if (listener != null) listener.onZoomGesture(z, true);
        invalidate();
    }
}
