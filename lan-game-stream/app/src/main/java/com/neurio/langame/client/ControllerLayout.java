package com.neurio.langame.client;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * An editable on-screen controller layout.
 *
 * <p>Everything is expressed in normalised coordinates (0..1 of the widget's
 * container) so one layout works on any screen size and in both orientations.
 * Serialisation is a compact hand-rolled text format — no JSON library, no
 * dependency, and trivially readable in a bug report:</p>
 *
 * <pre>id|type|label|x|y|size|keyCode|enabled;…</pre>
 */
public final class ControllerLayout {

    public enum WidgetType {
        JOYSTICK,
        DPAD,
        BUTTON,
        SHOULDER,
        TRIGGER,
        ZONE
    }

    /** One control on the overlay. */
    public static final class Widget {
        public String id;
        public WidgetType type;
        public String label;
        /** Centre position, normalised to the controller area. */
        public float x;
        public float y;
        /** Width as a fraction of the shorter container side. */
        public float size;
        /** Optional Android key code used when a physical controller is attached. */
        public int keyCode;
        public boolean enabled = true;

        public Widget(String id, WidgetType type, String label, float x, float y, float size,
                      int keyCode) {
            this.id = id;
            this.type = type;
            this.label = label;
            this.x = x;
            this.y = y;
            this.size = size;
            this.keyCode = keyCode;
        }

        public Widget copy() {
            Widget w = new Widget(id, type, label, x, y, size, keyCode);
            w.enabled = enabled;
            return w;
        }

        /** Radius in pixels inside a container of the given size. */
        public float radiusPx(int width, int height) {
            return size * Math.min(width, height) * 0.5f;
        }
    }

    private final List<Widget> widgets = new ArrayList<>();

    public List<Widget> widgets() {
        return widgets;
    }

    public Widget findById(String id) {
        for (Widget widget : widgets) {
            if (widget.id.equals(id)) {
                return widget;
            }
        }
        return null;
    }

    public ControllerLayout copy() {
        ControllerLayout copy = new ControllerLayout();
        for (Widget widget : widgets) {
            copy.widgets.add(widget.copy());
        }
        return copy;
    }

    public void add(Widget widget) {
        widgets.add(widget);
    }

    /**
     * The default layout: analogue stick on the left, four action buttons and two
     * shoulders on the right — the shape most mobile games are designed around.
     * Players move and resize every element from the stream screen.
     */
    public static ControllerLayout defaultLayout() {
        ControllerLayout layout = new ControllerLayout();
        // Left side
        layout.add(new Widget("stick", WidgetType.JOYSTICK, "MOVE", 0.11f, 0.66f, 0.30f, 0));
        layout.add(new Widget("dpad", WidgetType.DPAD, "D-PAD", 0.13f, 0.26f, 0.20f, 0));
        layout.add(new Widget("sh_l", WidgetType.SHOULDER, "L", 0.13f, 0.06f, 0.16f, android.view.KeyEvent.KEYCODE_BUTTON_L1));
        layout.add(new Widget("tr_l", WidgetType.TRIGGER, "ZL", 0.30f, 0.05f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_L2));
        // Right side
        layout.add(new Widget("btn_a", WidgetType.BUTTON, "A", 0.88f, 0.70f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_A));
        layout.add(new Widget("btn_b", WidgetType.BUTTON, "B", 0.79f, 0.60f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_B));
        layout.add(new Widget("btn_x", WidgetType.BUTTON, "X", 0.97f, 0.60f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_X));
        layout.add(new Widget("btn_y", WidgetType.BUTTON, "Y", 0.88f, 0.50f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_Y));
        layout.add(new Widget("sh_r", WidgetType.SHOULDER, "R", 0.87f, 0.06f, 0.16f, android.view.KeyEvent.KEYCODE_BUTTON_R1));
        layout.add(new Widget("tr_r", WidgetType.TRIGGER, "ZR", 0.70f, 0.05f, 0.12f, android.view.KeyEvent.KEYCODE_BUTTON_R2));
        return layout;
    }

    /** Four ready-made layouts the player can switch between while playing. */
    public static final String[] PRESET_NAMES = {"Default", "Left-handed", "Minimal", "Racing"};

    public static ControllerLayout preset(int index) {
        switch (index) {
            case 1:
                return defaultLayout().mirrored();
            case 2:
                return minimal();
            case 3:
                return racing();
            case 0:
            default:
                return defaultLayout();
        }
    }

    /** Mirror of the default layout for left-handed players. */
    public ControllerLayout mirrored() {
        ControllerLayout copy = copy();
        for (Widget widget : copy.widgets) {
            widget.x = 1f - widget.x;
        }
        copy.clampAll();
        return copy;
    }

    public static ControllerLayout minimal() {
        ControllerLayout layout = new ControllerLayout();
        layout.add(new Widget("stick", WidgetType.JOYSTICK, "MOVE", 0.12f, 0.68f, 0.30f, 0));
        layout.add(new Widget("btn_a", WidgetType.BUTTON, "A", 0.88f, 0.70f, 0.14f,
                android.view.KeyEvent.KEYCODE_BUTTON_A));
        layout.add(new Widget("btn_b", WidgetType.BUTTON, "B", 0.76f, 0.58f, 0.14f,
                android.view.KeyEvent.KEYCODE_BUTTON_B));
        layout.add(new Widget("sh_r", WidgetType.SHOULDER, "R", 0.88f, 0.08f, 0.16f,
                android.view.KeyEvent.KEYCODE_BUTTON_R1));
        return layout;
    }

    public static ControllerLayout racing() {
        ControllerLayout layout = new ControllerLayout();
        layout.add(new Widget("steer", WidgetType.JOYSTICK, "STEER", 0.16f, 0.74f, 0.34f, 0));
        layout.add(new Widget("gas", WidgetType.BUTTON, "GAS", 0.88f, 0.80f, 0.16f,
                android.view.KeyEvent.KEYCODE_BUTTON_R1));
        layout.add(new Widget("brake", WidgetType.BUTTON, "BRAKE", 0.88f, 0.60f, 0.14f,
                android.view.KeyEvent.KEYCODE_BUTTON_L1));
        layout.add(new Widget("drift", WidgetType.BUTTON, "DRIFT", 0.72f, 0.72f, 0.12f,
                android.view.KeyEvent.KEYCODE_BUTTON_A));
        layout.add(new Widget("look", WidgetType.ZONE, "LOOK", 0.50f, 0.30f, 0.10f, 0));
        return layout;
    }

    /** Scales every control (the "smaller / bigger" buttons in edit mode). */
    public void resize(float factor) {
        for (Widget widget : widgets) {
            widget.size *= factor;
        }
        clampAll();
    }

    /** Restores the preset this layout came from, discarding manual tweaks. */
    public void resetToPreset(int index) {
        ControllerLayout preset = preset(index);
        widgets.clear();
        for (Widget widget : preset.widgets) {
            widgets.add(widget.copy());
        }
    }

    /* ------------------------------------------------------------------ *
     *  Persistence
     * ------------------------------------------------------------------ */

    public String serialize() {
        StringBuilder sb = new StringBuilder();
        for (Widget widget : widgets) {
            if (sb.length() > 0) {
                sb.append(';');
            }
            sb.append(widget.id).append('|')
                    .append(widget.type.name()).append('|')
                    .append(widget.label.replace("|", "").replace(";", "")).append('|')
                    .append(fmt(widget.x)).append('|')
                    .append(fmt(widget.y)).append('|')
                    .append(fmt(widget.size)).append('|')
                    .append(widget.keyCode).append('|')
                    .append(widget.enabled ? 1 : 0);
        }
        return sb.toString();
    }

    private static String fmt(float value) {
        return String.format(Locale.US, "%.4f", value);
    }

    public static ControllerLayout deserialize(String text) {
        if (text == null || text.trim().isEmpty()) {
            return defaultLayout();
        }
        ControllerLayout layout = new ControllerLayout();
        for (String chunk : text.split(";")) {
            String[] parts = chunk.split("\\|");
            if (parts.length < 8) {
                continue;
            }
            try {
                Widget widget = new Widget(parts[0], WidgetType.valueOf(parts[1]), parts[2],
                        Float.parseFloat(parts[3]), Float.parseFloat(parts[4]),
                        Float.parseFloat(parts[5]), Integer.parseInt(parts[6]));
                widget.enabled = "1".equals(parts[7]);
                layout.widgets.add(widget);
            } catch (Exception ignored) {
                // Skip malformed entries rather than losing the whole layout.
            }
        }
        if (layout.widgets.isEmpty()) {
            return defaultLayout();
        }
        return layout;
    }

    /** Clamp every widget so it cannot be dragged off screen. */
    public void clampAll() {
        for (Widget widget : widgets) {
            widget.x = clamp(widget.x, 0.04f, 0.96f);
            widget.y = clamp(widget.y, 0.05f, 0.95f);
            widget.size = clamp(widget.size, 0.06f, 0.6f);
        }
    }

    private static float clamp(float value, float min, float max) {
        return value < min ? min : (value > max ? max : value);
    }
}
