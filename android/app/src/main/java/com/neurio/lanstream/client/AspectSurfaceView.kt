package com.neurio.lanstream.client

import android.content.Context
import android.util.AttributeSet
import android.view.SurfaceView
import kotlin.math.min

class AspectSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SurfaceView(context, attrs) {
    @Volatile private var videoWidth = 16
    @Volatile private var videoHeight = 9

    fun setVideoSize(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        videoWidth = width
        videoHeight = height
        requestLayout()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val availableWidth = MeasureSpec.getSize(widthMeasureSpec)
        val availableHeight = MeasureSpec.getSize(heightMeasureSpec)
        val widthMode = MeasureSpec.getMode(widthMeasureSpec)
        val heightMode = MeasureSpec.getMode(heightMeasureSpec)
        val maxWidth = if (widthMode == MeasureSpec.UNSPECIFIED) resources.displayMetrics.widthPixels else availableWidth
        val maxHeight = if (heightMode == MeasureSpec.UNSPECIFIED) resources.displayMetrics.heightPixels else availableHeight
        val scale = min(maxWidth.toDouble() / videoWidth, maxHeight.toDouble() / videoHeight)
        val measuredWidth = (videoWidth * scale).toInt().coerceAtLeast(1)
        val measuredHeight = (videoHeight * scale).toInt().coerceAtLeast(1)
        setMeasuredDimension(measuredWidth, measuredHeight)
    }
}
