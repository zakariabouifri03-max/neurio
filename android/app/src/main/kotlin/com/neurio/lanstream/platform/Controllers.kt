package com.neurio.lanstream.platform

import android.content.Context
import android.view.Surface
import androidx.core.content.ContextCompat
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.discovery.HostEndpoint
import com.neurio.lanstream.games.GameApp
import com.neurio.lanstream.input.InputEvent
import com.neurio.lanstream.input.TouchAction

/**
 * UI-facing facade for HOST mode.
 *
 * The heavy lifting happens in [HostStreamService]; this object only knows how
 * to start/stop it and how to ask it for a fresh pairing code.
 */
object HostController {

    @Volatile
    private var service: HostStreamService? = null

    fun attach(service: HostStreamService?) {
        this.service = service
    }

    fun isRunning(): Boolean = service != null

    fun start(context: Context, resultCode: Int, data: android.content.Intent, game: GameApp?) {
        val intent = HostStreamService.startIntent(context, resultCode, data, game)
        runCatching {
            ContextCompat.startForegroundService(context, intent)
        }.onFailure { Log.e("Cannot start host service: ${it.message}") }
    }

    fun stop(context: Context) {
        runCatching { context.startService(HostStreamService.stopIntent(context)) }
            .onFailure { Log.w("Cannot stop host service: ${it.message}") }
    }

    fun rotateCode(): String? = service?.rotateCode()
}

/** UI-facing facade for CLIENT mode. */
object ClientController {

    @Volatile
    private var service: ClientSessionService? = null

    /** Latest gamepad button mask, merged with the motion-event state. */
    @Volatile
    private var keyMask: Int = 0

    fun attach(service: ClientSessionService?) {
        this.service = service
    }

    fun isStreaming(): Boolean = service != null

    fun connect(context: Context, endpoint: HostEndpoint, code: String) {
        val intent = ClientSessionService.startIntent(
            context,
            endpoint.hostAddress,
            endpoint.controlPort,
            code,
            endpoint.name
        )
        runCatching { ContextCompat.startForegroundService(context, intent) }
            .onFailure { Log.e("Cannot start client service: ${it.message}") }
    }

    fun disconnect(context: Context) {
        runCatching { context.startService(ClientSessionService.stopIntent(context)) }
            .onFailure { Log.w("Cannot stop client service: ${it.message}") }
    }

    fun attachSurface(surface: Surface?) {
        service?.attachSurface(surface)
    }

    fun sendTouch(action: TouchAction, pointerId: Int, x: Float, y: Float) {
        service?.sendInput(InputEvent.Touch(action, pointerId, x, y))
    }

    fun sendTouch(event: InputEvent.Touch) {
        service?.sendInput(event)
    }

    fun sendKey(keyCode: Int, down: Boolean) {
        service?.sendInput(InputEvent.Key(keyCode, down))
    }

    fun sendGamepad(state: InputEvent.Gamepad) {
        val merged = state.copy(buttons = state.buttons or keyMask)
        service?.sendInput(merged)
    }

    fun updateKeyMask(keyCode: Int, down: Boolean) {
        val mask = com.neurio.lanstream.input.GamepadReader.maskForKey(keyCode)
        if (mask == 0) return
        keyMask = if (down) keyMask or mask else keyMask and mask.inv()
        service?.sendInput(
            InputEvent.Gamepad(
                buttons = keyMask,
                leftX = 0f, leftY = 0f, rightX = 0f, rightY = 0f,
                leftTrigger = 0f, rightTrigger = 0f, hatX = 0f, hatY = 0f
            )
        )
    }

    fun requestKeyframe() {
        service?.requestKeyframe()
    }
}
