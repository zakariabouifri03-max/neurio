package com.neurio.network

import com.neurio.common.SessionSecurity
import com.neurio.common.StreamConfig
import java.net.InetSocketAddress

/** Lifecycle of a host session. */
enum class SessionState { IDLE, WAITING_CLIENT, PAIRED, STREAMING }

/** Everything the host knows about the single paired client. */
class HostSession(
    val sessionId: Int,
    val token: ByteArray,
    val clientName: String,
    val clientAddress: InetSocketAddress
) {
    @Volatile
    var state: SessionState = SessionState.PAIRED

    @Volatile
    var config: StreamConfig? = null

    val tokenHex: String = SessionSecurity.toHex(token)
}

/** Host-side session bookkeeping (single client for this prototype). */
class SessionManager {
    @Volatile
    var active: HostSession? = null
        private set

    val isBusy: Boolean get() = active != null

    fun create(clientName: String, clientAddress: InetSocketAddress): HostSession {
        val session = HostSession(
            sessionId = SessionSecurity.generateSessionId(),
            token = SessionSecurity.generateToken(),
            clientName = clientName,
            clientAddress = clientAddress
        )
        active = session
        return session
    }

    fun clear() {
        active = null
    }
}

/** Data parsed out of PAIR_OK on the client side. */
data class PairingResult(
    val sessionId: Int,
    val token: ByteArray,
    val hostMediaPort: Int,
    val hostName: String
)
