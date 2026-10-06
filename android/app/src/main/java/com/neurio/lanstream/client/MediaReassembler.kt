package com.neurio.lanstream.client

import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.protocol.LanProtocol
import com.neurio.lanstream.protocol.MediaFragment
import java.io.ByteArrayOutputStream
import java.util.LinkedHashMap

internal data class EncodedAccessUnit(
    val mediaType: Int,
    val sequence: Int,
    val presentationTimeUs: Long,
    val keyFrame: Boolean,
    val data: ByteArray,
)

/** Reassembles bounded low-latency access units from independently authenticated UDP fragments. */
internal class MediaReassembler(private val stats: NetworkStats, private val onLost: (Long) -> Unit = {}) {
    private data class Key(val type: Int, val sequence: Int)
    private data class Assembly(
        val flags: Int,
        val ptsUs: Long,
        val parts: Array<ByteArray?>,
        val createdAtMs: Long,
        var received: Int = 0,
        var bytes: Int = 0,
    )

    private val assemblies = LinkedHashMap<Key, Assembly>()
    private var lastVideoSequence: Int? = null

    @Synchronized
    fun accept(fragment: MediaFragment): EncodedAccessUnit? {
        prune(System.currentTimeMillis())
        if (fragment.mediaType == LanProtocol.MEDIA_VIDEO) {
            val previous = lastVideoSequence
            if (previous != null && fragment.sequence > previous + 1) {
                val missed = (fragment.sequence - previous - 1).toLong()
                stats.lost(missed)
                onLost(missed)
            }
            if (previous == null || fragment.sequence > previous) lastVideoSequence = fragment.sequence
        }
        val key = Key(fragment.mediaType, fragment.sequence)
        val assembly = assemblies.getOrPut(key) {
            Assembly(fragment.flags, fragment.presentationTimeUs, arrayOfNulls(fragment.fragmentCount), System.currentTimeMillis())
        }
        if (assembly.parts.size != fragment.fragmentCount || assembly.parts[fragment.fragmentIndex] != null) return null
        assembly.parts[fragment.fragmentIndex] = fragment.payload
        assembly.received++
        assembly.bytes += fragment.payload.size
        if (assembly.received != assembly.parts.size) return null
        assemblies.remove(key)
        if (assembly.bytes !in 1..(4 * 1024 * 1024)) return null
        val joined = ByteArrayOutputStream(assembly.bytes)
        assembly.parts.forEach { part -> if (part != null) joined.write(part, 0, part.size) }
        return EncodedAccessUnit(
            mediaType = fragment.mediaType,
            sequence = fragment.sequence,
            presentationTimeUs = assembly.ptsUs,
            keyFrame = assembly.flags and LanProtocol.FLAG_KEY_FRAME != 0,
            data = joined.toByteArray(),
        )
    }

    @Synchronized
    private fun prune(now: Long) {
        val expired = assemblies.filterValues { now - it.createdAtMs > 180 }.keys
        expired.forEach { key ->
            if (key.type == LanProtocol.MEDIA_VIDEO) {
                stats.lost()
                onLost(1)
            }
            assemblies.remove(key)
        }
        while (assemblies.size > 80) {
            val oldest = assemblies.entries.firstOrNull() ?: break
            if (oldest.key.type == LanProtocol.MEDIA_VIDEO) {
                stats.lost()
                onLost(1)
            }
            assemblies.remove(oldest.key)
        }
    }
}
