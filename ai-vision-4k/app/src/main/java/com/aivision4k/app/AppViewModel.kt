package com.aivision4k.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.aivision4k.app.benchmark.CadenceResult
import com.aivision4k.app.benchmark.FrameCadenceProbe
import com.aivision4k.app.games.GameCatalog
import com.aivision4k.app.games.InstalledGame
import com.aivision4k.app.games.InstalledGames
import com.aivision4k.app.monitor.MetricsOverlay
import com.aivision4k.app.monitor.MonitorService
import com.aivision4k.app.settings.AppSettings
import com.aivision4k.sdk.AIUpscaler
import com.aivision4k.sdk.DeviceCompatibility
import com.aivision4k.sdk.DeviceDetails
import com.aivision4k.sdk.GraphicsProfile
import com.aivision4k.sdk.IntegrationKind
import com.aivision4k.sdk.ModelState
import com.aivision4k.sdk.PerformanceSnapshot
import com.aivision4k.sdk.ProfilePresetOption
import com.aivision4k.sdk.UpscalerMetrics
import com.aivision4k.sdk.UpscalingQuality
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One immutable snapshot of everything the screens draw. */
data class UiState(
    val engineReady: Boolean = false,
    val engineError: String? = null,
    val profile: GraphicsProfile? = null,
    val snapshot: PerformanceSnapshot? = null,
    val compatibility: DeviceCompatibility? = null,
    val device: DeviceDetails? = null,
    val metrics: UpscalerMetrics? = null,
    val model: ModelState? = null,
    val presets: List<ProfilePresetOption> = emptyList(),
    val apps: List<InstalledGame> = emptyList(),
    val selectedPackage: String = "",
    val selectedTitle: String = "",
    val integration: IntegrationKind = IntegrationKind.None,
    val monitorEnabled: Boolean = true,
    val overlayVisible: Boolean = false,
    val message: String? = null,
    val scanning: Boolean = true,
    val benchmarkRunning: Boolean = false,
    val benchmarkElapsed: Int = 0,
    val benchmarkSamples: Int = 0,
    val benchmarkResult: CadenceResult? = null,
) {
    val selectedApp: InstalledGame? get() = apps.firstOrNull { it.packageName == selectedPackage }
    val knownGame: com.aivision4k.app.games.KnownGame?
        get() = GameCatalog.match(selectedPackage, selectedTitle)
    val games: List<InstalledGame> get() = apps.filter { it.isGame }
}

class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val settings = AppSettings(application)

    var state by mutableStateOf(UiState())
        private set

    private val cadenceProbe = FrameCadenceProbe(
        onProgress = { elapsed, samples ->
            state = state.copy(benchmarkElapsed = elapsed, benchmarkSamples = samples)
        },
        onFinished = { result ->
            state = state.copy(benchmarkRunning = false, benchmarkResult = result, benchmarkElapsed = 0)
        },
        onFrame = { frameMs -> AIUpscaler.onFrameRendered(frameMs) },
    )

    init {
        bootstrap()
        viewModelScope.launch {
            var tick = 0
            while (isActive) {
                delay(1000L)
                tick++
                backgroundTick(deep = tick % 3 == 0)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    private fun bootstrap() {
        val context = getApplication<Application>()
        val integration = settings.integration
        // A probe can throw on a hostile driver. The app must still start and
        // say why, so the failure is turned into a message instead of a crash.
        val error = runCatching { AIUpscaler.initialize(context, integration) }
            .getOrElse { failure ->
                "Engine initialisation failed: ${'$'}{failure.message ?: failure.javaClass.simpleName}"
            }
        state = state.copy(
            engineReady = AIUpscaler.isInitialised,
            engineError = error,
            integration = integration,
            monitorEnabled = settings.monitorEnabled,
            overlayVisible = MetricsOverlay.isVisible,
        )
        if (error != null) {
            // The native library failed to initialise. Everything else still
            // works: the screens simply have no engine data to show.
            state = state.copy(scanning = true)
            scanInstalledApps()
            return
        }
        reloadEngineState()
        scanInstalledApps()
    }

    /** Reads everything the engine can answer right now. */
    fun reloadEngineState() {
        if (!AIUpscaler.isInitialised) return
        val stored = settings.profileFor(settings.selectedPackage)
        val current = AIUpscaler.currentProfile()
        val chosen = stored ?: settings.lastProfile ?: current
        if (chosen != null && chosen != current) {
            AIUpscaler.setProfile(chosen)?.let { message(it) }
        }
        state = state.copy(
            engineReady = true,
            engineError = null,
            profile = AIUpscaler.currentProfile(),
            compatibility = AIUpscaler.compatibility(),
            device = AIUpscaler.deviceDetails(),
            model = AIUpscaler.model(),
            presets = AIUpscaler.presets(),
            snapshot = AIUpscaler.status(),
            metrics = AIUpscaler.metrics(),
        )
    }

    private fun scanInstalledApps() {
        val context = getApplication<Application>()
        viewModelScope.launch {
            val apps = withContext(Dispatchers.IO) { InstalledGames.scan(context) }
            val selected = settings.selectedPackage
            val title = apps.firstOrNull { it.packageName == selected }?.label.orEmpty()
            state = state.copy(apps = apps, selectedPackage = selected, selectedTitle = title, scanning = false)
            if (selected.isNotEmpty() && state.profile?.packageName != selected) {
                applyStoredProfileFor(selected, title, quiet = true)
            }
        }
    }

    private fun backgroundTick(deep: Boolean) {
        if (!AIUpscaler.isInitialised) return
        val context = getApplication<Application>()
        // A tick that throws must not kill the monitoring loop: the previous
        // snapshot simply stays on screen, which is visible to the user.
        runCatching {
            AIUpscaler.updateThermal(context)
            val snapshot = AIUpscaler.status()
            val metrics = if (deep) AIUpscaler.metrics() else null
            state = state.copy(
                snapshot = snapshot ?: state.snapshot,
                metrics = metrics ?: state.metrics,
                model = if (deep) (AIUpscaler.model() ?: state.model) else state.model,
                overlayVisible = MetricsOverlay.isVisible,
            )
        }
    }

    // -----------------------------------------------------------------------
    // Device
    // -----------------------------------------------------------------------
    fun reprobeDevice() {
        val context = getApplication<Application>()
        val error = AIUpscaler.refreshDevice(context)
        if (error != null) {
            message(error)
            return
        }
        reloadEngineState()
        message("Device capabilities re-read.")
    }

    fun setIntegration(kind: IntegrationKind) {
        settings.integration = kind
        AIUpscaler.initialize(getApplication(), kind)
        state = state.copy(
            integration = kind,
            compatibility = AIUpscaler.compatibility(),
        )
    }

    // -----------------------------------------------------------------------
    // Profiles
    // -----------------------------------------------------------------------
    private fun updateProfile(quiet: Boolean = false, transform: (GraphicsProfile) -> GraphicsProfile) {
        val current = state.profile ?: return
        val updated = transform(current)
        val error = AIUpscaler.setProfile(updated)
        if (error != null) {
            message(error)
            return
        }
        val applied = AIUpscaler.currentProfile() ?: updated
        persist(applied)
        if (!quiet) {
            state = state.copy(profile = applied, snapshot = AIUpscaler.status() ?: state.snapshot)
        } else {
            state = state.copy(profile = applied)
        }
    }

    private fun persist(profile: GraphicsProfile) {
        settings.lastProfile = profile
        if (profile.packageName.isNotEmpty()) settings.saveProfile(profile)
    }

    fun applyPreset(option: ProfilePresetOption) {
        val current = state.profile
        val preset = option.profile.copy(
            packageName = current?.packageName ?: "",
            gameTitle = current?.gameTitle ?: "",
            id = current?.id ?: option.profile.id,
        )
        val error = AIUpscaler.setProfile(preset)
        if (error != null) {
            message(error)
            return
        }
        val applied = AIUpscaler.currentProfile() ?: preset
        persist(applied)
        state = state.copy(profile = applied)
        message("Applied ${option.preset.label}.")
    }

    fun setAiEnabled(enabled: Boolean) = updateProfile { it.copy(aiUpscaling = enabled) }

    fun setQuality(quality: UpscalingQuality) = updateProfile {
        it.copy(aiQuality = quality, aiUpscaling = quality != UpscalingQuality.Off)
    }

    fun setSharpening(percent: Int) = updateProfile {
        it.copy(sharpening = percent.coerceIn(0, 100) / 100.0f)
    }

    fun setNoiseReduction(percent: Int) = updateProfile {
        it.copy(noiseReduction = percent.coerceIn(0, 100) / 100.0f)
    }

    fun setRenderScale(percent: Int) = updateProfile { it.copy(renderScalePercent = percent) }

    fun setOutputResolution(width: Int, height: Int) = updateProfile {
        it.copy(outputWidth = width, outputHeight = height)
    }

    fun setTargetFps(fps: Int) = updateProfile { it.copy(targetFps = fps) }

    fun setAntiAliasing(enabled: Boolean) = updateProfile { it.copy(antiAliasing = enabled) }

    fun setMotionAware(enabled: Boolean) = updateProfile { it.copy(motionAware = enabled) }

    fun setDynamicResolution(enabled: Boolean) = updateProfile { it.copy(dynamicResolution = enabled) }

    fun setThermalGuard(enabled: Boolean) = updateProfile { it.copy(thermalGuard = enabled) }

    fun setPerformanceMode(enabled: Boolean) = updateProfile {
        it.copy(performanceMode = enabled, batteryMode = if (enabled) false else it.batteryMode)
    }

    fun setBatteryMode(enabled: Boolean) = updateProfile {
        it.copy(batteryMode = enabled, performanceMode = if (enabled) false else it.performanceMode)
    }

    fun selectGame(packageName: String, title: String) {
        settings.selectedPackage = packageName
        state = state.copy(selectedPackage = packageName, selectedTitle = title)
        applyStoredProfileFor(packageName, title, quiet = false)
    }

    /** Re-applies the stored (or suggested) profile of a game. */
    private fun applyStoredProfileFor(packageName: String, title: String, quiet: Boolean) {
        if (!AIUpscaler.isInitialised) return
        val stored = settings.profileFor(packageName)
        val suggested = GameCatalog.match(packageName, title)?.recommended
        val fallback = GameCatalog.deviceDefault(state.compatibility, packageName, title)
        val target = (stored ?: suggested ?: fallback).copy(
            packageName = packageName,
            gameTitle = title.ifEmpty { packageName },
        )
        val error = AIUpscaler.setProfile(target)
        if (error != null) {
            message(error)
            return
        }
        val applied = AIUpscaler.currentProfile() ?: target
        settings.lastProfile = applied
        state = state.copy(profile = applied, snapshot = AIUpscaler.status() ?: state.snapshot)
        if (!quiet) {
            message(
                when {
                    stored != null -> "Loaded your saved profile for ${applied.gameTitle}."
                    suggested != null -> "Loaded the suggested starting profile for ${applied.gameTitle}."
                    else -> "Created a profile from this device's recommended settings."
                },
            )
        }
    }

    fun resetProfileForSelectedGame() {
        val packageName = state.selectedPackage
        if (packageName.isEmpty()) return
        settings.removeProfile(packageName)
        applyStoredProfileFor(packageName, state.selectedTitle, quiet = true)
        message("Reset to the device-recommended profile.")
    }

    // -----------------------------------------------------------------------
    // Games
    // -----------------------------------------------------------------------
    fun launchSelectedGame() {
        val packageName = state.selectedPackage
        val context = getApplication<Application>()
        if (packageName.isEmpty()) {
            message("Select a game first.")
            return
        }
        if (state.monitorEnabled) MonitorService.start(context)
        val launched = InstalledGames.launch(context, packageName)
        message(
            if (launched) {
                "Launching ${state.selectedTitle.ifEmpty { packageName }}. Monitoring stays in the background."
            } else {
                "Android did not expose a launcher activity for $packageName."
            },
        )
    }

    fun setMonitorEnabled(enabled: Boolean) {
        settings.monitorEnabled = enabled
        state = state.copy(monitorEnabled = enabled)
        val context = getApplication<Application>()
        if (enabled) MonitorService.start(context) else MonitorService.stop(context)
    }

    fun setOverlayEnabled(enabled: Boolean) {
        val context = getApplication<Application>()
        if (enabled) {
            if (!MetricsOverlay.canShow(context)) {
                // Android requires an explicit user grant; send them to the
                // system screen instead of pretending the overlay is on.
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(intent) }
                message(context.getString(R.string.overlay_permission_message))
                state = state.copy(overlayVisible = false)
                return
            }
            val error = MetricsOverlay.show(context)
            if (error != null) {
                message(error)
                state = state.copy(overlayVisible = false)
                return
            }
            settings.overlayEnabled = true
            state = state.copy(overlayVisible = true)
        } else {
            MetricsOverlay.hide()
            settings.overlayEnabled = false
            state = state.copy(overlayVisible = false)
        }
    }

    fun markSandboxDisclaimerSeen() {
        settings.sandboxDisclaimerSeen = true
    }

    fun notificationPermissionAsked() {
        settings.notificationPermissionAsked = true
    }

    // -----------------------------------------------------------------------
    // AI model manager
    // -----------------------------------------------------------------------
    fun installModelFromUri(uri: Uri) {
        val context = getApplication<Application>()
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                }.getOrNull()
            }
            if (bytes == null || bytes.isEmpty()) {
                message("Could not read that file.")
                return@launch
            }
            val error = AIUpscaler.installModel(bytes)
            if (error != null) {
                message(error)
                return@launch
            }
            state = state.copy(model = AIUpscaler.model())
            message("Model installed (${bytes.size} bytes).")
        }
    }

    fun installModelFromPath(path: String) {
        val error = AIUpscaler.installModelFile(path)
        if (error != null) {
            message(error)
            return
        }
        state = state.copy(model = AIUpscaler.model())
    }

    fun removeModel() {
        AIUpscaler.removeModel()
        state = state.copy(model = AIUpscaler.model())
        message("Model removed. The engine falls back to analytical upscaling.")
    }

    /**
     * Installs one of the calibration models that ship inside the APK.
     *
     * They are linear graphs on purpose: the sub-pixel one must reproduce bilinear
     * upscaling of the input and the residual one must reproduce bicubic. That is what
     * makes them useful - they exercise the container, the GPU planner and the compute
     * kernels on a real device and have a right answer to check against. They are *not*
     * quality models, and every label around this button says so.
     */
    fun installBundledCalibrationModel(assetPath: String = CALIBRATION_SUBPIXEL) {
        val context = getApplication<Application>()
        viewModelScope.launch {
            val file = withContext(Dispatchers.IO) {
                runCatching {
                    val directory = File(context.filesDir, "models").apply { mkdirs() }
                    val target = File(directory, assetPath.substringAfterLast('/'))
                    context.assets.open(assetPath).use { input ->
                        target.outputStream().use { output -> input.copyTo(output) }
                    }
                    target
                }.getOrNull()
            }
            if (file == null || !file.exists()) {
                message("The bundled calibration model is not in this build's assets.")
                return@launch
            }
            val error = AIUpscaler.installModelFile(file.absolutePath)
            if (error != null) {
                message(error)
                return@launch
            }
            state = state.copy(model = AIUpscaler.model())
            message(
                "Calibration model installed (${file.length()} bytes). It reproduces " +
                    (if (assetPath == CALIBRATION_RESIDUAL) "bicubic" else "bilinear") +
                    " upscaling exactly - a pipeline check, not an image-quality model.",
            )
        }
    }

    // -----------------------------------------------------------------------
    // Benchmark
    // -----------------------------------------------------------------------
    fun startBenchmark(seconds: Int = 30) {
        if (state.benchmarkRunning) return
        if (!AIUpscaler.isInitialised) {
            message("The engine is not running, so samples cannot be recorded.")
            return
        }
        val refresh = state.device?.displayRefreshRate ?: 60f
        state = state.copy(benchmarkRunning = true, benchmarkResult = null, benchmarkElapsed = 0, benchmarkSamples = 0)
        cadenceProbe.start(seconds = seconds, refreshRate = refresh)
    }

    fun cancelBenchmark() {
        cadenceProbe.cancel()
        state = state.copy(benchmarkRunning = false)
    }

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------
    fun dismissMessage() {
        state = state.copy(message = null)
    }

    private fun message(text: String) {
        state = state.copy(message = text)
    }

    override fun onCleared() {
        cadenceProbe.cancel()
        super.onCleared()
    }

    companion object {
        /** Asset paths of the calibration models, see tools/model/README.md. */
        const val CALIBRATION_SUBPIXEL = "models/reference_sr_x2_subpixel.v4kmodel"
        const val CALIBRATION_RESIDUAL = "models/reference_sr_x2_residual.v4kmodel"
    }
}
