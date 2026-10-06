package com.aivision4k.sdk

import org.json.JSONArray
import org.json.JSONObject

/**
 * Typed views over the JSON documents the engine produces.
 *
 * The native side speaks JSON on purpose (see jni/v4k_jni.cpp): it keeps the
 * boundary free of marshalling structs, makes every value loggable and lets the
 * app add a screen without touching C++. These classes parse defensively —
 * an "unavailable" measurement is a nullable field, never a 0 that could be
 * mistaken for a real reading.
 */

// ---------------------------------------------------------------------------
// Enums (values are the exact codes the C++ side prints)
// ---------------------------------------------------------------------------
enum class IntegrationKind(val value: Int) {
    /** A plain third-party app: monitoring only, the engine cannot change its rendering. */
    None(0),

    /** The game links this SDK and calls `processFrame` — the only path that can replace a render resolution. */
    SdkIntegrated(1),

    /** Our own Vulkan demo scene / comparison screen (a reference integration). */
    SampleDemo(2),

    /** MediaProjection frame enhancement: experimental, requires user consent per session. */
    ScreenEnhance(3);

    companion object {
        fun fromValue(value: Int): IntegrationKind = entries.firstOrNull { it.value == value } ?: None
    }
}

enum class CompatStatus(val code: String) {
    Unsupported("UNSUPPORTED"),
    Experimental("EXPERIMENTAL"),
    PartiallySupported("PARTIALLY_SUPPORTED"),
    Supported("SUPPORTED");

    /** Short label for the compatibility chip. */
    val label: String
        get() = when (this) {
            Unsupported -> "Unsupported"
            Experimental -> "Experimental"
            PartiallySupported -> "Partially supported"
            Supported -> "Supported"
        }

    companion object {
        fun fromCode(code: String?): CompatStatus =
            entries.firstOrNull { it.code == code } ?: Unsupported
    }
}

enum class DeviceTier(val code: String) {
    Unsupported("UNSUPPORTED"),
    Entry("ENTRY"),
    Mid("MID"),
    High("HIGH"),
    Flagship("FLAGSHIP");

    companion object {
        fun fromCode(code: String?): DeviceTier =
            entries.firstOrNull { it.code == code } ?: Unsupported
    }
}

/** Neural reconstruction strength. `Off` disables the AI stage entirely. */
enum class UpscalingQuality(val code: String) {
    Off("OFF"),
    Low("LOW"),
    Medium("MEDIUM"),
    High("HIGH"),
    Ultra("ULTRA");

    val label: String
        get() = when (this) {
            Off -> "Off"
            Low -> "Low"
            Medium -> "Medium"
            High -> "High"
            Ultra -> "Ultra"
        }

    companion object {
        fun fromCode(code: String?): UpscalingQuality =
            entries.firstOrNull { it.code == code } ?: Medium
    }
}

enum class QualityPreset(val code: String) {
    Quality("QUALITY"),
    Balanced("BALANCED"),
    Performance("PERFORMANCE"),
    Extreme("EXTREME");

    val label: String
        get() = when (this) {
            Quality -> "Quality"
            Balanced -> "Balanced"
            Performance -> "Performance"
            Extreme -> "Extreme"
        }

    val description: String
        get() = when (this) {
            Quality -> "Highest reconstruction quality, higher GPU cost"
            Balanced -> "Good quality at a reasonable GPU load"
            Performance -> "Lowest GPU cost, favours frame rate"
            Extreme -> "Experimental: maximum output resolution and quality"
        }

    companion object {
        fun fromCode(code: String?): QualityPreset =
            entries.firstOrNull { it.code == code } ?: Balanced
    }
}

/** What actually produced the frame — reported, never guessed. */
enum class UpscalingMode(val code: String) {
    Disabled("DISABLED"),
    Analytical("ANALYTICAL"),
    Neural("NEURAL");

    companion object {
        fun fromCode(code: String?): UpscalingMode =
            entries.firstOrNull { it.code == code } ?: Disabled
    }
}

enum class InferenceBackend(val code: String) {
    None("NONE"),
    GpuVulkan("GPU_VULKAN"),
    Nnapi("NNAPI"),
    Cpu("CPU");

    companion object {
        fun fromCode(code: String?): InferenceBackend =
            entries.firstOrNull { it.code == code } ?: None
    }
}

enum class ReconstructionMode(val code: String) {
    None("NONE"),
    Analytical("ANALYTICAL"),
    Neural("NEURAL"),
    NeuralTemporal("NEURAL_TEMPORAL"),
    AnalyticalTemporal("ANALYTICAL_TEMPORAL");

    val label: String
        get() = when (this) {
            None -> "Idle"
            Analytical -> "Analytical upscale"
            Neural -> "AI upscaling"
            NeuralTemporal -> "AI upscaling + temporal"
            AnalyticalTemporal -> "Analytical + temporal"
        }

    companion object {
        fun fromCode(code: String?): ReconstructionMode =
            entries.firstOrNull { it.code == code } ?: None
    }
}

enum class ThermalLevel(val code: String) {
    Nominal("NOMINAL"),
    Light("LIGHT"),
    Moderate("MODERATE"),
    Severe("SEVERE"),
    Critical("CRITICAL"),
    Emergency("EMERGENCY"),
    Shutdown("SHUTDOWN");

    val label: String
        get() = when (this) {
            Nominal -> "Normal"
            Light -> "Warm"
            Moderate -> "Warm"
            Severe -> "Hot"
            Critical -> "Very hot"
            Emergency -> "Critical"
            Shutdown -> "Shutting down"
        }

    val isWarning: Boolean
        get() = this >= Severe

    companion object {
        fun fromCode(code: String?): ThermalLevel =
            entries.firstOrNull { it.code == code } ?: Nominal
    }
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------
data class CompatReason(
    val cap: CompatStatus,
    val code: String,
    val message: String,
    val detail: String,
    val blocking: Boolean,
) {
    companion object {
        fun parse(json: JSONObject) = CompatReason(
            cap = CompatStatus.fromCode(json.optString("cap")),
            code = json.optString("code"),
            message = json.optString("message"),
            detail = json.optString("detail"),
            blocking = json.optBoolean("blocking", false),
        )
    }
}

data class DeviceCompatibility(
    val status: CompatStatus,
    val tier: DeviceTier,
    val achievableMode: UpscalingMode,
    val achievableBackend: InferenceBackend,
    val recommendedOutputWidth: Int,
    val recommendedOutputHeight: Int,
    val recommendedOutputLabel: String,
    val recommendedRenderScalePercent: Int,
    val maximumAiQuality: UpscalingQuality,
    val monitoringAvailable: Boolean,
    val overlayAvailable: Boolean,
    val gameModeHintAvailable: Boolean,
    val headline: String,
    val reasons: List<CompatReason>,
) {
    /** Reasons that cap the result, worst first — what the "why" panel shows. */
    val blockingReasons: List<CompatReason> get() = reasons.filter { it.blocking }

    companion object {
        fun parse(json: JSONObject): DeviceCompatibility {
            val reasonsJson = json.optJSONArray("reasons") ?: JSONArray()
            val reasons = (0 until reasonsJson.length()).mapNotNull { index ->
                reasonsJson.optJSONObject(index)?.let { CompatReason.parse(it) }
            }
            return DeviceCompatibility(
                status = CompatStatus.fromCode(json.optString("status")),
                tier = DeviceTier.fromCode(json.optString("tier")),
                achievableMode = UpscalingMode.fromCode(json.optString("achievableMode")),
                achievableBackend = InferenceBackend.fromCode(json.optString("achievableBackend")),
                recommendedOutputWidth = json.optInt("recommendedOutputWidth", 1280),
                recommendedOutputHeight = json.optInt("recommendedOutputHeight", 720),
                recommendedOutputLabel = json.optString("recommendedOutputLabel", "720p"),
                recommendedRenderScalePercent = json.optInt("recommendedRenderScalePercent", 67),
                maximumAiQuality = UpscalingQuality.fromCode(json.optString("maximumAiQuality")),
                monitoringAvailable = json.optBoolean("monitoringAvailable", true),
                overlayAvailable = json.optBoolean("overlayAvailable", false),
                gameModeHintAvailable = json.optBoolean("gameModeHintAvailable", false),
                headline = json.optString("headline"),
                reasons = reasons,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
/**
 * A graphics profile, exactly the shape the native `GraphicsProfile` has. The
 * JSON keys are the C++ ones, so a profile can be exported, edited and imported
 * without a translation table.
 */
data class GraphicsProfile(
    val id: String = "default",
    val name: String = "Balanced",
    val packageName: String = "",
    val gameTitle: String = "",
    val preset: QualityPreset = QualityPreset.Balanced,
    val renderScalePercent: Int = 67,
    val outputWidth: Int = 1920,
    val outputHeight: Int = 1080,
    val aiUpscaling: Boolean = true,
    val aiQuality: UpscalingQuality = UpscalingQuality.Medium,
    /** 0..1, the UI shows it as a percentage. */
    val sharpening: Float = 0.2f,
    val noiseReduction: Float = 0.15f,
    val antiAliasing: Boolean = true,
    val motionAware: Boolean = true,
    val dynamicResolution: Boolean = true,
    val targetFps: Int = 60,
    val performanceMode: Boolean = false,
    val batteryMode: Boolean = false,
    val thermalGuard: Boolean = true,
    val integration: IntegrationKind = IntegrationKind.None,
) {
    /** Internal render resolution implied by output * render scale. */
    val inputWidth: Int get() = ((outputWidth * renderScalePercent / 100) / 2) * 2
    val inputHeight: Int get() = ((outputHeight * renderScalePercent / 100) / 2) * 2

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("packageName", packageName)
        put("gameTitle", gameTitle)
        put("preset", preset.code)
        put("renderScalePercent", renderScalePercent)
        put("outputWidth", outputWidth)
        put("outputHeight", outputHeight)
        put("aiUpscaling", aiUpscaling)
        put("aiQuality", aiQuality.code)
        put("sharpening", sharpening.toDouble())
        put("noiseReduction", noiseReduction.toDouble())
        put("antiAliasing", antiAliasing)
        put("motionAware", motionAware)
        put("dynamicResolution", dynamicResolution)
        put("targetFps", targetFps)
        put("performanceMode", performanceMode)
        put("batteryMode", batteryMode)
        put("thermalGuard", thermalGuard)
        put("integration", integration.value)
    }

    companion object {
        fun parse(json: JSONObject): GraphicsProfile = GraphicsProfile(
            id = json.optString("id", "default"),
            name = json.optString("name", "Balanced"),
            packageName = json.optString("packageName", ""),
            gameTitle = json.optString("gameTitle", ""),
            preset = QualityPreset.fromCode(json.optString("preset")),
            renderScalePercent = json.optInt("renderScalePercent", 67),
            outputWidth = json.optInt("outputWidth", 1920),
            outputHeight = json.optInt("outputHeight", 1080),
            aiUpscaling = json.optBoolean("aiUpscaling", true),
            aiQuality = UpscalingQuality.fromCode(json.optString("aiQuality")),
            sharpening = json.optDouble("sharpening", 0.2).toFloat(),
            noiseReduction = json.optDouble("noiseReduction", 0.15).toFloat(),
            antiAliasing = json.optBoolean("antiAliasing", true),
            motionAware = json.optBoolean("motionAware", true),
            dynamicResolution = json.optBoolean("dynamicResolution", true),
            targetFps = json.optInt("targetFps", 60),
            performanceMode = json.optBoolean("performanceMode", false),
            batteryMode = json.optBoolean("batteryMode", false),
            thermalGuard = json.optBoolean("thermalGuard", true),
            integration = IntegrationKind.fromValue(json.optInt("integration", 0)),
        )
    }
}

/** One entry of the preset row in the profile editor. */
data class ProfilePresetOption(
    val preset: QualityPreset,
    val renderScalePercent: Int,
    val outputWidth: Int,
    val outputHeight: Int,
    val outputLabel: String,
    val aiQuality: UpscalingQuality,
    val sharpeningPercent: Int,
    val targetFps: Int,
    val experimental: Boolean,
    /** True when this device's limits already reduced the preset. */
    val clampedForThisDevice: Boolean,
    val profile: GraphicsProfile,
) {
    companion object {
        fun parse(json: JSONObject) = ProfilePresetOption(
            preset = QualityPreset.fromCode(json.optString("preset")),
            renderScalePercent = json.optInt("renderScalePercent", 67),
            outputWidth = json.optInt("outputWidth", 1280),
            outputHeight = json.optInt("outputHeight", 720),
            outputLabel = json.optString("outputLabel", ""),
            aiQuality = UpscalingQuality.fromCode(json.optString("aiQuality")),
            sharpeningPercent = json.optInt("sharpeningPercent", 20),
            targetFps = json.optInt("targetFps", 60),
            experimental = json.optBoolean("experimental", false),
            clampedForThisDevice = json.optBoolean("clampedForThisDevice", false),
            profile = GraphicsProfile.parse(json.optJSONObject("profile") ?: JSONObject()),
        )

        fun parseAll(json: JSONObject): List<ProfilePresetOption> {
            val array = json.optJSONArray("presets") ?: JSONArray()
            return (0 until array.length()).mapNotNull { index ->
                array.optJSONObject(index)?.let { parse(it) }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Device details
// ---------------------------------------------------------------------------
data class DeviceDetails(
    val description: String,
    val tier: DeviceTier,
    val socModel: String,
    val socManufacturer: String,
    val sdkInt: Int,
    val release: String,
    val cpuCoreCount: Int,
    val isEmulator: Boolean,
    val displayRefreshRate: Float,
    val displayWidth: Int,
    val displayHeight: Int,
    val totalRamBytes: Long,
    val lowRamDevice: Boolean,
    val vulkanAvailable: Boolean,
    val deviceName: String,
    val driverName: String,
    val vendor: String,
    val apiVersionMajor: Int,
    val apiVersionMinor: Int,
    val hasComputeQueue: Boolean,
    val maxComputeWorkGroupInvocations: Int,
    val maxImageDimension2D: Int,
    val deviceLocalMemoryBytes: Long,
    val memoryBudgetBytes: Long,
    val hasFloat16Storage: Boolean,
    val hasInt8Storage: Boolean,
    val hasTimestampCompute: Boolean,
    val softwareRenderer: Boolean,
    val glesAvailable: Boolean,
    val glesVersion: String,
    val glesComputeShaders: Boolean,
    val nnapiAvailable: Boolean,
    val nnapiHasAccelerator: Boolean,
    val nnapiNote: String,
    val thermalApiAvailable: Boolean,
    val batteryTemperatureAvailable: Boolean,
    val gameManagerAvailable: Boolean,
) {
    companion object {
        fun parse(json: JSONObject): DeviceDetails {
            val vulkan = json.optJSONObject("vulkan") ?: JSONObject()
            val gles = json.optJSONObject("gles") ?: JSONObject()
            val neural = json.optJSONObject("neural") ?: JSONObject()
            val thermal = json.optJSONObject("thermal") ?: JSONObject()
            return DeviceDetails(
                description = json.optString("description"),
                tier = DeviceTier.fromCode(json.optString("tier")),
                socModel = json.optString("socModel"),
                socManufacturer = json.optString("socManufacturer"),
                sdkInt = json.optInt("sdkInt"),
                release = json.optString("release"),
                cpuCoreCount = json.optInt("cpuCoreCount"),
                isEmulator = json.optBoolean("isEmulator", false),
                displayRefreshRate = json.optDouble("displayRefreshRate", 60.0).toFloat(),
                displayWidth = json.optInt("displayWidth"),
                displayHeight = json.optInt("displayHeight"),
                totalRamBytes = json.optLong("totalRamBytes"),
                lowRamDevice = json.optBoolean("lowRamDevice", false),
                vulkanAvailable = vulkan.optBoolean("available", false),
                deviceName = vulkan.optString("deviceName"),
                driverName = vulkan.optString("driverName"),
                vendor = vulkan.optString("vendor"),
                apiVersionMajor = vulkan.optInt("apiVersionMajor"),
                apiVersionMinor = vulkan.optInt("apiVersionMinor"),
                hasComputeQueue = vulkan.optBoolean("hasComputeQueue", false),
                maxComputeWorkGroupInvocations = vulkan.optInt("maxComputeWorkGroupInvocations"),
                maxImageDimension2D = vulkan.optInt("maxImageDimension2D"),
                deviceLocalMemoryBytes = vulkan.optLong("deviceLocalMemoryBytes"),
                memoryBudgetBytes = vulkan.optLong("memoryBudgetBytes"),
                hasFloat16Storage = vulkan.optBoolean("hasFloat16Storage", false),
                hasInt8Storage = vulkan.optBoolean("hasInt8Storage", false),
                hasTimestampCompute = vulkan.optBoolean("hasTimestampCompute", false),
                softwareRenderer = vulkan.optBoolean("softwareRenderer", false),
                glesAvailable = gles.optBoolean("available", false),
                glesVersion = "${gles.optInt("majorVersion")}.${gles.optInt("minorVersion")}",
                glesComputeShaders = gles.optBoolean("computeShaders", false),
                nnapiAvailable = neural.optBoolean("nnapiAvailable", false),
                nnapiHasAccelerator = neural.optBoolean("hasAccelerator", false),
                nnapiNote = neural.optString("note"),
                thermalApiAvailable = thermal.optBoolean("powerManagerThermalApi", false),
                batteryTemperatureAvailable = thermal.optBoolean("batteryTemperature", false),
                gameManagerAvailable = thermal.optBoolean("gameManagerAvailable", false),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------
/** GPU timings of the newest frame. Null fields mean "the device did not report it". */
data class StageTimings(
    val available: Boolean,
    val countersAvailable: Boolean,
    val preprocessMs: Double?,
    val neuralMs: Double?,
    val denoiseMs: Double?,
    val temporalMs: Double?,
    val aaMs: Double?,
    val sharpenMs: Double?,
    val totalMs: Double?,
) {
    companion object {
        fun parse(json: JSONObject?): StageTimings {
            val source = json ?: JSONObject()
            return StageTimings(
                available = source.optBoolean("available", false),
                countersAvailable = source.optBoolean("countersAvailable", false),
                preprocessMs = source.optNullableDouble("preprocessMs"),
                neuralMs = source.optNullableDouble("neuralMs"),
                denoiseMs = source.optNullableDouble("denoiseMs"),
                temporalMs = source.optNullableDouble("temporalMs"),
                aaMs = source.optNullableDouble("aaMs"),
                sharpenMs = source.optNullableDouble("sharpenMs"),
                totalMs = source.optNullableDouble("totalMs"),
            )
        }
    }
}

data class SessionState(
    val active: Boolean,
    val inputWidth: Int,
    val inputHeight: Int,
    val outputWidth: Int,
    val outputHeight: Int,
    val neural: Boolean,
    val temporal: Boolean,
    val layerCount: Int,
    val workingSetBytes: Long,
    val weightBytes: Long,
    val mode: ReconstructionMode,
    val modeName: String,
    val modelId: String,
    val lastError: String,
    val timings: StageTimings,
    val aiProcessingMs: Double?,
) {
    val resolutionLabel: String
        get() = if (!active) "" else "${inputWidth}x$inputHeight \u2192 ${outputWidth}x$outputHeight"

    companion object {
        fun parse(json: JSONObject?): SessionState {
            val source = json ?: JSONObject()
            return SessionState(
                active = source.optBoolean("active", false),
                inputWidth = source.optInt("inputWidth"),
                inputHeight = source.optInt("inputHeight"),
                outputWidth = source.optInt("outputWidth"),
                outputHeight = source.optInt("outputHeight"),
                neural = source.optBoolean("neural", false),
                temporal = source.optBoolean("temporal", false),
                layerCount = source.optInt("layerCount"),
                workingSetBytes = source.optLong("workingSetBytes"),
                weightBytes = source.optLong("weightBytes"),
                mode = ReconstructionMode.fromCode(source.optString("mode")),
                modeName = source.optString("modeName"),
                modelId = source.optString("modelId"),
                lastError = source.optString("lastError"),
                timings = StageTimings.parse(source.optJSONObject("timings")),
                aiProcessingMs = source.optNullableDouble("aiProcessingMs"),
            )
        }
    }
}

data class ModelState(
    val installed: Boolean,
    val path: String,
    val preferredModelId: String,
    val quality: UpscalingQuality,
    val backend: InferenceBackend,
    val id: String,
    val version: Int,
    val scaleFactor: Int,
    val opCount: Int,
    val fileBytes: Long,
    val sha256: String,
    val temporal: Boolean,
    val globalResidual: Boolean,
    val experimental: Boolean,
) {
    val displayName: String
        get() = when {
            !installed -> "No model installed"
            id.isNotEmpty() -> id
            else -> "Model"
        }

    companion object {
        fun parse(json: JSONObject?): ModelState {
            val source = json ?: JSONObject()
            val model = source.optJSONObject("model") ?: JSONObject()
            return ModelState(
                installed = source.optBoolean("installed", false),
                path = source.optString("path"),
                preferredModelId = source.optString("preferredModelId"),
                quality = UpscalingQuality.fromCode(source.optString("quality")),
                backend = InferenceBackend.fromCode(source.optString("backend")),
                id = model.optString("id"),
                version = model.optInt("version"),
                scaleFactor = model.optInt("scaleFactor"),
                opCount = model.optInt("opCount"),
                fileBytes = model.optLong("fileBytes"),
                sha256 = model.optString("sha256"),
                temporal = model.optBoolean("temporal", false),
                globalResidual = model.optBoolean("globalResidual", false),
                experimental = model.optBoolean("experimental", false),
            )
        }
    }
}

/**
 * One dashboard snapshot. Every nullable field is a genuine "the platform did
 * not report this" — the UI must render it as "—" rather than as zero.
 */
data class PerformanceSnapshot(
    val engineVersion: String,
    val initialised: Boolean,
    val integration: IntegrationKind,
    val tier: DeviceTier,
    val profile: GraphicsProfile,
    val thermalLevel: ThermalLevel,
    val batteryTempC: Double?,
    val socTempC: Double?,
    val platformThermalStatus: Int,
    val governorActions: List<String>,
    val governorReason: String,
    val fps: Double?,
    val averageFps: Double?,
    val onePercentLowFps: Double?,
    val frameTimeMs: Double?,
    val jitterMs: Double?,
    val worstFrameMs: Double?,
    val gpuBusyFraction: Double?,
    val gpuBusyMs: Double?,
    val gpuBusyLabel: String,
    val cpuLoadFraction: Double?,
    val ramUsedFraction: Double?,
    val ramTotalBytes: Long,
    val aiProcessingMs: Double?,
    val aiStageTotalMs: Double?,
    val session: SessionState,
    val model: ModelState,
    val note: String,
) {
    companion object {
        fun parse(json: JSONObject): PerformanceSnapshot {
            val thermal = json.optJSONObject("thermal") ?: JSONObject()
            val decision = thermal.optJSONObject("decision") ?: JSONObject()
            val monitor = json.optJSONObject("monitor") ?: JSONObject()
            val actionsJson = decision.optJSONArray("actions") ?: JSONArray()
            val actions = (0 until actionsJson.length()).mapNotNull { actionsJson.optString(it) }
            return PerformanceSnapshot(
                engineVersion = json.optString("engineVersion"),
                initialised = json.optBoolean("initialised", false),
                integration = IntegrationKind.fromValue(json.optInt("integration", 0)),
                tier = DeviceTier.fromCode(json.optString("tier")),
                profile = GraphicsProfile.parse(json.optJSONObject("profile") ?: JSONObject()),
                thermalLevel = ThermalLevel.fromCode(thermal.optString("level")),
                batteryTempC = thermal.optNullableDouble("batteryTempC"),
                socTempC = thermal.optNullableDouble("socTempC"),
                platformThermalStatus = thermal.optInt("platformThermalStatus"),
                governorActions = actions,
                governorReason = decision.optString("reason"),
                fps = monitor.optNullableDouble("fps"),
                averageFps = monitor.optNullableDouble("averageFps"),
                onePercentLowFps = monitor.optNullableDouble("onePercentLowFps"),
                frameTimeMs = monitor.optNullableDouble("frameTimeMs"),
                jitterMs = monitor.optNullableDouble("jitterMs"),
                worstFrameMs = monitor.optNullableDouble("worstFrameMs"),
                gpuBusyFraction = monitor.optNullableDouble("gpuBusyFraction"),
                gpuBusyMs = monitor.optNullableDouble("gpuBusyMs"),
                gpuBusyLabel = monitor.optString("gpuBusyLabel", "GPU busy (AI Vision passes)"),
                cpuLoadFraction = monitor.optNullableDouble("cpuLoadFraction"),
                ramUsedFraction = monitor.optNullableDouble("ramUsedFraction"),
                ramTotalBytes = monitor.optLong("ramTotalBytes"),
                aiProcessingMs = monitor.optNullableDouble("aiProcessingMs"),
                aiStageTotalMs = monitor.optNullableDouble("aiStageTotalMs"),
                session = SessionState.parse(json.optJSONObject("session")),
                model = ModelState.parse(json.optJSONObject("model")),
                note = json.optString("note"),
            )
        }
    }
}

/** One stage of the rolling per-stage timer table. */
data class StageTimer(
    val stage: String,
    val lastUs: Double?,
    val emaUs: Double?,
    val maxUs: Double?,
) {
    companion object {
        fun parseAll(json: JSONObject): List<StageTimer> {
            val array = json.optJSONArray("stages") ?: JSONArray()
            return (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                StageTimer(
                    stage = item.optString("stage"),
                    lastUs = item.optNullableDouble("lastUs"),
                    emaUs = item.optNullableDouble("emaUs"),
                    maxUs = item.optNullableDouble("maxUs"),
                )
            }
        }
    }
}

/** Data for the live graphs. */
data class UpscalerMetrics(
    val frameCount: Int,
    val frameTimesMs: List<Double>,
    val stages: List<StageTimer>,
    val gpuTimings: StageTimings,
    val gpuBusyFraction: Double?,
    val gpuBusyMs: Double?,
) {
    companion object {
        fun parse(json: JSONObject): UpscalerMetrics {
            val framesJson = json.optJSONArray("frameTimesMs") ?: JSONArray()
            val frames = (0 until framesJson.length()).mapNotNull { framesJson.optDouble(it).takeIf { v -> !v.isNaN() } }
            val gpu = json.optJSONObject("gpu") ?: JSONObject()
            return UpscalerMetrics(
                frameCount = json.optInt("frameCount"),
                frameTimesMs = frames,
                stages = StageTimer.parseAll(json),
                gpuTimings = StageTimings.parse(json.optJSONObject("timings")),
                gpuBusyFraction = gpu.optNullableDouble("busyFraction"),
                gpuBusyMs = gpu.optNullableDouble("busyMs"),
            )
        }
    }
}

/** Result of one `processFrame` call. */
data class FrameResult(
    val submitted: Boolean,
    val mode: ReconstructionMode,
    val upscalerMs: Double?,
    val error: String,
) {
    companion object {
        fun parse(json: String): FrameResult {
            val document = JSONObject(json)
            return FrameResult(
                submitted = document.optBoolean("submitted", false),
                mode = ReconstructionMode.fromCode(document.optString("mode")),
                upscalerMs = document.optNullableDouble("upscalerMs"),
                error = document.optString("error"),
            )
        }
    }
}

/** Handles of a caller-owned Vulkan device (see `NativeBridge.nativeStartSession`). */
data class VulkanDeviceInfo(
    val instance: Long,
    val physicalDevice: Long,
    val device: Long,
    val computeQueueFamily: Int,
    val graphicsQueueFamily: Int,
    val computeQueue: Long,
    val graphicsQueue: Long,
)

/** `null` when the JSON value is absent or explicitly null, else the number. */
internal fun JSONObject.optNullableDouble(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    val value = optDouble(key, Double.NaN)
    return if (value.isNaN()) null else value
}
