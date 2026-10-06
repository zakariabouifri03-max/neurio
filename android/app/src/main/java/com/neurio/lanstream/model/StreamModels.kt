package com.neurio.lanstream.model

import android.content.Context
import android.os.Build
import java.net.Inet4Address
import java.net.NetworkInterface

/** A local, transient advertisement. No game files or cloud service are involved. */
data class HostAdvertisement(
    val sessionId: Long,
    val deviceName: String,
    val gameName: String,
    val address: String,
    val tcpPort: Int,
    val discoveryPort: Int,
    val pingMs: Long = -1L,
    val seenAtMs: Long = System.currentTimeMillis(),
)

data class StreamOptions(
    val resolutionCap: Int = 720,
    val framesPerSecond: Int = 60,
    val bitrateBitsPerSecond: Int = 6_000_000,
    val bitrateLabel: String = "Medium",
    val customBitrateBitsPerSecond: Int = 6_000_000,
) {
    fun selectedBitrate(): Int = if (bitrateLabel == "Custom") customBitrateBitsPerSecond else bitrateBitsPerSecond

    companion object {
        fun fromPreferences(context: Context): StreamOptions {
            val p = context.getSharedPreferences("stream_settings", Context.MODE_PRIVATE)
            val preset = p.getString("bitrate_label", "Medium") ?: "Medium"
            val custom = p.getInt("custom_bitrate", 6_000_000).coerceIn(750_000, 24_000_000)
            val presetBitrate = when (preset) {
                "Low" -> 2_000_000
                "High" -> 12_000_000
                "Custom" -> custom
                else -> 6_000_000
            }
            return StreamOptions(
                resolutionCap = p.getInt("resolution", 720).let { if (it in setOf(480, 720, 1080)) it else 720 },
                framesPerSecond = if (p.getInt("fps", 60) == 30) 30 else 60,
                bitrateBitsPerSecond = presetBitrate,
                bitrateLabel = preset,
                customBitrateBitsPerSecond = custom,
            )
        }
    }
}

data class VideoStreamConfig(
    val width: Int,
    val height: Int,
    val fps: Int,
    val targetBitrate: Int,
    val csd0: ByteArray,
    val csd1: ByteArray,
) {
    override fun equals(other: Any?): Boolean = other is VideoStreamConfig &&
        width == other.width && height == other.height && fps == other.fps && targetBitrate == other.targetBitrate &&
        csd0.contentEquals(other.csd0) && csd1.contentEquals(other.csd1)

    override fun hashCode(): Int = 31 * width + height
}

data class AudioStreamConfig(
    val sampleRate: Int,
    val channelCount: Int,
    val csd0: ByteArray,
) {
    override fun equals(other: Any?): Boolean = other is AudioStreamConfig &&
        sampleRate == other.sampleRate && channelCount == other.channelCount && csd0.contentEquals(other.csd0)

    override fun hashCode(): Int = 31 * sampleRate + channelCount
}

data class InstalledGame(
    val packageName: String,
    val label: String,
    val isGame: Boolean,
)

data class HostUiState(
    val running: Boolean = false,
    val gameName: String = "",
    val localIp: String = "—",
    val pairingCode: String = "------",
    val connectedPlayer: String = "Waiting for player",
    val fps: Double = 0.0,
    val pingMs: Long = -1L,
    val bitrateMbps: Double = 0.0,
    val packetLossPercent: Double = 0.0,
    val audioStatus: String = "Not started",
    val detail: String = "",
)

object LocalNetwork {
    fun deviceName(): String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android phone"

    fun bestIpv4Address(): String {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { it.isUp && !it.isLoopback }
            val wlan = interfaces.sortedBy { if (it.name.startsWith("wlan", true)) 0 else 1 }
            wlan.asSequence()
                .flatMap { it.inetAddresses.toList().asSequence() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress && it.hostAddress != null }
                ?.hostAddress ?: "Not connected to Wi-Fi"
        } catch (_: Exception) {
            "Not connected to Wi-Fi"
        }
    }
}
