package com.aivision4k.sdk

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLES31
import org.json.JSONObject

/**
 * Off-screen OpenGL ES probe.
 *
 * The engine's preferred backend is Vulkan, but two things need the GLES
 * driver's own words:
 *
 *  * the dashboard shows the GPU vendor/name (the Vulkan device name is often
 *    an internal string such as "Adreno (TM) 740" — the same value, but the GL
 *    string is what every other tool on the device reports, so users can
 *    cross-check it);
 *  * the compatibility engine needs the GLES fallback level (ES 3.1+ for
 *    compute shaders) to say what a device could do *without* Vulkan.
 *
 * Creating a 1x1 pbuffer and a context is the standard, driver-safe way to
 * query this without touching the UI. Everything is released in `finally`.
 */
object GlesProbe {

    data class Result(
        val available: Boolean,
        val vendor: String = "",
        val renderer: String = "",
        val version: String = "",
        val majorVersion: Int = 0,
        val minorVersion: Int = 0,
        val maxTextureSize: Int = 0,
        val maxComputeWorkGroupInvocations: Int = 0,
        val computeShaders: Boolean = false,
        val floatRenderTargets: Boolean = false,
        val floatTextures: Boolean = false,
        val error: String = "",
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("available", available)
            put("majorVersion", majorVersion)
            put("minorVersion", minorVersion)
            put("computeShaders", computeShaders)
            put("floatRenderTargets", floatRenderTargets)
            put("floatTextures", floatTextures)
            put("maxTextureSize", maxTextureSize)
            put("maxComputeWorkGroupInvocations", maxComputeWorkGroupInvocations)
        }
    }

    fun probe(): Result {
        var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
        var context: EGLContext = EGL14.EGL_NO_CONTEXT
        var surface: EGLSurface = EGL14.EGL_NO_SURFACE
        try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            if (display == EGL14.EGL_NO_DISPLAY) {
                return Result(available = false, error = "no EGL display")
            }
            val version = IntArray(2)
            if (!EGL14.eglInitialize(display, version, 0, version, 1)) {
                return Result(available = false, error = "eglInitialize failed")
            }

            val configAttributes = intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_NONE,
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val configCount = IntArray(1)
            if (!EGL14.eglChooseConfig(display, configAttributes, 0, configs, 0, 1, configCount, 0) ||
                configCount[0] == 0 || configs[0] == null
            ) {
                return Result(available = false, error = "no ES2 pbuffer config")
            }
            val config = configs[0] as EGLConfig

            // Ask for an ES3 context: a device that only offers ES2 will still
            // give a valid context (the driver falls back), and the version
            // string tells us what we actually got.
            val contextAttributes = intArrayOf(
                EGL14.EGL_CONTEXT_CLIENT_VERSION, 3,
                EGL14.EGL_NONE,
            )
            context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, contextAttributes, 0)
            if (context == EGL14.EGL_NO_CONTEXT) {
                return Result(available = false, error = "eglCreateContext failed")
            }
            val surfaceAttributes = intArrayOf(
                EGL14.EGL_WIDTH, 1,
                EGL14.EGL_HEIGHT, 1,
                EGL14.EGL_NONE,
            )
            surface = EGL14.eglCreatePbufferSurface(display, config, surfaceAttributes, 0)
            if (surface == EGL14.EGL_NO_SURFACE) {
                return Result(available = false, error = "eglCreatePbufferSurface failed")
            }
            if (!EGL14.eglMakeCurrent(display, surface, surface, context)) {
                return Result(available = false, error = "eglMakeCurrent failed")
            }

            val renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: ""
            val vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: ""
            val glVersion = GLES20.glGetString(GLES20.GL_VERSION) ?: ""
            val (major, minor) = parseVersion(glVersion)
            val compute = major > 3 || (major == 3 && minor >= 1)
            // glGetIntegerv has no scalar overload in GLES20/GLES31: the value is
            // written into a one-element array.
            val textureSizeQuery = IntArray(1)
            GLES20.glGetIntegerv(GLES20.GL_MAX_TEXTURE_SIZE, textureSizeQuery, 0)
            val maxTextureSize = textureSizeQuery[0].coerceAtLeast(0)
            var maxInvocations = 0
            if (compute) {
                maxInvocations = try {
                    val query = IntArray(1)
                    GLES31.glGetIntegerv(GLES31.GL_MAX_COMPUTE_WORK_GROUP_INVOCATIONS, query, 0)
                    query[0]
                } catch (error: Throwable) {
                    0
                }
            }
            // Extension strings are only valid after the context is current.
            val extensions = GLES20.glGetString(GLES20.GL_EXTENSIONS) ?: ""
            val floatTargets = extensions.contains("EXT_color_buffer_float") ||
                extensions.contains("EXT_color_buffer_half_float")
            val floatTextures = extensions.contains("OES_texture_float")

            return Result(
                available = true,
                vendor = vendor,
                renderer = renderer,
                version = glVersion,
                majorVersion = major,
                minorVersion = minor,
                maxTextureSize = maxTextureSize,
                maxComputeWorkGroupInvocations = maxInvocations,
                computeShaders = compute,
                floatRenderTargets = floatTargets,
                floatTextures = floatTextures,
            )
        } catch (error: Throwable) {
            return Result(available = false, error = error.message ?: error.javaClass.simpleName)
        } finally {
            try {
                if (display != EGL14.EGL_NO_DISPLAY) {
                    EGL14.eglMakeCurrent(
                        display,
                        EGL14.EGL_NO_SURFACE,
                        EGL14.EGL_NO_SURFACE,
                        EGL14.EGL_NO_CONTEXT,
                    )
                    if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
                    if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
                    EGL14.eglTerminate(display)
                }
            } catch (ignored: Throwable) {
                // Nothing useful to do: the probe already has its answer.
            }
        }
    }

    /** "OpenGL ES 3.2 v1.r38..." -> (3, 2); (0, 0) when unparseable. */
    private fun parseVersion(version: String): Pair<Int, Int> {
        val match = Regex("OpenGL ES (\\d+)\\.(\\d+)").find(version) ?: return 0 to 0
        return (match.groupValues[1].toIntOrNull() ?: 0) to
            (match.groupValues[2].toIntOrNull() ?: 0)
    }
}
