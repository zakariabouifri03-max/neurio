package com.aivision4k.sdk

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject

/**
 * The public SDK entry point.
 *
 * ## What this can and cannot do
 *
 * Android does not let one application replace another application's rendering
 * pipeline. There is no supported way to inject a shader into a game you do not
 * own, and this SDK does not pretend otherwise (it never uses an overlay to
 * "upscale" a game it cannot touch). What it *can* do:
 *
 *  * if the game itself links this module and calls [startSession] +
 *    [processFrame] with its own Vulkan handles, the engine replaces the render
 *    resolution for real — that is the supported integration path;
 *  * for any other game the app can still report real device measurements and
 *    the OS performance hints, and the compatibility report explains exactly
 *    why in-pipeline upscaling is not available.
 *
 * ## Threading
 *
 * The engine is not thread safe. Every method here is synchronised, and the
 * frame path is expected to run from the single thread that owns the render
 * loop (which also keeps `processFrame` allocation-free).
 *
 * ## Example (a game that already has a Vulkan context)
 * ```kotlin
 * AIUpscaler.initialize(context, IntegrationKind.SdkIntegrated)
 * AIUpscaler.setOutputResolution(3840, 2160)
 * AIUpscaler.setQuality(UpscalingQuality.High)
 * AIUpscaler.startSession(VulkanDeviceInfo(instance, physicalDevice, device,
 *     computeFamily, graphicsFamily, computeQueue, graphicsQueue))
 *
 * // once per frame, inside the render loop:
 * val result = AIUpscaler.processFrame(
 *     lowResImage = lowResVkImage, lowResView = lowResVkImageView,
 *     outputImage = outputVkImage, outputView = outputVkImageView,
 *     deltaSeconds = frameDeltaSeconds, resetHistory = resized,
 * )
 * if (!result.submitted) log("upscaling skipped: ${result.error}")
 * ```
 */
object AIUpscaler {

    /** The engine's "the device did not report this" sentinel. */
    const val UNAVAILABLE: Double = -1.0

    private val lock = Any()
    private var initialised = false
    private var cachedProfile: GraphicsProfile? = null
    private var cachedSession: SessionState? = null

    val isInitialised: Boolean get() = synchronized(lock) { initialised }

    private val notLoadedMessage =
        "the native engine library (libaivision4k.so) is not loaded. Build the SDK module " +
            "for this device's ABI (arm64-v8a or x86_64) — see docs/BUILD.md."

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    /**
     * Probes the device and starts the engine. Returns null on success, or a
     * message to show the user. Safe to call again after [shutdown].
     */
    fun initialize(
        context: Context,
        integration: IntegrationKind = IntegrationKind.None,
    ): String? = synchronized(lock) {
        if (!NativeBridge.loaded) return notLoadedMessage
        if (initialised) {
            NativeBridge.nativeSetIntegration(integration.value)
            return null
        }
        val caps = AndroidCapsCollector.collect(context.applicationContext)
        val error = NativeBridge.nativeInitialise(caps.toString())
        if (error != null) return error
        NativeBridge.nativeSetIntegration(integration.value)
        initialised = true
        cachedProfile = parseProfile(NativeBridge.nativeProfileJson())
        null
    }

    fun shutdown() = synchronized(lock) {
        if (!NativeBridge.loaded) return
        if (initialised) NativeBridge.nativeShutdown()
        initialised = false
        cachedProfile = null
        cachedSession = null
    }

    /** Re-reads the Android-side facts (after a display or battery change) and re-probes. */
    fun refreshDevice(context: Context): String? = synchronized(lock) {
        if (!NativeBridge.loaded) return notLoadedMessage
        NativeBridge.nativeUpdateAndroidCaps(
            AndroidCapsCollector.collect(context.applicationContext).toString(),
        )?.let { return it }
        val error = NativeBridge.nativeReprobeDevice()
        cachedProfile = parseProfile(NativeBridge.nativeProfileJson())
        error
    }

    // -----------------------------------------------------------------------
    // Device + compatibility
    // -----------------------------------------------------------------------
    fun compatibility(): DeviceCompatibility? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return null
        return try {
            DeviceCompatibility.parse(JSONObject(NativeBridge.nativeCompatibilityJson()))
        } catch (error: Throwable) {
            null
        }
    }

    fun deviceDetails(): DeviceDetails? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return null
        return try {
            DeviceDetails.parse(JSONObject(NativeBridge.nativeDeviceJson()))
        } catch (error: Throwable) {
            null
        }
    }

    // -----------------------------------------------------------------------
    // Profiles and resolutions
    // -----------------------------------------------------------------------
    fun currentProfile(): GraphicsProfile? = synchronized(lock) { cachedProfile }

    fun setProfile(profile: GraphicsProfile): String? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return notLoadedMessage
        val error = NativeBridge.nativeSetProfileJson(profile.toJson().toString())
        if (error == null) cachedProfile = parseProfile(NativeBridge.nativeProfileJson())
        error
    }

    fun presets(): List<ProfilePresetOption> = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return emptyList()
        return try {
            ProfilePresetOption.parseAll(JSONObject(NativeBridge.nativePresetsJson()))
        } catch (error: Throwable) {
            emptyList()
        }
    }

    /** Output resolution (the resolution the frame is reconstructed *to*). */
    fun setOutputResolution(width: Int, height: Int): String? = synchronized(lock) {
        val profile = cachedProfile ?: return notLoadedMessage
        setProfileLocked(profile.copy(outputWidth = width, outputHeight = height))
    }

    /**
     * Render resolution (what the game draws) — expressed as a render scale of
     * the output resolution, snapped to the ladder the engine allows
     * (50/60/67/75/83/100 %). The native validator clamps it again, so a value
     * coming from a hand-edited profile can never put the engine in an illegal
     * state.
     */
    fun setInputResolution(width: Int, height: Int): String? = synchronized(lock) {
        val profile = cachedProfile ?: return notLoadedMessage
        if (width <= 0 || height <= 0 || profile.outputWidth <= 0) {
            return "input resolution must be positive"
        }
        val percent = Math.round(width * 100.0f / profile.outputWidth.toFloat())
        val snapped = nearestAllowedRenderScale(percent)
        setProfileLocked(profile.copy(renderScalePercent = snapped))
    }

    fun setQuality(quality: UpscalingQuality): String? = synchronized(lock) {
        val profile = cachedProfile ?: return notLoadedMessage
        setProfileLocked(profile.copy(aiQuality = quality, aiUpscaling = quality != UpscalingQuality.Off))
    }

    /** Sharpening in percent (0..100), the way the UI shows it. */
    fun setSharpening(percent: Int): String? = synchronized(lock) {
        val profile = cachedProfile ?: return notLoadedMessage
        setProfileLocked(profile.copy(sharpening = (percent.coerceIn(0, 100) / 100.0f)))
    }

    fun setTargetFps(fps: Int): String? = synchronized(lock) {
        val profile = cachedProfile ?: return notLoadedMessage
        setProfileLocked(profile.copy(targetFps = fps))
    }

    private fun setProfileLocked(profile: GraphicsProfile): String? {
        val error = NativeBridge.nativeSetProfileJson(profile.toJson().toString())
        if (error == null) cachedProfile = parseProfile(NativeBridge.nativeProfileJson())
        return error
    }

    // -----------------------------------------------------------------------
    // Session
    // -----------------------------------------------------------------------
    /**
     * Starts the upscaler on the caller's Vulkan device. Only a caller that
     * hands over its own device can have its render resolution changed — this is
     * the integration contract, not a limitation of the library.
     */
    fun startSession(
        device: VulkanDeviceInfo,
        profile: GraphicsProfile? = null,
        maxWorkingBytes: Long = 0L,
    ): String? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return notLoadedMessage
        val active = profile ?: cachedProfile ?: return "no profile selected"
        if (!active.aiUpscaling) {
            return "AI upscaling is disabled in this profile (quality is Off)"
        }
        val error = NativeBridge.nativeStartSession(
            device.instance,
            device.physicalDevice,
            device.device,
            device.computeQueueFamily,
            device.graphicsQueueFamily,
            device.computeQueue,
            device.graphicsQueue,
            active.inputWidth,
            active.inputHeight,
            active.outputWidth,
            active.outputHeight,
            true,
            active.noiseReduction > 0.0f,
            active.antiAliasing,
            active.sharpening,
            active.noiseReduction,
            true,
            maxWorkingBytes,
        )
        if (error == null) cachedSession = parseSession(NativeBridge.nativeSessionJson())
        error
    }

    fun stopSession() = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return
        NativeBridge.nativeStopSession()
        cachedSession = parseSession(NativeBridge.nativeSessionJson())
    }

    fun session(): SessionState? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return cachedSession
        cachedSession = parseSession(NativeBridge.nativeSessionJson())
        cachedSession
    }

    /**
     * Upscales one frame. Every argument is a Vulkan handle the caller owns;
     * the engine writes the result into `outputImage`.
     *
     * `resetHistory` must be true for the first frame, after a resize and after
     * a scene cut — the temporal stage must never blend unrelated frames.
     */
    fun processFrame(
        lowResImage: Long,
        lowResView: Long,
        outputImage: Long,
        outputView: Long,
        deltaSeconds: Double,
        resetHistory: Boolean = false,
        historyValid: Boolean = true,
        motionImage: Long = 0L,
        motionView: Long = 0L,
    ): FrameResult = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) {
            return FrameResult(false, ReconstructionMode.None, null, notLoadedMessage)
        }
        val json = NativeBridge.nativeProcessFrame(
            lowResImage,
            lowResView,
            outputImage,
            outputView,
            motionImage,
            motionView,
            deltaSeconds,
            resetHistory,
            historyValid,
        )
        return try {
            FrameResult.parse(json)
        } catch (error: Throwable) {
            FrameResult(false, ReconstructionMode.None, null, error.message ?: "malformed result")
        }
    }

    // -----------------------------------------------------------------------
    // Monitoring + thermal policy
    // -----------------------------------------------------------------------
    /** Call about once per second: it reads the battery and feeds the governor. */
    fun updateThermal(context: Context) = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return
        val profile = cachedProfile
        val battery = AndroidCapsCollector.batteryTemperatureC(context.applicationContext)
        val averageFrame = lastFrameTimeMs
        val target = profile?.let { budgetMs(it.targetFps) } ?: 0.0f
        NativeBridge.nativeUpdateThermal(
            AndroidCapsCollector.platformThermalStatus(context.applicationContext),
            battery ?: 0.0f,
            averageFrame,
            target,
            profile?.thermalGuard ?: true,
            SystemClock.elapsedRealtime(),
        )
    }

    /** Feeds the rolling frame window. `upscalerMs` may be [UNAVAILABLE]. */
    fun onFrameRendered(frameTimeMs: Double, upscalerMs: Double = UNAVAILABLE) =
        synchronized(lock) {
            if (!NativeBridge.loaded || !initialised) return
            lastFrameTimeMs = frameTimeMs.toFloat()
            NativeBridge.nativeAddFrameSample(frameTimeMs, SystemClock.elapsedRealtime(), upscalerMs)
        }

    fun status(): PerformanceSnapshot? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return null
        return try {
            PerformanceSnapshot.parse(JSONObject(NativeBridge.nativeStatusJson()))
        } catch (error: Throwable) {
            null
        }
    }

    fun metrics(): UpscalerMetrics? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return null
        return try {
            UpscalerMetrics.parse(JSONObject(NativeBridge.nativeMetricsJson()))
        } catch (error: Throwable) {
            null
        }
    }

    // -----------------------------------------------------------------------
    // AI model manager
    // -----------------------------------------------------------------------
    /** Installs a `.v4kmodel` file from a byte array (already verified by the caller). */
    fun installModel(bytes: ByteArray): String? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return notLoadedMessage
        NativeBridge.nativeInstallModelBytes(bytes)
    }

    fun installModelFile(path: String): String? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return notLoadedMessage
        NativeBridge.nativeInstallModelFile(path)
    }

    fun removeModel() = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return
        NativeBridge.nativeRemoveModel()
    }

    fun model(): ModelState? = synchronized(lock) {
        if (!NativeBridge.loaded || !initialised) return null
        return try {
            ModelState.parse(JSONObject(NativeBridge.nativeModelJson()))
        } catch (error: Throwable) {
            null
        }
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------
    private var lastFrameTimeMs = 0.0f

    private fun budgetMs(targetFps: Int): Float =
        if (targetFps <= 0) 0.0f else 1000.0f / targetFps.toFloat()

    private fun parseProfile(json: String): GraphicsProfile? = try {
        GraphicsProfile.parse(JSONObject(json))
    } catch (error: Throwable) {
        null
    }

    private fun parseSession(json: String): SessionState? = try {
        SessionState.parse(JSONObject(json))
    } catch (error: Throwable) {
        null
    }

    /** The render-scale ladder the engine accepts (`v4k_profile.h`). */
    private val renderScaleLadder = intArrayOf(50, 60, 67, 75, 83, 100)

    private fun nearestAllowedRenderScale(percent: Int): Int {
        var best = renderScaleLadder[0]
        var bestDistance = Int.MAX_VALUE
        for (value in renderScaleLadder) {
            val distance = Math.abs(value - percent)
            if (distance < bestDistance) {
                bestDistance = distance
                best = value
            }
        }
        return best
    }
}
