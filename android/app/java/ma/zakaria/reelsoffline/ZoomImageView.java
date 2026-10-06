package ma.zakaria.reelsoffline;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.drawable.Drawable;
import android.util.AttributeSet;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.widget.ImageView;

/** ImageView with pinch-zoom / double-tap-zoom / pan, used for saved photos. */
public class ZoomImageView extends ImageView {

    private final Matrix matrix = new Matrix();
    private final float[] values = new float[9];
    private float scale = 1f;
    private float minScale = 1f;
    private float lastX, lastY;
    private boolean dragging;
    private ScaleGestureDetector pinch;
    private GestureDetector taps;

    public ZoomImageView(Context c) {
        super(c);
        init();
    }

    public ZoomImageView(Context c, AttributeSet a) {
        super(c, a);
        init();
    }

    private void init() {
        super.setScaleType(ScaleType.MATRIX);
        pinch = new ScaleGestureDetector(getContext(), new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector d) {
                float f = d.getScaleFactor();
                float next = Math.max(minScale, Math.min(scale * f, minScale * 6f));
                float factor = next / scale;
                scale = next;
                matrix.postScale(factor, factor, d.getFocusX(), d.getFocusY());
                clamp();
                setImageMatrix(matrix);
                return true;
            }
        });
        taps = new GestureDetector(getContext(), new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDoubleTap(MotionEvent e) {
                if (scale > minScale * 1.2f) {
                    fit();
                } else {
                    float f = Math.min(3f, minScale * 2.5f) / scale;
                    scale = scale * f;
                    matrix.postScale(f, f, e.getX(), e.getY());
                    clamp();
                    setImageMatrix(matrix);
                }
                return true;
            }

            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }
        });
    }

    @Override
    public void setImageBitmap(Bitmap bm) {
        super.setImageBitmap(bm);
        post(this::fit);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        fit();
    }

    private void fit() {
        Drawable d = getDrawable();
        if (d == null || getWidth() == 0 || d.getIntrinsicWidth() <= 0) return;
        float bw = d.getIntrinsicWidth();
        float bh = d.getIntrinsicHeight();
        float s = Math.min(getWidth() / bw, getHeight() / bh);
        minScale = s;
        scale = s;
        matrix.reset();
        matrix.postScale(s, s);
        matrix.postTranslate((getWidth() - bw * s) / 2f, (getHeight() - bh * s) / 2f);
        setImageMatrix(matrix);
    }

    private void clamp() {
        Drawable d = getDrawable();
        if (d == null) return;
        matrix.getValues(values);
        float tx = values[Matrix.MTRANS_X];
        float ty = values[Matrix.MTRANS_Y];
        float sc = values[Matrix.MSCALE_X];
        float w = d.getIntrinsicWidth() * sc;
        float h = d.getIntrinsicHeight() * sc;
        float ntx;
        float nty;
        if (w <= getWidth()) ntx = (getWidth() - w) / 2f;
        else ntx = Math.min(0f, Math.max(getWidth() - w, tx));
        if (h <= getHeight()) nty = (getHeight() - h) / 2f;
        else nty = Math.min(0f, Math.max(getHeight() - h, ty));
        matrix.postTranslate(ntx - tx, nty - ty);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        pinch.onTouchEvent(e);
        taps.onTouchEvent(e);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastX = e.getX();
                lastY = e.getY();
                dragging = true;
                break;
            case MotionEvent.ACTION_MOVE:
                if (dragging && !pinch.isInProgress() && scale > minScale * 1.02f) {
                    float dx = e.getX() - lastX;
                    float dy = e.getY() - lastY;
                    matrix.postTranslate(dx, dy);
                    clamp();
                    setImageMatrix(matrix);
                }
                lastX = e.getX();
                lastY = e.getY();
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                break;
            default:
                break;
        }
        return true;
    }
}
