package com.neurio.lanstream.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

object UiKit {
    const val BG = 0xFF080C16.toInt()
    const val CARD = 0xFF101827.toInt()
    const val CARD_ALT = 0xFF141F31.toInt()
    const val WHITE = 0xFFF3F7FF.toInt()
    const val MUTED = 0xFFA0ADC1.toInt()
    const val CYAN = 0xFF54E4FF.toInt()
    const val PURPLE = 0xFFA885FF.toInt()
    const val GREEN = 0xFF4CE6C8.toInt()
    const val RED = 0xFFFF748C.toInt()

    fun dp(context: Context, value: Float): Int = (value * context.resources.displayMetrics.density + .5f).toInt()

    fun text(context: Context, value: CharSequence, sizeSp: Float, color: Int = WHITE, bold: Boolean = false): TextView =
        TextView(context).apply {
            text = value
            textSize = sizeSp
            setTextColor(color)
            typeface = if (bold) Typeface.create("sans-serif", Typeface.BOLD) else Typeface.create("sans-serif", Typeface.NORMAL)
            includeFontPadding = true
        }

    fun card(context: Context, paddingDp: Int = 18, alternate: Boolean = false): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(context, paddingDp.toFloat()), dp(context, paddingDp.toFloat()), dp(context, paddingDp.toFloat()), dp(context, paddingDp.toFloat()))
        background = rounded(if (alternate) CARD_ALT else CARD, dp(context, 22f), 0xFF26364D.toInt(), dp(context, 1f))
    }

    fun rounded(fill: Int, radius: Int, stroke: Int = Color.TRANSPARENT, strokeWidth: Int = 0): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radius.toFloat()
            setColor(fill)
            if (strokeWidth > 0) setStroke(strokeWidth, stroke)
        }

    fun primaryButton(context: Context, title: String, onClick: () -> Unit): TextView = TextView(context).apply {
        text = title
        textSize = 15f
        setTextColor(0xFF07111D.toInt())
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        gravity = Gravity.CENTER
        minHeight = dp(context, 54f)
        setPadding(dp(context, 18f), dp(context, 12f), dp(context, 18f), dp(context, 12f))
        background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(CYAN, 0xFF94F4D7.toInt())).apply {
            cornerRadius = dp(context, 17f).toFloat()
        }
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

    fun secondaryButton(context: Context, title: String, onClick: () -> Unit): TextView = TextView(context).apply {
        text = title
        textSize = 14f
        setTextColor(WHITE)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        gravity = Gravity.CENTER
        minHeight = dp(context, 50f)
        setPadding(dp(context, 16f), dp(context, 10f), dp(context, 16f), dp(context, 10f))
        background = rounded(CARD_ALT, dp(context, 16f), 0xFF354863.toInt(), dp(context, 1f))
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

    fun addSpace(context: Context, parent: LinearLayout, heightDp: Int) {
        parent.addView(View(context), LinearLayout.LayoutParams(1, dp(context, heightDp.toFloat())))
    }

    fun smallPill(context: Context, title: String, color: Int = CYAN): TextView = TextView(context).apply {
        text = title
        textSize = 10f
        setTextColor(color)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dp(context, 10f), dp(context, 6f), dp(context, 10f), dp(context, 6f))
        background = rounded(0x222D4058, dp(context, 30f), 0x553C5979, dp(context, 1f))
    }

    fun row(context: Context, left: View, right: View): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(left, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(right, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }
}
