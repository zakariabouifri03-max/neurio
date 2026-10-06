package com.neurio.lanstream.platform

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import com.neurio.lanstream.core.Log

/**
 * Optional accessibility service used **only** to deliver the touches the player
 * makes on the other phone (host mode).
 *
 * What it does:
 *   * dispatches GestureDescription gestures = real taps/swipes;
 *   * performs the global Back / Home / Recents actions.
 *
 * What it explicitly does not do:
 *   * no window content, no text, no screen reading (canRetrieveWindowContent is
 *     false in res/xml/accessibility_service_config.xml);
 *   * nothing is stored or transmitted anywhere.
 *
 * The user must turn it on in Android Settings; Android deliberately offers no
 * API for an app to enable it itself.
 */
class NeurioAccessibilityService : AccessibilityService() {

    @Volatile
    var isConnected: Boolean = false
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        isConnected = true
        instance = this
        Log.i("Neurio accessibility service connected (input injection enabled)")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Intentionally empty: we never observe the screen, we only inject.
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        isConnected = false
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        isConnected = false
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: NeurioAccessibilityService? = null
            private set
    }
}
