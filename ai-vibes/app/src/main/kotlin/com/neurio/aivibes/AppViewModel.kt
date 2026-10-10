package com.neurio.aivibes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.neurio.aivibes.ai.SmartSound
import com.neurio.aivibes.audio.AudioEngine
import com.neurio.aivibes.dsp.DspConfig
import com.neurio.aivibes.dsp.SpectrumAnalyzer
import com.neurio.aivibes.headphones.HeadphoneMonitor
import com.neurio.aivibes.playback.NowPlaying
import com.neurio.aivibes.playback.Playlist
import com.neurio.aivibes.playback.PlayerRepository
import com.neurio.aivibes.playback.Track
import com.neurio.aivibes.settings.Presets
import com.neurio.aivibes.settings.SettingsStore
import com.neurio.aivibes.settings.SoundPreset
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Single UI-facing state holder: library, playlists, playback, DSP config,
 * visualizer snapshots and smart-sound analysis. All side effects go through
 * the repositories owned by [AiVibesApp].
 */
class AppViewModel(private val app: AiVibesApp) : ViewModel() {

    // ---- library -----------------------------------------------------------
    private val _tracks = MutableStateFlow<List<Track>>(emptyList())
    val tracks: StateFlow<List<Track>> = _tracks.asStateFlow()

    private val _playlists = MutableStateFlow<List<Playlist>>(emptyList())
    val playlists: StateFlow<List<Playlist>> = _playlists.asStateFlow()

    // ---- playback / devices ------------------------------------------------
    val nowPlaying: StateFlow<NowPlaying> = app.player.nowPlaying
    val headphones: StateFlow<HeadphoneMonitor.HeadphoneState> = app.headphones.state

    // ---- settings / dsp ----------------------------------------------------
    private val _prefs = MutableStateFlow(SettingsStore.Prefs())
    val prefs: StateFlow<SettingsStore.Prefs> = _prefs.asStateFlow()

    private val _config = MutableStateFlow(DspConfig())
    val config: StateFlow<DspConfig> = _config.asStateFlow()

    // ---- visualizer --------------------------------------------------------
    private val _viz = MutableStateFlow(SpectrumAnalyzer.SpectrumSnapshot.EMPTY)
    val viz: StateFlow<SpectrumAnalyzer.SpectrumSnapshot> = _viz.asStateFlow()

    private val _smart = MutableStateFlow(SmartSound.Analysis.EMPTY)
    val smart: StateFlow<SmartSound.Analysis> = _smart.asStateFlow()

    private val _activePresetId = MutableStateFlow("flat")
    val activePresetId: StateFlow<String> = _activePresetId.asStateFlow()

    private val _loadedTrackIds = HashSet<Long>()
    private var lastDeviceKey: String? = null

    init {
        viewModelScope.launch {
            app.player.connect()
            app.settings.prefs.collect { p ->
                _prefs.value = p
                _config.value = p.config
                _activePresetId.value = p.presetId
                AudioEngine.setConfig(p.config)
            }
        }
        viewModelScope.launch {
            // Live spectrum for the visualizer — 30 Hz, 20 Hz in battery saver.
            while (isActive) {
                _viz.value = AudioEngine.analyzer.analyze(System.currentTimeMillis())
                delay(if (_prefs.value.batterySaver) 50 else 33)
            }
        }
        viewModelScope.launch {
            // Auto-load per-device preset when headphones connect.
            app.headphones.state.collect { st ->
                if (st.connected && _prefs.value.autoPreset) {
                    val key = deviceKeyOf(st)
                    if (key != lastDeviceKey) {
                        lastDeviceKey = key
                        val presetId = app.settings.loadDevicePreset(key)
                        if (presetId != null) applyPreset(Presets.byId(presetId))
                    }
                } else if (!st.connected) {
                    lastDeviceKey = null
                }
            }
        }
    }

    // ---- library -----------------------------------------------------------
    fun loadLibrary() {
        viewModelScope.launch {
            _tracks.value = app.library.loadTracks()
            _playlists.value = app.playlists.load()
        }
    }

    // ---- playback ----------------------------------------------------------
    fun playTrack(track: Track) {
        val list = _tracks.value
        val idx = list.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        app.player.play(list, idx)
    }

    fun playPlaylist(playlist: Playlist) {
        val map = _tracks.value.associateBy { it.id }
        val list = playlist.trackIds.mapNotNull { map[it] }
        if (list.isNotEmpty()) app.player.play(list, 0)
    }

    fun togglePlayPause() = app.player.togglePlayPause()
    fun next() = app.player.next()
    fun previous() = app.player.previous()
    fun seekTo(positionMs: Long) = app.player.seekTo(positionMs)

    // ---- playlists ---------------------------------------------------------
    fun createPlaylist(name: String, trackIds: List<Long> = emptyList()) {
        viewModelScope.launch {
            app.playlists.create(name, trackIds)
            _playlists.value = app.playlists.load()
        }
    }

    fun deletePlaylist(id: String) {
        viewModelScope.launch {
            app.playlists.delete(id)
            _playlists.value = app.playlists.load()
        }
    }

    fun addToPlaylist(playlistId: String, trackId: Long) {
        viewModelScope.launch {
            app.playlists.addTracks(playlistId, listOf(trackId))
            _playlists.value = app.playlists.load()
        }
    }

    fun removeFromPlaylist(playlistId: String, trackId: Long) {
        viewModelScope.launch {
            app.playlists.removeTrack(playlistId, trackId)
            _playlists.value = app.playlists.load()
        }
    }

    // ---- DSP ---------------------------------------------------------------
    fun updateConfig(transform: (DspConfig) -> DspConfig) {
        val next = transform(_config.value)
        _config.value = next
        _activePresetId.value = "custom"
        AudioEngine.setConfig(next)
        viewModelScope.launch { app.settings.saveConfig(next, presetId = "custom") }
    }

    fun applyPreset(preset: SoundPreset) {
        _config.value = preset.config
        _activePresetId.value = preset.id
        AudioEngine.setConfig(preset.config)
        viewModelScope.launch { app.settings.saveConfig(preset.config, presetId = preset.id) }
    }

    fun resetToDefaults() {
        applyPreset(Presets.byId("flat"))
    }

    fun assignDevicePreset(deviceKey: String, presetId: String) {
        viewModelScope.launch { app.settings.saveDevicePreset(deviceKey, presetId) }
    }

    fun currentDeviceKey(): String = deviceKeyOf(_headphonesSnapshot())

    private fun _headphonesSnapshot(): HeadphoneMonitor.HeadphoneState = headphones.value

    fun saveViz(style: Int, sensitivity: Float) {
        viewModelScope.launch { app.settings.saveViz(style, sensitivity) }
    }

    fun saveBatterySaver(on: Boolean) {
        viewModelScope.launch { app.settings.saveBatterySaver(on) }
    }

    fun saveAutoPreset(on: Boolean) {
        viewModelScope.launch { app.settings.saveAutoPreset(on) }
    }

    fun saveDeviceAssist(on: Boolean) {
        viewModelScope.launch { app.settings.saveDeviceAssist(on) }
    }

    fun setOnboarded() {
        viewModelScope.launch { app.settings.setOnboarded() }
    }

    // ---- smart sound -------------------------------------------------------
    fun runSmartMatch() {
        viewModelScope.launch {
            val analysis = SmartSound.analyze(AudioEngine.analyzer.analyze(System.currentTimeMillis()))
            _smart.value = analysis
            if (analysis.bassShare > 0f) {
                val applied = SmartSound.apply(_config.value, analysis)
                _config.value = applied
                _activePresetId.value = "smart"
                AudioEngine.setConfig(applied)
                app.settings.saveConfig(applied, presetId = "smart")
            }
        }
    }

    fun applySmartCorrection() {
        val applied = SmartSound.apply(_config.value, _smart.value)
        _config.value = applied
        _activePresetId.value = "smart"
        AudioEngine.setConfig(applied)
        viewModelScope.launch { app.settings.saveConfig(applied, presetId = "smart") }
    }

    fun analyzeNow() {
        _smart.value = SmartSound.analyze(AudioEngine.analyzer.analyze(System.currentTimeMillis()))
    }

    private fun deviceKeyOf(st: HeadphoneMonitor.HeadphoneState): String {
        val name = st.deviceName.ifBlank { st.kind.name }
        return name.lowercase().replace(Regex("[^a-z0-9]+"), "_")
    }

    class Factory(private val app: AiVibesApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(app) as T
    }
}
