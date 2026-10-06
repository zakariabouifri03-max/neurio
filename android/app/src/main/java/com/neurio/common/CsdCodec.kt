package com.neurio.common

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Encodes/decodes codec-specific-data (SPS/PPS or VPS/SPS/PPS) into one blob
 * that travels as a CONFIG packet at stream start and before keyframes:
 *
 * [len4][csd-0 bytes][len4][csd-1 bytes]?   (second block optional)
 */
object CsdCodec {

    fun encode(csd0: ByteArray, csd1: ByteArray?): ByteArray {
        val size = 4 + csd0.size + (if (csd1 != null) 4 + csd1.size else 0)
        val buf = ByteBuffer.allocate(size).order(ByteOrder.BIG_ENDIAN)
        buf.putInt(csd0.size)
        buf.put(csd0)
        if (csd1 != null) {
            buf.putInt(csd1.size)
            buf.put(csd1)
        }
        return buf.array()
    }

    /** @return csd-0 and optional csd-1, or null when the blob is malformed. */
    fun decode(blob: ByteArray): Pair<ByteArray, ByteArray?>? {
        return try {
            val buf = ByteBuffer.wrap(blob).order(ByteOrder.BIG_ENDIAN)
            val len0 = buf.int
            if (len0 <= 0 || len0 > buf.remaining()) return null
            val csd0 = ByteArray(len0)
            buf.get(csd0)
            var csd1: ByteArray? = null
            if (buf.remaining() >= 4) {
                val len1 = buf.int
                if (len1 > 0 && len1 <= buf.remaining()) {
                    csd1 = ByteArray(len1)
                    buf.get(csd1)
                }
            }
            Pair(csd0, csd1)
        } catch (e: Exception) {
            null
        }
    }
}
