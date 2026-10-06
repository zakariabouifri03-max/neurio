package com.neurio

import com.neurio.common.CsdCodec
import com.neurio.common.Protocol
import com.neurio.common.QualityReport
import com.neurio.common.SessionSecurity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class ProtocolTest {

    @Test
    fun headerRoundTrip() {
        // A real datagram always carries the trailing auth tag; include it.
        val buf = Protocol.newBuffer(Protocol.HEADER_SIZE + Protocol.AUTH_SIZE)
        Protocol.writeHeader(buf, Protocol.TYPE_VIDEO, Protocol.FLAG_KEYFRAME, 0, 0x11223344, 42)
        val data = buf.array()
        val header = Protocol.readHeader(data, data.size)
        assertNotNull(header)
        assertEquals(Protocol.TYPE_VIDEO, header!!.type)
        assertEquals(Protocol.FLAG_KEYFRAME, header.flags)
        assertEquals(0x11223344, header.sessionId)
        assertEquals(42, header.seq)
    }

    @Test
    fun rejectsBadMagic() {
        val buf = Protocol.newBuffer(Protocol.HEADER_SIZE + Protocol.AUTH_SIZE)
        Protocol.writeHeader(buf, Protocol.TYPE_VIDEO, 0, 0, 1, 1)
        val data = buf.array()
        data[0] = 0
        assertNull(Protocol.readHeader(data, data.size))
    }

    @Test
    fun inputEventRoundTrip() {
        val event = Protocol.InputEvent(
            evType = Protocol.INPUT_AXIS,
            code = Protocol.AXIS_JOYSTICK,
            flags = 0,
            x = -0.734f,
            y = 0.512f,
            value = 1f,
            seq = 1234,
            tsMs = 55555
        )
        val buf = ByteBuffer.allocate(Protocol.INPUT_PAYLOAD_SIZE)
        event.encode(buf)
        val decoded = Protocol.InputEvent.decode(ByteBuffer.wrap(buf.array()))
        assertEquals(event, decoded)
    }

    @Test
    fun videoMetaRoundTrip() {
        val meta = Protocol.VideoMeta(frameId = 99123, ptsUs = 123_456_789L, fragIndex = 3, fragCount = 17)
        val buf = Protocol.newBuffer(Protocol.VIDEO_META_SIZE)
        Protocol.writeVideoMeta(buf, meta)
        val decoded = Protocol.readVideoMeta(ByteBuffer.wrap(buf.array()))
        assertEquals(meta, decoded)
    }

    @Test
    fun qualityReportRoundTrip() {
        val report = QualityReport(
            rttMs = 6.2, lossPct = 0.4, jitterMs = 1.8, decodeMs = 7.3, fps = 59.2,
            width = 1280, height = 720
        )
        val encoded = report.encode()
        val decoded = QualityReport.decode(encoded, 0, encoded.size)
        assertNotNull(decoded)
        assertEquals(report, decoded)
    }

    @Test
    fun hmacSignAndVerify() {
        val token = SessionSecurity.generateToken()
        val packet = ByteArray(200)
        Protocol.writeHeader(ByteBuffer.wrap(packet), Protocol.TYPE_INPUT, 0, 0, 7, 7)
        SessionSecurity.sign(token, packet, 192)
        assertTrue(SessionSecurity.verify(token, packet, 200))
    }

    @Test
    fun hmacDetectsTampering() {
        val token = SessionSecurity.generateToken()
        val packet = ByteArray(64)
        SessionSecurity.sign(token, packet, 56)
        packet[20] = (packet[20].toInt() xor 0x5A).toByte()
        assertFalse(SessionSecurity.verify(token, packet, 64))
    }

    @Test
    fun wrongTokenFailsVerify() {
        val tokenA = SessionSecurity.generateToken()
        val tokenB = SessionSecurity.generateToken()
        val packet = ByteArray(80)
        SessionSecurity.sign(tokenA, packet, 72)
        assertFalse(SessionSecurity.verify(tokenB, packet, 80))
    }

    @Test
    fun pairingCodeShape() {
        repeat(20) {
            val code = SessionSecurity.generatePairingCode()
            assertEquals(6, code.length)
            assertTrue(code.all { it.isDigit() })
        }
    }

    @Test
    fun tokenHexRoundTrip() {
        val token = SessionSecurity.generateToken()
        val hex = SessionSecurity.toHex(token)
        assertEquals(64, hex.length)
        assertTrue(SessionSecurity.fromHex(hex)!!.contentEquals(token))
        assertNull(SessionSecurity.fromHex("zz"))
    }

    @Test
    fun csdBlobRoundTrip() {
        val csd0 = byteArrayOf(0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1F)
        val csd1 = byteArrayOf(0, 0, 0, 1, 0x68, 0x01)
        val blob = CsdCodec.encode(csd0, csd1)
        val (a, b) = CsdCodec.decode(blob)!!
        assertTrue(a.contentEquals(csd0))
        assertNotNull(b)
        assertTrue(b!!.contentEquals(csd1))

        val blobSingle = CsdCodec.encode(csd0, null)
        val (x, y) = CsdCodec.decode(blobSingle)!!
        assertTrue(x.contentEquals(csd0))
        assertNull(y)
    }
}
