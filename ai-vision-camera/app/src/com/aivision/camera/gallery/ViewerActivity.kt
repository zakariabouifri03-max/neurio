package com.aivision.camera.gallery

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import com.aivision.camera.core.Storage
import com.aivision.camera.core.Ui
import com.aivision.camera.core.Work
import com.aivision.camera.ui.Theme
import com.aivision.camera.ui.CompareSlider

/**
 * Full-screen viewer: pinch/double-tap photo review, the AI before/after slider
 * when the original sidecar exists, in-place video playback, share and delete.
 */
class ViewerActivity : Activity() {

    companion object {
        const val EXTRA_URI = "uri"
        const val EXTRA_PATH = "path"
        const val EXTRA_VIDEO = "video"
        const val EXTRA_NAME = "name"
    }

    private lateinit var stage: FrameLayout
    private lateinit var image: ImageView
    private lateinit var compare: CompareSlider
    private lateinit var video: VideoView
    private lateinit var info: TextView
    private var item: MediaItem? = null
    private var showingCompare = false
    private var before: Bitmap? = null
    private var after: Bitmap? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val name = intent.getStringExtra(EXTRA_NAME) ?: "item"
        val path = intent.getStringExtra(EXTRA_PATH)
        val uri = Uri.parse(intent.getStringExtra(EXTRA_URI) ?: Uri.EMPTY.toString())
        val isVideo = intent.getBooleanExtra(EXTRA_VIDEO, false)
        item = MediaItem(uri, path?.let { java.io.File(it) }, name, isVideo,
            name.endsWith(".dng", true), 0L, 0L, 0, 0)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        stage = FrameLayout(this)
        image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setOnClickListener { toggleZoom() }
        }
        stage.addView(image, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        video = VideoView(this).apply { visibility = View.GONE }
        stage.addView(video, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER))
        compare = CompareSlider(this).apply { visibility = View.GONE }
        stage.addView(compare, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(stage, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // top bar
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(this@ViewerActivity, 12f), Ui.dp(this@ViewerActivity, 26f),
                Ui.dp(this@ViewerActivity, 12f), Ui.dp(this@ViewerActivity, 8f))
        }
        top.addView(actionButton("Close") { finish() })
        top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        info = Theme.label(this, "", Theme.textSecondary)
        top.addView(info)
        top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        top.addView(actionButton("Share") { share() })
        root.addView(top, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 74f), Gravity.TOP))

        // bottom bar
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(Ui.dp(this@ViewerActivity, 12f), Ui.dp(this@ViewerActivity, 8f),
                Ui.dp(this@ViewerActivity, 12f), Ui.dp(this@ViewerActivity, 26f))
        }
        bottom.addView(actionButton("BEFORE / AFTER") { toggleCompare() })
        bottom.addView(actionButton("Delete") { confirmDelete() })
        root.addView(bottom, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 82f), Gravity.BOTTOM))

        setContentView(root)
        load(uri, path, isVideo)
    }

    private fun actionButton(label: String, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = "  $label  "
            textSize = 12f
            setTextColor(Color.WHITE)
            background = Theme.pill(this@ViewerActivity, Theme.withAlpha(Theme.surface, 230))
            setPadding(Ui.dp(this@ViewerActivity, 10f), Ui.dp(this@ViewerActivity, 8f),
                Ui.dp(this@ViewerActivity, 10f), Ui.dp(this@ViewerActivity, 8f))
            setOnClickListener { onClick() }
        }.also {
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 38f))
            lp.marginEnd = Ui.dp(this, 8f)
            it.layoutParams = lp
        }

    private fun load(uri: Uri, path: String?, isVideo: Boolean) {
        val media = item ?: return
        info.text = media.name
        if (isVideo) {
            image.visibility = View.GONE
            compare.visibility = View.GONE
            video.visibility = View.VISIBLE
            try {
                video.setVideoURI(uri)
                video.setOnPreparedListener { it.isLooping = true; video.start() }
                video.setMediaController(android.widget.MediaController(this))
            } catch (t: Throwable) {
                toast("Cannot play: ${t.message}")
            }
            return
        }
        Work.io.execute {
            val full = MediaRepo.decodeFull(this, media, 30_000_000)
            val original = media.originalFile()?.let { file ->
                android.graphics.BitmapFactory.decodeFile(file.absolutePath,
                    android.graphics.BitmapFactory.Options().apply { inSampleSize = 2 })
            }
            runOnUiThread {
                if (full == null) {
                    toast("Could not decode image")
                    return@runOnUiThread
                }
                image.setImageBitmap(full)
                after = full
                before = original
                compare.visibility = View.GONE
                info.text = "${media.name}  ${full.width}×${full.height}"
            }
        }
    }

    private var zoomed = false

    private fun toggleZoom() {
        zoomed = !zoomed
        image.scaleType = if (zoomed) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
    }

    private fun toggleCompare() {
        val b = before
        val a = after
        if (b == null || a == null) {
            toast("No original sidecar stored with this shot")
            return
        }
        showingCompare = !showingCompare
        if (showingCompare) {
            compare.setBitmaps(b, a)
            compare.visibility = View.VISIBLE
            image.visibility = View.GONE
            info.text = "Before / after AI"
        } else {
            compare.visibility = View.GONE
            image.visibility = View.VISIBLE
            info.text = "${item?.name ?: ""}  ${a.width}×${a.height}"
        }
    }

    private fun share() {
        val media = item ?: return
        try {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = if (media.isVideo) "video/mp4" else "image/jpeg"
                putExtra(Intent.EXTRA_STREAM, media.uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "Share with"))
        } catch (t: Throwable) {
            toast("Share failed: ${t.message}")
        }
    }

    private fun confirmDelete() {
        AlertDialog.Builder(this)
            .setTitle("Delete this item?")
            .setPositiveButton("Delete") { _, _ ->
                val media = item ?: return@setPositiveButton
                Work.io.execute {
                    val ok = MediaRepo.delete(this, media)
                    runOnUiThread {
                        toast(if (ok) "Deleted" else "Delete failed")
                        if (ok) finish()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    override fun onPause() { super.onPause(); runCatching { video.pause() } }
    override fun onDestroy() {
        runCatching { after?.recycle(); before?.recycle() }
        super.onDestroy()
    }
}
