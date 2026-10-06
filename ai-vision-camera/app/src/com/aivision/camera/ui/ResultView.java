package com.aivision.camera.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.aivision.camera.ai.EngineBridge;

/**
 * The result sheet shown right after a capture: the real before/after comparison, the measured AI
 * report, and the actions (save, share, discard, run AI Ultra again). This is what makes the app's
 * claims checkable by the user instead of decorative.
 */
public class ResultView extends FrameLayout {

    public interface Listener {
        void onSave();

        void onDiscard();

        void onUltra();

        void onShare();

        void onOpenGallery();
    }

    private final CompareView compare;
    private final TextView title, subtitle, reportText, rawTag;
    private final ScrollView reportScroll;
    private final IconButton ultraBtn;
    private Listener listener;

    public ResultView(Context ctx) {
        super(ctx);
        float d = ctx.getResources().getDisplayMetrics().density;
        setBackgroundColor(0xFF060709);
        setVisibility(GONE);

        compare = new CompareView(ctx);
        LayoutParams cParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
        cParams.topMargin = Math.round(d * 56);
        cParams.bottomMargin = Math.round(d * 132);
        addView(compare, cParams);

        // ------------------------------------------------------------------ top bar
        LinearLayout top = new LinearLayout(ctx);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(0xE60B0D10);
        top.setPadding(Math.round(d * 6), Math.round(d * 14), Math.round(d * 6), Math.round(d * 6));
        IconButton close = new IconButton(ctx).icon(Icons.CLOSE).iconSize(20f).style(IconButton.STYLE_PLAIN);
        close.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onDiscard();
            }
        });
        top.addView(close);
        LinearLayout titles = new LinearLayout(ctx);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(Math.round(d * 6), 0, 0, 0);
        title = new TextView(ctx);
        title.setTextColor(Color.WHITE);
        title.setTextSize(14f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        subtitle = new TextView(ctx);
        subtitle.setTextColor(0x99FFFFFF);
        subtitle.setTextSize(10.5f);
        titles.addView(title);
        titles.addView(subtitle);
        top.addView(titles, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        rawTag = new TextView(ctx);
        rawTag.setTextColor(0xFF4CE0D2);
        rawTag.setTextSize(10f);
        top.addView(rawTag);
        IconButton gallery = new IconButton(ctx).icon(Icons.GALLERY).iconSize(20f).style(IconButton.STYLE_PLAIN);
        gallery.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onOpenGallery();
            }
        });
        top.addView(gallery);
        IconButton share = new IconButton(ctx).icon(Icons.SHARE).iconSize(20f).style(IconButton.STYLE_PLAIN);
        share.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onShare();
            }
        });
        top.addView(share);
        addView(top, new LayoutParams(LayoutParams.MATCH_PARENT, Math.round(d * 56)));

        // ------------------------------------------------------------------ bottom actions
        LinearLayout bottom = new LinearLayout(ctx);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackgroundColor(0xE60B0D10);
        bottom.setPadding(Math.round(d * 8), Math.round(d * 4), Math.round(d * 8), Math.round(d * 10));

        reportScroll = new ScrollView(ctx);
        reportScroll.setVisibility(GONE);
        reportText = new TextView(ctx);
        reportText.setTextColor(0xD9FFFFFF);
        reportText.setTextSize(10.5f);
        reportText.setTypeface(Typeface.MONOSPACE);
        reportText.setPadding(Math.round(d * 8), Math.round(d * 6), Math.round(d * 8), Math.round(d * 6));
        reportScroll.addView(reportText);
        bottom.addView(reportScroll, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, Math.round(d * 150)));

        LinearLayout actions = new LinearLayout(ctx);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        ultraBtn = new IconButton(ctx).icon(Icons.ULTRA).label("AI ULTRA").style(IconButton.STYLE_GHOST).iconSize(20f);
        ultraBtn.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onUltra();
            }
        });
        actions.addView(ultraBtn, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        IconButton report = new IconButton(ctx).icon(Icons.INFO).label("REPORT").style(IconButton.STYLE_GHOST).iconSize(20f);
        report.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                reportScroll.setVisibility(reportScroll.getVisibility() == VISIBLE ? GONE : VISIBLE);
            }
        });
        actions.addView(report, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        IconButton trash = new IconButton(ctx).icon(Icons.TRASH).label("DISCARD").style(IconButton.STYLE_GHOST).iconSize(20f);
        trash.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onDiscard();
            }
        });
        actions.addView(trash, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        IconButton save = new IconButton(ctx).icon(Icons.SAVE).label("SAVE").style(IconButton.STYLE_FILLED)
                .iconSize(22f).colors(0xFFFFFFFF, 0xFFFFC24B, 0xFFFFC24B);
        save.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) listener.onSave();
            }
        });
        actions.addView(save, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1.2f));
        bottom.addView(actions);
        LayoutParams bParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        bParams.gravity = Gravity.BOTTOM;
        addView(bottom, bParams);
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void show(Bitmap before, Bitmap enhanced, String titleText, String subtitleText,
                     String reportJson, boolean canUltra, boolean rawSaved) {
        compare.set(before, enhanced);
        title.setText(titleText);
        subtitle.setText(subtitleText == null ? "" : subtitleText);
        reportText.setText(EngineBridge.humanReport(reportJson));
        reportScroll.setVisibility(GONE);
        ultraBtn.setEnabled(canUltra);
        ultraBtn.setAlpha(canUltra ? 1f : 0.35f);
        rawTag.setText(rawSaved ? "DNG saved" : "");
        setVisibility(VISIBLE);
        bringToFront();
    }

    public void hide() {
        setVisibility(GONE);
    }

    public boolean isShowing() {
        return getVisibility() == VISIBLE;
    }

    public CompareView compareView() {
        return compare;
    }
}
