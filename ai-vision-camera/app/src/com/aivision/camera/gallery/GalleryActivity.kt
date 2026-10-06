package com.aivision.camera.gallery

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.GridView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.aivision.camera.core.Storage
import com.aivision.camera.core.Ui
import com.aivision.camera.core.Work
import com.aivision.camera.ui.Theme

/**
 * The built-in pro gallery: every shot the app produced (including AI Ultra
 * results, RAW files and video), newest first, with delete + one tap to the
 * viewer where the before/after comparison lives.
 */
class GalleryActivity : Activity() {

    private lateinit var grid: GridView
    private lateinit var adapter: MediaAdapter
    private lateinit var emptyLabel: TextView
    private var items: List<MediaItem> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Theme.bg) }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(this@GalleryActivity, 16f), Ui.dp(this@GalleryActivity, 26f),
                Ui.dp(this@GalleryActivity, 16f), Ui.dp(this@GalleryActivity, 10f))
        }
        header.addView(Theme.text(this, "Gallery", 20f, Color.WHITE, bold = true))
        val spacer = View(this)
        header.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))
        val countLabel = Theme.label(this, "0 items", Theme.textSecondary)
        header.addView(countLabel)
        root.addView(header, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 76f), Gravity.TOP))

        // simple segmented control: All / Photos / Videos / AI Ultra
        val filterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(this@GalleryActivity, 14f), 0, Ui.dp(this@GalleryActivity, 14f), 0)
        }
        val filters = listOf("All", "Photos", "Videos", "AI Ultra")
        for (name in filters) {
            val chip = TextView(this).apply {
                text = "  $name  "
                textSize = 12f
                setTextColor(Color.WHITE)
                background = Theme.pill(this@GalleryActivity, Theme.withAlpha(Theme.surface, 220))
                setPadding(Ui.dp(this@GalleryActivity, 8f), Ui.dp(this@GalleryActivity, 6f),
                    Ui.dp(this@GalleryActivity, 8f), Ui.dp(this@GalleryActivity, 6f))
                setOnClickListener { applyFilter(name, countLabel) }
            }
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 34f))
            lp.marginEnd = Ui.dp(this, 6f)
            filterRow.addView(chip, lp)
        }
        root.addView(filterRow, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 44f), Gravity.TOP).apply {
            topMargin = Ui.dp(this@GalleryActivity, 76f)
        })

        grid = GridView(this).apply {
            numColumns = 3
            horizontalSpacing = Ui.dp(this@GalleryActivity, 4f)
            verticalSpacing = Ui.dp(this@GalleryActivity, 4f)
            setPadding(Ui.dp(this@GalleryActivity, 4f), Ui.dp(this@GalleryActivity, 4f),
                Ui.dp(this@GalleryActivity, 4f), Ui.dp(this@GalleryActivity, 90f))
            setBackgroundColor(Theme.bg)
        }
        adapter = MediaAdapter()
        grid.adapter = adapter
        grid.setOnItemClickListener { _, _, position, _ ->
            val item = items.getOrNull(position) ?: return@setOnItemClickListener
            startActivity(Intent(this, ViewerActivity::class.java).apply {
                putExtra(ViewerActivity.EXTRA_URI, item.uri.toString())
                putExtra(ViewerActivity.EXTRA_PATH, item.file?.absolutePath)
                putExtra(ViewerActivity.EXTRA_VIDEO, item.isVideo)
                putExtra(ViewerActivity.EXTRA_NAME, item.name)
            })
        }
        grid.setOnItemLongClickListener { _, _, position, _ ->
            confirmDelete(items.getOrNull(position) ?: return@setOnItemLongClickListener true)
            true
        }
        root.addView(grid, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        emptyLabel = Theme.text(this, "No shots yet - open the camera and press the shutter",
            13f, Theme.textSecondary)
        root.addView(emptyLabel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER))

        setContentView(root)
        leafCountLabel = countLabel
        load()
    }

    private var leafCountLabel: TextView? = null
    private var activeFilter = "All"

    private fun applyFilter(name: String, label: TextView) {
        activeFilter = name
        load()
        label.text = "${items.size} items"
    }

    private fun load() {
        Work.io.execute {
            val all = MediaRepo.listItems(this)
            val filtered = when (activeFilter) {
                "Photos" -> all.filter { !it.isVideo }
                "Videos" -> all.filter { it.isVideo }
                "AI Ultra" -> all.filter { it.name.contains("ULTRA", true) || it.width >= 5000 }
                else -> all
            }
            runOnUiThread {
                items = filtered
                adapter.notifyDataSetChanged()
                leafCountLabel?.text = "${items.size} items"
                emptyLabel.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
            }
        }
    }

    private fun confirmDelete(item: MediaItem) {
        AlertDialog.Builder(this)
            .setTitle("Delete ${item.name}?")
            .setMessage("This removes the file from your device.")
            .setPositiveButton("Delete") { _, _ ->
                Work.io.execute {
                    val ok = MediaRepo.delete(this, item)
                    runOnUiThread {
                        toast(if (ok) "Deleted" else "Delete failed")
                        load()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    override fun onResume() { super.onResume(); load() }

    private inner class MediaAdapter : BaseAdapter() {
        private val cache = HashMap<String, Bitmap?>()

        override fun getCount() = items.size
        override fun getItem(position: Int) = items.getOrNull(position)
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val holder: Holder
            val view: View
            if (convertView is FrameLayout) {
                view = convertView
                holder = view.tag as Holder
            } else {
                view = FrameLayout(this@GalleryActivity)
                val image = ImageView(this@GalleryActivity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundColor(Theme.surfaceHigh)
                }
                val badge = TextView(this@GalleryActivity).apply {
                    textSize = 9f
                    setTextColor(Color.WHITE)
                    background = Theme.pill(this@GalleryActivity, Theme.withAlpha(Theme.accentDim, 220))
                    setPadding(Ui.dp(this@GalleryActivity, 6f), Ui.dp(this@GalleryActivity, 2f),
                        Ui.dp(this@GalleryActivity, 6f), Ui.dp(this@GalleryActivity, 2f))
                }
                view.addView(image, FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                view.addView(badge, FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM or Gravity.START).apply {
                    leftMargin = Ui.dp(this@GalleryActivity, 6f)
                    bottomMargin = Ui.dp(this@GalleryActivity, 6f)
                })
                holder = Holder(image, badge)
                view.tag = holder
            }
            val item = items[position]
            val cell = resources.displayMetrics.widthPixels / 3
            holder.badge.text = item.badge + if (item.isVideo) " • video" else ""
            val cached = cache[item.uri.toString()]
            if (cached != null) {
                holder.image.setImageBitmap(cached)
            } else {
                holder.image.setImageBitmap(null)
                Work.io.execute {
                    val bmp = MediaRepo.thumbnail(this@GalleryActivity, item, cell)
                    cache[item.uri.toString()] = bmp
                    runOnUiThread {
                        if (gridPositionStillValid(position, item)) holder.image.setImageBitmap(bmp)
                    }
                }
            }
            if (item.sizeBytes > 0) {
                holder.badge.text = "${item.badge} • ${Storage.humanSize(item.sizeBytes)}"
            }
            return view
        }

        private fun gridPositionStillValid(position: Int, item: MediaItem): Boolean =
            items.getOrNull(position)?.uri == item.uri
    }

    private data class Holder(val image: ImageView, val badge: TextView)
}
