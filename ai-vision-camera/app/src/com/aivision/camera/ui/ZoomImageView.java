package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;

/**
 * Pinch-to-zoom / pan / double-tap image view used by the viewer and the result sheet. Handles very
 * large bitmaps by drawing them through a matrix with bitmap filtering enabled.
 */
public class ZoomImageView extends View {

    private Bitmap bitmap;
    private final Matrix matrix = new Matrix();
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private float scale = 1f, minScale = 1f, maxScale = 8f;
    private float tx, ty;
    private boolean fitted;
    private GestureDetector gestures;
    private ScaleGestureDetector scaler;
    private float lastX, lastY;
    private boolean panning;

    public ZoomImageView(Context ctx) {
        super(ctx);
        setFocusable(true);
        gestures = new GestureDetector(ctx, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDoubleTap(MotionEvent e) {
                if (scale > minScale * 1.4f) {
                    reset();
                } else {
                    zoomTo(e.getX(), e.getY(), minScale * 3f);
                }
                return true;
            }

            @Override
            public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                pan(-dx, -dy);
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                performClick();
                return false;
            }
        });
        scaler = new ScaleGestureDetector(ctx, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector d) {
                float target = clampScale(scale * d.getScaleFactor());
                float k = target / scale;
                scale = target;
                matrix.postScale(k, k, d.getFocusX(), d.getFocusY());
                constrain();
                invalidate();
                return true;
            }
        });
    }

    public void setBitmap(Bitmap bmp) {
        bitmap = bmp;
        fitted = false;
        scale = 1f;
        invalidate();
    }

    public Bitmap bitmap() {
        return bitmap;
    }

    public void reset() {
        fitted = false;
        scale = 1f;
        invalidate();
    }

    private float clampScale(float s) {
        return Math.max(minScale, Math.min(maxScale, s));
    }

    private void zoomTo(float cx, float cy, float target) {
        float t = clampScale(target);
        float k = t / scale;
        scale = t;
        matrix.postScale(k, k, cx, cy);
        constrain();
        invalidate();
    }

    private void pan(float dx, float dy) {
        matrix.postTranslate(dx, dy);
        constrain();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        if (bitmap == null || bitmap.isRecycled()) {
            return;
        }
        if (!fitted) {
            float bw = bitmap.getWidth(), bh = bitmap.getHeight();
            float s = Math.min(getWidth() / bw, getHeight() / bh);
            minScale = s;
            maxScale = Math.max(1f, s * 8f);
            scale = s;
            matrix.reset();
            matrix.postScale(s, s);
            matrix.postTranslate((getWidth() - bw * s) / 2f, (getHeight() - bh * s) / 2f);
            fitted = true;
        }
        c.drawBitmap(bitmap, matrix, paint);
    }

    /** Keeps the image covering the view: no dragging it off into the void. */
    private void constrain() {
        if (bitmap == null) return;
        RectF r = new RectF(0, 0, bitmap.getWidth(), bitmap.getHeight());
        matrix.mapRect(r);
        float dx = 0, dy = 0;
        if (r.width() <= getWidth()) {
            dx = (getWidth() - r.width()) / 2f - r.left;
        } else if (r.left > 0) {
            dx = -r.left;
        } else if (r.right < getWidth()) {
            dx = getWidth() - r.right;
        }
        if (r.height() <= getHeight()) {
            dy = (getHeight() - r.height()) / 2f - r.top;
        } else if (r.top > 0) {
            dy = -r.top;
        } else if (r.bottom < getHeight()) {
            dy = getHeight() - r.bottom;
        }
        if (dx != 0 || dy != 0) matrix.postTranslate(dx, dy);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        scaler.onTouchEvent(e);
        gestures.onTouchEvent(e);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastX = e.getX();
                lastY = e.getY();
                panning = true;
                getParent().requestDisallowInterceptTouchEvent(true);
                return true;
            case MotionEvent.ACTION_MOVE:
                if (panning && !scaler.isInProgress() && e.getPointerCount() == 1) {
                    pan(e.getX() - lastX, e.getY() - lastY);
                    lastX = e.getX();
                    lastY = e.getY();
                }
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                panning = false;
                getParent().requestDisallowInterceptTouchEvent(false);
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
