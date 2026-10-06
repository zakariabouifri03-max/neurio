package com.neurio.langame.host.input;

import android.content.Context;

/**
 * The input abstraction layer.
 *
 * <p>Stock Android does <b>not</b> offer a general "inject input into another
 * app" API. The only mechanisms that exist are:</p>
 *
 * <table>
 *   <tr><th>Adapter</th><th>Availability</th><th>Latency</th><th>Notes</th></tr>
 *   <tr>
 *     <td>{@link AccessibilityInputAdapter}</td>
 *     <td>Any device, user must enable the service</td>
 *     <td>tens of ms</td>
 *     <td>Real system-level touch injection via {@code dispatchGesture}. Works in
 *         normal games; sensitive/secure surfaces and some anti-cheat SDKs ignore
 *         injected gestures.</td>
 *   </tr>
 *   <tr>
 *     <td>{@link RootShellInputAdapter}</td>
 *     <td>Rooted device (or an {@code adb shell} daemon)</td>
 *     <td>50-300 ms (process spawn)</td>
 *     <td>Fine for D-pad/menu navigation, useless for analogue sticks.</td>
 *   </tr>
 * </table>
 *
 * <p>Everything downstream of this interface (protocol, gesture synthesis,
 * coordinate mapping) is adapter independent, which is exactly the point: when a
 * platform finally ships a supported low-latency injection API, only a new
 * adapter is needed.</p>
 */
public interface GameInputAdapter {

    /** Stable id used in logs and settings. */
    String id();

    /** One-line description shown in the host UI. */
    String describe();

    /** Whether the user has given us everything this adapter needs. */
    boolean isAvailable(Context context);

    /**
     * Called once before the first event. Returns false (with {@link #status()}
     * explaining why) when the prerequisites are missing.
     */
    boolean prepare(Context context);

    /** Human readable status for the host screen. */
    String status();

    /**
     * Pointer down at display coordinates.
     *
     * @param pointerId logical finger id (0 = first finger)
     */
    void pointerDown(int pointerId, float x, float y);

    /** Pointer moved while still touching. */
    void pointerMove(int pointerId, float x, float y);

    /** Pointer lifted. */
    void pointerUp(int pointerId, float x, float y);

    /**
     * A discrete key press (D-pad, shoulder buttons, controller buttons) that maps
     * to an Android key code.
     */
    void key(int keyCode, boolean pressed);

    /** Called when the session ends: release everything that is still held. */
    void release();
}
