package com.neurio.lanstream.protocol

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Ephemeral ECDH + code proof. Gameplay never leaves the LAN. */
data class SessionKeys(
    val hostToClient: ByteArray,
    val clientToHost: ByteArray,
    val media: ByteArray,
)

data class ControlFrame(val type: Int, val body: DataInputStream)

object PairingCrypto {
    private val random = SecureRandom()
    private const val AES_GCM_TAG_BITS = 128

    fun newEphemeralKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"), random)
    }.generateKeyPair()

    fun decodePublicKey(encoded: ByteArray): PublicKey = KeyFactory.getInstance("EC")
        .generatePublic(X509EncodedKeySpec(encoded))

    fun agree(privateKey: PrivateKey, peerPublicKey: PublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").run {
            init(privateKey)
            doPhase(peerPublicKey, true)
            generateSecret()
        }

    fun transcript(
        sessionId: Long,
        serverNonce: ByteArray,
        clientNonce: ByteArray,
        clientVideoPort: Int,
        clientDeviceName: String,
        serverPublicKey: ByteArray,
        clientPublicKey: ByteArray,
    ): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { out ->
            out.writeLong(sessionId)
            out.writeSizedBytes(serverNonce)
            out.writeSizedBytes(clientNonce)
            out.writeInt(clientVideoPort)
            out.writeUTF(clientDeviceName.take(128))
            out.writeSizedBytes(serverPublicKey)
            out.writeSizedBytes(clientPublicKey)
        }
        bytes.toByteArray()
    }

    fun codeProof(code: String, transcript: ByteArray, side: Byte): ByteArray =
        hmac(code.toByteArray(Charsets.US_ASCII), transcript + byteArrayOf(side))

    fun deriveSessionKeys(sharedSecret: ByteArray, serverNonce: ByteArray, clientNonce: ByteArray, sessionId: Long): SessionKeys {
        val salt = serverNonce + clientNonce + ByteBuffer.allocate(8).putLong(sessionId).array()
        val master = hkdf(sharedSecret, salt, "neurio-lan-stream/v1/master".toByteArray(), 32)
        val material = hkdf(master, salt, "neurio-lan-stream/v1/directional-keys".toByteArray(), 96)
        return SessionKeys(
            hostToClient = material.copyOfRange(0, 32),
            clientToHost = material.copyOfRange(32, 64),
            media = material.copyOfRange(64, 96),
        )
    }

    fun authOkNonce(sessionId: Long): ByteArray = ByteBuffer.allocate(12)
        .putInt(0x41555448) // AUTH
        .putLong(sessionId)
        .array()

    fun authOkAad(sessionId: Long): ByteArray = ByteBuffer.allocate(8 + 7)
        .putLong(sessionId)
        .put("AUTH_OK".toByteArray(Charsets.US_ASCII))
        .array()

    fun encrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, plain: ByteArray): ByteArray =
        cipher(Cipher.ENCRYPT_MODE, key, nonce, aad).doFinal(plain)

    fun decrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, encrypted: ByteArray): ByteArray =
        cipher(Cipher.DECRYPT_MODE, key, nonce, aad).doFinal(encrypted)

    fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)

    fun nonce(prefix: Int, sequence: Long): ByteArray = ByteBuffer.allocate(12)
        .putInt(prefix)
        .putLong(sequence)
        .array()

    fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(data)
    }

    private fun cipher(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_BITS, nonce))
            updateAAD(aad)
        }

    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmac(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        val result = ByteArrayOutputStream(length)
        var previous = ByteArray(0)
        var counter = 1
        while (result.size() < length) {
            previous = hmac(prk, previous + info + byteArrayOf(counter.toByte()))
            result.write(previous)
            counter++
        }
        return result.toByteArray().copyOf(length)
    }
}

/** Length-prefixed AES-GCM control channel. TCP is used only for control/input. */
class SecureControlChannel(
    private val input: DataInputStream,
    private val output: DataOutputStream,
    private val sessionId: Long,
    private val txKey: ByteArray,
    private val rxKey: ByteArray,
    private val txPrefix: Int,
    private val rxPrefix: Int,
) {
    private var txSequence = 0L
    private var rxSequence = 0L
    private val writeLock = Any()

    fun send(type: Int, writeBody: DataOutputStream.() -> Unit = {}) {
        val plain = ByteArrayOutputStream().use { buffer ->
            DataOutputStream(buffer).use { body ->
                body.writeByte(type)
                body.writeBody()
            }
            buffer.toByteArray()
        }
        synchronized(writeLock) {
            val sequence = ++txSequence
            val aad = ByteBuffer.allocate(16).putLong(sessionId).putLong(sequence).array()
            val encrypted = PairingCrypto.encrypt(txKey, PairingCrypto.nonce(txPrefix, sequence), aad, plain)
            val length = 8 + encrypted.size
            if (length > LanProtocol.MAX_CONTROL_FRAME) throw IllegalArgumentException("Control frame too large")
            output.writeInt(length)
            output.writeLong(sequence)
            output.write(encrypted)
            output.flush()
        }
    }

    fun read(): ControlFrame {
        val length = input.readInt()
        if (length < 8 + 17 || length > LanProtocol.MAX_CONTROL_FRAME) {
            throw IllegalArgumentException("Invalid encrypted control frame size: $length")
        }
        val sequence = input.readLong()
        if (sequence != rxSequence + 1) throw SecurityException("Control replay or out-of-order frame")
        val encrypted = ByteArray(length - 8)
        input.readFully(encrypted)
        val aad = ByteBuffer.allocate(16).putLong(sessionId).putLong(sequence).array()
        val plain = PairingCrypto.decrypt(rxKey, PairingCrypto.nonce(rxPrefix, sequence), aad, encrypted)
        if (plain.isEmpty()) throw IllegalArgumentException("Empty control frame")
        rxSequence = sequence
        return ControlFrame(plain[0].toInt() and 0xff, DataInputStream(ByteArrayInputStream(plain, 1, plain.size - 1)))
    }
}

internal fun DataOutputStream.writeSizedBytes(bytes: ByteArray) {
    writeInt(bytes.size)
    write(bytes)
}

internal fun DataInputStream.readSizedBytes(maxBytes: Int = 1 shl 20): ByteArray {
    val size = readInt()
    if (size < 0 || size > maxBytes) throw IllegalArgumentException("Invalid byte array size")
    val bytes = ByteArray(size)
    readFully(bytes)
    return bytes
}
