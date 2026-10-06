package com.aivision4k.sdk

/**
 * The raw JNI surface. Every method maps one-to-one onto an entry point
 * registered by `jni/v4k_jni.cpp` (see the `kMethods` table there — a rename
 * here without the same rename there fails at `System.loadLibrary` time, not
 * later on some unlucky device).
 *
 * Nothing in this file is meant to be called by an application directly:
 * [AIUpscaler] is the supported API. It exists as a separate object so the
 * native signatures stay readable and so tests can stub the engine.
 *
 * Conventions:
 *  * methods that can fail return a `String?` — `null` means success, anything
 *    else is a human-readable error the UI may show verbatim;
 *  * structured data crosses as JSON because both sides already have a parser
 *    (org.json on this side, `v4k::JsonValue` on the other) and it keeps the
 *    protocol loggable;
 *  * frames cross as raw 64-bit Vulkan handles, so the per-frame path does no
 *    allocation and no string conversion.
 */
internal object NativeBridge {

    /** True once the engine library is loaded. */
    val loaded: Boolean

    init {
        var ok = false
        try {
            System.loadLibrary("aivision4k")
            ok = true
        } catch (error: UnsatisfiedLinkError) {
            // A missing .so is a build problem, not a runtime device problem: the
            // 64-bit ABIs are declared in build.gradle.kts (arm64-v8a, x86_64).
            ok = false
        }
        loaded = ok
    }

    // ---- lifecycle ---------------------------------------------------------
    external fun nativeInitialise(androidCapsJson: String?): String?
    external fun nativeShutdown()
    external fun nativeIsInitialised(): Boolean

    // ---- device + compatibility -------------------------------------------
    external fun nativeUpdateAndroidCaps(androidCapsJson: String?): String?
    external fun nativeReprobeDevice(): String?
    external fun nativeDeviceJson(): String
    external fun nativeCompatibilityJson(): String
    external fun nativeSetIntegration(kind: Int)

    // ---- profiles ----------------------------------------------------------
    external fun nativeSetProfileJson(profileJson: String?): String?
    external fun nativeProfileJson(): String
    external fun nativePresetsJson(): String

    // ---- thermal + monitoring ---------------------------------------------
    external fun nativeUpdateThermal(
        platformStatus: Int,
        batteryTempC: Float,
        averageFrameTimeMs: Float,
        targetFrameTimeMs: Float,
        thermalGuardEnabled: Boolean,
        nowMs: Long,
    )
    external fun nativeAddFrameSample(frameTimeMs: Double, nowMs: Long, upscalerMs: Double)
    external fun nativeStatusJson(): String
    external fun nativeMetricsJson(): String

    // ---- AI model manager --------------------------------------------------
    external fun nativeInstallModelBytes(bytes: ByteArray): String?
    external fun nativeInstallModelFile(path: String?): String?
    external fun nativeRemoveModel()
    external fun nativeModelJson(): String

    // ---- sessions ----------------------------------------------------------
    /**
     * Starts an upscaling session on a caller-owned Vulkan device. Every handle
     * is a raw Vulkan object the caller already owns; the engine creates only
     * its own pipelines and command pool and never destroys anything it was
     * given.
     */
    external fun nativeStartSession(
        instance: Long,
        physicalDevice: Long,
        device: Long,
        computeQueueFamily: Int,
        graphicsQueueFamily: Int,
        computeQueue: Long,
        graphicsQueue: Long,
        inputWidth: Int,
        inputHeight: Int,
        outputWidth: Int,
        outputHeight: Int,
        temporal: Boolean,
        denoise: Boolean,
        antiAliasing: Boolean,
        sharpening: Float,
        noiseReduction: Float,
        neural: Boolean,
        maxWorkingBytes: Long,
    ): String?

    external fun nativeStopSession()
    external fun nativeSessionJson(): String

    /**
     * Upscales one frame. Returns a JSON document
     * `{"submitted":bool,"mode":"...","upscalerMs":double|null,"error":"..."}`
     * so the render loop never has to allocate a Java object graph; use
     * [FrameResult.parse] to read it.
     */
    external fun nativeProcessFrame(
        lowResImage: Long,
        lowResView: Long,
        outputImage: Long,
        outputView: Long,
        motionImage: Long,
        motionView: Long,
        deltaSeconds: Double,
        resetHistory: Boolean,
        historyValid: Boolean,
    ): String
}
