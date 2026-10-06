package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

/**
 * A camera-app style button: optional round background, vector icon, optional label, optional badge.
 * Real View with real touch handling, press animation and haptic feedback.
 */
public class IconButton extends View {

    public static final int STYLE_PLAIN = 0;      // just the icon
    public static final int STYLE_GHOST = 1;      // translucent plate
    public static final int STYLE_FILLED = 2;     // solid accent ring / fill

    private String icon;
    private String label;
    private String badge;

    private int iconColor = Color.WHITE;
    private int plateColor = 0x33FFFFFF;
    private int selectedColor = 0xFFFFC24B;
    private int labelColor = 0xB3FFFFFF;

    private int style = STYLE_GHOST;
    private boolean selected;
    private boolean enabled = true;
    private boolean showDot;

    private float pressT;
    private float iconSizeDp = 24f;
    private float labelSizeDp = 10f;
    private boolean labelUnder = true;
    private boolean pulsing;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    public IconButton(Context ctx) {
        super(ctx);
        setClickable(true);
        setFocusable(true);
        setBackgroundColor(Color.TRANSPARENT);
    }

    public IconButton icon(String name) {
        this.icon = name;
        invalidate();
        return this;
    }

    public IconButton label(String text) {
        this.label = text;
        invalidate();
        return this;
    }

    public IconButton badge(String text) {
        this.badge = text;
        invalidate();
        return this;
    }

    public IconButton style(int s) {
        this.style = s;
        invalidate();
        return this;
    }

    public IconButton colors(int iconC, int plateC, int selC) {
        this.iconColor = iconC;
        this.plateColor = plateC;
        this.selectedColor = selC;
        invalidate();
        return this;
    }

    public IconButton labelColor(int c) {
        this.labelColor = c;
        return this;
    }

    public IconButton iconSize(float dp) {
        this.iconSizeDp = dp;
        requestLayout();
        return this;
    }

    public IconButton labelUnder(boolean under) {
        this.labelUnder = under;
        requestLayout();
        return this;
    }

    public void setSelectedState(boolean sel) {
        if (selected != sel) {
            selected = sel;
            invalidate();
        }
    }

    public boolean selectedState() {
        return selected;
    }

    @Override
    public void setEnabled(boolean e) {
        enabled = e;
        super.setEnabled(e);
        setAlpha(e ? 1f : 0.35f);
        invalidate();
    }

    public void setDot(boolean dot) {
        showDot = dot;
        invalidate();
    }

    /** Slow breathing highlight used for AI ENHANCE / AI ULTRA to advertise the smart pipeline. */
    public void setPulsing(boolean p) {
        pulsing = p;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        float d = getResources().getDisplayMetrics().density;
        int icon = Math.round(iconSizeDp * d);
        int pad = Math.round(10 * d);
        int labelH = (label != null) ? Math.round(labelSizeDp * d * 1.5f) : 0;
        int w = icon + pad * 2;
        int h = icon + pad * 2 + labelH;
        if (style == STYLE_PLAIN) {
            w += Math.round(4 * d);
            h += Math.round(4 * d);
        }
        int mw = resolveSize(w, widthSpec), mh = resolveSize(h, heightSpec);
        setMeasuredDimension(mw, mh);
    }

    @Override
    protected void onDraw(Canvas c) {
        float d = getResources().getDisplayMetrics().density;
        int w = getWidth(), h = getHeight();
        float r = Math.min(w, h - (label != null ? labelSizeDp * d * 1.5f : 0)) / 2f - d;
        float cx = w / 2f, cy = r + d;
        boolean active = selected || isPressed();
        float grow = 1f + 0.06f * pressT;

        if (style == STYLE_FILLED) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(active ? selectedColor : plateColor);
            c.drawCircle(cx, cy, r * grow, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(d * 1.5f);
            paint.setColor(Color.argb(active ? 220 : 90, 255, 255, 255));
            c.drawCircle(cx, cy, r * grow, paint);
        } else if (style == STYLE_GHOST) {
            paint.setStyle(Paint.Style.FILL);
            int base = plateColor;
            if (pulsing) {
                float a = 0.5f + 0.5f * (float) Math.sin(System.currentTimeMillis() / 420.0);
                base = blend(base, selectedColor, 0.25f + 0.35f * a);
            }
            paint.setColor(active ? blend(base, selectedColor, 0.45f) : base);
            c.drawCircle(cx, cy, r * grow, paint);
        }

        if (showDot) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xFFFF5252);
            c.drawCircle(cx + r * 0.72f, cy - r * 0.72f, d * 3f, paint);
        }

        float iconPx = style == STYLE_PLAIN ? iconSizeDp * d * 1.15f : r * 1.15f;
        paint.setColor(selected ? bestOn(selectedColor) : iconColor);
        paint.setAlpha(enabled ? 255 : 120);
        paint.setStrokeWidth(d);
        float ix = cx - iconPx / 2f, iy = cy - iconPx / 2f;
        c.save();
        c.translate(ix, iy);
        Icons.draw(c, icon == null ? Icons.AI : icon, iconPx, paint);
        c.restore();

        if (badge != null && badge.length() > 0) {
            textPaint.setColor(Color.WHITE);
            textPaint.setTextSize(d * 8.5f);
            textPaint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            textPaint.setTextAlign(Paint.Align.CENTER);
            float bw = textPaint.measureText(badge) + d * 8f;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xE0111418);
            RectF br = new RectF(cx - bw / 2f, cy + r * 0.42f, cx + bw / 2f, cy + r * 0.42f + d * 13f);
            c.drawRoundRect(br, d * 6.5f, d * 6.5f, paint);
            c.drawText(badge, cx, br.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f, textPaint);
        }

        if (label != null && label.length() > 0) {
            textPaint.setColor(selected ? selectedColor : labelColor);
            textPaint.setTextSize(labelSizeDp * d);
            textPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setLetterSpacing(0.08f);
            float ly = h - d * 4f;
            c.drawText(label, cx, ly, textPaint);
        }
        if (pulsing) postInvalidateDelayed(60);
    }

    private static int blend(int a, int b, float t) {
        int ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF, aa = (a >>> 24);
        int br = (b >> 16) & 0xFF, bg = (b >> 8) & 0xFF, bb = b & 0xFF, ba = (b >>> 24);
        int r = (int) (ar + (br - ar) * t), g = (int) (ag + (bg - ag) * t), bl = (int) (ab + (bb - ab) * t);
        int al = (int) (aa + (ba - aa) * t);
        return (al << 24) | (r << 16) | (g << 8) | bl;
    }

    private static int bestOn(int bg) {
        int lum = (int) (0.299 * ((bg >> 16) & 0xFF) + 0.587 * ((bg >> 8) & 0xFF) + 0.114 * (bg & 0xFF));
        return lum > 150 ? 0xFF101214 : Color.WHITE;
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                pressT = 1f;
                invalidate();
                return true;
            case MotionEvent.ACTION_UP:
                pressT = 0f;
                invalidate();
                if (isEnabled()) {
                    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                    performClick();
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                pressT = 0f;
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                boolean inside = e.getX() >= 0 && e.getX() <= getWidth() && e.getY() >= 0 && e.getY() <= getHeight();
                pressT = inside ? 1f : 0f;
                invalidate();
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    @Override
    public boolean performClick() {
        return super.performClick();
    }
}
