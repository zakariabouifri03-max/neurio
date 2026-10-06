package com.neurio.langame.ui.views;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.neurio.langame.R;

/**
 * Small programmatic styling kit.
 *
 * <p>The screens use XML for structure and this class for anything that has to be
 * generated (list rows, chips, metric grids). Keeping the palette in one place is
 * what makes the dark theme consistent, and it avoids pulling in a design library
 * — the app has no third-party dependencies at all.</p>
 */
public final class UiKit {

    public static final int TEXT_PRIMARY = 0xFFF2F6FF;
    public static final int TEXT_SECONDARY = 0xFF9AA9C7;
    public static final int TEXT_TERTIARY = 0xFF5E6C88;
    public static final int ACCENT = 0xFF28E0C8;
    public static final int ACCENT_ALT = 0xFF7C5CFF;
    public static final int OK = 0xFF4DFFA1;
    public static final int WARN = 0xFFFFC14D;
    public static final int DANGER = 0xFFFF4D6D;
    public static final int SURFACE = 0xFF101828;
    public static final int SURFACE_ALT = 0xFF172038;

    private UiKit() {
    }

    public static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    public static LinearLayout vertical(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    public static LinearLayout horizontal(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    public static LinearLayout card(Context context) {
        LinearLayout layout = vertical(context);
        layout.setBackgroundResource(R.drawable.bg_card);
        int padding = dp(context, 16);
        layout.setPadding(padding, padding, padding, padding);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(context, 14);
        layout.setLayoutParams(params);
        return layout;
    }

    public static TextView text(Context context, CharSequence value, float sizeSp, int color,
                                boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return view;
    }

    public static TextView caption(Context context, CharSequence value) {
        return text(context, value, 12f, TEXT_SECONDARY, false);
    }

    public static TextView section(Context context, CharSequence value) {
        TextView view = text(context, value, 12f, TEXT_TERTIARY, true);
        view.setLetterSpacing(0.18f);
        view.setAllCaps(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(context, 6);
        params.bottomMargin = dp(context, 6);
        view.setLayoutParams(params);
        return view;
    }

    public static GradientDrawable pill(Context context, int color, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(dp(context, 100));
        drawable.setColor(color);
        if (strokeColor != 0) {
            drawable.setStroke(dp(context, 1), strokeColor);
        }
        return drawable;
    }

    /** A tappable chip; the selected variant is accent-tinted. */
    public static TextView chip(Context context, CharSequence label, boolean selected,
                                View.OnClickListener clickListener) {
        TextView view = text(context, label, 13f, selected ? ACCENT : TEXT_SECONDARY, selected);
        int paddingH = dp(context, 14);
        int paddingV = dp(context, 8);
        view.setPadding(paddingH, paddingV, paddingH, paddingV);
        view.setBackground(selected
                ? pill(context, 0x3328E0C8, 0x9928E0C8)
                : pill(context, 0x14FFFFFF, 0x26FFFFFF));
        if (clickListener != null) {
            view.setOnClickListener(clickListener);
            view.setClickable(true);
        }
        return view;
    }

    /** Adds a chip to a horizontal row with a leading margin. */
    public static void addChip(LinearLayout row, TextView chipView) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.rightMargin = dp(row.getContext(), 8);
        chipView.setLayoutParams(params);
        row.addView(chipView);
    }

    /**
     * Generic list row: optional icon, title, subtitle and a trailing badge —
     * shared by the game library and the host browser.
     */
    public static LinearLayout listRow(Context context, Bitmap icon, CharSequence title,
                                       CharSequence subtitle, CharSequence trailing,
                                       int trailingColor, View.OnClickListener clickListener) {
        LinearLayout row = horizontal(context);
        row.setBackgroundResource(R.drawable.bg_card);
        int padding = dp(context, 12);
        row.setPadding(padding, padding, padding, padding);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.bottomMargin = dp(context, 8);
        row.setLayoutParams(rowParams);

        if (icon != null) {
            ImageView image = new ImageView(context);
            int size = dp(context, 44);
            LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(size, size);
            iconParams.rightMargin = dp(context, 12);
            image.setLayoutParams(iconParams);
            image.setImageBitmap(icon);
            row.addView(image);
        }

        LinearLayout labels = vertical(context);
        LinearLayout.LayoutParams labelsParams = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        labels.setLayoutParams(labelsParams);

        TextView titleView = text(context, title, 15f, TEXT_PRIMARY, true);
        titleView.setMaxLines(1);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        labels.addView(titleView);

        TextView subtitleView = text(context, subtitle, 12f, TEXT_SECONDARY, false);
        subtitleView.setMaxLines(2);
        subtitleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        labels.addView(subtitleView);
        row.addView(labels);

        if (trailing != null && trailing.length() > 0) {
            TextView badge = text(context, trailing, 12f, trailingColor, true);
            badge.setBackground(pill(context, 0x1AFFFFFF, 0x26FFFFFF));
            int paddingH = dp(context, 10);
            int paddingV = dp(context, 5);
            badge.setPadding(paddingH, paddingV, paddingH, paddingV);
            LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            badgeParams.leftMargin = dp(context, 8);
            badge.setLayoutParams(badgeParams);
            row.addView(badge);
        }

        if (clickListener != null) {
            row.setOnClickListener(clickListener);
            row.setClickable(true);
            row.setFocusable(true);
        }
        return row;
    }

    public static void setVisible(View view, boolean visible) {
        if (view != null) {
            view.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    public static void toast(Context context, CharSequence message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    public static String formatMbps(float mbps) {
        return String.format(java.util.Locale.US, "%.1f Mbps", mbps);
    }

    public static String formatMs(float millis) {
        if (millis < 0) {
            return "—";
        }
        return String.format(java.util.Locale.US, "%.0f ms", millis);
    }
}
