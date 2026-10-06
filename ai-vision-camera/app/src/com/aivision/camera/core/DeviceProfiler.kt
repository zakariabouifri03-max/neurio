package com.aivision.camera.core

import android.app.ActivityManager
import android.content.Context
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Build
import java.io.File
import kotlin.math.max
import kotlin.math.min

enum class DeviceTier { LOW_END, MID_RANGE, FLAGSHIP }

/**
 * What the AI is allowed to do on this exact device.
 *
 * Derived from the detected hardware so a 2019 mid-ranger never attempts an 8K
 * multi-frame stack, while a current flagship is pushed as hard as it safely can.
 */
data class QualityPolicy(
    val tier: DeviceTier,
    val burstFrames: Int,
    val nightFrames: Int,
    val hdrBrackets: Int,
    val maxProcessMp: Float,
    val upscaleCapLongEdge: Int,
    val ultraUpscaleFactor: Float,
    val threads: Int,
    val tileSize: Int,
    val jpegQuality: Int,
    val previewDenoise: Boolean,
    val previewSharpen: Boolean,
    val previewSuperRes: Boolean,
    val videoAiEnhanced4k: Boolean,
    val parallelFrameProcessing: Boolean,
) {
    val tierLabel: String
        get() = when (tier) {
            DeviceTier.LOW_END -> "Entry"
            DeviceTier.MID_RANGE -> "Mid-range"
            DeviceTier.FLAGSHIP -> "Flagship"
        }
}

/** Full hardware report - shown in the app under Settings > Device. */
data class DeviceReport(
    val soc: String,
    val cpuModel: String,
    val cores: Int,
    val maxFreqGhz: Float,
    val ramGb: Float,
    val gpuVendor: String,
    val gpuRenderer: String,
    val glesVersion: String,
    val maxTextureSize: Int,
    val abi: String,
    val buildDevice: String,
    val androidRelease: String,
    val sdkInt: Int,
    val tier: DeviceTier,
    val score: Int,
    val notes: List<String>,
)

/**
 * Device capability profiler.
 *
 * Real detection - no hard-coded device list:
 *  - RAM from ActivityManager, cores + clock from /proc + sysfs
 *  - GPU vendor/renderer/GLES level from a throw-away EGL pbuffer context
 *  - SoC model from Build.SOC_MODEL / build fingerprints
 *  - plus the camera hardware score (see [com.aivision.camera.camera.CameraCapabilities])
 */
object DeviceProfiler {

    @Volatile private var cached: DeviceReport? = null

    fun report(ctx: Context, cameraScore: Int = 0, cameraNotes: List<String> = emptyList()): DeviceReport {
        cached?.let { if (it.notes.size >= cameraNotes.size) return it }
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        am?.getMemoryInfo(memInfo)
        val ramGb = memInfo.totalMem / 1e9f

        val cores = Runtime.getRuntime().availableProcessors()
        val maxFreq = maxCpuFrequencyGhz()
        val soc = socModel()

        val gpu = gpuInfo(ctx)

        val score = hardwareScore(ramGb, cores, maxFreq, gpu, soc, cameraScore)
        val tier = when {
            score >= 68 -> DeviceTier.FLAGSHIP
            score >= 40 -> DeviceTier.MID_RANGE
            else -> DeviceTier.LOW_END
        }
        val rep = DeviceReport(
            soc = soc, cpuModel = cpuModel(), cores = cores, maxFreqGhz = maxFreq,
            ramGb = ramGb, gpuVendor = gpu.vendor, gpuRenderer = gpu.renderer,
            glesVersion = gpu.version, maxTextureSize = gpu.maxTexture,
            abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "?", buildDevice = "${Build.MANUFACTURER} ${Build.MODEL}",
            androidRelease = Build.VERSION.RELEASE ?: "?", sdkInt = Build.VERSION.SDK_INT,
            tier = tier, score = score, notes = cameraNotes,
        )
        cached = rep
        L.i("device: $soc | ${gpu.renderer} | ${"%.1f".format(ramGb)}GB | $cores cores | score=$score -> $tier")
        return rep
    }

    /** AI quality policy for the detected tier (or a user override from Settings). */
    fun policy(report: DeviceReport, override: Int = -1): QualityPolicy {
        val tier = when (override) {
            0 -> DeviceTier.LOW_END
            1 -> DeviceTier.MID_RANGE
            2 -> DeviceTier.FLAGSHIP
            else -> report.tier
        }
        val bigTexture = report.maxTextureSize >= 8192
        return when (tier) {
            DeviceTier.FLAGSHIP -> QualityPolicy(
                tier = tier, burstFrames = 12, nightFrames = 16, hdrBrackets = 5,
                maxProcessMp = 30f, upscaleCapLongEdge = if (bigTexture) 6000 else 4096,
                ultraUpscaleFactor = 4f, threads = min(6, report.cores), tileSize = 512,
                jpegQuality = 97, previewDenoise = true, previewSharpen = true,
                previewSuperRes = true, videoAiEnhanced4k = true, parallelFrameProcessing = true,
            )
            DeviceTier.MID_RANGE -> QualityPolicy(
                tier = tier, burstFrames = 7, nightFrames = 9, hdrBrackets = 3,
                maxProcessMp = 18f, upscaleCapLongEdge = 4096,
                ultraUpscaleFactor = 2.5f, threads = min(4, report.cores), tileSize = 384,
                jpegQuality = 95, previewDenoise = true, previewSharpen = true,
                previewSuperRes = bigTexture, videoAiEnhanced4k = true, parallelFrameProcessing = true,
            )
            DeviceTier.LOW_END -> QualityPolicy(
                tier = tier, burstFrames = 3, nightFrames = 4, hdrBrackets = 3,
                maxProcessMp = 12f, upscaleCapLongEdge = 3000,
                ultraUpscaleFactor = 2f, threads = min(2, report.cores), tileSize = 256,
                jpegQuality = 92, previewDenoise = true, previewSharpen = false,
                previewSuperRes = false, videoAiEnhanced4k = false, parallelFrameProcessing = false,
            )
        }
    }

    // ---------------------------------------------------------------- hardware
    private fun socModel(): String {
        if (Build.VERSION.SDK_INT >= 31) {
            val soc = Build.SOC_MODEL
            if (!soc.isNullOrBlank() && soc != Build.UNKNOWN) return soc
        }
        val props = listOf(
            "ro.soc.model", "ro.board.platform", "ro.hardware.chipname",
            "ro.mediatek.platform", "ro.chipname",
        )
        for (p in props) {
            val v = systemProp(p)
            if (!v.isNullOrBlank()) return v
        }
        return "${Build.HARDWARE} (${Build.BOARD})"
    }

    private fun systemProp(key: String): String? = try {
        val cls = Class.forName("android.os.SystemProperties")
        val get = cls.getMethod("get", String::class.java)
        (get.invoke(null, key) as? String)?.takeIf { it.isNotBlank() }
    } catch (t: Throwable) { null }

    private fun cpuModel(): String = try {
        File("/proc/cpuinfo").readLines()
            .firstOrNull { it.startsWith("Hardware") || it.startsWith("model name") }
            ?.substringAfter(':')?.trim() ?: Build.HARDWARE
    } catch (t: Throwable) { Build.HARDWARE }

    private fun maxCpuFrequencyGhz(): Float = try {
        var best = 0L
        val clusterDirs = File("/sys/devices/system/cpu").listFiles { f ->
            f.name.matches(Regex("cpu[0-9]+"))
        } ?: emptyArray()
        for (dir in clusterDirs) {
            val f = File(dir, "cpufreq/cpuinfo_max_freq")
            if (f.exists()) best = max(best, f.readText().trim().toLongOrNull() ?: 0L)
        }
        if (best == 0L) 0f else best / 1_000_000f
    } catch (t: Throwable) { 0f }

    private data class GpuInfo(val vendor: String, val renderer: String, val version: String, val maxTexture: Int)

    /**
     * Spin up a 1x1 EGL pbuffer, ask the driver who it is, tear it down.
     * Everything is guarded: a device without working EGL still gets a report.
     */
    private fun gpuInfo(ctx: Context): GpuInfo {
        var display: EGLDisplay? = null
        var surface: EGLSurface? = null
        var context: EGLContext? = null
        try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            if (display == EGL14.EGL_NO_DISPLAY) throw IllegalStateException("no EGL display")
            val ver = IntArray(2)
            if (!EGL14.eglInitialize(display, ver, 0, ver, 1)) throw IllegalStateException("eglInitialize failed")
            val cfgAttrs = intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_NONE,
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val num = IntArray(1)
            EGL14.eglChooseConfig(display, cfgAttrs, 0, configs, 0, 1, num, 0)
            val config = configs[0] ?: throw IllegalStateException("no EGL config")
            surface = EGL14.eglCreatePbufferSurface(display, config,
                intArrayOf(EGL14.EGL_WIDTH, 4, EGL14.EGL_HEIGHT, 4, EGL14.EGL_NONE), 0)
            context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
            if (context == null || context == EGL14.EGL_NO_CONTEXT) throw IllegalStateException("no EGL context")
            EGL14.eglMakeCurrent(display, surface, surface, context)
            val renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: "?"
            val vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: "?"
            val version = GLES20.glGetString(GLES20.GL_VERSION) ?: "?"
            val maxTex = IntArray(1)
            GLES20.glGetIntegerv(GLES20.GL_MAX_TEXTURE_SIZE, maxTex, 0)
            return GpuInfo(vendor, renderer, "${version.ifBlank { glesRequested(ctx) }}", maxTex[0])
        } catch (t: Throwable) {
            L.w("GPU probe failed: ${t.message}")
            return GpuInfo("unknown", "unknown", glesRequested(ctx), 4096)
        } finally {
            try {
                if (display != null && display != EGL14.EGL_NO_DISPLAY) {
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                    if (context != null) EGL14.eglDestroyContext(display, context)
                    if (surface != null) EGL14.eglDestroySurface(display, surface)
                    EGL14.eglTerminate(display)
                }
            } catch (t: Throwable) { /* ignore */ }
        }
    }

    private fun glesRequested(ctx: Context): String = try {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = am.deviceConfigurationInfo
        "OpenGL ES ${(info.reqGlEsVersion shr 16)}.${(info.reqGlEsVersion and 0xffff)}"
    } catch (t: Throwable) { "OpenGL ES 2.0" }

    // ------------------------------------------------------------------- score
    private fun hardwareScore(ramGb: Float, cores: Int, maxFreq: Float, gpu: GpuInfo,
                              soc: String, cameraScore: Int): Int {
        var score = 0
        score += when {
            ramGb >= 11.5f -> 26
            ramGb >= 7.5f -> 22
            ramGb >= 5.5f -> 16
            ramGb >= 3.5f -> 10
            ramGb >= 2.5f -> 5
            else -> 2
        }
        score += when {
            cores >= 8 -> 14
            cores >= 6 -> 10
            cores >= 4 -> 6
            else -> 2
        }
        score += when {
            maxFreq >= 2.9f -> 12
            maxFreq >= 2.4f -> 9
            maxFreq >= 2.0f -> 6
            maxFreq >= 1.6f -> 3
            else -> 1
        }
        score += gpuScore(gpu.renderer + " " + gpu.vendor)
        score += socScore(soc)
        score += cameraScore.coerceIn(0, 24)
        return score
    }

    private fun gpuScore(name: String): Int {
        val s = name.lowercase()
        return when {
            s.contains("immortalis") || s.contains("xclipse") -> 22
            s.contains("adreno") -> when {
                Regex("adreno \\(?[6789]\\d\\d").containsMatchIn(s) -> 22
                Regex("adreno \\(?[5-6]\\d\\d").containsMatchIn(s) -> 14
                else -> 8
            }
            s.contains("mali-g7") || s.contains("mali-g9") || s.contains("mali-g6") -> 16
            s.contains("mali-g5") || s.contains("mali-g3") -> 8
            s.contains("powervr") -> 10
            s.contains("apple") -> 22
            s == "unknown unknown" -> 4
            else -> 6
        }
    }

    private fun socScore(soc: String): Int {
        val s = soc.lowercase()
        // Snapdragon: 8xx = flagship, 7xx = upper-mid, 6xx/4xx = entry
        Regex("sm(8|9)\\d{3}").find(s)?.let { return 20 }
        Regex("sm7\\d{3}").find(s)?.let { return 14 }
        Regex("sm6\\d{3}").find(s)?.let { return 8 }
        Regex("sm4\\d{3}").find(s)?.let { return 4 }
        // MediaTek Dimensity
        Regex("mt(6|7|8)\\d{3}").find(s)?.let { return 16 }
        Regex("mt(9)\\d{3}").find(s)?.let { return 20 }
        Regex("mt(8)\\d{2,3}").find(s)?.let { return 6 }
        // Exynos / Tensor / Kirin
        if (s.contains("exynos") || s.contains("tensor") || s.contains("kirin")) return 14
        if (s.contains("snapdragon")) return 12
        return 6
    }
}
