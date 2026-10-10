package com.neurio.aivibes.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.neurio.aivibes.ui.components.NeonButton
import com.neurio.aivibes.ui.theme.VibeColors
import kotlinx.coroutines.delay

/**
 * First-run experience: animated sound-wave welcome, honest feature summary,
 * permission primer and a headphone connection nudge.
 */
@Composable
fun OnboardingScreen(
    onPermissionRequest: () -> Unit,
    onFinished: () -> Unit
) {
    var step by remember { mutableStateOf(0) }
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(step) {
        visible = false
        delay(60)
        visible = true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(VibeColors.Black)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        AnimatedVisibility(visible = visible, enter = fadeIn() + slideInVertically { it / 2 }) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                WaveMark(step = step)
                Spacer(Modifier.height(28.dp))
                when (step) {
                    0 -> {
                        Text(
                            "AI VIBES",
                            style = MaterialTheme.typography.displayLarge,
                            color = VibeColors.White
                        )
                        Text(
                            "Headphone audio, reimagined",
                            style = MaterialTheme.typography.titleMedium,
                            color = VibeColors.Cyan
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Real DSP — bass studio, 10-band EQ, spatial width, " +
                                "dynamics and a live visualizer — applied to the music " +
                                "you play inside the app.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = VibeColors.Muted,
                            textAlign = TextAlign.Center
                        )
                    }
                    1 -> {
                        Text(
                            "Honest by design",
                            style = MaterialTheme.typography.headlineMedium,
                            color = VibeColors.White
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Android does not let an ordinary app reshape audio from " +
                                "Spotify, YouTube or games. AI VIBES processes its own " +
                                "music player stream — so every effect you hear is real.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = VibeColors.Muted,
                            textAlign = TextAlign.Center
                        )
                    }
                    2 -> {
                        Text(
                            "A few permissions",
                            style = MaterialTheme.typography.headlineMedium,
                            color = VibeColors.White
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "· Music library — to list and play your songs\n" +
                                "· Notifications — for the media controls\n" +
                                "· Nearby devices — for headphone detection\n\n" +
                                "Nothing leaves your phone. AI VIBES has zero network code.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = VibeColors.Muted,
                            textAlign = TextAlign.Center
                        )
                    }
                    else -> {
                        Text(
                            "Plug in your headphones",
                            style = MaterialTheme.typography.headlineMedium,
                            color = VibeColors.White
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "AI VIBES detects wired, USB and Bluetooth outputs, and can " +
                                "auto-load a preset per device. Connect yours and hit Start.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = VibeColors.Muted,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(40.dp))
        NeonButton(
            text = when (step) {
                0 -> "Get started"
                1 -> "Continue"
                2 -> "Grant permissions"
                else -> "Start listening"
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            when (step) {
                2 -> {
                    onPermissionRequest()
                    step = 3
                }
                3 -> onFinished()
                else -> step++
            }
        }
    }
}

@Composable
private fun WaveMark(step: Int) {
    val t = rememberInfiniteTransition(label = "wave")
    val phase by t.animateFloat(
        initialValue = 0f, targetValue = (2 * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(tween(2600, easing = LinearEasing), RepeatMode.Restart),
        label = "phase"
    )
    Box(modifier = Modifier.size(160.dp), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val cy = size.height / 2f
            for (wave in 0 until 3) {
                val amp = size.height * (0.16f + wave * 0.05f)
                val path = androidx.compose.ui.graphics.Path()
                for (i in 0..72) {
                    val x = size.width * i / 72f
                    val y = cy + amp * Math.sin(phase + wave * 0.9 + i * 0.22).toFloat() *
                        (1f - step * 0.08f)
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(
                    path = path,
                    color = when (wave) {
                        0 -> VibeColors.Cyan
                        1 -> VibeColors.Blue
                        else -> VibeColors.Purple
                    }.copy(alpha = 0.85f - wave * 0.22f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                        width = 3.dp.toPx(), cap = StrokeCap.Round
                    )
                )
            }
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(VibeColors.Purple.copy(alpha = 0.28f), Color.Transparent)
                ),
                radius = size.minDimension * 0.55f
            )
        }
    }
}
