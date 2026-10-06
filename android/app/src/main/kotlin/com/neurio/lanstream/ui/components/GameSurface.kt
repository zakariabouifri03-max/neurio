package com.neurio.lanstream.ui.components

import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * The stream target.
 *
 * SurfaceView (not TextureView) on purpose: it gives the decoder its own
 * hardware-composited layer, which is the lowest latency way to show decoded
 * video on Android. The decoder renders into the Surface directly.
 */
@Composable
fun GameSurface(
    modifier: Modifier = Modifier,
    onSurfaceChanged: (Surface?) -> Unit
) {
    val callback = rememberUpdatedState(onSurfaceChanged)
    AndroidView(
        factory = { context ->
            SurfaceView(context).apply {
                holder.addCallback(object : SurfaceHolder.Callback {
                    override fun surfaceCreated(holder: SurfaceHolder) {
                        callback.value.invoke(holder.surface)
                    }

                    override fun surfaceChanged(
                        holder: SurfaceHolder,
                        format: Int,
                        width: Int,
                        height: Int
                    ) {
                        callback.value.invoke(holder.surface)
                    }

                    override fun surfaceDestroyed(holder: SurfaceHolder) {
                        callback.value.invoke(null)
                    }
                })
            }
        },
        modifier = modifier,
        update = { view ->
            view.setZOrderOnTop(false)
        }
    )
}
