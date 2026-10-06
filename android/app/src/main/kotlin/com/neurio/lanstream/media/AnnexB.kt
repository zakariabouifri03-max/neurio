package com.neurio.lanstream.media

/**
 * Minimal Annex-B helpers.
 *
 * MediaCodec speaks Annex-B (start-code delimited NAL units) for H.264/H.265,
 * while MediaFormat wants the codec configuration as raw NAL units in `csd-0`
 * / `csd-1`. These helpers convert between the two and let the host prepend
 * SPS/PPS to every keyframe so a player that joins mid-stream (or lost a config
 * packet) can still start decoding immediately.
 */
object AnnexB {

    private val START_CODE_4 = byteArrayOf(0, 0, 0, 1)
    private val START_CODE_3 = byteArrayOf(0, 0, 1)

    const val NAL_SPS = 7
    const val NAL_PPS = 8
    const val NAL_IDR = 5
    const val NAL_VPS_HEVC = 32
    const val NAL_SPS_HEVC = 33
    const val NAL_PPS_HEVC = 34
    const val NAL_IDR_HEVC_N_LP = 19
    const val NAL_IDR_HEVC_W_RADL = 20

    fun nalType(nal: ByteArray): Int {
        if (nal.isEmpty()) return 0
        return when {
            isHevc(nal) -> (nal[0].toInt() and 0x7E) shr 1
            else -> nal[0].toInt() and 0x1F
        }
    }

    /** HEVC NAL header is two bytes ( nal_unit_header = 0x40 0x01 ... ). */
    private fun isHevc(nal: ByteArray): Boolean =
        nal.size >= 2 && (nal[0].toInt() and 0x7E) == 0x40

    /** Splits an Annex-B buffer into NAL units (start codes removed). */
    fun splitNals(data: ByteArray): List<ByteArray> {
        val nals = ArrayList<ByteArray>(4)
        val size = data.size
        var i = 0
        var nalStart = -1
        while (i + 2 < size) {
            if (data[i] == 0.toByte() && data[i + 1] == 0.toByte() && data[i + 2] == 1.toByte()) {
                // Count (max 3) the zero bytes that belong to this start code.
                var zeros = 0
                while (zeros < 3 && i - 1 - zeros >= 0 && data[i - 1 - zeros] == 0.toByte()) zeros++
                val begin = i - zeros
                if (nalStart >= 0 && begin > nalStart) {
                    nals.add(data.copyOfRange(nalStart, begin))
                }
                nalStart = i + 3
                i += 3
            } else {
                i++
            }
        }
        if (nalStart >= 0 && nalStart < size) nals.add(data.copyOfRange(nalStart, size))
        return nals.filter { it.isNotEmpty() }
    }

    /**
     * Extracts (SPS, PPS) from a codec-config buffer.
     * Returns nulls when the buffer cannot be parsed — callers then fall back to
     * handing the whole buffer to MediaFormat as `csd-0`, which most Android
     * decoders accept.
     */
    fun spsPps(data: ByteArray, hevc: Boolean): Pair<ByteArray?, ByteArray?> {
        val nals = splitNals(data)
        if (nals.isEmpty()) return null to null
        if (hevc) {
            val vps = nals.firstOrNull { nalType(it) == NAL_VPS_HEVC }
            val sps = nals.firstOrNull { nalType(it) == NAL_SPS_HEVC }
            val pps = nals.firstOrNull { nalType(it) == NAL_PPS_HEVC }
            // For HEVC, csd-0 conventionally holds VPS+SPS+PPS concatenated.
            val csd0 = listOfNotNull(vps, sps).takeIf { it.isNotEmpty() }?.let { concat(it) }
            return (csd0 ?: sps) to pps
        }
        val sps = nals.firstOrNull { nalType(it) == NAL_SPS }
        val pps = nals.firstOrNull { nalType(it) == NAL_PPS }
        return sps to pps
    }

    fun concat(nals: List<ByteArray>): ByteArray {
        val total = nals.sumOf { it.size }
        val out = ByteArray(total)
        var pos = 0
        nals.forEach { nal ->
            System.arraycopy(nal, 0, out, pos, nal.size)
            pos += nal.size
        }
        return out
    }

    fun withStartCode(nal: ByteArray, long: Boolean = true): ByteArray {
        val prefix = if (long) START_CODE_4 else START_CODE_3
        val out = ByteArray(prefix.size + nal.size)
        System.arraycopy(prefix, 0, out, 0, prefix.size)
        System.arraycopy(nal, 0, out, prefix.size, nal.size)
        return out
    }

    /** Prepends SPS/PPS (with start codes) to an access unit. */
    fun prependConfig(frame: ByteArray, sps: ByteArray?, pps: ByteArray?): ByteArray {
        if (sps == null && pps == null) return frame
        val parts = ArrayList<ByteArray>(3)
        sps?.let { parts.add(withStartCode(it)) }
        pps?.let { parts.add(withStartCode(it)) }
        parts.add(frame)
        return concat(parts)
    }

    fun containsKeyframe(data: ByteArray, hevc: Boolean): Boolean {
        val types = if (hevc) intArrayOf(NAL_IDR_HEVC_N_LP, NAL_IDR_HEVC_W_RADL) else intArrayOf(NAL_IDR)
        return splitNals(data).any { nalType(it) in types }
    }
}
