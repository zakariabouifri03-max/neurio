package com.neurio.langame.host.input;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.os.Handler;
import android.view.accessibility.AccessibilityEvent;

import com.neurio.langame.common.Logger;

import java.util.concurrent.atomic.AtomicReference;

/**
 * The only stock-Android bridge that can put a touch into another app.
 *
 * <p>It is deliberately minimal and privacy preserving:</p>
 * <ul>
 *   <li>{@code canRetrieveWindowContent="false"} — the service never reads what is
 *       on screen, it only writes gestures.</li>
 *   <li>It is used for exactly one thing: replaying the gestures that a paired
 *       client produced, and only while a stream is running.</li>
 *   <li>It also reports the foreground package name back to the host engine so the
 *       UI can confirm "the game is running in front" — nothing else is observed.</li>
 * </ul>
 */
public class NeurioAccessibilityService extends AccessibilityService {

    private static final String TAG = "A11yInput";

    private static final AtomicReference<NeurioAccessibilityService> INSTANCE =
            new AtomicReference<>();

    private final AtomicReference<String> foregroundPackage = new AtomicReference<>("");
    private volatile long eventsObserved;

    /** @return the live service instance, or {@code null} when the user has not enabled it. */
    public static NeurioAccessibilityService get() {
        return INSTANCE.get();
    }

    public static boolean isConnected() {
        return INSTANCE.get() != null;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        INSTANCE.set(this);
        Logger.i(TAG, "Accessibility input service connected");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        eventsObserved++;
        if (event == null) {
            return;
        }
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && event.getPackageName() != null) {
            foregroundPackage.set(event.getPackageName().toString());
        }
    }

    @Override
    public void onInterrupt() {
        // Nothing to interrupt: we only ever push gestures.
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        INSTANCE.compareAndSet(this, null);
        Logger.i(TAG, "Accessibility input service disconnected");
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        INSTANCE.compareAndSet(this, null);
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */

    /** Package currently in the foreground (empty when unknown). */
    public String foregroundPackage() {
        return foregroundPackage.get();
    }

    public long eventsObserved() {
        return eventsObserved;
    }

    /** Dispatches a gesture; returns false when the platform refuses it. */
    public boolean dispatch(GestureDescription description, GestureResultCallback callback,
                            Handler handler) {
        try {
            return dispatchGesture(description, callback, handler);
        } catch (Exception e) {
            Logger.w(TAG, "dispatchGesture failed: " + e.getMessage());
            return false;
        }
    }
}
