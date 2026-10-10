package com.neurio.aivibes.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.ui.theme.VibeColors

/** Rounded premium panel with a subtle neon gradient fill. */
@Composable
fun GlowPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Box(
        modifier = modifier
            .shadow(12.dp, RoundedCornerShape(24.dp), spotColor = VibeColors.Purple.copy(alpha = 0.35f))
            .clip(RoundedCornerShape(24.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF151527), Color(0xFF0C0C16))))
            .border(1.dp, Color(0xFF242440), RoundedCornerShape(24.dp))
            .padding(18.dp)
    ) {
        content()
    }
}

/** Section heading with optional trailing content. */
@Composable
fun SectionTitle(title: String, subtitle: String? = null) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = VibeColors.White,
            fontWeight = FontWeight.Bold
        )
        if (subtitle != null) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = VibeColors.Muted
            )
        }
    }
}

/** Neon pill used for statuses and preset chips. */
@Composable
fun NeonChip(
    text: String,
    selected: Boolean = false,
    accent: Color = VibeColors.Purple,
    onClick: (() -> Unit)? = null
) {
    val bg by animateColorAsState(
        targetValue = if (selected) accent.copy(alpha = 0.28f) else Color(0xFF14142A),
        label = "chipBg"
    )
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(
                width = if (selected) 1.5.dp else 1.dp,
                color = if (selected) accent else Color(0xFF2A2A46),
                shape = RoundedCornerShape(50)
            )
            .then(if (onClick != null) Modifier.clickable { onClick.invoke() } else Modifier)
            .padding(horizontal = 16.dp, vertical = 9.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) VibeColors.White else VibeColors.Muted,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
        )
    }
}

/** Status dot + label row (headphones, engine, etc.). */
@Composable
fun StatusPill(label: String, active: Boolean, accent: Color = VibeColors.Cyan) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        val pulse = rememberInfiniteTransition(label = "pulse")
        val alpha by pulse.animateFloat(
            initialValue = 0.45f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
            label = "pulseAlpha"
        )
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (active) accent.copy(alpha = alpha) else Color(0xFF3A3A55))
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (active) VibeColors.White else VibeColors.Muted,
            modifier = Modifier.padding(start = 8.dp)
        )
    }
}

/**
 * Neon slider with a glowing active track. Value range semantics are chosen by
 * the caller; [format] renders the value label.
 */
@Composable
fun NeonSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    accent: Color = VibeColors.Purple,
    label: String? = null,
    valueText: String? = null
) {
    Column(modifier = modifier) {
        if (label != null || valueText != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(label ?: "", style = MaterialTheme.typography.labelLarge, color = VibeColors.Muted)
                Text(
                    valueText ?: "",
                    style = MaterialTheme.typography.labelLarge,
                    color = VibeColors.White
                )
            }
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = valueRange,
            colors = SliderDefaults.colors(
                thumbColor = accent,
                activeTrackColor = accent,
                inactiveTrackColor = Color(0xFF22223A)
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(36.dp)
        )
    }
}

/** Full-width gradient action button. */
@Composable
fun NeonButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val brush = Brush.linearGradient(listOf(VibeColors.Purple, VibeColors.Blue))
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) brush else Brush.linearGradient(listOf(Color(0xFF22223A), Color(0xFF18182B))))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 24.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = if (enabled) VibeColors.White else VibeColors.Muted,
            fontWeight = FontWeight.Bold
        )
    }
}

/** Small value readout used across the studio screens. */
@Composable
fun ValueReadout(text: String, accent: Color = VibeColors.Cyan) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelLarge,
        color = accent,
        fontWeight = FontWeight.Bold
    )
}

/**
 * Vertical fader (custom control) used by the 10-band EQ. Drag or tap anywhere
 * on the track to set the value; the thumb glows in the accent colour.
 */
@Composable
fun VerticalFader(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = -12f..12f,
    accent: Color = VibeColors.Purple
) {
    val lo = valueRange.start
    val hi = valueRange.endInclusive
    Box(
        modifier = modifier
            .width(34.dp)
            .height(150.dp)
            .pointerInput(valueRange) {
                detectDragGestures(
                    onDragStart = { offset ->
                        val t = 1f - (offset.y / size.height).coerceIn(0f, 1f)
                        onValueChange(lo + t * (hi - lo))
                    }
                ) { change, _ ->
                    change.consume()
                    val t = 1f - (change.position.y / size.height).coerceIn(0f, 1f)
                    onValueChange(lo + t * (hi - lo))
                }
            }
            .pointerInput(valueRange) {
                detectTapGestures { offset ->
                    val t = 1f - (offset.y / size.height).coerceIn(0f, 1f)
                    onValueChange(lo + t * (hi - lo))
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val cx = size.width / 2f
            val thumbR = 9.dp.toPx()
            val trackTop = thumbR + 4.dp.toPx()
            val trackBottom = size.height - thumbR - 4.dp.toPx()
            // Track.
            drawRoundRect(
                color = Color(0xFF22223A),
                topLeft = Offset(cx - 2.5.dp.toPx(), trackTop),
                size = androidx.compose.ui.geometry.Size(5.dp.toPx(), trackBottom - trackTop),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
            )
            // Active portion (from mid to thumb — EQ style).
            val t = ((value - lo) / (hi - lo)).coerceIn(0f, 1f)
            val thumbY = trackBottom - t * (trackBottom - trackTop)
            val midY = trackBottom - 0.5f * (trackBottom - trackTop)
            val top = minOf(thumbY, midY)
            val bottom = maxOf(thumbY, midY)
            drawRoundRect(
                brush = Brush.verticalGradient(listOf(accent, accent.copy(alpha = 0.5f))),
                topLeft = Offset(cx - 2.5.dp.toPx(), top),
                size = androidx.compose.ui.geometry.Size(5.dp.toPx(), bottom - top),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
            )
            // Thumb with glow.
            drawCircle(color = accent.copy(alpha = 0.25f), radius = thumbR * 1.8f, center = Offset(cx, thumbY))
            drawCircle(color = accent, radius = thumbR, center = Offset(cx, thumbY))
            drawCircle(color = Color.White, radius = thumbR * 0.38f, center = Offset(cx, thumbY))
        }
    }
}
