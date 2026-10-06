package com.neurio.common

import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Local session security.
 *
 *  - The host shows a short pairing code; only clients that present it can
 *    establish a session (see network.PairingService).
 *  - Every session gets a random 32-bit session id and a random 32-byte token.
 *  - Every UDP datagram carries an 8-byte truncated HMAC-SHA256 over its
 *    content keyed with the session token, so other devices on the LAN cannot
 *    inject video/input into an established session.
 *
 * This is LAN-grade security for a prototype: the stream is never routed
 * outside the local network and no cloud service is involved.
 */
object SessionSecurity {
    private val rng = SecureRandom()

    /** 6 digit pairing code, never starts with 0 ambiguity because of the range. */
    fun generatePairingCode(): String = (100000 + rng.nextInt(900000)).toString()

    fun generateSessionId(): Int {
        var id = rng.nextInt()
        if (id == 0) id = 0x12345678
        return id
    }

    fun generateToken(): ByteArray {
        val t = ByteArray(32)
        rng.nextBytes(t)
        return t
    }

    fun mac(token: ByteArray, data: ByteArray, offset: Int, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token, "HmacSHA256"))
        mac.update(data, offset, length)
        return mac.doFinal().copyOfRange(0, Protocol.AUTH_SIZE)
    }

    /** Signs `packet[0 until payloadLen]` in place, writing the auth tag right after. */
    fun sign(token: ByteArray, packet: ByteArray, payloadLen: Int) {
        val tag = mac(token, packet, 0, payloadLen)
        System.arraycopy(tag, 0, packet, payloadLen, Protocol.AUTH_SIZE)
    }

    /** Verifies the trailing auth tag of a received datagram of total length [len]. */
    fun verify(token: ByteArray, packet: ByteArray, len: Int): Boolean {
        if (len < Protocol.HEADER_SIZE + Protocol.AUTH_SIZE) return false
        val payloadLen = len - Protocol.AUTH_SIZE
        val expected = mac(token, packet, 0, payloadLen)
        var diff = 0
        for (i in 0 until Protocol.AUTH_SIZE) {
            diff = diff or (expected[i].toInt() xor packet[payloadLen + i].toInt())
        }
        return diff == 0
    }

    fun toHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            sb.append(Character.forDigit((b.toInt() shr 4) and 0xF, 16))
            sb.append(Character.forDigit(b.toInt() and 0xF, 16))
        }
        return sb.toString()
    }

    fun fromHex(hex: String): ByteArray? {
        if (hex.length % 2 != 0) return null
        for (c in hex) {
            if (Character.digit(c, 16) < 0) return null
        }
        return try {
            ByteArray(hex.length / 2) { i ->
                ((Character.digit(hex[i * 2], 16) shl 4) + Character.digit(hex[i * 2 + 1], 16)).toByte()
            }
        } catch (e: Exception) {
            null
        }
    }
}
