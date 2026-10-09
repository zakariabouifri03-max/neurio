package com.turbocast60.protocol

import android.util.Base64
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Ephemeral P-256 ECDH, authenticated by a short code shown on the receiver, then AES-GCM. */
object PairingHandshake {
    private val random = SecureRandom()

    data class Keys(
        val clientToServerControl: ByteArray,
        val serverToClientControl: ByteArray,
        val clientToServerVideo: ByteArray,
        val clientAuthentication: ByteArray,
        val serverAuthentication: ByteArray
    )

    fun asClient(socket: Socket, pin: String): SecureControlChannel {
        require(pin.matches(Regex("\\d{6}"))) { "Enter the six-digit code shown on the TV" }
        socket.soTimeout = 20_000
        val reader = socket.getInputStream().bufferedReader(StandardCharsets.UTF_8)
        val writer = socket.getOutputStream().bufferedWriter(StandardCharsets.UTF_8)
        val clientPair = newEphemeralKeyPair()
        writePlain(writer, JSONObject().put("type", "HELLO").put("pub", b64(clientPair.public.encoded)))
        val challenge = readPlain(reader)
        check(challenge.optString("type") == "CHALLENGE") { "Receiver did not start secure pairing" }
        val salt = decode(challenge.getString("salt"))
        val nonce = decode(challenge.getString("nonce"))
        val serverPublic = decodePublicKey(challenge.getString("pub"))
        val keys = deriveKeys(clientPair, serverPublic, pin, salt)
        val senderProof = hmac(keys.clientAuthentication, concat("sender".toByteArray(), nonce))
        writePlain(writer, JSONObject().put("type", "AUTH").put("proof", b64(senderProof)))
        val accepted = readPlain(reader)
        check(accepted.optString("type") == "ACCEPT") {
            "Pairing failed. Check the code shown on the TV and try again."
        }
        val expected = hmac(keys.serverAuthentication, concat("receiver".toByteArray(), nonce))
        check(MessageDigest.isEqual(expected, decode(accepted.getString("proof")))) {
            "Receiver authentication failed"
        }
        socket.soTimeout = 0
        return SecureControlChannel(socket, keys, client = true, reader = reader, writer = writer)
    }

    fun asServer(socket: Socket, pin: String): SecureControlChannel {
        require(pin.matches(Regex("\\d{6}")))
        socket.soTimeout = 20_000
        val reader = socket.getInputStream().bufferedReader(StandardCharsets.UTF_8)
        val writer = socket.getOutputStream().bufferedWriter(StandardCharsets.UTF_8)
        val hello = readPlain(reader)
        check(hello.optString("type") == "HELLO") { "Unsupported sender handshake" }
        val clientPublic = decodePublicKey(hello.getString("pub"))
        val serverPair = newEphemeralKeyPair()
        val salt = ByteArray(16).also(random::nextBytes)
        val nonce = ByteArray(16).also(random::nextBytes)
        val keys = deriveKeys(serverPair, clientPublic, pin, salt)
        writePlain(
            writer,
            JSONObject()
                .put("type", "CHALLENGE")
                .put("pub", b64(serverPair.public.encoded))
                .put("salt", b64(salt))
                .put("nonce", b64(nonce))
        )
        val auth = readPlain(reader)
        val expected = hmac(keys.clientAuthentication, concat("sender".toByteArray(), nonce))
        if (auth.optString("type") != "AUTH" || !MessageDigest.isEqual(expected, decode(auth.optString("proof")))) {
            writePlain(writer, JSONObject().put("type", "REJECT"))
            throw SecurityException("Pair code was not accepted")
        }
        val receiverProof = hmac(keys.serverAuthentication, concat("receiver".toByteArray(), nonce))
        writePlain(writer, JSONObject().put("type", "ACCEPT").put("proof", b64(receiverProof)))
        socket.soTimeout = 0
        return SecureControlChannel(socket, keys, client = false, reader = reader, writer = writer)
    }

    private fun newEphemeralKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"), random)
    }.generateKeyPair()

    private fun decodePublicKey(encoded: String) = KeyFactory.getInstance("EC")
        .generatePublic(X509EncodedKeySpec(decode(encoded)))

    private fun deriveKeys(pair: KeyPair, peer: java.security.PublicKey, pin: String, salt: ByteArray): Keys {
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(pair.private)
        agreement.doPhase(peer, true)
        val shared = agreement.generateSecret()
        val pinSpec = PBEKeySpec(pin.toCharArray(), salt, 120_000, 256)
        val pinKey = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(pinSpec).encoded
        pinSpec.clearPassword()
        val prk = hmac(pinKey, shared)
        return Keys(
            clientToServerControl = hmac(prk, "TurboCast60 control c2s v1".toByteArray()),
            serverToClientControl = hmac(prk, "TurboCast60 control s2c v1".toByteArray()),
            clientToServerVideo = hmac(prk, "TurboCast60 video c2s v1".toByteArray()),
            clientAuthentication = hmac(prk, "TurboCast60 authentication c2s v1".toByteArray()),
            serverAuthentication = hmac(prk, "TurboCast60 authentication s2c v1".toByteArray())
        )
    }

    internal fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(data)
    }

    private fun concat(a: ByteArray, b: ByteArray) = ByteArray(a.size + b.size).also {
        System.arraycopy(a, 0, it, 0, a.size)
        System.arraycopy(b, 0, it, a.size, b.size)
    }

    private fun writePlain(writer: BufferedWriter, json: JSONObject) {
        writer.write(json.toString())
        writer.newLine()
        writer.flush()
    }

    private fun readPlain(reader: BufferedReader): JSONObject = JSONObject(readBoundedProtocolLine(reader, 65_536))

    private fun b64(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
    private fun decode(value: String) = Base64.decode(value, Base64.DEFAULT)
}

internal fun readBoundedProtocolLine(reader: BufferedReader, maxChars: Int): String {
    val line = StringBuilder()
    while (true) {
        val value = reader.read()
        if (value == -1) throw java.io.EOFException("Control connection closed")
        if (value == '\n'.code) return line.toString()
        if (value == '\r'.code) continue
        require(line.length < maxChars) { "Oversized protocol message" }
        line.append(value.toChar())
    }
}

/** Authenticated, ordered JSON control channel. Video packets use a separate GCM key. */
class SecureControlChannel internal constructor(
    private val socket: Socket,
    private val keys: PairingHandshake.Keys,
    private val client: Boolean,
    private val reader: BufferedReader,
    private val writer: BufferedWriter
) : AutoCloseable {
    private val sendLock = Any()
    private var sendSequence = 0L
    private var receiveSequence = 0L

    fun send(message: JSONObject) {
        synchronized(sendLock) {
            val sequence = sendSequence++
            val key = if (client) keys.clientToServerControl else keys.serverToClientControl
            val encrypted = crypt(Cipher.ENCRYPT_MODE, key, sequence, message.toString().toByteArray(StandardCharsets.UTF_8))
            val envelope = JSONObject().put("seq", sequence).put("box", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            writer.write(envelope.toString())
            writer.newLine()
            writer.flush()
        }
    }

    fun read(): JSONObject {
        val envelope = JSONObject(readBoundedProtocolLine(reader, 131_072))
        val sequence = envelope.getLong("seq")
        check(sequence == receiveSequence) { "Control packet sequence mismatch" }
        val key = if (client) keys.serverToClientControl else keys.clientToServerControl
        val plain = crypt(Cipher.DECRYPT_MODE, key, sequence, Base64.decode(envelope.getString("box"), Base64.DEFAULT))
        receiveSequence++
        return JSONObject(String(plain, StandardCharsets.UTF_8))
    }

    fun newVideoCipher(): SecureVideoCipher {
        check(client) { "Only the sender encrypts video" }
        return SecureVideoCipher(keys.clientToServerVideo, encrypt = true)
    }

    fun newVideoDecipher(): SecureVideoCipher {
        check(!client) { "Only the receiver decrypts video" }
        return SecureVideoCipher(keys.clientToServerVideo, encrypt = false)
    }

    private fun crypt(mode: Int, key: ByteArray, sequence: Long, bytes: ByteArray): ByteArray {
        val direction = if ((mode == Cipher.ENCRYPT_MODE) == client) 1 else 2
        val nonce = ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN)
            .putInt(direction).putLong(sequence).array()
        val aad = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(sequence).array()
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(bytes)
        }
    }

    override fun close() {
        runCatching { socket.close() }
    }
}

/** Authenticated RTP payload wrapper. Clear RTP headers only expose sequence and timing metadata. */
class SecureVideoCipher internal constructor(private val key: ByteArray, private val encrypt: Boolean) {
    private var nextCounter = 0L
    private var lastReceivedCounter = -1L
    private val noncePrefix = PairingHandshake.hmac(key, "TurboCast60 RTP nonce v1".toByteArray()).copyOfRange(0, 4)

    @Synchronized
    fun protect(rtpPacket: ByteArray): ByteArray {
        check(encrypt && rtpPacket.size >= 12)
        val counter = nextCounter++
        val counterBytes = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(counter).array()
        val header = rtpPacket.copyOfRange(0, 12)
        val protectedBody = crypt(Cipher.ENCRYPT_MODE, counter, counterBytes, header, rtpPacket.copyOfRange(12, rtpPacket.size))
        return header + counterBytes + protectedBody
    }

    @Synchronized
    fun unprotect(packet: ByteArray): ByteArray? {
        if (encrypt || packet.size < 12 + 8 + 16) return null
        val header = packet.copyOfRange(0, 12)
        val counterBytes = packet.copyOfRange(12, 20)
        val counter = ByteBuffer.wrap(counterBytes).order(ByteOrder.BIG_ENDIAN).long
        if (counter <= lastReceivedCounter || counter < 0) return null
        return try {
            val plain = crypt(Cipher.DECRYPT_MODE, counter, counterBytes, header, packet.copyOfRange(20, packet.size))
            lastReceivedCounter = counter
            header + plain
        } catch (_: Exception) {
            null
        }
    }

    private fun crypt(mode: Int, counter: Long, counterBytes: ByteArray, header: ByteArray, body: ByteArray): ByteArray {
        val nonce = noncePrefix + counterBytes
        val aad = header + counterBytes
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(body)
        }
    }
}
