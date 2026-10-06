package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.hardware.camera2.CaptureResult;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import com.aivision.camera.camera.CameraController;
import com.aivision.camera.camera.Capabilities;

/**
 * Pro mode panel with real manual controls: ISO, shutter speed, focus distance, white balance
 * temperature and exposure compensation, all of which map onto actual Camera2 capture request keys.
 * Also shows the values the sensor is really using, straight from the capture result.
 */
public class ProPanel extends LinearLayout {

    public interface Listener {
        void onManualChanged(CameraController.Manual m);

        void onRawToggled(boolean raw);
    }

    private static final long[] SHUTTERS = {
            30_000_000_000L, 15_000_000_000L, 8_000_000_000L, 4_000_000_000L, 2_000_000_000L,
            1_000_000_000L, 500_000_000L, 250_000_000L, 125_000_000L, 60_000_000L, 30_000_000L,
            15_000_000L, 8_000_000L, 4_000_000L, 2_000_000L, 1_000_000L, 500_000L, 250_000L, 125_000L};

    private final TextView live;
    private final TextView isoValue, shutterValue, focusValue, wbValue, evValue;
    private final SeekBar isoBar, shutterBar, focusBar, wbBar, evBar;
    private final TextView isoLabel, shutterLabel, focusLabel, wbLabel, evLabel;
    private final com.aivision.camera.ui.IconButton autoBtn, rawBtn;
    private final com.aivision.camera.ui.IconButton[] autoToggles = new com.aivision.camera.ui.IconButton[4];
    private Listener listener;
    private Capabilities caps;
    private CameraController.Manual manual = new CameraController.Manual();
    private boolean suppress;

    public ProPanel(Context ctx) {
        super(ctx);
        setOrientation(VERTICAL);
        setBackgroundColor(0xE60B0D10);
        float d = ctx.getResources().getDisplayMetrics().density;
        int pad = Math.round(d * 12);
        setPadding(pad, pad, pad, pad);

        LinearLayout header = new LinearLayout(ctx);
        header.setOrientation(HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(ctx);
        title.setText("PRO CONTROLS");
        title.setTextSize(11f);
        title.setTextColor(0xFFFFC24B);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setLetterSpacing(0.12f);
        header.addView(title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        autoBtn = new com.aivision.camera.ui.IconButton(ctx).icon(Icons.AI).label("AUTO").style(com.aivision.camera.ui.IconButton.STYLE_GHOST).iconSize(18f);
        autoBtn.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                manual.enabled = !manual.enabled;
                autoBtn.setSelectedState(manual.enabled);
                push();
            }
        });
        header.addView(autoBtn);
        rawBtn = new com.aivision.camera.ui.IconButton(ctx).icon(Icons.RAW).label("RAW").style(com.aivision.camera.ui.IconButton.STYLE_GHOST).iconSize(18f);
        rawBtn.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                rawBtn.setSelectedState(!rawBtn.selectedState());
                if (listener != null) listener.onRawToggled(rawBtn.selectedState());
            }
        });
        header.addView(rawBtn);
        addView(header);

        live = new TextView(ctx);
        live.setTextSize(10.5f);
        live.setTextColor(0xB3FFFFFF);
        live.setPadding(0, Math.round(d * 4), 0, Math.round(d * 8));
        addView(live);

        isoValue = addValueRow("ISO", "ISO", true);
        isoBar = addBar();
        isoLabel = (TextView) isoBar.getTag();
        isoBar.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                manual.iso = 50 * (1 + progress);
                isoValue.setText(String.valueOf(manual.iso));
                if (fromUser) {
                    manual.autoIso = false;
                    push();
                }
            }
        });

        shutterValue = addValueRow("SHUTTER", "SPEED", true);
        shutterBar = addBar();
        shutterLabel = (TextView) shutterBar.getTag();
        shutterBar.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                manual.exposureNs = SHUTTERS[Math.max(0, Math.min(SHUTTERS.length - 1, progress))];
                shutterValue.setText(CameraController.shutterLabel(manual.exposureNs));
                if (fromUser) {
                    manual.autoShutter = false;
                    push();
                }
            }
        });

        focusValue = addValueRow("FOCUS", "FOCUS", true);
        focusBar = addBar();
        focusLabel = (TextView) focusBar.getTag();
        focusBar.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                float maxDp = caps == null ? 10f : Math.max(0.5f, caps.minFocusDistance);
                manual.focusDiopters = maxDp * progress / 100f;
                focusValue.setText(focusText(manual.focusDiopters));
                if (fromUser) {
                    manual.autoFocus = false;
                    push();
                }
            }
        });

        wbValue = addValueRow("WHITE BALANCE", "WB", true);
        wbBar = addBar();
        wbLabel = (TextView) wbBar.getTag();
        wbBar.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                manual.wbTemperature = 2000f + progress * 60f;   // 2000K .. 8000K
                wbValue.setText(Math.round(manual.wbTemperature) + "K");
                if (fromUser) {
                    manual.autoWb = false;
                    push();
                }
            }
        });

        evValue = addValueRow("EXPOSURE", "EXPOSURE", true);
        evBar = addBar();
        evLabel = (TextView) evBar.getTag();
        evBar.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                manual.evCompensation = (progress - 12) / 6f;    // -2 .. +2 EV in 1/6 steps
                evValue.setText(String.format(java.util.Locale.US, "%+.1f EV", manual.evCompensation));
                if (fromUser) push();
            }
        });

        LinearLayout locks = new LinearLayout(ctx);
        locks.setOrientation(HORIZONTAL);
        locks.setPadding(0, Math.round(d * 4), 0, 0);
        String[] names = {"AE LOCK", "AF LOCK", "AWB LOCK"};
        for (int i = 0; i < names.length; i++) {
            final int idx = i;
            com.aivision.camera.ui.IconButton b = new com.aivision.camera.ui.IconButton(ctx)
                    .icon(i == 0 ? Icons.EXPOSURE : (i == 1 ? Icons.FOCUS : Icons.WB))
                    .label(names[i]).iconSize(18f).style(com.aivision.camera.ui.IconButton.STYLE_GHOST);
            b.setOnClickListener(new OnClickListener() {
                @Override
                public void onClick(View v) {
                    manual.autoIso = !(idx == 0);
                    manual.autoFocus = !(idx == 1);
                    manual.autoWb = !(idx == 2);
                    b.setSelectedState(!b.selectedState());
                    push();
                }
            });
            locks.addView(b, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        }
        addView(locks);
        setManual(manual);
    }

    private String focusText(float diopters) {
        if (diopters <= 0.02f) return "Infinity";
        float meters = 1f / diopters;
        if (meters >= 1f) return String.format(java.util.Locale.US, "%.1f m", meters);
        return String.format(java.util.Locale.US, "%.0f cm", meters * 100f);
    }

    private TextView addValueRow(String title, String iconName, boolean withIcon) {
        float d = getResources().getDisplayMetrics().density;
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, Math.round(d * 6), 0, 0);
        TextView t = new TextView(getContext());
        t.setText(title);
        t.setTextSize(10f);
        t.setTextColor(0x99FFFFFF);
        t.setLetterSpacing(0.08f);
        row.addView(t, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        TextView v = new TextView(getContext());
        v.setTextSize(11.5f);
        v.setTextColor(Color.WHITE);
        v.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        row.addView(v);
        addView(row);
        return v;
    }

    private SeekBar addBar() {
        float d = getResources().getDisplayMetrics().density;
        SeekBar bar = new SeekBar(getContext());
        bar.setMax(100);
        bar.setPadding(0, 0, 0, 0);
        LinearLayout wrap = new LinearLayout(getContext());
        wrap.setOrientation(VERTICAL);
        wrap.addView(bar, new LayoutParams(LayoutParams.MATCH_PARENT, Math.round(d * 34)));
        addView(wrap);
        return bar;
    }

    abstract static class SimpleSeek implements SeekBar.OnSeekBarChangeListener {
        @Override
        public void onStartTrackingTouch(SeekBar seekBar) {
        }

        @Override
        public void onStopTrackingTouch(SeekBar seekBar) {
        }
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public CameraController.Manual manual() {
        return manual;
    }

    public void setRawAvailable(boolean available) {
        rawBtn.setEnabled(available);
        if (!available) rawBtn.setSelectedState(false);
    }

    public void setCaps(Capabilities c) {
        caps = c;
        suppress = true;
        isoBar.setMax(Math.max(4, (int) (c.maxIso / 50) - 1));
        manual.iso = Math.max(c.minIso, Math.min(c.maxIso, 200));
        isoBar.setProgress(manual.iso / 50 - 1);
        shutterBar.setProgress(9);
        manual.exposureNs = SHUTTERS[9];
        focusBar.setProgress(0);
        wbBar.setProgress(50);
        evBar.setProgress(12);
        boolean manualOk = c.manualExposureSupported && c.manualSensor;
        isoBar.setEnabled(manualOk);
        shutterBar.setEnabled(manualOk);
        focusBar.setEnabled(c.manualFocusSupported);
        wbBar.setEnabled(manualOk);
        if (!manualOk) {
            live.setText("This camera does not expose manual sensor controls; ISO and shutter follow the "
                    + "device's auto exposure. Exposure compensation, focus and white balance remain available.");
        } else {
            live.setText("Manual sensor:" + (c.manualSensor ? " yes" : " no")
                    + "  ISO " + c.minIso + "-" + c.maxIso
                    + "  shutter " + CameraController.shutterLabel(c.maxExposureNs) + "-"
                    + CameraController.shutterLabel(c.minExposureNs));
        }
        suppress = false;
        push();
    }

    public void setManual(CameraController.Manual m) {
        manual = m;
        suppress = true;
        isoBar.setProgress(Math.max(0, m.iso / 50 - 1));
        int best = 0;
        for (int i = 0; i < SHUTTERS.length; i++) {
            if (SHUTTERS[i] >= m.exposureNs) best = i;
        }
        shutterBar.setProgress(best);
        wbBar.setProgress((int) ((m.wbTemperature - 2000f) / 60f));
        evBar.setProgress(Math.round(m.evCompensation * 6) + 12);
        autoBtn.setSelectedState(m.enabled);
        suppress = false;
        isoValue.setText(String.valueOf(m.iso));
        shutterValue.setText(CameraController.shutterLabel(m.exposureNs));
        wbValue.setText(Math.round(m.wbTemperature) + "K");
        evValue.setText(String.format(java.util.Locale.US, "%+.1f EV", m.evCompensation));
        focusValue.setText(focusText(m.focusDiopters));
    }

    private void push() {
        if (suppress) return;
        if (listener != null) listener.onManualChanged(manual);
    }

    /** Live values measured by the sensor, shown so Pro mode is not guesswork. */
    public void updateLive(CaptureResult r) {
        if (r == null) return;
        Integer iso = r.get(CaptureResult.SENSOR_SENSITIVITY);
        Long exp = r.get(CaptureResult.SENSOR_EXPOSURE_TIME);
        Float fd = r.get(CaptureResult.LENS_FOCUS_DISTANCE);
        Integer awb = r.get(CaptureResult.COLOR_CORRECTION_MODE);
        Float f = r.get(CaptureResult.LENS_FOCUS_DISTANCE);
        StringBuilder sb = new StringBuilder();
        sb.append("live  ISO ").append(iso == null ? "-" : iso);
        sb.append("   ").append(exp == null ? "-" : CameraController.shutterLabel(exp));
        sb.append("   ").append(fd == null ? "focus -" : "focus " + focusText(fd));
        sb.append("   WB ").append(awb == null ? "-" : (awb == 0 ? "auto" : "manual"));
        live.setText(sb.toString());
    }
}
