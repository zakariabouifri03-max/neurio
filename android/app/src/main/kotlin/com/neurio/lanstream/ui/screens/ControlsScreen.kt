package com.neurio.lanstream.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.R
import com.neurio.lanstream.input.ControlSpec
import com.neurio.lanstream.input.PadLayout
import com.neurio.lanstream.platform.neurioApp
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.SurfaceElevated
import com.neurio.lanstream.ui.theme.SurfaceOutline
import com.neurio.lanstream.ui.theme.TextSecondary
import kotlin.math.roundToInt

/**
 * Editor for the virtual gamepad: enable, move and resize every control.
 *
 * The layout is stored as JSON in Settings and is also sent to the host during
 * the handshake, so a physical controller can be mapped onto the same positions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ControlsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = context.neurioApp.settings
    val settings by repository.settings.collectAsState()
    var layout by remember(settings.controlLayoutJson) {
        mutableStateOf(PadLayout.fromJson(settings.controlLayoutJson))
    }

    fun commit(next: PadLayout) {
        layout = next
        repository.update { copy(controlLayoutJson = next.toJson()) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.controls_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                text = stringResource(R.string.controls_desc),
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(16.dp)
            )

            LayoutPreview(layout = layout)

            OutlinedButton(
                onClick = { commit(PadLayout.default()) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text(stringResource(R.string.controls_reset))
            }

            PadLayout.ORDER.forEach { id ->
                val spec = layout.controls[id] ?: return@forEach
                ControlEditor(
                    spec = spec,
                    onChange = { updated -> commit(layout.with(id, updated)) }
                )
            }
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun LayoutPreview(layout: PadLayout) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .padding(16.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(SurfaceElevated)
            .border(1.dp, SurfaceOutline, RoundedCornerShape(14.dp))
    ) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        val base = minOf(width, height)
        val density = LocalDensity.current
        layout.controls.values.filter { it.enabled }.forEach { spec ->
            val sizePx = spec.size * base
            val sizeDp = with(density) { sizePx.toDp() }
            Box(
                modifier = Modifier
                    .offset {
                        IntOffset(
                            (spec.x * width - sizePx / 2f).roundToInt(),
                            (spec.y * height - sizePx / 2f).roundToInt()
                        )
                    }
                    .size(sizeDp)
                    .clip(CircleShape)
                    .background(NeonPurple.copy(alpha = 0.35f))
                    .border(1.dp, NeonPurple, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = spec.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White
                )
            }
        }
    }
}

@Composable
private fun ControlEditor(spec: ControlSpec, onChange: (ControlSpec) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceElevated)
            .border(1.dp, SurfaceOutline, RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = spec.label.uppercase(),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = stringResource(R.string.controls_enable),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary
            )
            Spacer(modifier = Modifier.width(8.dp))
            Switch(
                checked = spec.enabled,
                onCheckedChange = { onChange(spec.copy(enabled = it)) }
            )
        }
        SliderRow(
            label = stringResource(R.string.controls_x),
            value = spec.x,
            range = 0f..1f
        ) { onChange(spec.copy(x = it)) }
        SliderRow(
            label = stringResource(R.string.controls_y),
            value = spec.y,
            range = 0f..1f
        ) { onChange(spec.copy(y = it)) }
        SliderRow(
            label = stringResource(R.string.controls_size),
            value = spec.size,
            range = 0.05f..0.5f
        ) { onChange(spec.copy(size = it)) }
    }
}

@Composable
private fun SliderRow(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
            modifier = Modifier.width(40.dp)
        )
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            valueRange = range,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = "%.2f".format(value),
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
            modifier = Modifier.width(36.dp)
        )
    }
}
