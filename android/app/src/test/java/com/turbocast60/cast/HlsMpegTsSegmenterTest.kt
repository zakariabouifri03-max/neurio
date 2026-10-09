package com.turbocast60.cast

import com.turbocast60.protocol.EncodedAccessUnit
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HlsMpegTsSegmenterTest {
    @Test fun writesInMemoryTsSegmentsAtIdrBoundaries() {
        val store = HlsLiveStore(windowSize = 4)
        val segmenter = HlsMpegTsSegmenter(store, targetSegmentUs = 1_500_000)
        val sps = byteArrayOf(0x67, 0x42, 0x00, 0x1e)
        val pps = byteArrayOf(0x68, 0x11)
        segmenter.configure(1280, 720, sps, pps)
        segmenter.add(EncodedAccessUnit(0, listOf(byteArrayOf(0x65, 1, 2)), true))
        segmenter.add(EncodedAccessUnit(1_000_000, listOf(byteArrayOf(0x41, 3, 4)), false))
        assertTrue(segmenter.add(EncodedAccessUnit(2_000_000, listOf(byteArrayOf(0x65, 5, 6)), true)))

        val segment = store.get(0)
        assertNotNull(segment)
        assertTrue(segment!!.bytes.isNotEmpty())
        assertTrue(segment.bytes.size % 188 == 0)
        assertTrue(segment.bytes.allIndexed { index, byte -> index % 188 != 0 || byte == 0x47.toByte() })
        val playlist = String(store.playlist("token"), Charsets.UTF_8)
        assertTrue(playlist.contains("#EXTM3U"))
        assertTrue(playlist.contains("seg-0.ts"))
        segmenter.finish()
        store.clear()
    }

    private inline fun ByteArray.allIndexed(predicate: (Int, Byte) -> Boolean): Boolean {
        for (index in indices) if (!predicate(index, this[index])) return false
        return true
    }
}
