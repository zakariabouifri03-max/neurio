package com.neurio.lanstream.client

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import com.neurio.lanstream.input.InputTransport
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.hypot
import kotlin.math.min

/** Configurable local overlay; controls are translated to normalized host-screen touch events. */
class GamepadOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private enum class Kind { FREE_TOUCH, JOYSTICK, BUTTON }
    private data class Zone(val name: String, val x: Float, val y: Float, val radius: Float, val anchorX: Float, val anchorY: Float)
    private data class Press(val remoteId: Int, val kind: Kind, val anchorX: Float, val anchorY: Float, var x: Float, var y: Float)

    @Volatile private var input: InputTransport? = null
    @Volatile private var visible = true
    @Volatile private var leftHanded = false
    @Volatile private var buttonScale = 1f
    @Volatile private var aspect = 16f / 9f
    private val presses = ConcurrentHashMap<Int, Press>()
    private val rect = RectF()
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
    }

    init {
        isClickable = true
        setLayerType(View.LAYER_TYPE_HARDWARE, null)
    }

    fun setInputTransport(transport: InputTransport?) { input = transport }
    fun setControlsVisible(value: Boolean) { visible = value; invalidate() }
    fun controlsVisible(): Boolean = visible
    fun setLeftHanded(value: Boolean) { leftHanded = value; invalidate() }
    fun setButtonScale(value: Float) { buttonScale = value.coerceIn(.78f, 1.28f); invalidate() }
    fun setVideoAspect(width: Int, height: Int) {
        if (width > 0 && height > 0) {
            aspect = width.toFloat() / height.toFloat()
            invalidate()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        updateVideoRect()
        if (!visible) {
            fill.color = 0x880A1424.toInt()
            canvas.drawRoundRect(width - dp(60f), dp(16f), width - dp(16f), dp(56f), dp(18f), dp(18f), fill)
            label.textSize = dp(16f)
            canvas.drawText("◉", width - dp(38f), dp(42f), label)
            return
        }
        val shortSide = min(rect.width(), rect.height())
        val joystick = zone("STICK", .16f, .78f, .115f * shortSide, .16f, .78f)
        drawJoystick(canvas, joystick, shortSide)

        val dpad = listOf(
            zone("↑", .16f, .56f, .038f * shortSide, .16f, .69f),
            zone("↓", .16f, .65f, .038f * shortSide, .16f, .87f),
            zone("←", .11f, .605f, .038f * shortSide, .08f, .78f),
            zone("→", .21f, .605f, .038f * shortSide, .24f, .78f),
        )
        dpad.forEach { drawButton(canvas, it, shortSide, 0x9968D7FF.toInt()) }

        listOf(
            zone("A", .86f, .78f, .055f * shortSide, .86f, .78f),
            zone("B", .95f, .65f, .055f * shortSide, .95f, .65f),
            zone("X", .77f, .65f, .055f * shortSide, .77f, .65f),
            zone("Y", .86f, .52f, .055f * shortSide, .86f, .52f),
        ).forEach { drawButton(canvas, it, shortSide, 0x99A885FF.toInt()) }
        listOf(
            zone("L1", .13f, .14f, .042f * shortSide, .13f, .14f),
            zone("R1", .87f, .14f, .042f * shortSide, .87f, .14f),
            zone("L2", .13f, .24f, .042f * shortSide, .13f, .24f),
            zone("R2", .87f, .24f, .042f * shortSide, .87f, .24f),
        ).forEach { drawButton(canvas, it, shortSide, 0x994CE6C8.toInt()) }
        drawButton(canvas, zone("SEL", .45f, .91f, .045f * shortSide, .45f, .91f), shortSide, 0x883A5671.toInt())
        drawButton(canvas, zone("START", .56f, .91f, .045f * shortSide, .56f, .91f), shortSide, 0x883A5671.toInt())

        fill.color = 0x99202D42.toInt()
        canvas.drawRoundRect(width - dp(126f), dp(14f), width - dp(14f), dp(50f), dp(18f), dp(18f), fill)
        label.textSize = dp(11f)
        label.color = Color.rgb(193, 212, 234)
        canvas.drawText("CONTROLS  ·  TAP TO HIDE", width - dp(70f), dp(37f), label)
        label.color = Color.WHITE
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val transport = input
        if (event.actionMasked == MotionEvent.ACTION_DOWN && !visible) {
            visible = true
            invalidate()
            performClick()
            return true
        }
        updateVideoRect()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val index = event.actionIndex
                val x = event.getX(index)
                val y = event.getY(index)
                val pointer = event.getPointerId(index)
                if (visible && x >= width - dp(142f) && y <= dp(64f)) {
                    visible = false
                    releaseAll(transport)
                    invalidate()
                    performClick()
                    return true
                }
                val hit = if (visible) hitZone(x, y) else null
                val mapped = if (hit == null) normalized(x, y) else if (hit.name == "STICK") normalized(x, y, mirrorHanded = true) else hit.anchorX to hit.anchorY
                val kind = when {
                    hit == null -> Kind.FREE_TOUCH
                    hit.name == "STICK" -> Kind.JOYSTICK
                    else -> Kind.BUTTON
                }
                presses[pointer] = Press(pointer, kind, mapped.first, mapped.second, x, y)
                transport?.sendPointer(com.neurio.lanstream.input.RemoteInputType.POINTER_DOWN, pointer, mapped.first, mapped.second, SystemClock.elapsedRealtimeNanos())
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                for (index in 0 until event.pointerCount) {
                    val id = event.getPointerId(index)
                    val press = presses[id] ?: continue
                    val x = event.getX(index)
                    val y = event.getY(index)
                    press.x = x
                    press.y = y
                    if (press.kind != Kind.BUTTON) {
                        val mapped = normalized(x, y, mirrorHanded = press.kind == Kind.JOYSTICK)
                        transport?.sendPointer(com.neurio.lanstream.input.RemoteInputType.POINTER_MOVE, press.remoteId, mapped.first, mapped.second, SystemClock.elapsedRealtimeNanos())
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val index = event.actionIndex
                val id = event.getPointerId(index)
                val press = presses.remove(id)
                if (press != null) {
                    val x = event.getX(index)
                    val y = event.getY(index)
                    val point = if (press.kind == Kind.BUTTON) press.anchorX to press.anchorY else normalized(x, y, mirrorHanded = press.kind == Kind.JOYSTICK)
                    transport?.sendPointer(com.neurio.lanstream.input.RemoteInputType.POINTER_UP, press.remoteId, point.first, point.second, SystemClock.elapsedRealtimeNanos())
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                releaseAll(transport)
                invalidate()
                return true
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun releaseAll(transport: InputTransport?) {
        presses.values.forEach { press ->
            transport?.sendPointer(com.neurio.lanstream.input.RemoteInputType.POINTER_UP, press.remoteId, press.anchorX, press.anchorY, SystemClock.elapsedRealtimeNanos())
        }
        presses.clear()
    }

    private fun updateVideoRect() {
        val safeAspect = aspect.coerceIn(.35f, 3f)
        if (width == 0 || height == 0) return
        val viewAspect = width.toFloat() / height.toFloat()
        if (viewAspect > safeAspect) {
            val contentWidth = height * safeAspect
            val left = (width - contentWidth) * .5f
            rect.set(left, 0f, left + contentWidth, height.toFloat())
        } else {
            val contentHeight = width / safeAspect
            val top = (height - contentHeight) * .5f
            rect.set(0f, top, width.toFloat(), top + contentHeight)
        }
    }

    private fun normalized(x: Float, y: Float, mirrorHanded: Boolean = false): Pair<Float, Float> {
        val localX = ((x - rect.left) / rect.width().coerceAtLeast(1f)).coerceIn(0f, 1f)
        val mappedX = if (mirrorHanded) mirror(localX) else localX
        return mappedX to ((y - rect.top) / rect.height().coerceAtLeast(1f)).coerceIn(0f, 1f)
    }

    private fun hitZone(x: Float, y: Float): Zone? {
        val shortSide = min(rect.width(), rect.height())
        val zones = mutableListOf(
            zone("STICK", .16f, .78f, .14f * shortSide, .16f, .78f),
            zone("↑", .16f, .56f, .048f * shortSide, .16f, .69f),
            zone("↓", .16f, .65f, .048f * shortSide, .16f, .87f),
            zone("←", .11f, .605f, .048f * shortSide, .08f, .78f),
            zone("→", .21f, .605f, .048f * shortSide, .24f, .78f),
            zone("A", .86f, .78f, .063f * shortSide, .86f, .78f),
            zone("B", .95f, .65f, .063f * shortSide, .95f, .65f),
            zone("X", .77f, .65f, .063f * shortSide, .77f, .65f),
            zone("Y", .86f, .52f, .063f * shortSide, .86f, .52f),
            zone("L1", .13f, .14f, .052f * shortSide, .13f, .14f),
            zone("R1", .87f, .14f, .052f * shortSide, .87f, .14f),
            zone("L2", .13f, .24f, .052f * shortSide, .13f, .24f),
            zone("R2", .87f, .24f, .052f * shortSide, .87f, .24f),
            zone("SEL", .45f, .91f, .052f * shortSide, .45f, .91f),
            zone("START", .56f, .91f, .052f * shortSide, .56f, .91f),
        )
        val localX = x - rect.left
        val localY = y - rect.top
        return zones.asSequence().map { it to hypot(localX - it.x * rect.width(), localY - it.y * rect.height()) }
            .filter { it.second <= it.first.radius }
            .minByOrNull { it.second }?.first
    }

    private fun zone(name: String, x: Float, y: Float, radius: Float, anchorX: Float, anchorY: Float): Zone {
        val displayX = if (leftHanded) 1f - x else x
        return Zone(name, displayX * rect.width(), y * rect.height(), radius * buttonScale, if (leftHanded) 1f - anchorX else anchorX, anchorY)
    }

    private fun drawJoystick(canvas: Canvas, zone: Zone, shortSide: Float) {
        val cx = rect.left + zone.x
        val cy = rect.top + zone.y
        fill.color = 0x554CE6C8
        canvas.drawCircle(cx, cy, zone.radius, fill)
        stroke.color = 0xBB65F0D0.toInt()
        stroke.style = Paint.Style.STROKE
        stroke.strokeWidth = dp(2f)
        canvas.drawCircle(cx, cy, zone.radius, stroke)
        stroke.style = Paint.Style.FILL
        val active = presses.values.firstOrNull { it.kind == Kind.JOYSTICK }
        val thumbX = active?.x ?: cx
        val thumbY = active?.y ?: cy
        fill.color = 0xCCB7FFF0.toInt()
        canvas.drawCircle(thumbX, thumbY, zone.radius * .35f, fill)
        label.textSize = dp(10f)
        label.color = 0xFFE0FFF8.toInt()
        canvas.drawText("MOVE", cx, cy + zone.radius + dp(15f), label)
        label.color = Color.WHITE
    }

    private fun drawButton(canvas: Canvas, zone: Zone, shortSide: Float, color: Int) {
        val cx = rect.left + zone.x
        val cy = rect.top + zone.y
        val isPressed = presses.values.any { it.kind == Kind.BUTTON && it.anchorX == zone.anchorX && it.anchorY == zone.anchorY }
        fill.color = if (isPressed) color or 0x33000000 else color
        canvas.drawCircle(cx, cy, zone.radius, fill)
        stroke.color = 0xCCFFFFFF.toInt()
        stroke.style = Paint.Style.STROKE
        stroke.strokeWidth = dp(1.2f)
        canvas.drawCircle(cx, cy, zone.radius, stroke)
        stroke.style = Paint.Style.FILL
        label.textSize = if (zone.name.length > 2) dp(9f) else dp(14f)
        canvas.drawText(zone.name, cx, cy + label.textSize * .36f, label)
    }

    private fun mirror(value: Float): Float = if (leftHanded) 1f - value else value
    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
