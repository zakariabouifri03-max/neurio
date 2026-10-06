package com.neurio.network

import com.neurio.common.AppLog
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.net.Socket
import java.net.SocketTimeoutException

/** Message types of the TCP control channel (length-prefixed UTF-8 JSON). */
object ControlTypes {
    const val HELLO = "HELLO"
    const val HELLO_ACK = "HELLO_ACK"
    const val PAIR_REQ = "PAIR_REQ"
    const val PAIR_OK = "PAIR_OK"
    const val PAIR_FAIL = "PAIR_FAIL"
    const val START = "START"
    const val STARTED = "STARTED"
    const val ADAPT = "ADAPT"
    const val STOP = "STOP"
    const val BYE = "BYE"
    const val ERROR = "ERROR"
}

/**
 * One control message. The TCP channel is used for everything that must be
 * reliable: pairing, session negotiation, adaptation notifications, teardown.
 * The UDP channel carries the latency-critical media + input.
 */
class ControlMessage(val type: String, val body: JSONObject) {

    fun write(out: DataOutputStream) {
        val bytes = toJson().toByteArray(Charsets.UTF_8)
        synchronized(out) {
            out.writeInt(bytes.size)
            out.write(bytes)
            out.flush()
        }
    }

    fun toJson(): String {
        val o = JSONObject()
        o.put("t", type)
        o.put("b", body)
        return o.toString()
    }

    companion object {
        private const val TAG = "Control"
        private const val MAX_LEN = 64 * 1024

        fun of(type: String, fill: (JSONObject.() -> Unit)? = null): ControlMessage {
            val body = JSONObject()
            fill?.invoke(body)
            return ControlMessage(type, body)
        }

        /** @return the next message, or null on clean end of stream. */
        fun read(input: DataInputStream): ControlMessage? {
            val len = try {
                input.readInt()
            } catch (e: EOFException) {
                return null
            } catch (e: SocketTimeoutException) {
                return null
            }
            if (len <= 0 || len > MAX_LEN) {
                AppLog.w(TAG, "bad control frame length $len")
                return null
            }
            val buf = ByteArray(len)
            input.readFully(buf)
            val json = JSONObject(String(buf, Charsets.UTF_8))
            return ControlMessage(json.getString("t"), json.optJSONObject("b") ?: JSONObject())
        }
    }
}

/** Wraps a TCP socket with message framing and a reader thread. */
class ControlChannel(val socket: Socket) {
    private val out = DataOutputStream(socket.getOutputStream())
    private val input = DataInputStream(socket.getInputStream())

    @Volatile
    var isOpen: Boolean = true
        private set

    var remoteName: String = ""

    val remoteAddress: String
        get() = socket.inetAddress?.hostAddress ?: "?"

    fun send(msg: ControlMessage) {
        if (!isOpen) return
        try {
            msg.write(out)
        } catch (e: Exception) {
            AppLog.w("Control", "send failed: ${e.message}")
            isOpen = false
        }
    }

    /** Blocking single-message read, used during the synchronous handshake. */
    fun readBlocking(): ControlMessage? {
        return try {
            ControlMessage.read(input)
        } catch (e: Exception) {
            AppLog.d("Control", "readBlocking error: ${e.message}")
            null
        }
    }

    fun startReader(onMessage: (ControlMessage) -> Unit, onClose: () -> Unit): Thread {
        val t = Thread {
            try {
                while (isOpen) {
                    val msg = read(input) ?: break
                    try {
                        onMessage(msg)
                    } catch (e: Exception) {
                        AppLog.w("Control", "handler error", e)
                    }
                }
            } catch (e: Exception) {
                AppLog.d("Control", "reader ended: ${e.message}")
            } finally {
                isOpen = false
                try {
                    onClose()
                } catch (ignored: Exception) {
                }
            }
        }
        t.name = "neurio-control-rx"
        t.isDaemon = true
        t.start()
        return t
    }

    fun close() {
        isOpen = false
        try {
            socket.close()
        } catch (ignored: Exception) {
        }
    }
}
