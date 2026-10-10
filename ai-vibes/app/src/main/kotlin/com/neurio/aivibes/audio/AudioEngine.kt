package com.neurio.aivibes.audio

import com.neurio.aivibes.dsp.DspChain
import com.neurio.aivibes.dsp.DspConfig
import com.neurio.aivibes.dsp.SpectrumAnalyzer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-wide audio engine state.
 *
 * The UI writes [DspConfig] snapshots here; the Media3 audio thread reads them
 * through the shared [DspChain]. No locks in the audio path — configs are
 * immutable snapshots swapped atomically.
 */
object AudioEngine {
    val chain = DspChain()
    val analyzer = SpectrumAnalyzer()

    private val _config = MutableStateFlow(DspConfig())
    val config: StateFlow<DspConfig> = _config.asStateFlow()

    @Volatile
    var audioSessionId: Int = 0
        private set

    /** Called by the UI whenever a slider/preset changes. */
    fun setConfig(config: DspConfig) {
        _config.value = config
        chain.updateConfig(config)
    }

    /** Called by MusicService when the playback session id becomes known. */
    fun onAudioSessionId(id: Int) {
        if (id != audioSessionId) {
            audioSessionId = id
        }
    }

    /** Called on seek/track change so envelopes restart cleanly. */
    fun resetProcessingState() {
        chain.resetState()
    }
}
