package com.neurio.langame.client;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.SparseArray;
import android.view.MotionEvent;
import android.view.View;

import com.neurio.langame.common.Logger;

import java.util.Locale;

/**
 * The on-screen controller overlay.
 *
 * <p>Two legitimate ways to drive a game that runs <b>on the host</b>:</p>
 * <ol>
 *   <li><b>Touch zones</b> (default): every widget is placed by the player over the
 *       game's own on-screen control, and a press is forwarded as a touch at that
 *       screen position. The client is simply "a finger on the other phone", which
 *       is what makes this work with games that ignore gamepads.</li>
 *   <li><b>Key codes</b>: widgets that carry an Android key code can be sent as
 *       {@code KEY_DOWN}/{@code KEY_UP} instead, for games that accept HID input.</li>
 * </ol>
 *
 * <p>Nothing here fakes a controller the game never sees: if the game ignores both
 * synthetic touches and key events on the host (some anti-cheat / input-hardened
 * titles do), the failure is real and is reported by the host UI — see the
 * limitations section of the README.</p>
 */
public final class VirtualController extends View {

    private static final String TAG = "VirtualController";

    /** Receives already-mapped input, normalised to the video rectangle (0..1). */
    public interface Listener {
        void onPointerDown(int pointerId, float x, float y);

        void onPointerMove(int pointerId, float x, float y);

        void onPointerUp(int pointerId, float x, float y);

        void onKey(int keyCode, boolean pressed);

        /** Fired when the player moves/resizes a widget in edit mode. */
        void onLayoutEdited(ControllerLayout layout);

        /** Long-press on a widget: the activity can toggle edit mode / settings. */
        void onWidgetLongPress(ControllerLayout.Widget widget);

        /** The player tapped empty space: the activity brings the control bar back. */
        void onTouchOutside();
    }

    private static final class Stick {
        float anchorX;
        float anchorY;
        float dx;
        float dy;
    }

    private ControllerLayout layout = ControllerLayout.defaultLayout();
    private Listener listener;
    private final SparseArray<ControllerLayout.Widget> pointerWidgets = new SparseArray<>();
    private final SparseArray<Stick> sticks = new SparseArray<>();

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint knob = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF videoRect = new RectF();

    private boolean editMode;
    private boolean keyMode;
    private boolean hapticsEnabled = true;
    private ControllerLayout.Widget dragging;
    private float dragOffsetX;
    private float dragOffsetY;
    private float downX;
    private float downY;

    /** Used by the XML inflater. */
    public VirtualController(Context context) {
        super(context);
        init();
    }

    /** Used by the XML inflater. */
    public VirtualController(Context context, android.util.AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    /** Used by the XML inflater. */
    public VirtualController(Context context, android.util.AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
        init();
    }

    public VirtualController(Context context, ControllerLayout layout, Listener listener) {
        super(context);
        this.layout = layout;
        this.listener = listener;
        init();
    }

    public void setLayout(ControllerLayout layout) {
        if (layout != null) {
            this.layout = layout;
            pointerWidgets.clear();
            sticks.clear();
            invalidate();
        }
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    private void init() {
        setFocusable(true);
        setLayerType(View.LAYER_TYPE_HARDWARE, null);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setColor(Color.WHITE);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(dp(2f));
        stroke.setColor(Color.argb(150, 255, 255, 255));
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(Color.argb(70, 255, 255, 255));
        knob.setStyle(Paint.Style.FILL);
        knob.setColor(Color.WHITE);
    }

    /* ------------------------------------------------------------------ *
     *  Configuration
     * ------------------------------------------------------------------ */

    /** Where the video is actually drawn (letterboxed) — keeps zones 1:1. */
    public void setVideoRect(RectF rect) {
        videoRect.set(rect);
        invalidate();
    }

    public void setEditMode(boolean editMode) {
        this.editMode = editMode;
        invalidate();
    }

    public boolean isEditMode() {
        return editMode;
    }

    /** When true, widgets that define a key code are sent as key events. */
    public void setKeyMode(boolean keyMode) {
        this.keyMode = keyMode;
    }

    public void setHapticsEnabled(boolean enabled) {
        this.hapticsEnabled = enabled;
    }

    public ControllerLayout layout() {
        return layout;
    }

    /* ------------------------------------------------------------------ *
     *  Geometry
     * ------------------------------------------------------------------ */

    private RectF activeRect() {
        if (videoRect.width() > 1 && videoRect.height() > 1) {
            return videoRect;
        }
        return new RectF(0, 0, getWidth(), getHeight());
    }

    private float widgetRadius(ControllerLayout.Widget widget) {
        RectF rect = activeRect();
        return widget.size * Math.min(rect.width(), rect.height()) * 0.5f;
    }

    private float widgetCenterX(ControllerLayout.Widget widget) {
        RectF rect = activeRect();
        return rect.left + widget.x * rect.width();
    }

    private float widgetCenterY(ControllerLayout.Widget widget) {
        RectF rect = activeRect();
        return rect.top + widget.y * rect.height();
    }

    /** Overlay pixel coordinates → normalised coordinates inside the video. */
    private float[] toVideoNormalized(float x, float y) {
        RectF rect = activeRect();
        float nx = rect.width() <= 0 ? 0 : (x - rect.left) / rect.width();
        float ny = rect.height() <= 0 ? 0 : (y - rect.top) / rect.height();
        return new float[]{clamp01(nx), clamp01(ny)};
    }

    private static float clamp01(float value) {
        return value < 0f ? 0f : (value > 1f ? 1f : value);
    }

    private ControllerLayout.Widget hitTest(float x, float y) {
        // Reverse order: the widget drawn last (on top) wins.
        for (int i = layout.widgets().size() - 1; i >= 0; i--) {
            ControllerLayout.Widget widget = layout.widgets().get(i);
            if (!widget.enabled) {
                continue;
            }
            float cx = widgetCenterX(widget);
            float cy = widgetCenterY(widget);
            float radius = widgetRadius(widget);
            float dx = x - cx;
            float dy = y - cy;
            if (widget.type == ControllerLayout.WidgetType.ZONE) {
                if (Math.abs(dx) <= radius * 1.6f && Math.abs(dy) <= radius * 1.6f) {
                    return widget;
                }
            } else if (Math.hypot(dx, dy) <= radius * 1.15f) {
                return widget;
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ *
     *  Touch
     * ------------------------------------------------------------------ */

    @SuppressLint("ClickableViewAccessibility")
    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        int index = event.getActionIndex();
        int pointerId = event.getPointerId(index);
        float x = event.getX(index);
        float y = event.getY(index);

        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                ControllerLayout.Widget widget = hitTest(x, y);
                if (widget == null) {
                    if (listener != null) {
                        listener.onTouchOutside();
                    }
                    return true;
                }
                pointerWidgets.put(pointerId, widget);
                if (editMode) {
                    dragging = widget;
                    dragOffsetX = widgetCenterX(widget) - x;
                    dragOffsetY = widgetCenterY(widget) - y;
                    downX = x;
                    downY = y;
                    return true;
                }
                haptic();
                if (widget.type == ControllerLayout.WidgetType.JOYSTICK) {
                    Stick stick = new Stick();
                    stick.anchorX = widgetCenterX(widget);
                    stick.anchorY = widgetCenterY(widget);
                    sticks.put(pointerId, stick);
                    // The stick's anchor is where the game's own virtual stick lives.
                    float[] anchor = toVideoNormalized(stick.anchorX, stick.anchorY);
                    listener.onPointerDown(pointerId, anchor[0], anchor[1]);
                    return true;
                }
                if (widget.type == ControllerLayout.WidgetType.DPAD) {
                    handleDpad(widget, x, y, true);
                    return true;
                }
                dispatch(widget, x, y, true);
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (dragging != null && editMode) {
                    RectF rect = activeRect();
                    ControllerLayout.Widget widget = dragging;
                    float cx = x + dragOffsetX;
                    float cy = y + dragOffsetY;
                    widget.x = clamp01((cx - rect.left) / rect.width());
                    widget.y = clamp01((cy - rect.top) / rect.height());
                    invalidate();
                    return true;
                }
                for (int i = 0; i < event.getPointerCount(); i++) {
                    int id = event.getPointerId(i);
                    ControllerLayout.Widget widget = pointerWidgets.get(id);
                    if (widget == null) {
                        continue;
                    }
                    float px = event.getX(i);
                    float py = event.getY(i);
                    if (widget.type == ControllerLayout.WidgetType.JOYSTICK) {
                        Stick stick = sticks.get(id);
                        if (stick == null) {
                            continue;
                        }
                        stick.dx = px - stick.anchorX;
                        stick.dy = py - stick.anchorY;
                        float radius = widgetRadius(widget);
                        double length = Math.hypot(stick.dx, stick.dy);
                        float scale = 1f;
                        if (length > 0.0001 && length > radius) {
                            scale = (float) (radius / length);
                        }
                        // Dead zone: 12 % of the stick radius, so a resting thumb
                        // never produces a phantom direction.
                        if (length < radius * 0.12) {
                            stick.dx = 0;
                            stick.dy = 0;
                        }
                        float[] target = toVideoNormalized(stick.anchorX + stick.dx * scale,
                                stick.anchorY + stick.dy * scale);
                        listener.onPointerMove(id, target[0], target[1]);
                        invalidate();
                    } else if (widget.type == ControllerLayout.WidgetType.DPAD) {
                        handleDpad(widget, px, py, false);
                    } else {
                        dispatch(widget, px, py, false);
                    }
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP:
            case MotionEvent.ACTION_CANCEL: {
                ControllerLayout.Widget widget = pointerWidgets.get(pointerId);
                pointerWidgets.remove(pointerId);
                sticks.remove(pointerId);
                if (dragging != null && editMode) {
                    dragging = null;
                    layout.clampAll();
                    listener.onLayoutEdited(layout);
                    return true;
                }
                if (widget == null) {
                    return true;
                }
                if (widget.type == ControllerLayout.WidgetType.DPAD) {
                    handleDpadCancel(widget);
                    return true;
                }
                if (widget.type == ControllerLayout.WidgetType.BUTTON
                        || widget.type == ControllerLayout.WidgetType.SHOULDER
                        || widget.type == ControllerLayout.WidgetType.TRIGGER
                        || widget.type == ControllerLayout.WidgetType.ZONE) {
                    dispatch(widget, x, y, false);
                }
                invalidate();
                return true;
            }
            default:
                return true;
        }
    }

    /**
     * A press is sent either as a key code or as a touch at the widget's own
     * position. Both paths are honest: one needs a game that accepts HID events,
     * the other needs the widget to sit over the game's real control.
     */
    private void dispatch(ControllerLayout.Widget widget, float x, float y, boolean pressed) {
        if (keyMode && widget.keyCode != 0) {
            listener.onKey(widget.keyCode, pressed);
            return;
        }
        float[] normalized = toVideoNormalized(x, y);
        if (pressed) {
            listener.onPointerDown(widgetPointerId(widget), normalized[0], normalized[1]);
        } else {
            listener.onPointerUp(widgetPointerId(widget), normalized[0], normalized[1]);
        }
    }

    /** Stable per-widget pointer id so overlapping presses do not cancel each other. */
    private int widgetPointerId(ControllerLayout.Widget widget) {
        int hash = widget.id.hashCode();
        return 1 + (Math.abs(hash) % 9);
    }

    private void handleDpad(ControllerLayout.Widget widget, float x, float y, boolean initial) {
        float cx = widgetCenterX(widget);
        float cy = widgetCenterY(widget);
        float radius = widgetRadius(widget);
        float dx = x - cx;
        float dy = y - cy;
        boolean left = dx < -radius * 0.3f;
        boolean right = dx > radius * 0.3f;
        boolean up = dy < -radius * 0.3f;
        boolean down = dy > radius * 0.3f;
        int[] horizontal = {android.view.KeyEvent.KEYCODE_DPAD_LEFT,
                android.view.KeyEvent.KEYCODE_DPAD_RIGHT};
        int[] vertical = {android.view.KeyEvent.KEYCODE_DPAD_UP,
                android.view.KeyEvent.KEYCODE_DPAD_DOWN};
        boolean[] horizontalState = {left, right};
        boolean[] verticalState = {up, down};

        if (keyMode) {
            for (int i = 0; i < 2; i++) {
                if (initial || horizontalState[i] != dpadState(widget, horizontal[i])) {
                    setDpadState(widget, horizontal[i], horizontalState[i]);
                }
                if (initial || verticalState[i] != dpadState(widget, vertical[i])) {
                    setDpadState(widget, vertical[i], verticalState[i]);
                }
            }
            return;
        }
        // Touch mode: only the dominant direction is pressed, at the d-pad centre.
        float[] center = toVideoNormalized(cx, cy);
        int pointer = widgetPointerId(widget);
        if (!left && !right && !up && !down) {
            listener.onPointerUp(pointer, center[0], center[1]);
            return;
        }
        float nx = center[0];
        float ny = center[1];
        if (Math.abs(dx) > Math.abs(dy)) {
            nx += (right ? 1 : -1) * 0.02f;
        } else {
            ny += (down ? 1 : -1) * 0.02f;
        }
        listener.onPointerDown(pointer, clamp01(nx), trim(ny));
    }

    private static float trim(float value) {
        return value < 0f ? 0f : (value > 1f ? 1f : value);
    }

    private final SparseArray<Boolean> dpadStates = new SparseArray<>();

    private boolean dpadState(ControllerLayout.Widget widget, int keyCode) {
        Boolean state = dpadStates.get(widget.id.hashCode() * 31 + keyCode);
        return state != null && state;
    }

    private void setDpadState(ControllerLayout.Widget widget, int keyCode, boolean pressed) {
        dpadStates.put(widget.id.hashCode() * 31 + keyCode, pressed);
        haptic();
        listener.onKey(keyCode, pressed);
    }

    private void handleDpadCancel(ControllerLayout.Widget widget) {
        if (keyMode) {
            for (int code : new int[]{android.view.KeyEvent.KEYCODE_DPAD_LEFT,
                    android.view.KeyEvent.KEYCODE_DPAD_RIGHT,
                    android.view.KeyEvent.KEYCODE_DPAD_UP,
                    android.view.KeyEvent.KEYCODE_DPAD_DOWN}) {
                if (dpadState(widget, code)) {
                    setDpadState(widget, code, false);
                }
            }
        } else {
            float[] center = toVideoNormalized(widgetCenterX(widget), widgetCenterY(widget));
            listener.onPointerUp(widgetPointerId(widget), center[0], center[1]);
        }
    }

    private void haptic() {
        if (!hapticsEnabled) {
            return;
        }
        try {
            performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ *
     *  Drawing
     * ------------------------------------------------------------------ */

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // Solid widgets would hide the game; everything is translucent.
        fill.setAlpha(editMode ? 110 : 64);
        stroke.setAlpha(editMode ? 220 : 130);
        text.setAlpha(editMode ? 255 : 190);

        for (ControllerLayout.Widget widget : layout.widgets()) {
            if (!widget.enabled) {
                continue;
            }
            float cx = widgetCenterX(widget);
            float cy = widgetCenterY(widget);
            float radius = widgetRadius(widget);
            switch (widget.type) {
                case JOYSTICK:
                    canvas.drawCircle(cx, cy, radius, fill);
                    canvas.drawCircle(cx, cy, radius, stroke);
                    drawStickKnob(canvas, widget, cx, cy, radius);
                    break;
                case DPAD:
                    drawDpad(canvas, cx, cy, radius);
                    break;
                case ZONE:
                    canvas.drawRect(cx - radius * 1.6f, cy - radius * 1.6f,
                            cx + radius * 1.6f, cy + radius * 1.6f, stroke);
                    break;
                default:
                    canvas.drawCircle(cx, cy, radius, fill);
                    canvas.drawCircle(cx, cy, radius, stroke);
                    break;
            }
            text.setTextSize(Math.max(dp(10f), radius * 0.5f));
            canvas.drawText(widget.label, cx, cy + radius * 0.16f, text);
        }

        if (editMode) {
            text.setTextSize(dp(13f));
            canvas.drawText(getContext().getString(com.neurio.langame.R.string.controller_edit_hint),
                    getWidth() / 2f, dp(28f), text);
        }
    }

    private void drawStickKnob(Canvas canvas, ControllerLayout.Widget widget, float cx, float cy,
                               float radius) {
        float knobX = cx;
        float knobY = cy;
        for (int i = 0; i < sticks.size(); i++) {
            Stick stick = sticks.valueAt(i);
            knobX = stick.anchorX + stick.dx;
            knobY = stick.anchorY + stick.dy;
            double length = Math.hypot(knobX - cx, knobY - cy);
            if (length > radius) {
                float scale = (float) (radius / length);
                knobX = cx + (knobX - cx) * scale;
                knobY = cy + (knobY - cy) * scale;
            }
        }
        knob.setAlpha(96);
        canvas.drawCircle(knobX, knobY, radius * 0.38f, knob);
        canvas.drawCircle(knobX, knobY, radius * 0.38f, stroke);
    }

    private void drawDpad(Canvas canvas, float cx, float cy, float radius) {
        float arm = radius * 0.34f;
        stroke.setStrokeWidth(dp(2f));
        canvas.drawRect(cx - arm, cy - radius, cx + arm, cy + radius, stroke);
        canvas.drawRect(cx - radius, cy - arm, cx + radius, cy + arm, stroke);
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    /** Clears all held pointers (called when the overlay is hidden or the stream ends). */
    public void releaseAll() {
        for (int i = 0; i < pointerWidgets.size(); i++) {
            int pointerId = pointerWidgets.keyAt(i);
            ControllerLayout.Widget widget = pointerWidgets.valueAt(i);
            float[] center = toVideoNormalized(widgetCenterX(widget), widgetCenterY(widget));
            listener.onPointerUp(pointerId, center[0], center[1]);
        }
        pointerWidgets.clear();
        sticks.clear();
        dpadStates.clear();
        invalidate();
    }

    public String describe() {
        return String.format(Locale.US, "%d controls · %s", layout.widgets().size(),
                editMode ? "edit" : (keyMode ? "keys" : "touch"));
    }
}
