package com.aivision.camera.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import com.aivision.camera.App;
import com.aivision.camera.camera.Capabilities;

/**
 * Settings sheet. Everything here writes to the real preferences the capture pipeline reads, and the
 * bottom of the sheet shows the measured device profile so the user can see the tier and budget the AI
 * is actually running with on this phone.
 */
public final class SettingsDialog {

    public interface OnChange {
        void onSettingsChanged();
    }

    private SettingsDialog() {
    }

    public static void show(final Activity act, final Capabilities caps, final OnChange cb) {
        final Context ctx = act;
        final SharedPreferences p = App.get().prefs();
        float d = ctx.getResources().getDisplayMetrics().density;

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(d * 16);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(0xFF0B0D10);

        addTitle(root, "CAPTURE");
        addSwitch(ctx, root, "Rule of thirds grid", "grid", p, cb);
        addSwitch(ctx, root, "Level indicator", "level", p, cb);
        addSwitch(ctx, root, "Live histogram", "histogram", p, cb);
        addSwitch(ctx, root, "Save RAW (DNG) with each shot", "keep_raw", p, cb);
        addSwitch(ctx, root, "AI watermark on enhanced shots", "watermark", p, cb);
        addSwitch(ctx, root, "Haptic feedback", "haptics", p, cb);
        addSwitch(ctx, root, "Face detection for portrait mode", "faces", p, cb);

        addTitle(root, "AI");
        final TextView strengthValue = new TextView(ctx);
        strengthValue.setTextColor(Color.WHITE);
        strengthValue.setTextSize(11);
        final SeekBar strength = new SeekBar(ctx);
        strength.setMax(100);
        strength.setProgress((int) (p.getFloat("ai_strength", 1f) * 100));
        strengthValue.setText(String.format(java.util.Locale.US, "AI strength  %.0f%%", p.getFloat("ai_strength", 1f) * 100));
        strength.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int prog, boolean fromUser) {
                if (!fromUser) return;
                float v = prog / 100f;
                p.edit().putFloat("ai_strength", v).apply();
                strengthValue.setText(String.format(java.util.Locale.US, "AI strength  %.0f%%", v * 100));
                cb.onSettingsChanged();
            }

            @Override
            public void onStartTrackingTouch(SeekBar sb) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar sb) {
            }
        });
        root.addView(strengthValue);
        root.addView(strength);

        final TextView resValue = new TextView(ctx);
        resValue.setTextColor(Color.WHITE);
        resValue.setTextSize(11);
        final SeekBar frames = new SeekBar(ctx);
        int tierFrames = App.get().tier().maxBurstFrames;
        frames.setMax(Math.max(1, tierFrames));
        frames.setProgress(Math.min(tierFrames, p.getInt("frames", Math.min(6, tierFrames))));
        final String resText = "Burst frames  " + frames.getProgress() + "  (AI detail from multiple exposures)";
        resValue.setText(resText);
        frames.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int prog, boolean fromUser) {
                resValue.setText("Burst frames  " + prog + "  (AI detail from multiple exposures)");
                if (fromUser) {
                    p.edit().putInt("frames", prog).apply();
                    cb.onSettingsChanged();
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar sb) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar sb) {
            }
        });
        root.addView(resValue);
        root.addView(frames);

        addSwitch(ctx, root, "Keep full sensor resolution", "keep_full", p, cb);
        addSwitch(ctx, root, "Prefer on-device processing only (never upload)", "on_device", p, cb);

        addTitle(root, "DEVICE PROFILE");
        TextView info = new TextView(ctx);
        info.setTextColor(0xB3FFFFFF);
        info.setTextSize(10.5f);
        info.setText(App.get().profiler().summary()
                + "\nGPU: " + App.get().profiler().gpuSummary()
                + "\nAI thread budget: " + App.get().profiler().getAiThreads()
                + "\nTier: " + App.get().tier().label + "  working edge " + App.get().tier().workingLongEdge
                + " px, up to " + App.get().tier().maxBurstFrames + " frames, up to "
                + App.get().tier().maxUltraScale + "x AI Ultra scale"
                + (caps != null ? "\n\nCAMERA\n" + caps.describe() : ""));
        root.addView(info);

        ScrollView sc = new ScrollView(ctx);
        sc.addView(root);
        sc.setBackgroundColor(0xFF0B0D10);

        new AlertDialog.Builder(act)
                .setTitle("AI Vision Camera settings")
                .setView(sc)
                .setPositiveButton("Done", null)
                .show();
    }

    private static void addTitle(LinearLayout root, String text) {
        TextView t = new TextView(root.getContext());
        t.setText(text);
        t.setTextSize(10.5f);
        t.setTextColor(0xFFFFC24B);
        t.setLetterSpacing(0.14f);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        float d = root.getContext().getResources().getDisplayMetrics().density;
        t.setPadding(0, Math.round(d * 14), 0, Math.round(d * 4));
        root.addView(t);
    }

    private static void addSwitch(Context ctx, LinearLayout root, String label, final String key,
                                  final SharedPreferences p, final OnChange cb) {
        Switch s = new Switch(ctx);
        s.setText(label);
        s.setTextColor(0xF2FFFFFF);
        s.setTextSize(12f);
        s.setChecked(p.getBoolean(key, defaultFor(key)));
        s.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                p.edit().putBoolean(key, checked).apply();
                cb.onSettingsChanged();
            }
        });
        root.addView(s);
    }

    public static boolean defaultFor(String key) {
        if ("level".equals(key)) return true;
        if ("histogram".equals(key)) return true;
        if ("faces".equals(key)) return true;
        if ("haptics".equals(key)) return true;
        if ("keep_full".equals(key)) return true;
        if ("on_device".equals(key)) return true;
        return false;
    }
}
