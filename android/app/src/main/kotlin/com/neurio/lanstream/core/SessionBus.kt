package com.neurio.lanstream.core

import com.neurio.lanstream.discovery.HostEndpoint
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.media.StreamProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// ---------------------------------------------------------------------------
// HOST
// ---------------------------------------------------------------------------

enum class HostPhase { IDLE, PREPARING, WAITING, STREAMING, STOPPING, ERROR }

enum class AudioStatus {
    UNKNOWN,
    UNSUPPORTED_OS,
    DISABLED,
    STARTING,
    CAPTURING,
    SILENT,
    BLOCKED,
    FAILED;

    val isLive: Boolean get() = this == CAPTURING
}

data class HostState(
    val phase: HostPhase = HostPhase.IDLE,
    val deviceName: String = "",
    val localIp: String? = null,
    val networkType: String = "",
    val ssid: String? = null,
    val pairingCode: String = "",
    val selectedGame: GameApp? = null,
    val playerName: String? = null,
    val message: String? = null,
    val audio: AudioStatus = AudioStatus.UNKNOWN,
    val audioDetail: String? = null,
    val inputDescription: String = "",
    val profile: StreamProfile? = null
) {
    val isStreaming: Boolean get() = phase == HostPhase.STREAMING
    val isActive: Boolean get() = phase == HostPhase.PREPARING ||
        phase == HostPhase.WAITING ||
        phase == HostPhase.STREAMING
}

data class HostStats(
    val fps: Float = 0f,
    val targetFps: Int = 0,
    val bitrateBps: Long = 0L,
    val targetBitrateBps: Long = 0L,
    val pingMs: Long = 0L,
    val resolution: String = "",
    val droppedFrames: Long = 0L,
    val encoderName: String = "",
    val hardwareEncoder: Boolean = false,
    val packetLoss: Float = 0f,
    val encodeMs: Float = 0f,
    val adaptiveState: String = "",
    val inputEventsPerSec: Float = 0f,
    val inputLatencyMs: Float = 0f,
    val playerReportedFps: Float = 0f
)

/**
 * Process-wide state hub for host mode. The service writes, the Compose UI
 * reads through flows; both live in the same process (no AIDL needed for a
 * prototype, and it keeps the UI honest about what the service is doing).
 */
object HostBus {
    private val _state = MutableStateFlow(HostState())
    val state: StateFlow<HostState> = _state.asStateFlow()

    private val _stats = MutableStateFlow(HostStats())
    val stats: StateFlow<HostStats> = _stats.asStateFlow()

    fun updateState(mutator: HostState.() -> HostState) {
        _state.value = _state.value.mutator()
    }

    fun setStats(stats: HostStats) {
        _stats.value = stats
    }

    fun resetStats() {
        _stats.value = HostStats()
    }
}

// ---------------------------------------------------------------------------
// CLIENT
// ---------------------------------------------------------------------------

enum class ClientPhase { IDLE, SCANNING, CONNECTING, AUTHENTICATING, STREAMING, ERROR }

data class ClientState(
    val phase: ClientPhase = ClientPhase.IDLE,
    val hosts: List<HostEndpoint> = emptyList(),
    val selected: HostEndpoint? = null,
    val message: String? = null,
    val videoReady: Boolean = false,
    val nowPlaying: String? = null,
    val inputForwarding: Boolean = false
)

data class ClientStats(
    val fps: Float = 0f,
    val pingMs: Long = 0L,
    val bitrateBps: Long = 0L,
    val resolution: String = "",
    val droppedFrames: Long = 0L,
    val packetLoss: Float = 0f,
    val decodeMs: Float = 0f,
    val latencyMs: Float = 0f,
    val decoderName: String = "",
    val hardwareDecoder: Boolean = false,
    val audioPlaying: Boolean = false
)

object ClientBus {
    private val _state = MutableStateFlow(ClientState())
    val state: StateFlow<ClientState> = _state.asStateFlow()

    private val _stats = MutableStateFlow(ClientStats())
    val stats: StateFlow<ClientStats> = _stats.asStateFlow()

    private val _code = MutableStateFlow("")
    val code: StateFlow<String> = _code.asStateFlow()

    fun updateState(mutator: ClientState.() -> ClientState) {
        _state.value = _state.value.mutator()
    }

    fun setStats(stats: ClientStats) {
        _stats.value = stats
    }

    fun setCode(code: String) {
        _code.value = code
    }

    fun resetStats() {
        _stats.value = ClientStats()
    }
}
