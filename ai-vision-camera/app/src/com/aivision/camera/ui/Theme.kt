package com.aivision.camera.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.view.View
import android.widget.TextView
import com.aivision.camera.core.Ui
import android.content.res.ColorStateList

/**
 * Design tokens for the premium dark camera interface.
 *
 * Deliberately restrained: near-black surfaces, a single electric accent for the
 * AI actions, and typography that stays legible over a live preview.
 */
object Theme {
    val bg = Color.parseColor("#07090C")
    val surface = Color.parseColor("#12161C")
    val surfaceHigh = Color.parseColor("#1B212A")
    val stroke = Color.parseColor("#2A323D")
    val textPrimary = Color.parseColor("#F2F5F9")
    val textSecondary = Color.parseColor("#9AA6B6")
    val accent = Color.parseColor("#00E5FF")        // AI accent
    val accentDim = Color.parseColor("#0E6E7D")
    val ultra = Color.parseColor("#7C5CFF")         // AI Ultra accent
    val ultraDim = Color.parseColor("#3A2C7A")
    val warning = Color.parseColor("#FFB020")
    val danger = Color.parseColor("#FF4D5E")
    val ok = Color.parseColor("#39D98A")

    fun dp(ctx: Context, v: Float) = Ui.dp(ctx, v)

    fun rounded(fill: Int, radiusPx: Float, strokePx: Int = 0, strokeColor: Int = 0): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.RECTANGLE
        d.cornerRadius = radiusPx
        d.setColor(fill)
        if (strokePx > 0 && strokeColor != 0) d.setStroke(strokePx, strokeColor)
        return d
    }

    fun pill(ctx: Context, fill: Int, strokeColor: Int = stroke, alphaFill: Int = 0): GradientDrawable {
        val color = if (alphaFill > 0) withAlpha(fill, alphaFill) else fill
        return rounded(color, dp(ctx, 22f).toFloat(), dp(ctx, 1f), strokeColor)
    }

    fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    fun applyRipple(view: View, color: Int = Color.WHITE, radiusPx: Float = 48f): View {
        if (Build.VERSION.SDK_INT >= 21) {
            val mask = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = radiusPx
                setColor(Color.WHITE)
            }
            view.background = RippleDrawable(ColorStateList.valueOf(withAlpha(color, 60)), view.background, mask)
        }
        return view
    }

    fun text(ctx: Context, text: String, sizeSp: Float, color: Int = textPrimary,
             bold: Boolean = false, letterSpacing: Float = 0f): TextView {
        val tv = TextView(ctx)
        tv.text = text
        tv.setTextColor(color)
        tv.textSize = sizeSp
        tv.letterSpacing = letterSpacing
        if (bold) tv.typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        else tv.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        return tv
    }

    fun label(ctx: Context, text: String, color: Int = textSecondary): TextView {
        val tv = text(ctx, text, 10.5f, color, bold = true, letterSpacing = 0.08f)
        return tv
    }
}
