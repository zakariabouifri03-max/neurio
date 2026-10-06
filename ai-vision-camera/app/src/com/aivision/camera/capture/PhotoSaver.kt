package com.aivision.camera.capture

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.DngCreator
import android.media.Image
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.aivision.camera.ai.Planes
import com.aivision.camera.core.L
import com.aivision.camera.core.Storage
import com.aivision.camera.core.Work
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

/** Result of a save: content uri (if it went to the gallery) + file + metadata. */
data class SavedMedia(
    val uri: Uri?,
    val file: File?,
    val width: Int,
    val height: Int,
    val bytes: Long,
    val isRaw: Boolean,
    val label: String,
)

/**
 * Writing photos/videos the way a real camera app does:
 *  - JPEG encoded from our processed YUV planes (camera never compresses for us)
 *  - EXIF orientation + description written so any gallery shows it correctly
 *  - files registered through MediaStore (Android 10+ scoped storage)
 *  - DNG written straight from the sensor's RAW frame when the device supports it
 */
object PhotoSaver {

    const val ALBUM = "AI Vision Camera"

    /** Encode [planes] to JPEG bytes. Quality is tier dependent, never fake. */
    fun encodeJpeg(planes: Planes, quality: Int): ByteArray {
        val nv21 = planes.toNv21()
        val yuv = YuvImage(nv21, ImageFormat.NV21, planes.w, planes.h, null)
        val out = java.io.ByteArrayOutputStream(nv21.size / 3)
        yuv.compressToJpeg(Rect(0, 0, planes.w, planes.h), quality, out)
        return out.toByteArray()
    }

    fun saveJpeg(
        ctx: Context, planes: Planes, jpegQuality: Int, orientation: Int,
        label: String, description: String, isFrontFacing: Boolean, mirror: Boolean,
    ): SavedMedia {
        val bytes = encodeJpeg(planes, jpegQuality)
        val name = "AIV_${System.currentTimeMillis()}.jpg"
        val saved = writeMedia(ctx, name, "image/jpeg", bytes, label, description, width = planes.w, height = planes.h)
        // mirror front camera selfies when the user wants the preview-faithful result
        if (mirror && isFrontFacing && saved.file != null) {
            flipJpegInPlace(saved.file)
        }
        saved.file?.let { applyExif(it, orientation, description, label) }
        return saved
    }

    fun saveBitmap(
        ctx: Context, bitmap: Bitmap, quality: Int, orientation: Int,
        label: String, description: String,
    ): SavedMedia {
        val out = java.io.ByteArrayOutputStream(bitmap.width)
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        val bytes = out.toByteArray()
        val name = "AIV_${System.currentTimeMillis()}.jpg"
        val saved = writeMedia(ctx, name, "image/jpeg", bytes, label, description, bitmap.width, bitmap.height)
        saved.file?.let { applyExif(it, orientation, description, label) }
        return saved
    }

    /**
     * RAW capture: Bayer frame straight from the sensor, wrapped as DNG with the
     * real capture metadata. This is genuine RAW support - only on devices that
     * expose a RAW stream (REQUEST_AVAILABLE_CAPABILITIES_RAW).
     */
    fun saveDng(ctx: Context, image: Image, characteristics: CameraCharacteristics,
                result: CaptureResult?, label: String): SavedMedia? {
        return try {
            val name = "AIV_${System.currentTimeMillis()}.dng"
            val file = File(Storage.appDir(ctx), name)
            if (result == null) throw IllegalStateException("RAW needs a capture result")
            FileOutputStream(file).use { fos ->
                val creator = DngCreator(characteristics, result)
                creator.setDescription(label)
                creator.setOrientation(exifOrientationValue(90))
                creator.writeImage(fos, image)
                creator.close()
            }
            val saved = registerFile(ctx, file, "image/x-adobe-dng", label, "RAW (DNG)")
            SavedMedia(saved.uri ?: Uri.fromFile(file), file, image.width, image.height,
                file.length(), true, "RAW DNG ${image.width}×${image.height}")
        } catch (t: Throwable) {
            L.w("DNG write failed: ${t.message}")
            null
        }
    }

    private fun flipJpegInPlace(file: File) {
        try {
            val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = 1 }
            val bmp = android.graphics.BitmapFactory.decodeFile(file.absolutePath, opts) ?: return
            val matrix = android.graphics.Matrix().apply { postScale(-1f, 1f) }
            val flipped = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, matrix, true)
            FileOutputStream(file).use { flipped.compress(Bitmap.CompressFormat.JPEG, 97, it) }
            if (flipped != bmp) bmp.recycle()
            flipped.recycle()
        } catch (t: Throwable) {
            L.w("mirror failed: ${t.message}")
        }
    }

    private fun applyExif(file: File, orientationDegrees: Int, description: String, label: String) {
        try {
            val exif = android.media.ExifInterface(file.absolutePath)
            exif.setAttribute(android.media.ExifInterface.TAG_ORIENTATION,
                exifOrientationValue(orientationDegrees).toString())
            exif.setAttribute(android.media.ExifInterface.TAG_IMAGE_DESCRIPTION, description)
            exif.setAttribute(android.media.ExifInterface.TAG_SOFTWARE, "AI Vision Camera")
            exif.setAttribute(android.media.ExifInterface.TAG_USER_COMMENT, label)
            exif.saveAttributes()
        } catch (t: Throwable) {
            L.w("exif write failed: ${t.message}")
        }
    }

    private fun exifOrientationValue(degrees: Int): Int = when (((degrees % 360) + 360) % 360) {
        90 -> android.media.ExifInterface.ORIENTATION_ROTATE_90
        180 -> android.media.ExifInterface.ORIENTATION_ROTATE_180
        270 -> android.media.ExifInterface.ORIENTATION_ROTATE_270
        else -> android.media.ExifInterface.ORIENTATION_NORMAL
    }

    /** Put bytes into the shared gallery (scoped storage aware). */
    private fun writeMedia(ctx: Context, name: String, mime: String, bytes: ByteArray,
                           label: String, description: String, width: Int, height: Int): SavedMedia {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DCIM}/$ALBUM")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            put(MediaStore.Images.Media.DESCRIPTION, description)
            put(MediaStore.Images.Media.TITLE, label)
        }
        val resolver = ctx.contentResolver
        var uri: Uri? = null
        try {
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (uri != null) {
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                if (Build.VERSION.SDK_INT >= 29) {
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                }
            }
        } catch (t: Throwable) {
            L.w("mediastore insert failed: ${t.message}")
        }
        // always keep an app-private copy so the in-app gallery is instant/reliable
        val file = File(Storage.appDir(ctx), name)
        try {
            FileOutputStream(file).use { it.write(bytes) }
        } catch (t: Throwable) {
            L.w("private copy failed: ${t.message}")
        }
        return SavedMedia(uri ?: Uri.fromFile(file), file, width, height, bytes.size.toLong(), false, label)
    }

    fun registerFile(ctx: Context, file: File, mime: String, title: String, description: String): SavedMedia {
        var uri: Uri? = null
        try {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                if (Build.VERSION.SDK_INT >= 29) {
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DCIM}/$ALBUM")
                }
            }
            uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            uri?.let { u ->
                ctx.contentResolver.openOutputStream(u)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            }
        } catch (t: Throwable) {
            L.w("raw register failed: ${t.message}")
        }
        MediaScannerConnection.scanFile(ctx, arrayOf(file.absolutePath), arrayOf(mime), null)
        return SavedMedia(uri, file, 0, 0, file.length(), true, description)
    }

    /** Insert a finished video into the gallery. */
    fun registerVideo(ctx: Context, file: File, width: Int, height: Int, label: String): SavedMedia {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.DURATION, 0)
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DCIM}/$ALBUM")
            }
            put(MediaStore.Video.Media.DESCRIPTION, label)
        }
        var uri: Uri? = null
        try {
            uri = ctx.contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            uri?.let { u ->
                ctx.contentResolver.openOutputStream(u)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            }
        } catch (t: Throwable) {
            L.w("video insert failed: ${t.message}")
        }
        MediaScannerConnection.scanFile(ctx, arrayOf(file.absolutePath), arrayOf("video/mp4"), null)
        return SavedMedia(uri, file, width, height, file.length(), false, label)
    }

    fun videoFile(ctx: Context, suffix: String): File {
        val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "AIVision")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "AIV_${System.currentTimeMillis()}_$suffix.mp4")
    }

    fun saveToGalleryCopy(ctx: Context, source: File, mime: String, title: String,
                         onDone: (Uri?) -> Unit = {}) {
        Work.io.execute {
            val result = registerFile(ctx, source, mime, title, title)
            onDone(result.uri)
        }
    }

    /** Decode a file with a pixel budget (thumbnails, editors). */
    fun decode(file: File, maxPixels: Int = 12_000_000): Bitmap? {
        return try {
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeFile(file.absolutePath, bounds)
            val sample = com.aivision.camera.core.Img.sampleSize(bounds.outWidth, bounds.outHeight, maxPixels)
            val opts = android.graphics.BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            android.graphics.BitmapFactory.decodeFile(file.absolutePath, opts)
        } catch (t: Throwable) {
            L.w("decode failed: ${t.message}")
            null
        }
    }

    fun savePlanesFromStream(out: OutputStream, planes: Planes, quality: Int) {
        out.use { it.write(encodeJpeg(planes, quality)) }
    }
}
