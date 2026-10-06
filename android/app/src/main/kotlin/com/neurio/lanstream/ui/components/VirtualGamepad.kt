package com.neurio.lanstream.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.input.ControlSpec
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.input.PadLayout
import com.neurio.lanstream.input.TouchAction
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * On-screen gamepad.
 *
 * Every control converts a press into *normalised* touch coordinates
 * (0..1 inside the streamed picture) and forwards them through the input
 * transport; the host maps them onto its own screen pixels. That is why this
 * works for any game without knowing anything about its layout.
 */
@Composable
fun VirtualGamepad(
    layout: PadLayout,
    modifier: Modifier = Modifier,
    onTouch: (InputEvent.Touch) -> Unit
) {
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val width = constraints.maxWidth.toFloat().coerceAtLeast(1f)
        val height = constraints.maxHeight.toFloat().coerceAtLeast(1f)
        val base = minOf(width, height)
        val density = LocalDensity.current

        layout.controls.values.filter { it.enabled }.forEach { spec ->
            val centreX = spec.x * width
            val centreY = spec.y * height
            val sizePx = spec.size * base
            val sizeDp = with(density) { sizePx.toDp() }
            val offsetX = (centreX - sizePx / 2f).roundToInt()
            val offsetY = (centreY - sizePx / 2f).roundToInt()

            when (spec.id) {
                PadLayout.JOYSTICK -> Joystick(
                    spec = spec,
                    sizeDp = sizeDp,
                    offset = IntOffset(offsetX, offsetY),
                    width = width,
                    height = height,
                    onTouch = onTouch
                )
                PadLayout.DPAD -> Dpad(
                    spec = spec,
                    sizeDp = sizeDp,
                    offset = IntOffset(offsetX, offsetY),
                    onTouch = onTouch
                )
                else -> PadButton(
                    spec = spec,
                    sizeDp = sizeDp,
                    offset = IntOffset(offsetX, offsetY),
                    onTouch = onTouch
                )
            }
        }
    }
}

@Composable
private fun Joystick(
    spec: ControlSpec,
    sizeDp: androidx.compose.ui.unit.Dp,
    offset: IntOffset,
    width: Float,
    height: Float,
    onTouch: (InputEvent.Touch) -> Unit
) {
    var knobX by remember { mutableStateOf(0f) }
    var knobY by remember { mutableStateOf(0f) }
    val radiusPx = with(LocalDensity.current) { (sizeDp / 2).toPx() }

    Box(
        modifier = Modifier
            .offset { offset }
            .size(sizeDp)
            .clip(CircleShape)
            .background(Color(0x55000000))
            .border(2.dp, Color(0x66FFFFFF), CircleShape)
            .pointerInput(spec.id) {
                detectDragGestures(
                    onDragStart = { start ->
                        val dx = start.x - radiusPx
                        val dy = start.y - radiusPx
                        val (clampedX, clampedY) = clampToRadius(dx, dy, radiusPx)
                        knobX = clampedX
                        knobY = clampedY
                        onTouch(
                            InputEvent.Touch(
                                TouchAction.DOWN,
                                pointerIdOf(spec.id),
                                spec.x,
                                spec.y
                            )
                        )
                        onTouch(
                            InputEvent.Touch(
                                TouchAction.MOVE,
                                pointerIdOf(spec.id),
                                (spec.x + clampedX / width).coerceIn(0f, 1f),
                                (spec.y + clampedY / height).coerceIn(0f, 1f)
                            )
                        )
                    },
                    onDrag = { _, dragAmount ->
                        val dx = knobX + dragAmount.x
                        val dy = knobY + dragAmount.y
                        val (clampedX, clampedY) = clampToRadius(dx, dy, radiusPx)
                        knobX = clampedX
                        knobY = clampedY
                        onTouch(
                            InputEvent.Touch(
                                TouchAction.MOVE,
                                pointerIdOf(spec.id),
                                (spec.x + clampedX / width).coerceIn(0f, 1f),
                                (spec.y + clampedY / height).coerceIn(0f, 1f)
                            )
                        )
                    },
                    onDragEnd = {
                        onTouch(
                            InputEvent.Touch(
                                TouchAction.UP,
                                pointerIdOf(spec.id),
                                (spec.x + knobX / width).coerceIn(0f, 1f),
                                (spec.y + knobY / height).coerceIn(0f, 1f)
                            )
                        )
                        knobX = 0f
                        knobY = 0f
                    },
                    onDragCancel = {
                        onTouch(
                            InputEvent.Touch(TouchAction.UP, pointerIdOf(spec.id), spec.x, spec.y)
                        )
                        knobX = 0f
                        knobY = 0f
                    }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .offset {
                    IntOffset(knobX.roundToInt(), knobY.roundToInt())
                }
                .size(sizeDp / 2)
                .clip(CircleShape)
                .background(Color(0xCC8B5CF6))
        )
    }
}

@Composable
private fun Dpad(
    spec: ControlSpec,
    sizeDp: androidx.compose.ui.unit.Dp,
    offset: IntOffset,
    onTouch: (InputEvent.Touch) -> Unit
) {
    val directions = listOf(
        0f to -1f,
        0f to 1f,
        -1f to 0f,
        1f to 0f
    )
    Box(modifier = Modifier.offset { offset }.size(sizeDp)) {
        directions.forEach { (dx, dy) ->
            val (x, y) = spec.pointAt(dx, dy)
            Box(
                modifier = Modifier
                    .align(
                        when {
                            dy < 0 -> Alignment.TopCenter
                            dy > 0 -> Alignment.BottomCenter
                            dx < 0 -> Alignment.CenterStart
                            else -> Alignment.CenterEnd
                        }
                    )
                    .size(sizeDp * 0.34f)
                    .clip(CircleShape)
                    .background(Color(0x44000000))
                    .border(1.dp, Color(0x55FFFFFF), CircleShape)
                    .pointerInput(spec.id, dx, dy) {
                        detectTapGestures(
                            onPress = {
                                onTouch(
                                    InputEvent.Touch(TouchAction.DOWN, pointerIdOf(spec.id), x, y)
                                )
                                try {
                                    awaitRelease()
                                } catch (_: Throwable) {
                                    // Cancelled (another gesture took over): still release.
                                } finally {
                                    onTouch(
                                        InputEvent.Touch(TouchAction.UP, pointerIdOf(spec.id), x, y)
                                    )
                                }
                            }
                        )
                    }
            )
        }
    }
}

@Composable
private fun PadButton(
    spec: ControlSpec,
    sizeDp: androidx.compose.ui.unit.Dp,
    offset: IntOffset,
    onTouch: (InputEvent.Touch) -> Unit
) {
    var pressed by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .offset { offset }
            .size(sizeDp)
            .clip(CircleShape)
            .background(if (pressed) Color(0xEE8B5CF6) else Color(0x55000000))
            .border(2.dp, Color(0x66FFFFFF), CircleShape)
            .pointerInput(spec.id) {
                detectTapGestures(
                    onPress = {
                        pressed = true
                        onTouch(
                            InputEvent.Touch(TouchAction.DOWN, pointerIdOf(spec.id), spec.x, spec.y)
                        )
                        try {
                            awaitRelease()
                        } catch (_: Throwable) {
                            // ignored: treated as a release
                        } finally {
                            pressed = false
                            onTouch(
                                InputEvent.Touch(TouchAction.UP, pointerIdOf(spec.id), spec.x, spec.y)
                            )
                        }
                    }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = spec.label,
            style = MaterialTheme.typography.labelLarge,
            color = Color.White
        )
    }
}

private fun clampToRadius(dx: Float, dy: Float, radius: Float): Pair<Float, Float> {
    val distance = hypot(dx, dy)
    return if (distance <= radius || distance == 0f) {
        dx to dy
    } else {
        (dx / distance * radius) to (dy / distance * radius)
    }
}

/** Stable pointer ids so a press always matches its release on the host. */
internal fun pointerIdOf(controlId: String): Int = when (controlId) {
    PadLayout.JOYSTICK -> 1
    PadLayout.DPAD -> 12
    PadLayout.A -> 2
    PadLayout.B -> 3
    PadLayout.X -> 4
    PadLayout.Y -> 5
    PadLayout.L1 -> 6
    PadLayout.R1 -> 7
    PadLayout.L2 -> 8
    PadLayout.R2 -> 9
    PadLayout.START -> 10
    PadLayout.SELECT -> 11
    else -> 20
}
