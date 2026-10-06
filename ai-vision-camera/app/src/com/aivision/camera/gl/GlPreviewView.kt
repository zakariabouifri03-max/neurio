package com.aivision.camera.gl

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.AttributeSet
import android.view.Surface
import com.aivision.camera.core.L
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * Live AI preview.
 *
 * The camera streams straight into an external OES texture; a single fragment
 * shader pass performs edge-aware noise reduction, detail recovery, local
 * contrast, tone mapping, vibrance and the AI zoom crop - every frame, on the
 * GPU. That is what makes the AI visible *while* you compose the shot instead of
 * only after pressing the shutter.
 *
 * If the AI shader cannot be compiled on a given driver the view transparently
 * falls back to a plain copy shader, so the preview never breaks.
 */
class GlPreviewView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null,
) : GLSurfaceView(context, attrs) {

    /** Handed to the camera engine as the preview target. */
    var surfaceTexture: SurfaceTexture? = null
        private set

    var onSurfaceReady: ((SurfaceTexture) -> Unit)? = null
    var onSurfaceSize: ((Int, Int) -> Unit)? = null
    var onGlError: ((String) -> Unit)? = null

    /** Report a GL problem without ever letting the callback kill the GL thread. */
    private fun reportError(message: String) {
        L.w("gl: $message")
        try {
            onGlError?.invoke(message)
        } catch (t: Throwable) {
            L.e("glError callback failed", t)
        }
    }

    // --- live settings written from the UI thread, read by the GL thread -----
    @Volatile var denoise = 0.3f
    @Volatile var sharpen = 0.35f
    @Volatile var clarity = 0.18f
    @Volatile var tone = 0.4f
    @Volatile var shadow = 0.1f
    @Volatile var highlight = 0.4f
    @Volatile var contrast = 0.2f
    @Volatile var vibrance = 0.2f
    @Volatile var saturation = 1f
    @Volatile var aiZoom = 1f
    @Volatile var portraitTint = 0f

    @Volatile var sensorWidth = 1920
    @Volatile var sensorHeight = 1080
    @Volatile var rotationDegrees = 90
    @Volatile var mirror = false
    @Volatile var aiActive = false

    private val renderer = PreviewRenderer()

    init {
        setEGLContextClientVersion(2)
        preserveEGLContextOnPause = true
        setRenderer(renderer)
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    /** Called when the preview size / orientation changes (safe from UI thread). */
    fun updateTransform(width: Int, height: Int, rotation: Int, mirrorHorizontally: Boolean) {
        sensorWidth = width
        sensorHeight = height
        rotationDegrees = rotation
        mirror = mirrorHorizontally
        requestRender()
    }

    fun applyEnhancement(
        denoise: Float, sharpen: Float, clarity: Float, tone: Float, shadow: Float,
        highlight: Float, contrast: Float, vibrance: Float, saturation: Float,
        aiZoom: Float, aiActive: Boolean,
    ) {
        this.denoise = denoise
        this.sharpen = sharpen
        this.clarity = clarity
        this.tone = tone
        this.shadow = shadow
        this.highlight = highlight
        this.contrast = contrast
        this.vibrance = vibrance
        this.saturation = saturation
        this.aiZoom = aiZoom.coerceIn(1f, 8f)
        this.aiActive = aiActive
        requestRender()
    }

    /** Turn the AI pipeline off (pure camera passthrough). */
    fun disableEnhancement() {
        applyEnhancement(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 1f, aiZoom, false)
    }

    private inner class PreviewRenderer : Renderer {
        private var textureId = 0
        private var program = 0
        private var fallbackProgram = 0
        private var useFallback = false
        private var quad: FloatBuffer? = null
        private var texCoords: FloatBuffer? = null
        // cached once after linking: glGet* runs a driver round trip and is far
        // too expensive to repeat 30-60 times per second in the GL thread
        private var aPosLoc = -1
        private var aTexLoc = -1
        private var sTexLoc = -1
        private val texMatrix = FloatArray(16)
        private val rotMatrix = FloatArray(4)
        private var uTexMatrixLoc = 0
        private var uCropLoc = 0
        private var uRotLoc = 0
        private var uMirrorLoc = 0
        private var uTexelLoc = 0
        private var uDenoiseLoc = 0
        private var uSharpenLoc = 0
        private var uClarityLoc = 0
        private var uToneLoc = 0
        private var uShadowLoc = 0
        private var uHighlightLoc = 0
        private var uContrastLoc = 0
        private var uVibranceLoc = 0
        private var uSaturationLoc = 0
        private var uZoomLoc = 0
        private var viewWidth = 1
        private var viewHeight = 1

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            val ids = IntArray(1)
            GLES20.glGenTextures(1, ids, 0)
            textureId = ids[0]
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

            quad = buildQuad()
            texCoords = buildTexCoords()

            program = buildProgram(VERTEX_SHADER, AI_FRAGMENT_SHADER)
            if (program == 0) {
                L.w("AI preview shader unavailable - falling back to passthrough")
                useFallback = true
                fallbackProgram = buildProgram(VERTEX_SHADER, PLAIN_FRAGMENT_SHADER)
                if (fallbackProgram == 0) {
                    reportError("Preview shaders unavailable on this GPU")
                    return
                }
                program = fallbackProgram
            }
            uTexMatrixLoc = GLES20.glGetUniformLocation(program, "uTexMatrix")
            uCropLoc = GLES20.glGetUniformLocation(program, "uCrop")
            uRotLoc = GLES20.glGetUniformLocation(program, "uRot")
            uMirrorLoc = GLES20.glGetUniformLocation(program, "uMirror")
            uTexelLoc = GLES20.glGetUniformLocation(program, "uTexel")
            uDenoiseLoc = GLES20.glGetUniformLocation(program, "uDenoise")
            uSharpenLoc = GLES20.glGetUniformLocation(program, "uSharpen")
            uClarityLoc = GLES20.glGetUniformLocation(program, "uClarity")
            uToneLoc = GLES20.glGetUniformLocation(program, "uTone")
            uShadowLoc = GLES20.glGetUniformLocation(program, "uShadow")
            uHighlightLoc = GLES20.glGetUniformLocation(program, "uHighlight")
            uContrastLoc = GLES20.glGetUniformLocation(program, "uContrast")
            uVibranceLoc = GLES20.glGetUniformLocation(program, "uVibrance")
            uSaturationLoc = GLES20.glGetUniformLocation(program, "uSaturation")
            uZoomLoc = GLES20.glGetUniformLocation(program, "uZoom")
            aPosLoc = GLES20.glGetAttribLocation(program, "aPos")
            aTexLoc = GLES20.glGetAttribLocation(program, "aTex")
            sTexLoc = GLES20.glGetUniformLocation(program, "sTex")

            surfaceTexture = SurfaceTexture(textureId)
            surfaceTexture?.setOnFrameAvailableListener { requestRender() }
            val ready = surfaceTexture
            if (ready != null) {
                // The host gets the texture on this (GL) thread; a mistake in the
                // callback must not take the process down with it.
                try {
                    onSurfaceReady?.invoke(ready)
                } catch (t: Throwable) {
                    L.e("surfaceReady callback failed", t)
                }
            }
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            viewWidth = width.coerceAtLeast(1)
            viewHeight = height.coerceAtLeast(1)
            GLES20.glViewport(0, 0, viewWidth, viewHeight)
            try {
                onSurfaceSize?.invoke(viewWidth, viewHeight)
            } catch (t: Throwable) {
                L.e("surfaceSize callback failed", t)
            }
        }

        override fun onDrawFrame(gl: GL10?) {
            val st = surfaceTexture ?: return
            try {
                st.updateTexImage()
            } catch (t: Throwable) {
                L.d("updateTexImage: ${t.message}")
                return
            }
            st.getTransformMatrix(texMatrix)

            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            if (program == 0) return
            GLES20.glUseProgram(program)

            quad?.position(0)
            GLES20.glEnableVertexAttribArray(aPosLoc)
            GLES20.glVertexAttribPointer(aPosLoc, 2, GLES20.GL_FLOAT, false, 0, quad)
            texCoords?.position(0)
            GLES20.glEnableVertexAttribArray(aTexLoc)
            GLES20.glVertexAttribPointer(aTexLoc, 2, GLES20.GL_FLOAT, false, 0, texCoords)

            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
            GLES20.glUniform1i(sTexLoc, 0)
            GLES20.glUniformMatrix4fv(uTexMatrixLoc, 1, false, texMatrix, 0)

            // ---- geometry: display-space crop -> sensor-space rotation --------
            val rotated = rotationDegrees % 360 == 90 || rotationDegrees % 360 == 270
            val srcAspect = if (rotated) sensorHeight.toFloat() / sensorWidth
            else sensorWidth.toFloat() / sensorHeight
            val viewAspect = viewWidth.toFloat() / viewHeight
            var cropX = 1f
            var cropY = 1f
            if (srcAspect > viewAspect) cropX = viewAspect / srcAspect else cropY = srcAspect / viewAspect
            // AI digital zoom crops further (hardware zoom covers the rest)
            cropX /= aiZoom
            cropY /= aiZoom
            GLES20.glUniform2f(uCropLoc, cropX, cropY)

            val rad = Math.toRadians(rotationDegrees.toDouble())
            val cos = kotlin.math.cos(rad).toFloat()
            val sin = kotlin.math.sin(rad).toFloat()
            rotMatrix[0] = cos; rotMatrix[1] = -sin; rotMatrix[2] = sin; rotMatrix[3] = cos
            GLES20.glUniformMatrix2fv(uRotLoc, 1, false, rotMatrix, 0)
            GLES20.glUniform1f(uMirrorLoc, if (mirror) 1f else 0f)
            GLES20.glUniform2f(uTexelLoc, 1f / sensorWidth, 1f / sensorHeight)

            if (useFallback) {
                GLES20.glUniform1f(uZoomLoc, aiZoom)
            } else {
                GLES20.glUniform1f(uDenoiseLoc, denoise)
                GLES20.glUniform1f(uSharpenLoc, sharpen)
                GLES20.glUniform1f(uClarityLoc, clarity)
                GLES20.glUniform1f(uToneLoc, tone)
                GLES20.glUniform1f(uShadowLoc, shadow)
                GLES20.glUniform1f(uHighlightLoc, highlight)
                GLES20.glUniform1f(uContrastLoc, contrast)
                GLES20.glUniform1f(uVibranceLoc, vibrance)
                GLES20.glUniform1f(uSaturationLoc, saturation)
                GLES20.glUniform1f(uZoomLoc, aiZoom)
            }

            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(aPosLoc)
            GLES20.glDisableVertexAttribArray(aTexLoc)
        }

        private fun buildQuad(): FloatBuffer {
            val data = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
            return ByteBuffer.allocateDirect(data.size * 4).order(ByteOrder.nativeOrder())
                .asFloatBuffer().apply { put(data); position(0) }
        }

        private fun buildTexCoords(): FloatBuffer {
            val data = floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)
            return ByteBuffer.allocateDirect(data.size * 4).order(ByteOrder.nativeOrder())
                .asFloatBuffer().apply { put(data); position(0) }
        }

        private fun buildProgram(vertex: String, fragment: String): Int {
            val vs = compile(GLES20.GL_VERTEX_SHADER, vertex) ?: return 0
            val fs = compile(GLES20.GL_FRAGMENT_SHADER, fragment) ?: return 0
            val p = GLES20.glCreateProgram()
            GLES20.glAttachShader(p, vs)
            GLES20.glAttachShader(p, fs)
            GLES20.glLinkProgram(p)
            val status = IntArray(1)
            GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
            if (status[0] != GLES20.GL_TRUE) {
                L.w("program link failed: ${GLES20.glGetProgramInfoLog(p)}")
                GLES20.glDeleteProgram(p)
                return 0
            }
            return p
        }

        private fun compile(type: Int, source: String): Int? {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val status = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
            if (status[0] != GLES20.GL_TRUE) {
                L.w("shader compile failed: ${GLES20.glGetShaderInfoLog(shader)}")
                GLES20.glDeleteShader(shader)
                return null
            }
            return shader
        }
    }

    companion object {
        private const val VERTEX_SHADER = """
            attribute vec4 aPos;
            attribute vec2 aTex;
            varying vec2 vTex;
            void main() {
                vTex = aTex;
                gl_Position = aPos;
            }
        """

        /** Single pass AI: denoise -> detail -> local contrast -> tone -> colour. */
        private const val AI_FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES sTex;
            uniform mat4 uTexMatrix;
            uniform vec2 uCrop;
            uniform mat2 uRot;
            uniform float uMirror;
            uniform vec2 uTexel;
            uniform float uDenoise;
            uniform float uSharpen;
            uniform float uClarity;
            uniform float uTone;
            uniform float uShadow;
            uniform float uHighlight;
            uniform float uContrast;
            uniform float uVibrance;
            uniform float uSaturation;
            uniform float uZoom;
            varying vec2 vTex;

            vec3 sample_at(vec2 displayUv) {
                vec2 d = (displayUv - 0.5) * uCrop + 0.5;
                vec2 s = uRot * (d - 0.5) + 0.5;
                if (uMirror > 0.5) s.x = 1.0 - s.x;
                vec4 t = uTexMatrix * vec4(s, 0.0, 1.0);
                return texture2D(sTex, t.xy).rgb;
            }

            float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

            void main() {
                vec3 c = sample_at(vTex);
                vec2 px = uTexel * uZoom;

                // --- edge aware denoise (5 tap cross with range weights) -------
                if (uDenoise > 0.001) {
                    vec3 n = sample_at(vTex + vec2(0.0, px.y));
                    vec3 s2 = sample_at(vTex - vec2(0.0, px.y));
                    vec3 e = sample_at(vTex + vec2(px.x, 0.0));
                    vec3 w2 = sample_at(vTex - vec2(px.x, 0.0));
                    float sigma = 0.045 + uDenoise * 0.06;
                    float inv = 1.0 / (2.0 * sigma * sigma);
                    vec3 acc = c;
                    float wsum = 1.0;
                    float d;
                    d = dot(n - c, n - c); float wn = exp(-d * inv);
                    d = dot(s2 - c, s2 - c); float ws = exp(-d * inv);
                    d = dot(e - c, e - c); float we = exp(-d * inv);
                    d = dot(w2 - c, w2 - c); float ww = exp(-d * inv);
                    acc += n * wn + s2 * ws + e * we + w2 * ww;
                    wsum += wn + ws + we + ww;
                    vec3 smooth_c = acc / wsum;
                    c = mix(smooth_c, c, clamp(1.0 - uDenoise, 0.05, 1.0));
                }

                // --- detail recovery (unsharp on a 3x3 neighbourhood) ----------
                if (uSharpen > 0.001) {
                    vec3 blur = (sample_at(vTex + vec2(px.x, 0.0)) + sample_at(vTex - vec2(px.x, 0.0))
                               + sample_at(vTex + vec2(0.0, px.y)) + sample_at(vTex - vec2(0.0, px.y))
                               + c) / 5.0;
                    vec3 detail = c - blur;
                    float gate = smoothstep(0.002, 0.03, length(detail));
                    c += clamp(detail * uSharpen * (0.35 + 0.65 * gate), vec3(-0.22), vec3(0.22));
                }

                // --- local contrast / clarity ---------------------------------
                if (uClarity > 0.001) {
                    vec3 wide = (sample_at(vTex + vec2(2.0 * px.x, 0.0)) + sample_at(vTex - vec2(2.0 * px.x, 0.0))
                               + sample_at(vTex + vec2(0.0, 2.0 * px.y)) + sample_at(vTex - vec2(0.0, 2.0 * px.y))) * 0.25;
                    float l = luma(c);
                    float tone = 1.0 - abs(l - 0.5) * 1.1;
                    c += (c - wide) * uClarity * clamp(tone, 0.25, 1.0);
                }

                // --- tone mapping ---------------------------------------------
                if (uTone > 0.001) {
                    float l = luma(c);
                    float lift = uShadow * (1.0 - smoothstep(0.02, 0.4, l)) * (1.0 - l);
                    float roll = uHighlight * smoothstep(0.62, 1.0, l) * (l - 0.62) * 0.9;
                    c = c + vec3(lift * uTone - roll * uTone);
                    float l2 = clamp(luma(c), 0.0, 1.0);
                    float curve = l2 * l2 * (3.0 - 2.0 * l2);
                    c = mix(c, c * (0.35 + curve * 1.3), clamp(uContrast, 0.0, 1.0) * 0.8);
                }

                // --- colour: vibrance then saturation --------------------------
                float l3 = luma(c);
                if (uVibrance > 0.001) {
                    float sat = length(c - vec3(l3));
                    float gain = 1.0 + uVibrance * (1.0 - clamp(sat / 0.28, 0.0, 1.0)) * 0.9;
                    c = mix(vec3(l3), c, gain);
                }
                if (abs(uSaturation - 1.0) > 0.001) {
                    c = mix(vec3(l3), c, uSaturation);
                }
                gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
            }
        """

        private const val PLAIN_FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES sTex;
            uniform mat4 uTexMatrix;
            uniform vec2 uCrop;
            uniform mat2 uRot;
            uniform float uMirror;
            uniform float uZoom;
            varying vec2 vTex;
            void main() {
                vec2 d = (vTex - 0.5) * uCrop + 0.5;
                vec2 s = uRot * (d - 0.5) + 0.5;
                if (uMirror > 0.5) s.x = 1.0 - s.x;
                vec4 t = uTexMatrix * vec4(s, 0.0, 1.0);
                gl_FragColor = vec4(texture2D(sTex, t.xy).rgb, 1.0);
            }
        """
    }
}
