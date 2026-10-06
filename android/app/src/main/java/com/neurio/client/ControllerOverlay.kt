package com.neurio.client

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import com.neurio.common.AppLog
import com.neurio.common.Protocol
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.hypot

/**
 * On-screen controller: joystick, ABXY cluster, d-pad, shoulders, triggers,
 * start/select. Widgets are placed with normalized coordinates so a layout
 * works in any resolution, and the user can drag every widget in edit mode.
 * Layouts persist as JSON (see PrefsStore).
 */
class ControllerOverlay @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    companion object {
        private const val TAG = "ControllerOverlay"

        const val W_JOYSTICK = "joystick"
        const val W_BUTTONS = "buttons"
        const val W_DPAD = "dpad"
        const val W_L1 = "l1"
        const val W_R1 = "r1"
        const val W_L2 = "l2"
        const val W_R2 = "r2"
        const val W_START = "start"
        const val W_SELECT = "select"

        fun defaultSpecs(): List<WidgetSpec> = listOf(
            WidgetSpec(W_JOYSTICK, 0.16f, 0.72f, 170f),
            WidgetSpec(W_BUTTONS, 0.84f, 0.68f, 170f),
            WidgetSpec(W_DPAD, 0.16f, 0.34f, 120f),
            WidgetSpec(W_L1, 0.08f, 0.08f, 74f),
            WidgetSpec(W_R1, 0.92f, 0.08f, 74f),
            WidgetSpec(W_L2, 0.22f, 0.08f, 74f),
            WidgetSpec(W_R2, 0.78f, 0.08f, 74f),
            WidgetSpec(W_START, 0.56f, 0.06f, 64f),
            WidgetSpec(W_SELECT, 0.44f, 0.06f, 64f)
        )
    }

    data class WidgetSpec(val id: String, var nx: Float, var ny: Float, var sizeDp: Float)

    /** Edit mode: widgets become draggable, grid shows. */
    var editMode: Boolean = false
        set(value) {
            field = value
            invalidate()
        }

    var globalScale: Float = 1f

    var onAxis: ((axisId: Int, x: Float, y: Float) -> Unit)? = null
    var onButton: ((buttonId: Int, pressed: Boolean) -> Unit)? = null

    private val specs = LinkedHashMap<String, WidgetSpec>()
    private val wrappers = HashMap<String, View>()

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f
        color = Color.argb(70, 120, 140, 190)
    }

    private val density: Float get() = resources.displayMetrics.density

    // ------------------------------------------------------------------ build

    fun build(specList: List<WidgetSpec>) {
        removeAllViews()
        wrappers.clear()
        specs.clear()
        for (spec in specList) {
            specs[spec.id] = spec
            val view = createWidget(spec)
            val wrapper = FrameLayout(context).apply {
                addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            }
            applyLayout(wrapper, spec)
            wrappers[spec.id] = wrapper
            addView(wrapper)
        }
    }

    private fun createWidget(spec: WidgetSpec): View {
        return when (spec.id) {
            W_JOYSTICK -> JoystickView(context).also { js ->
                js.onVector = { x, y, active ->
                    if (active || hypot(x, y) == 0f) {
                        onAxis?.invoke(Protocol.AXIS_JOYSTICK, x, y)
                    } else {
                        onAxis?.invoke(Protocol.AXIS_JOYSTICK, 0f, 0f)
                    }
                }
            }
            W_BUTTONS -> ButtonClusterView(context).also { cluster ->
                cluster.onButton = { id, pressed -> onButton?.invoke(id, pressed) }
            }
            W_DPAD -> DpadView(context).also { dpad ->
                dpad.onButton = { id, pressed -> onButton?.invoke(id, pressed) }
            }
            W_L1 -> makeRoundButton("L1", Protocol.BTN_L1)
            W_R1 -> makeRoundButton("R1", Protocol.BTN_R1)
            W_L2 -> makeRoundButton("L2", Protocol.BTN_L2)
            W_R2 -> makeRoundButton("R2", Protocol.BTN_R2)
            W_START -> makeRoundButton("≡", Protocol.BTN_START)
            W_SELECT -> makeRoundButton("…", Protocol.BTN_SELECT)
            else -> View(context)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun makeRoundButton(label: String, buttonId: Int): View {
        val tv = TextView(context)
        tv.text = label
        tv.gravity = Gravity.CENTER
        tv.setTextColor(Color.argb(235, 234, 239, 248))
        tv.textSize = 15f
        tv.background = resources.getDrawable(com.neurio.R.drawable.bg_widget_button, null)
        tv.setOnTouchListener { v, ev ->
            if (editMode) return@setOnTouchListener false
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    v.isPressed = true
                    onButton?.invoke(buttonId, true)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.isPressed = false
                    onButton?.invoke(buttonId, false)
                }
            }
            true
        }
        return tv
    }

    private fun applyLayout(wrapper: View, spec: WidgetSpec) {
        val w = width
        val h = height
        if (w == 0 || h == 0) return
        val sizePx = (spec.sizeDp * globalScale * density).toInt().coerceAtLeast(24)
        val lp = LayoutParams(sizePx, sizePx)
        lp.leftMargin = (spec.nx * w - sizePx / 2f).toInt().coerceIn(0, w - sizePx)
        lp.topMargin = (spec.ny * h - sizePx / 2f).toInt().coerceIn(0, h - sizePx)
        wrapper.layoutParams = lp
    }

    /** Re-apply positions (after layout pass or scale change). */
    fun relayout() {
        for ((id, spec) in specs) {
            wrappers[id]?.let { applyLayout(it, spec) }
        }
    }

    fun resizeAll(deltaScale: Float) {
        globalScale = (globalScale + deltaScale).coerceIn(0.55f, 2.2f)
        post { relayout() }
    }

    // ------------------------------------------------------------ drag (edit)

    @SuppressLint("ClickableViewAccessibility")
    fun enableDragging() {
        for ((id, wrapper) in wrappers) {
            wrapper.setOnTouchListener(object : OnTouchListener {
                private var startTouchX = 0f
                private var startTouchY = 0f
                private var startNx = 0f
                private var startNy = 0f
                private var dragging = false

                override fun onTouch(v: View, event: MotionEvent): Boolean {
                    if (!editMode) return false
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> {
                            startTouchX = event.rawX
                            startTouchY = event.rawY
                            val spec = specs[id] ?: return false
                            startNx = spec.nx
                            startNy = spec.ny
                            dragging = true
                            return true
                        }
                        MotionEvent.ACTION_MOVE -> {
                            if (!dragging) return false
                            val spec = specs[id] ?: return false
                            val w = this@ControllerOverlay.width.coerceAtLeast(1)
                            val h = this@ControllerOverlay.height.coerceAtLeast(1)
                            spec.nx = (startNx + (event.rawX - startTouchX) / w).coerceIn(0.03f, 0.97f)
                            spec.ny = (startNy + (event.rawY - startTouchY) / h).coerceIn(0.03f, 0.97f)
                            applyLayout(v, spec)
                            return true
                        }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                            dragging = false
                            onLayoutEdited?.invoke()
                            return true
                        }
                    }
                    return false
                }
            })
        }
    }

    var onLayoutEdited: (() -> Unit)? = null

    // ----------------------------------------------------------- persistence

    fun saveJson(): String {
        val root = JSONObject()
        root.put("scale", globalScale.toDouble())
        val arr = JSONArray()
        for ((id, spec) in specs) {
            val o = JSONObject()
            o.put("id", id)
            o.put("nx", spec.nx.toDouble())
            o.put("ny", spec.ny.toDouble())
            o.put("size", spec.sizeDp.toDouble())
            arr.put(o)
        }
        root.put("widgets", arr)
        return root.toString()
    }

    fun applySavedJson(json: String?) {
        val defaults = defaultSpecs()
        if (json.isNullOrBlank()) {
            build(defaults)
            return
        }
        try {
            val root = JSONObject(json)
            globalScale = root.optDouble("scale", 1.0).toFloat().coerceIn(0.55f, 2.2f)
            val byId = defaults.associateBy { it.id }.toMutableMap()
            val arr = root.optJSONArray("widgets") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val spec = byId[o.optString("id")] ?: continue
                spec.nx = o.optDouble("nx", spec.nx.toDouble()).toFloat()
                spec.ny = o.optDouble("ny", spec.ny.toDouble()).toFloat()
                spec.sizeDp = o.optDouble("size", spec.sizeDp.toDouble()).toFloat()
            }
            build(byId.values.toList())
        } catch (e: Exception) {
            AppLog.w(TAG, "layout json invalid, using defaults", e)
            build(defaults)
        }
    }

    // --------------------------------------------------------------- drawing

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (wrappers.isEmpty()) {
            build(defaultSpecs())
            enableDragging()
        } else {
            relayout()
        }
    }

    override fun dispatchDraw(canvas: Canvas) {
        if (editMode && width > 0 && height > 0) {
            val step = width / 10f
            var x = step
            while (x < width) {
                canvas.drawLine(x, 0f, x, height.toFloat(), gridPaint)
                x += step
            }
            val stepY = height / 10f
            var y = stepY
            while (y < height) {
                canvas.drawLine(0f, y, width.toFloat(), y, gridPaint)
                y += stepY
            }
        }
        super.dispatchDraw(canvas)
    }
}
