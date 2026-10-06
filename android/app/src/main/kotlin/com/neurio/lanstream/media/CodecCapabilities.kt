package com.neurio.lanstream.media

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import com.neurio.lanstream.core.Log

/** Everything the prototype needs to know about the codecs of this device. */
object CodecCapabilities {

    const val H264 = MediaFormat.MIMETYPE_VIDEO_AVC
    const val H265 = MediaFormat.MIMETYPE_VIDEO_HEVC
    const val AAC = MediaFormat.MIMETYPE_AUDIO_AAC

    data class CodecEntry(
        val name: String,
        val mime: String,
        val encoder: Boolean,
        val hardware: Boolean
    ) {
        override fun toString(): String =
            "$name [${mime}] ${if (hardware) "hardware" else "software"}"
    }

    private fun infos(): List<MediaCodecInfo> = runCatching {
        MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.toList()
    }.getOrDefault(emptyList())

    fun encodersFor(mime: String): List<MediaCodecInfo> =
        infos().filter { info -> info.isEncoder && info.supportedTypes.any { it.equals(mime, true) } }

    fun decodersFor(mime: String): List<MediaCodecInfo> =
        infos().filter { info -> !info.isEncoder && info.supportedTypes.any { it.equals(mime, true) } }

    fun isHardware(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated
        val n = info.name.lowercase()
        val software = n.startsWith("omx.google") || n.startsWith("c2.google") ||
            n.contains("sw") || n.contains("software")
        return !software
    }

    /** Hardware encoders first, then anything else. */
    fun preferEncoder(mime: String, forceSoftware: Boolean = false): MediaCodecInfo? {
        val candidates = encodersFor(mime)
        if (candidates.isEmpty()) return null
        val sorted = candidates.sortedWith(
            compareByDescending<MediaCodecInfo> { !forceSoftware && isHardware(it) }
                .thenBy { !it.name.startsWith("c2.") }
        )
        return sorted.firstOrNull()
    }

    fun preferDecoder(mime: String, forceSoftware: Boolean = false): MediaCodecInfo? {
        val candidates = decodersFor(mime)
        if (candidates.isEmpty()) return null
        val sorted = candidates.sortedWith(
            compareByDescending<MediaCodecInfo> { !forceSoftware && isHardware(it) }
                .thenBy { !it.name.startsWith("c2.") }
        )
        return sorted.firstOrNull()
    }

    fun supportsHevcEncoding(): Boolean = encodersFor(H265).any { isHardware(it) }

    fun supportsAacEncoding(): Boolean = encodersFor(AAC).isNotEmpty()

    /** Multi-line report used by the Diagnostics screen. */
    fun describe(): String {
        val sb = StringBuilder()
        listOf(H264, H265, AAC).forEach { mime ->
            sb.append("• ").append(mime).append('\n')
            val encoders = encodersFor(mime)
            val decoders = decodersFor(mime)
            if (encoders.isEmpty()) sb.append("    encoder: none\n")
            encoders.forEach { sb.append("    enc: ${it.name} (${if (isHardware(it)) "hw" else "sw"})\n") }
            if (decoders.isEmpty()) sb.append("    decoder: none\n")
            decoders.forEach { sb.append("    dec: ${it.name} (${if (isHardware(it)) "hw" else "sw"})\n") }
        }
        return sb.toString().trimEnd()
    }

    fun entries(): List<CodecEntry> = infos().flatMap { info ->
        info.supportedTypes.map { mime ->
            CodecEntry(info.name, mime, info.isEncoder, isHardware(info))
        }
    }

    fun logSummary() {
        Log.i("Video encoders: ${encodersFor(H264).map { it.name + if (isHardware(it)) "*" else "" }}")
        Log.i("Video decoders: ${decodersFor(H264).map { it.name + if (isHardware(it)) "*" else "" }}")
    }
}
