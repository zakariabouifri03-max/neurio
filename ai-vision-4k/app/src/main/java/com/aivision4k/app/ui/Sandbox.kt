package com.aivision4k.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The paragraph that keeps this app honest.
 *
 * It is shown on the dashboard and in settings, in full, without a "learn more"
 * link that nobody follows: the single most misleading thing an app like this
 * can do is to let the user believe it is upscaling a game it cannot touch.
 */
@Composable
fun SandboxExplainer(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        Paragraph("Android runs every app in its own sandbox. A normal app cannot open another app's graphics pipeline, cannot inject a shader into it, and cannot read its frame rate. There is no supported, non-root way to add AI upscaling to a game you do not own.")
        Spacer(Modifier.height(8.dp))
        Paragraph("What this app really does:")
        Spacer(Modifier.height(6.dp))
        Bullet("It measures this device for real: Vulkan support, compute queues, memory budget, GLES version, NNAPI, thermal API, RAM and battery temperature.")
        Bullet("It stores a graphics profile per game \u2014 render scale, output resolution, AI quality, sharpening, frame-rate target \u2014 and applies it to the engine.")
        Bullet("It reports live CPU, RAM and thermal data while you play, and reduces its own AI work when the device gets hot.")
        Bullet("A game that links the AIUpscaler SDK (a two-line change in its renderer) hands over its Vulkan device and gets real in-pipeline upscaling. The integration contract is in the SDK docs.")
        Spacer(Modifier.height(8.dp))
        Paragraph("What it cannot do: change a game's internal resolution, inject post-processing into a third-party game, or read another app's FPS. Any app that claims otherwise is either rooted, showing you an overlay it calls \"AI\", or lying about the numbers.", accent = WarnAmber)
    }
}

@Composable
private fun Paragraph(text: String, accent: androidx.compose.ui.graphics.Color = TextMuted) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = accent,
    )
}

@Composable
private fun Bullet(text: String) {
    Text(
        text = "\u2022  $text",
        style = MaterialTheme.typography.bodySmall,
        color = TextPrimary,
        modifier = Modifier.padding(start = 2.dp, bottom = 4.dp),
    )
}

/** The SDK snippet the app shows to a developer who wants to integrate. */
const val SDK_SAMPLE: String = """
AIUpscaler.initialize(context, IntegrationKind.SdkIntegrated)
AIUpscaler.setOutputResolution(3840, 2160)   // reconstruct *to*
AIUpscaler.setInputResolution(1920, 1080)    // what you draw
AIUpscaler.setQuality(UpscalingQuality.High)
AIUpscaler.setSharpening(20)                 // percent

AIUpscaler.startSession(
    VulkanDeviceInfo(instance, physicalDevice, device,
        computeFamily, graphicsFamily, computeQueue, graphicsQueue),
)

// once per frame, from the render thread:
val result = AIUpscaler.processFrame(
    lowResImage = lowResImage, lowResView = lowResView,
    outputImage = outputImage, outputView = outputView,
    deltaSeconds = delta, resetHistory = resized,
)
if (!result.submitted) log("upscaling skipped: ${'$'}{result.error}")
"""
