package com.neurio.aivibes.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.dsp.SpectrumAnalyzer
import com.neurio.aivibes.ui.theme.VibeColors
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Visualizer renderers. All draw *real* data from [SpectrumAnalyzer.SpectrumSnapshot];
 * when the snapshot is empty they show an honest "no signal" idle state (a slow
 * breathing ring), not a fake spectrum.
 */
object Viz {

    const val STYLE_SPECTRUM = 0
    const val STYLE_CIRCULAR = 1
    const val STYLE_PULSE = 2

    @Composable
    fun SpectrumBars(
        snap: SpectrumAnalyzer.SpectrumSnapshot,
        modifier: Modifier = Modifier,
        height: Dp = 220.dp
    ) {
        val idle = rememberInfiniteTransition(label = "idle")
        val breathe by idle.animateFloat(
            initialValue = 0.85f, targetValue = 1.0f,
            animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Reverse),
            label = "breathe"
        )
        Canvas(
            modifier = modifier
                .fillMaxWidth()
                .height(height)
        ) {
            val bands = snap.bands
            val active = snap.level > 0.00001f
            val n = bands.size
            val gap = 4.dp.toPx()
            val barW = (size.width - gap * (n - 1)) / n
            for (i in 0 until n) {
                val mag = if (active) bands[i].coerceIn(0f, 1f) else 0.02f * breathe
                val h = (mag * size.height * 0.92f).coerceAtLeast(3.dp.toPx())
                val x = i * (barW + gap)
                drawRoundBar(
                    x = x, width = barW, height = h,
                    color = barColor(i, n)
                )
            }
        }
    }

    @Composable
    fun CircularWaves(
        snap: SpectrumAnalyzer.SpectrumSnapshot,
        modifier: Modifier = Modifier,
        height: Dp = 260.dp
    ) {
        val idle = rememberInfiniteTransition(label = "idle2")
        val breathe by idle.animateFloat(
            initialValue = 0.9f, targetValue = 1.05f,
            animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse),
            label = "breathe2"
        )
        Canvas(
            modifier = modifier
                .fillMaxWidth()
                .height(height)
        ) {
            val cx = size.width / 2f
            val cy = size.height / 2f
            val base = min(size.width, size.height) * 0.32f
            val active = snap.level > 0.00001f
            val bass = if (active) snap.bass.coerceIn(0f, 1f) else 0f

            // Breathing core.
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(VibeColors.Purple.copy(alpha = 0.5f), Color.Transparent),
                    center = Offset(cx, cy), radius = base * breathe
                ),
                radius = base * breathe
            )
            drawCircle(
                color = VibeColors.Cyan.copy(alpha = 0.8f),
                radius = base * 0.55f * (1f + bass * 0.6f),
                style = Stroke(width = 2.dp.toPx())
            )

            // Frequency-reactive rings.
            val rings = snap.bands.size / 3
            for (r in 0 until rings) {
                val bandVal = if (active) snap.bands[r * 3].coerceIn(0f, 1f) else 0.02f
                val radius = base * (0.7f + r * 0.16f) * (1f + bandVal * 0.35f * if (active) 1f else breathe)
                drawCircle(
                    color = barColor(r, rings).copy(alpha = 0.10f + bandVal * 0.5f),
                    radius = radius,
                    style = Stroke(width = (1.2f + bandVal * 3f).dp.toPx())
                )
            }

            // Bass-reactive circular waveform.
            if (active) {
                val path = androidx.compose.ui.graphics.Path()
                val steps = 90
                for (i in 0..steps) {
                    val ang = i * 2f * Math.PI.toFloat() / steps
                    val bandIdx = (i * snap.bands.size / steps).toInt().coerceIn(0, snap.bands.size - 1)
                    val mag = snap.bands[bandIdx].coerceIn(0f, 1f)
                    val rr = base * 1.25f + mag * base * 0.7f
                    val x = cx + cos(ang) * rr
                    val y = cy + sin(ang) * rr
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                path.close()
                drawPath(
                    path = path,
                    color = VibeColors.Purple.copy(alpha = 0.35f),
                    style = Stroke(width = 1.6.dp.toPx())
                )
            }
        }
    }

    @Composable
    fun NeonPulse(
        snap: SpectrumAnalyzer.SpectrumSnapshot,
        beatAtMs: Long,
        modifier: Modifier = Modifier,
        height: Dp = 220.dp
    ) {
        val now = System.currentTimeMillis()
        val sinceBeat = (now - beatAtMs).toFloat()
        val beatFlash = if (snap.beat || sinceBeat < 350f) {
            (1f - sinceBeat / 350f).coerceIn(0f, 1f)
        } else 0f
        Canvas(
            modifier = modifier
                .fillMaxWidth()
                .height(height)
        ) {
            val active = snap.level > 0.00001f
            val level = if (active) snap.level.coerceIn(0f, 1f) else 0f
            // Horizon glow line.
            val y = size.height * 0.72f
            drawLine(
                brush = Brush.horizontalGradient(
                    listOf(Color.Transparent, VibeColors.Cyan, Color.Transparent)
                ),
                start = Offset(0f, y), end = Offset(size.width, y),
                strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round
            )
            // Beat rings expanding from centre.
            val cx = size.width / 2f
            val cy = size.height / 2f
            if (beatFlash > 0f) {
                drawCircle(
                    color = VibeColors.Purple.copy(alpha = 0.25f * beatFlash),
                    radius = size.minDimension * (0.30f + 0.25f * (1f - beatFlash)),
                    style = Stroke(width = (2 + beatFlash * 8).dp.toPx())
                )
            }
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(
                        VibeColors.Blue.copy(alpha = 0.35f + level * 0.4f + beatFlash * 0.3f),
                        Color.Transparent
                    ),
                    center = Offset(cx, cy), radius = size.minDimension * 0.55f
                ),
                radius = size.minDimension * 0.55f
            )
            // Vertical neon slats for the highs.
            val slats = 16
            for (i in 0 until slats) {
                val band = snap.bands[(i + 8).coerceIn(0, snap.bands.size - 1)]
                val mag = if (active) band.coerceIn(0f, 1f) else 0.02f
                val x = size.width * (i + 0.5f) / slats
                val h = mag * size.height * 0.5f
                drawLine(
                    color = VibeColors.Cyan.copy(alpha = 0.25f + mag * 0.6f),
                    start = Offset(x, y), end = Offset(x, y - h),
                    strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round
                )
            }
        }
    }

    private fun barColor(i: Int, n: Int): Color {
        val t = i.toFloat() / (n - 1).coerceAtLeast(1)
        return lerpColor(VibeColors.Cyan, VibeColors.Purple, t)
    }

    private fun lerpColor(a: Color, b: Color, t: Float): Color = Color(
        red = a.red + (b.red - a.red) * t,
        green = a.green + (b.green - a.green) * t,
        blue = a.blue + (b.blue - a.blue) * t,
        alpha = 1f
    )

    private fun DrawScope.drawRoundBar(x: Float, width: Float, height: Float, color: Color) {
        drawRoundRect(
            brush = Brush.verticalGradient(listOf(color, color.copy(alpha = 0.35f))),
            topLeft = Offset(x, size.height - height),
            size = androidx.compose.ui.geometry.Size(width, height),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(width / 2f)
        )
    }
}
