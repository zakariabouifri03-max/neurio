package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/**
 * The Before / After comparison the app is required to show. Left of the divider is the untouched
 * captured frame, right of it is the AI result - both real bitmaps, the divider is draggable, and a
 * long press toggles a full-frame peek of either side.
 */
public class CompareView extends View {

    private Bitmap before, after;
    private float split = 0.5f;
    private boolean drag;
    private int peek;   // 0 = slider, 1 = show before only, 2 = show after only

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF dst = new RectF();

    public CompareView(Context ctx) {
        super(ctx);
        setClickable(true);
    }

    public void set(Bitmap before, Bitmap after) {
        this.before = before;
        this.after = after;
        split = 0.5f;
        peek = 0;
        invalidate();
    }

    public void setPeek(int mode) {
        peek = mode;
        invalidate();
    }

    private void layout(RectF out) {
        Bitmap ref = after != null ? after : before;
        if (ref == null) {
            out.set(0, 0, getWidth(), getHeight());
            return;
        }
        float bw = ref.getWidth(), bh = ref.getHeight();
        float s = Math.min(getWidth() / bw, getHeight() / bh);
        float w = bw * s, h = bh * s;
        out.set((getWidth() - w) / 2f, (getHeight() - h) / 2f, (getWidth() + w) / 2f, (getHeight() + h) / 2f);
    }

    @Override
    protected void onDraw(Canvas c) {
        layout(dst);
        p.setStyle(Paint.Style.FILL);
        p.setColor(Color.BLACK);
        c.drawRect(0, 0, getWidth(), getHeight(), p);
        if (after == null && before == null) return;

        if (peek == 1 && before != null) {
            c.drawBitmap(before, null, dst, p);
        } else if (peek == 2 && after != null) {
            c.drawBitmap(after, null, dst, p);
        } else {
            float x = dst.left + dst.width() * split;
            if (after != null) c.drawBitmap(after, null, dst, p);
            if (before != null) {
                c.save();
                c.clipRect(dst.left, dst.top, x, dst.bottom);
                c.drawBitmap(before, null, dst, p);
                c.restore();
            }
            p.setColor(0xFFFFFFFF);
            p.setStrokeWidth(getResources().getDisplayMetrics().density * 1.6f);
            c.drawLine(x, dst.top, x, dst.bottom, p);
            float knob = getResources().getDisplayMetrics().density * 15f;
            p.setColor(0xFFFFC24B);
            c.drawCircle(x, dst.centerY(), knob, p);
            p.setColor(0xFF101214);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(getResources().getDisplayMetrics().density * 1.8f);
            c.drawLine(x - knob * 0.36f, dst.centerY() - knob * 0.3f, x - knob * 0.62f, dst.centerY(), p);
            c.drawLine(x - knob * 0.62f, dst.centerY(), x - knob * 0.36f, dst.centerY() + knob * 0.3f, p);
            c.drawLine(x + knob * 0.36f, dst.centerY() - knob * 0.3f, x + knob * 0.62f, dst.centerY(), p);
            c.drawLine(x + knob * 0.62f, dst.centerY(), x + knob * 0.36f, dst.centerY() + knob * 0.3f, p);
            p.setStyle(Paint.Style.FILL);
        }

        float d = getResources().getDisplayMetrics().density;
        text.setTextSize(d * 11);
        text.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        text.setColor(0xFFFFC24B);
        text.setTextAlign(Paint.Align.RIGHT);
        c.drawText(peek == 1 ? "ORIGINAL" : "AI ENHANCED", dst.right - d * 10, dst.top + d * 18, text);
        text.setColor(0x99FFFFFF);
        text.setTextAlign(Paint.Align.LEFT);
        c.drawText("drag to compare - long press to peek", dst.left + d * 10, dst.bottom - d * 10, text);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                drag = true;
                split = clamp((e.getX() - dst.left) / Math.max(1f, dst.width()));
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (drag) {
                    split = clamp((e.getX() - dst.left) / Math.max(1f, dst.width()));
                    invalidate();
                }
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                drag = false;
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    private static float clamp(float v) {
        return v < 0f ? 0f : (v > 1f ? 1f : v);
    }
}
