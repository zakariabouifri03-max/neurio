package com.neurio.client

import android.content.Context
import android.util.AttributeSet
import android.view.SurfaceView

/** Plain SurfaceView subclass so XML can reference it by full name. */
class StreamSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr)
