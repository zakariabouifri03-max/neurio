package com.aivision.camera.camera

import android.content.Context
import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.MediaRecorder
import android.os.Build
import android.util.Range
import android.util.Size
import com.aivision.camera.core.L
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Which physical lens this is, in photographic terms. */
enum class LensKind(val label: String) {
    ULTRA_WIDE("Ultra Wide"),
    WIDE("Wide"),
    TELE("Tele"),
    TELE_LONG("Super Tele"),
    FRONT("Front"),
    UNKNOWN("Camera");

    companion object {
        fun of(equivFocal: Float, facing: Int, isFrontGroup: Boolean): LensKind {
            if (facing == CameraMetadata.LENS_FACING_FRONT || isFrontGroup) return FRONT
            return when {
                equivFocal < 20f -> ULTRA_WIDE
                equivFocal < 30f -> WIDE
                equivFocal < 90f -> TELE
                else -> TELE_LONG
            }
        }
    }
}

/**
 * One physical camera with everything the app needs to know about it.
 * Populated straight from CameraCharacteristics - no hard-coded phone models.
 */
class LensInfo(
    val id: String,
    val facing: Int,
    kind: LensKind,
    val focalMm: Float,
    val equivFocal: Float,
    val sensorDiagonalMm: Float,
    val sensorWidthMm: Float,
    val sensorHeightMm: Float,
    val activeArray: Rect,
    val pixelArray: Size,
    val hardwareLevel: Int,
    val supportsRaw: Boolean,
    val supportsDepth: Boolean,
    val supportsPrivate: Boolean,
    val supportsMultiCamera: Boolean,
    val isLogical: Boolean,
    val physicalIds: List<String>,
    val ois: Boolean,
    val eis: Boolean,
    val flash: Boolean,
    val maxDigitalZoom: Float,
    val zoomRatioRange: Range<Float>?,
    val exposureRange: Range<Long>,
    val isoRange: Range<Int>,
    val minFocusDistance: Float,
    val afModes: IntArray,
    val previewSizes: List<Size>,
    val photoSizes: List<Size>,
    val yuvSizes: List<Size>,
    val rawSizes: List<Size>,
    val depthSizes: List<Size>,
    val videoSizes: List<Size>,
    val fpsRanges: List<Range<Int>>,
    val highSpeedSizes: List<Size>,
    val highSpeedFps: List<Range<Int>>,
    val maxIsoBoost: Int,
) {
    /** Native zoom factor of this lens relative to the reference wide lens. */
    var nativeZoom: Float = 1f

    /** Photographic role - refined once the group's reference lens is known. */
    var kind: LensKind = kind
        private set

    /** Hardware zoom ceiling (crop zoom), independent of AI zoom. */
    val hardwareMaxZoom: Float get() = zoomRatioRange?.upper?.takeIf { it > 1f } ?: maxDigitalZoom

    /** Re-classify using the real 35mm-equivalent zoom ratio within the group. */
    fun classifyAgain(group: List<LensInfo>) {
        if (facing == CameraMetadata.LENS_FACING_FRONT) {
            kind = LensKind.FRONT
            return
        }
        kind = when {
            nativeZoom < 0.72f -> LensKind.ULTRA_WIDE
            nativeZoom < 1.6f -> LensKind.WIDE
            nativeZoom < 4.2f -> LensKind.TELE
            else -> LensKind.TELE_LONG
        }
    }

    val maxPhotoMp: Float get() = photoSizes.maxByOrNull { it.width.toLong() * it.height }?.let {
        it.width.toFloat() * it.height / 1e6f
    } ?: 0f

    val maxFps: Int get() = fpsRanges.maxByOrNull { it.upper }?.upper ?: 30

    val bestRawSize: Size? get() = rawSizes.maxByOrNull { it.width.toLong() * it.height }

    fun supportsResolution(w: Int, h: Int): Boolean = videoSizes.any { it.width >= w && it.height >= h }
}

/** All cameras of one facing, ordered ultra-wide -> wide -> tele. */
class LensGroup(
    val facing: Int,
    val lenses: List<LensInfo>,
) {
    val reference: LensInfo get() = lenses.minByOrNull { abs(it.nativeZoom - 1f) } ?: lenses.first()
    val hasUltraWide: Boolean get() = lenses.any { it.kind == LensKind.ULTRA_WIDE }
    val hasTele: Boolean get() = lenses.any { it.kind == LensKind.TELE || it.kind == LensKind.TELE_LONG }
    val maxOpticalZoom: Float get() = lenses.maxOf { it.nativeZoom }
    val hasRaw: Boolean get() = lenses.any { it.supportsRaw }
    val hasDepth: Boolean get() = lenses.any { it.supportsDepth }
    val maxPhotoMp: Float get() = lenses.maxOf { it.maxPhotoMp }

    /**
     * Pick the best lens for a requested zoom factor: closest optical lens below
     * the target (so we never digitally zoom past a better lens).
     */
    fun lensFor(zoom: Float): LensInfo {
        val sorted = lenses.sortedBy { it.nativeZoom }
        var chosen = sorted.first()
        for (l in sorted) if (l.nativeZoom <= zoom * 1.02f) chosen = l
        // if zoom is far above the longest lens, keep the longest one
        val longest = sorted.last()
        return if (zoom > longest.nativeZoom) longest else chosen
    }

    /** Digital zoom that has to be applied on top of the chosen lens. */
    fun digitalZoomFor(zoom: Float, lens: LensInfo): Float = (zoom / lens.nativeZoom).coerceAtLeast(1f)

    /** Zoom levels offered as one-tap stops (like a real camera app). */
    fun zoomStops(): List<Pair<String, Float>> {
        val out = mutableListOf<Pair<String, Float>>()
        val sorted = lenses.sortedBy { it.nativeZoom }
        for (l in sorted) {
            val z = l.nativeZoom
            if (z >= 0.4f) out += (if (z < 1f) "0.6" else z.roundToInt().toString()) to z
        }
        val extra = listOf(2f, 3f, 5f, 10f)
        for (e in extra) if (maxOpticalZoom >= e * 0.6f) out += e.roundToInt().toString() to e
        return out.distinctBy { it.second }
    }
}

/**
 * Camera registry: enumerates every camera on the device, groups them by facing,
 * computes 35mm-equivalent focal lengths from the physical sensor size, and works
 * out the optical switch points used by the zoom dial.
 */
class CameraRegistry private constructor(
    val groups: Map<Int, LensGroup>,
    val score: Int,
    val notes: List<String>,
) {
    val backGroup: LensGroup? get() = groups[CameraMetadata.LENS_FACING_BACK]
    val frontGroup: LensGroup? get() = groups[CameraMetadata.LENS_FACING_FRONT]
    val hasLogicalMultiCamera: Boolean get() = groups.values.any { g -> g.lenses.any { it.isLogical } }

    fun group(facing: Int): LensGroup? = groups[facing]

    /** Device-dependent AI zoom ceiling: capped at 100x as the UI promises. */
    fun maxAiZoom(facing: Int, flagship: Boolean): Float {
        val g = group(facing) ?: return 1f
        val hw = g.lenses.maxOf { it.hardwareMaxZoom }
        val bonus = if (flagship) 6f else 3f
        return min(100f, max(hw, g.maxOpticalZoom) * bonus).coerceAtLeast(2f)
    }

    fun summary(): String {
        val parts = mutableListOf<String>()
        backGroup?.let { g ->
            parts += g.lenses.joinToString(" + ") { "%.1f×".format(it.nativeZoom) }
        }
        if (g2HasRaw()) parts += "RAW"
        if (backGroup?.hasDepth == true) parts += "Depth"
        return parts.joinToString(" • ")
    }

    private fun g2HasRaw(): Boolean = groups.values.any { it.hasRaw }

    companion object {
        /** Reads every camera; never throws - returns what the device exposes. */
        fun read(ctx: Context): CameraRegistry {
            val notes = mutableListOf<String>()
            val byFacing = HashMap<Int, MutableList<LensInfo>>()
            val manager = try {
                ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            } catch (t: Throwable) {
                L.e("no camera service", t); return CameraRegistry(emptyMap(), 0, listOf("No camera service"))
            }
            val ids = try { manager.cameraIdList.toList() } catch (t: Throwable) {
                L.e("camera id list failed", t); emptyList()
            }
            for (id in ids) {
                val lens = try { readLens(manager, id) } catch (t: Throwable) {
                    L.w("camera $id unsupported: ${t.message}"); null
                } ?: continue
                byFacing.getOrPut(lens.facing) { mutableListOf() }.add(lens)
            }

            val groups = HashMap<Int, LensGroup>()
            for ((facing, lenses) in byFacing) {
                // 35mm-equivalent reference = the "1x" lens if present, else the middle one
                val wide = lenses.filter { it.kind == LensKind.WIDE }
                    .minByOrNull { abs(it.equivFocal - 26f) }
                    ?: lenses.minByOrNull { abs(it.equivFocal - 26f) } ?: lenses.first()
                val refEquiv = if (wide.equivFocal > 0f) wide.equivFocal else 26f
                for (l in lenses) {
                    l.nativeZoom = if (l.equivFocal > 0f) {
                        (l.equivFocal / refEquiv).coerceIn(0.1f, 30f)
                    } else 1f
                }
                val isFront = facing == CameraMetadata.LENS_FACING_FRONT
                if (!isFront) {
                    // refine the classification with the real 35mm-equivalent focal
                    for (l in lenses) l.classifyAgain(lenses)
                }
                groups[facing] = LensGroup(facing, lenses.sortedBy { it.nativeZoom })
            }

            val back = groups[CameraMetadata.LENS_FACING_BACK]
            var score = 0
            if (back != null) {
                score += when {
                    back.maxPhotoMp >= 45f -> 8
                    back.maxPhotoMp >= 20f -> 5
                    back.maxPhotoMp >= 12f -> 3
                    else -> 1
                }
                if (back.hasRaw) score += 5
                if (back.hasUltraWide) score += 3
                if (back.hasTele) score += 3
                if (back.lenses.any { it.hardwareMaxZoom >= 20f }) score += 2
                if (back.hasDepth) score += 2
                if (back.lenses.any { it.highSpeedSizes.isNotEmpty() }) score += 2
                score = score.coerceAtMost(24)
                notes += "${"%.0f".format(back.maxPhotoMp)} MP"
                if (back.hasRaw) notes += "RAW"
                if (back.hasDepth) notes += "Depth AF"
                if (back.lenses.any { it.ois }) notes += "OIS"
                if (back.lenses.any { it.highSpeedSizes.isNotEmpty() }) notes += "High-speed"
            } else {
                notes += "No back camera"
            }
            return CameraRegistry(groups, score, notes)
        }

        private fun readLens(manager: CameraManager, id: String): LensInfo? {
            val ch = manager.getCameraCharacteristics(id)
            val facing = ch.get(CameraCharacteristics.LENS_FACING) ?: return null
            val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
            val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)

            val focal = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                ?.minOrNull() ?: 5f
            val sensor = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
            val sw = sensor?.width ?: 0f
            val sh = sensor?.height ?: 0f
            val diag = if (sw > 0 && sh > 0) hypot(sw.toDouble(), sh.toDouble()).toFloat() else 0f
            val equiv = if (diag > 0f) focal * 43.266f / diag else 0f
            val active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
                ?: Rect(0, 0, 4000, 3000)
            val pixel = ch.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
                ?: Size(active.width(), active.height())

            val af = ch.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf(0)
            val expRange = ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
                ?: Range(1000L, 100_000_000L)
            val isoRange = ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
                ?: Range(50, 3200)
            val oisModes = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
            val eisModes = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)

            val zoomRange = if (Build.VERSION.SDK_INT >= 30)
                ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) else null
            val maxDigital = ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f

            val previewSizes = (map.getOutputSizes(android.graphics.SurfaceTexture::class.java) ?: emptyArray())
                .filter { it.width <= 3840 }
            val photoSizes = (map.getOutputSizes(android.graphics.ImageFormat.JPEG) ?: emptyArray()).toList()
            val yuvSizes = (map.getOutputSizes(android.graphics.ImageFormat.YUV_420_888) ?: emptyArray()).toList()
            val rawSizes = (map.getOutputSizes(android.graphics.ImageFormat.RAW_SENSOR) ?: emptyArray()).toList()
            val depthSizes = (map.getOutputSizes(android.graphics.ImageFormat.DEPTH16) ?: emptyArray()).toList()
            val videoSizes = (map.getOutputSizes(MediaRecorder::class.java) ?: emptyArray()).toList()

            val fpsSet = linkedSetOf<Range<Int>>()
            ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.forEach { fpsSet += it }
            val hsSizes = try { map.highSpeedVideoSizes?.toList() ?: emptyList() } catch (t: Throwable) { emptyList() }
            val hsFps = try { map.highSpeedVideoFpsRanges?.toList() ?: emptyList() } catch (t: Throwable) { emptyList() }

            val physical = if (Build.VERSION.SDK_INT >= 28) {
                try { ch.physicalCameraIds.toList() } catch (t: Throwable) { emptyList() }
            } else emptyList()

            val level = ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
                ?: CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY

            val supportsRaw = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW)
            val supportsDepth = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT)
            val supportsPrivate = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_PRIVATE_REPROCESSING)
            val logical = Build.VERSION.SDK_INT >= 28 &&
                caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA)

            val minFocus = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f

            val kind = if (facing == CameraMetadata.LENS_FACING_FRONT) LensKind.FRONT
            else LensKind.of(equiv, facing, false)

            return LensInfo(
                id = id, facing = facing, kind = kind, focalMm = focal, equivFocal = equiv,
                sensorDiagonalMm = diag, sensorWidthMm = sw, sensorHeightMm = sh,
                activeArray = active, pixelArray = pixel,
                hardwareLevel = level, supportsRaw = supportsRaw, supportsDepth = supportsDepth,
                supportsPrivate = supportsPrivate, supportsMultiCamera = logical, isLogical = logical,
                physicalIds = physical,
                ois = oisModes?.contains(CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON) == true,
                eis = eisModes?.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON) == true,
                flash = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false,
                maxDigitalZoom = maxDigital, zoomRatioRange = zoomRange,
                exposureRange = expRange, isoRange = isoRange, minFocusDistance = minFocus,
                afModes = af,
                previewSizes = previewSizes.toList().sortedByDescending { it.width.toLong() * it.height },
                photoSizes = photoSizes.sortedByDescending { it.width.toLong() * it.height },
                yuvSizes = yuvSizes.sortedByDescending { it.width.toLong() * it.height },
                rawSizes = rawSizes, depthSizes = depthSizes,
                videoSizes = videoSizes.sortedByDescending { it.width.toLong() * it.height },
                fpsRanges = fpsSet.toList().sortedByDescending { it.upper },
                highSpeedSizes = hsSizes, highSpeedFps = hsFps,
                maxIsoBoost = isoRange.upper,
            )
        }
    }
}

/** Convenience: pick the preview size that best matches a view aspect. */
object SizePick {
    fun best(sizes: List<Size>, targetW: Int, targetH: Int, maxW: Int = 1920, maxH: Int = 1080): Size {
        if (sizes.isEmpty()) return Size(maxW, maxH)
        val aspect = targetW.toDouble() / max(1, targetH)
        val filtered = sizes.filter { it.width <= maxW && it.height <= maxH }
        val pool = if (filtered.isNotEmpty()) filtered else sizes
        return pool.minByOrNull { s ->
            val a = s.width.toDouble() / max(1, s.height)
            val aspectPenalty = abs(a - aspect) * 1000
            aspectPenalty + (maxW - s.width).coerceAtLeast(0) * 0.01
        } ?: pool.first()
    }

    fun largest(sizes: List<Size>, maxPixels: Long): Size? =
        sizes.filter { it.width.toLong() * it.height <= maxPixels }
            .maxByOrNull { it.width.toLong() * it.height }
            ?: sizes.minByOrNull { it.width.toLong() * it.height }
}
