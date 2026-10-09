package com.turbocast60.protocol

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RtpH264Test {
    @Test fun parsesAnnexBAndLengthPrefixedSamples() {
        val sps = byteArrayOf(0x67, 0x42, 0x00, 0x1e)
        val pps = byteArrayOf(0x68, 0x11)
        val annexB = byteArrayOf(0, 0, 0, 1) + sps + byteArrayOf(0, 0, 1) + pps
        val parsedAnnexB = H264NalUnits.parse(annexB)
        assertEquals(2, parsedAnnexB.size)
        assertArrayEquals(sps, parsedAnnexB[0])
        assertArrayEquals(pps, parsedAnnexB[1])

        val lengthPrefixed = byteArrayOf(0, 0, 0, sps.size.toByte()) + sps + byteArrayOf(0, 0, 0, pps.size.toByte()) + pps
        val parsedLength = H264NalUnits.parse(lengthPrefixed)
        assertEquals(2, parsedLength.size)
        assertArrayEquals(sps, parsedLength[0])
        assertArrayEquals(pps, parsedLength[1])
    }

    @Test fun fragmentsAndReassemblesAnIdrAccessUnit() {
        val idr = ByteArray(2_600) { index -> (index and 0xff).toByte() }.also { it[0] = 0x65 }
        var assembled: EncodedAccessUnit? = null
        val reassembler = RtpH264Reassembler(onAccessUnit = { assembled = it }, onLoss = {}, onIdrNeeded = {})
        val packets = RtpH264Packetizer(mtu = 600, ssrc = 17).packetize(EncodedAccessUnit(1_000_000, listOf(idr), true))
        assertTrue(packets.size > 1)
        packets.forEachIndexed { index, packet ->
            assertEquals(2, (packet[0].toInt() ushr 6) and 0x03)
            assertEquals(if (index == packets.lastIndex) 1 else 0, (packet[1].toInt() ushr 7) and 1)
            reassembler.accept(packet)
        }
        assertEquals(1_000_000L, assembled?.presentationTimeUs)
        assertTrue(assembled?.keyFrame == true)
        assertArrayEquals(idr, assembled?.nals?.single())
    }
}
