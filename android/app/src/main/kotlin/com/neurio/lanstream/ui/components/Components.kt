package com.neurio.lanstream.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.Image
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.neurio.lanstream.ui.theme.NeonCyan
import com.neurio.lanstream.ui.theme.NeonPurple
import com.neurio.lanstream.ui.theme.SurfaceElevated
import com.neurio.lanstream.ui.theme.SurfaceOutline
import com.neurio.lanstream.ui.theme.TextSecondary

private val CardShape = RoundedCornerShape(16.dp)

/** Titled section used on every settings-style screen. */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = NeonPurple,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp)
        )
        Surface(
            color = SurfaceElevated,
            shape = CardShape,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .border(1.dp, SurfaceOutline, CardShape)
        ) {
            Column(modifier = Modifier.padding(4.dp)) { content() }
        }
    }
}

@Composable
fun StatChip(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    accent: Color = NeonCyan
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xCC0B0B14))
            .border(1.dp, SurfaceOutline, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            color = accent
        )
    }
}

@Composable
fun StatRow(
    stats: List<Pair<String, String>>,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        stats.forEach { (label, value) ->
            StatChip(label = label, value = value, modifier = Modifier.padding(horizontal = 4.dp))
        }
    }
}

/** Zero-risk segmented control (no experimental Material3 APIs). */
@Composable
fun <T> SegmentedChoice(
    options: List<Pair<T, String>>,
    selected: T,
    onSelected: (T) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isSelected) NeonPurple else Color(0xFF1F1F2E))
                    .border(
                        width = 1.dp,
                        color = if (isSelected) NeonPurple else SurfaceOutline,
                        shape = RoundedCornerShape(10.dp)
                    )
                    .clickable { onSelected(value) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isSelected) Color(0xFF0B0B14) else TextSecondary,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
fun RowSetting(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    modifier = Modifier.padding(top = 2.dp)
                )
            }
        }
        trailing?.invoke()
    }
}

@Composable
fun StatusDot(active: Boolean, modifier: Modifier = Modifier, color: Color = NeonCyan) {
    Box(
        modifier = modifier
            .size(10.dp)
            .clip(androidx.compose.foundation.shape.CircleShape)
            .background(if (active) color else SurfaceOutline)
    )
}

/** Loads the real launcher icon of an installed game/app. */
@Composable
fun AppIcon(packageName: String, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val bitmap = remember(packageName) {
        val drawable = com.neurio.lanstream.games.GameLibrary.icon(context, packageName)
        drawable?.let {
            runCatching {
                androidx.core.graphics.drawable.toBitmap(it, 96, 96).asImageBitmap()
            }.getOrNull()
        }
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = null,
            modifier = modifier.clip(RoundedCornerShape(10.dp))
        )
    } else {
        Box(
            modifier = modifier
                .clip(RoundedCornerShape(10.dp))
                .background(SurfaceOutline)
        )
    }
}
