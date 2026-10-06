package com.neurio.lanstream.core

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Pairing + session security for the LAN session.
 *
 * 1. The host shows a 6 digit code (never sent over the wire in the clear).
 * 2. The host sends a random `challenge` + `salt` to whoever connects.
 * 3. The client proves it knows the code with HMAC-SHA256(code, challenge|salt|sessionId).
 * 4. On success the host hands out a random 32 bit session token that must be
 *    present in every UDP datagram (video / audio / input). Unknown tokens are
 *    dropped at the socket layer, so a stray device on the Wi-Fi cannot inject
 *    input or force keyframes.
 *
 * This is a prototype-grade scheme: it stops casual/unknown clients on a LAN,
 * it is not a substitute for TLS. Everything stays on the local network.
 */
object PairingService {

    private const val CODE_LENGTH = 6
    private const val CHALLENGE_BYTES = 16
    private const val SALT_BYTES = 16

    private val random = SecureRandom()

    fun generateCode(): String {
        val sb = StringBuilder(CODE_LENGTH)
        repeat(CODE_LENGTH) { sb.append(random.nextInt(10)) }
        return sb.toString()
    }

    fun newChallenge(): String = randomHex(CHALLENGE_BYTES)

    fun newSalt(): String = randomHex(SALT_BYTES)

    /** Random, non-zero, positive 32 bit token used by the UDP datagram header. */
    fun newToken(): Int {
        var t = random.nextInt()
        while (t == 0) t = random.nextInt()
        return t
    }

    /** Random session id (also carried in the datagram header). */
    fun newSessionId(): Int {
        var id = random.nextInt()
        while (id == 0) id = random.nextInt()
        return id
    }

    fun computeProof(code: String, challenge: String, salt: String, sessionId: Int): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(code.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val payload = "$challenge|$salt|$sessionId"
        return Base64.encodeToString(mac.doFinal(payload.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    /** Constant time verification (no early return on first differing byte). */
    fun verifyProof(
        code: String,
        challenge: String,
        salt: String,
        sessionId: Int,
        presented: String?
    ): Boolean {
        if (presented.isNullOrBlank()) return false
        val expected = runCatching { computeProof(code, challenge, salt, sessionId) }.getOrNull()
            ?: return false
        return MessageDigest.isEqual(
            expected.toByteArray(Charsets.UTF_8),
            presented.toByteArray(Charsets.UTF_8)
        )
    }

    fun constantTimeEquals(a: String?, b: String?): Boolean {
        if (a == null || b == null) return false
        return MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))
    }

    private fun randomHex(bytes: Int): String {
        val buf = ByteArray(bytes)
        random.nextBytes(buf)
        return buf.joinToString("") { "%02x".format(it) }
    }
}
