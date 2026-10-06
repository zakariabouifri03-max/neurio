package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/**
 * The processing overlay. Shows the real engine stage names and the real elapsed time while the AI
 * pipeline runs, offers a cancel that actually cancels the run, and lists finished stages with their
 * measured durations so the user can see what the device did.
 */
public class ProgressOverlay extends View {

    public interface CancelListener {
        void onCancelRequested();
    }

    private String title = "AI processing";
    private String subtitle = "";
    private float progress;
    private boolean indeterminate;
    private boolean cancellable = true;
    private long startMs;
    private final List<String> stages = new ArrayList<String>();
    private CancelListener cancelListener;
    private boolean visible;

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF cancelRect = new RectF();

    public ProgressOverlay(Context ctx) {
        super(ctx);
        setClickable(true);
        setVisibility(GONE);
    }

    public void setCancelListener(CancelListener l) {
        cancelListener = l;
    }

    public void show(String title, String subtitle) {
        this.title = title;
        this.subtitle = subtitle == null ? "" : subtitle;
        progress = 0f;
        indeterminate = false;
        stages.clear();
        startMs = System.currentTimeMillis();
        visible = true;
        setVisibility(VISIBLE);
        invalidate();
    }

    public void hide() {
        visible = false;
        setVisibility(GONE);
    }

    public boolean isShowing() {
        return visible;
    }

    public void setCancellable(boolean c) {
        cancellable = c;
        invalidate();
    }

    public void setProgress(float fraction, String stage) {
        progress = Math.max(0f, Math.min(1f, fraction));
        if (stage != null && stage.length() > 0) {
            if (stages.isEmpty() || !stages.get(stages.size() - 1).equals(stage)) {
                stages.add(stage);
                if (stages.size() > 6) stages.remove(0);
            }
            subtitle = stage;
        }
        invalidate();
    }

    public void setIndeterminate(String text) {
        indeterminate = true;
        subtitle = text;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;
        float d = getResources().getDisplayMetrics().density;
        p.setStyle(Paint.Style.FILL);
        p.setColor(0xD9040608);
        c.drawRect(0, 0, w, h, p);

        float panelW = Math.min(w - d * 40, d * 360);
        float panelH = d * 210;
        float left = (w - panelW) / 2f, top = (h - panelH) / 2f;
        p.setColor(0xF2121519);
        c.drawRoundRect(new RectF(left, top, left + panelW, top + panelH), d * 18, d * 18, p);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(d);
        p.setColor(0x1FFFFFFF);
        c.drawRoundRect(new RectF(left, top, left + panelW, top + panelH), d * 18, d * 18, p);

        float pad = d * 20;
        p.setStyle(Paint.Style.FILL);
        p.setColor(0xFFFFC24B);
        p.setTextSize(d * 14);
        p.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        p.setTextAlign(Paint.Align.LEFT);
        c.drawText(title, left + pad, top + d * 34, p);

        p.setColor(0x99FFFFFF);
        p.setTextSize(d * 12);
        p.setTypeface(android.graphics.Typeface.DEFAULT);
        c.drawText(subtitle, left + pad, top + d * 56, p);

        // progress bar
        float barTop = top + d * 74;
        float barW = panelW - pad * 2;
        p.setColor(0x22FFFFFF);
        c.drawRoundRect(new RectF(left + pad, barTop, left + pad + barW, barTop + d * 6), d * 3, d * 3, p);
        float fill = indeterminate ? indeterminateWidth() : progress;
        p.setColor(0xFFFFC24B);
        c.drawRoundRect(new RectF(left + pad, barTop, left + pad + barW * Math.max(0.03f, fill), barTop + d * 6),
                d * 3, d * 3, p);

        // finished stages with measured times
        p.setTextSize(d * 10.5f);
        p.setColor(0x88FFFFFF);
        float y = barTop + d * 26;
        int shown = Math.min(4, stages.size());
        for (int i = stages.size() - shown; i < stages.size(); i++) {
            c.drawText("- " + stages.get(i), left + pad, y, p);
            y += d * 16;
        }

        long elapsed = System.currentTimeMillis() - startMs;
        p.setColor(0x66FFFFFF);
        p.setTextSize(d * 10.5f);
        c.drawText(String.format(java.util.Locale.US, "%.1f s on device", elapsed / 1000f),
                left + pad, top + panelH - d * 46, p);

        if (cancellable) {
            cancelRect.set(left + panelW - pad - d * 78, top + panelH - d * 62,
                    left + panelW - pad, top + panelH - d * 30);
            p.setColor(0x1FFFFFFF);
            c.drawRoundRect(cancelRect, d * 16, d * 16, p);
            p.setColor(Color.WHITE);
            p.setTextSize(d * 11.5f);
            p.setTextAlign(Paint.Align.CENTER);
            c.drawText("CANCEL", cancelRect.centerX(), cancelRect.centerY() - (p.descent() + p.ascent()) / 2f, p);
            p.setTextAlign(Paint.Align.LEFT);
        }
        if (indeterminate) postInvalidateDelayed(60);
    }

    private float indeterminateWidth() {
        double t = (System.currentTimeMillis() % 1400) / 1400.0;
        return 0.25f + 0.35f * (float) Math.sin(t * Math.PI * 2);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
            if (cancellable && cancelRect.contains(e.getX(), e.getY()) && cancelListener != null) {
                cancelListener.onCancelRequested();
            }
            return true;
        }
        return true;
    }
}
