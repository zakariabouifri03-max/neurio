package com.neurio.lanstream.core

import com.neurio.lanstream.media.AudioProfile
import com.neurio.lanstream.media.StreamProfile

/**
 * Owns the identity of one host session: pairing code, session id, session
 * token and the negotiated media description.
 *
 * Security model (prototype grade, LAN only):
 *  * the 6 digit code is never sent over the network — the client proves it
 *    knows the code with an HMAC over a fresh challenge (see PairingService);
 *  * after a successful handshake the host issues a random session token that
 *    must be present in every UDP datagram, so a device that never paired
 *    cannot push input or request keyframes;
 *  * repeated failures lock the session out for [LOCKOUT_MS] and a successful
 *    authentication rotates the session id, invalidating old tokens.
 */
class SessionManager {

    @Volatile
    var sessionId: Int = PairingService.newSessionId()
        private set

    @Volatile
    var pairingCode: String = PairingService.generateCode()
        private set

    @Volatile
    var challenge: String = ""
        private set

    @Volatile
    var salt: String = ""
        private set

    @Volatile
    var token: Int = 0
        private set

    @Volatile
    var authenticated: Boolean = false
        private set

    @Volatile
    var clientName: String? = null

    @Volatile
    var profile: StreamProfile? = null

    @Volatile
    var audioProfile: AudioProfile? = null

    @Volatile
    var failedAttempts: Int = 0
        private set

    @Volatile
    private var lockedUntilMs: Long = 0L

    val isLockedOut: Boolean get() = System.currentTimeMillis() < lockedUntilMs

    fun lockoutRemainingMs(): Long = (lockedUntilMs - System.currentTimeMillis()).coerceAtLeast(0L)

    fun rotateCode(): String {
        pairingCode = PairingService.generateCode()
        failedAttempts = 0
        lockedUntilMs = 0L
        return pairingCode
    }

    /** Called when a new client connects: fresh challenge/salt for the HMAC. */
    fun beginHandshake(): Pair<String, String> {
        challenge = PairingService.newChallenge()
        salt = PairingService.newSalt()
        return challenge to salt
    }

    fun verifyProof(proof: String?, clientName: String?): Boolean {
        if (isLockedOut) return false
        val ok = PairingService.verifyProof(pairingCode, challenge, salt, sessionId, proof)
        if (ok) {
            // New session id => any token handed out before is now useless.
            sessionId = PairingService.newSessionId()
            token = PairingService.newToken()
            authenticated = true
            failedAttempts = 0
            lockedUntilMs = 0L
            this.clientName = clientName
            return true
        }
        failedAttempts++
        if (failedAttempts >= MAX_ATTEMPTS) {
            lockedUntilMs = System.currentTimeMillis() + LOCKOUT_MS
            failedAttempts = 0
            Log.w("Too many failed pairings, session locked for ${LOCKOUT_MS}ms")
        }
        return false
    }

    fun invalidateToken() {
        token = PairingService.newToken()
    }

    fun markUnauthenticated() {
        authenticated = false
        clientName = null
        token = 0
    }

    fun reset() {
        sessionId = PairingService.newSessionId()
        pairingCode = PairingService.generateCode()
        challenge = ""
        salt = ""
        token = 0
        authenticated = false
        clientName = null
        failedAttempts = 0
        lockedUntilMs = 0L
    }

    companion object {
        private const val MAX_ATTEMPTS = 5
        private const val LOCKOUT_MS = 30_000L
    }
}
