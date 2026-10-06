package com.aivision4k.app.demo

import android.view.Surface

/**
 * The demo renderer's raw JNI surface.
 *
 * Every method here maps one-to-one onto an entry point registered by
 * `demo/v4k_demo_jni.cpp` (see the `kDemoMethods` table there — a rename on one
 * side without the same rename on the other fails at `System.loadLibrary` time,
 * not later on some unlucky device). Nothing outside this package should call it:
 * [DemoActivity] is the only user.
 *
 * Conventions, identical to the SDK bridge so there is one idiom to remember:
 *  * methods that can fail return `String?` — `null` means success, anything else
 *    is a human-readable message shown verbatim;
 *  * structured data crosses as JSON, parsed here with [org.json];
 *  * the per-frame entry point returns `null` on the happy path and builds no
 *    string, so the render loop allocates nothing per frame.
 *
 * The native side owns the Vulkan device and every GPU object. It holds exactly
 * one renderer, so these calls are serialised on the native side and must not be
 * made from two threads at once; the activity does all of it from one render
 * thread plus the UI thread, which is what the native mutex expects.
 */
internal object DemoNativeBridge {

    /** True once the engine library is loaded. */
    val loaded: Boolean = try {
        System.loadLibrary("aivision4k")
        true
    } catch (error: UnsatisfiedLinkError) {
        // A missing .so is a build problem, not a device problem: the ABIs are
        // declared in build.gradle.kts.
        false
    }

    /** Creates the native renderer. The surface and the engine arrive later. */
    external fun nativeCreate(): String?

    /**
     * The Surface is ready at [width] x [height]. Must be called before any
     * other call that touches the renderer.
     */
    external fun nativeSurfaceCreated(surface: Surface, width: Int, height: Int): String?

    /** The Surface changed size or was recreated. */
    external fun nativeSurfaceChanged(surface: Surface, width: Int, height: Int): String?

    /** The Surface is going away; the native side tears the swapchain down. */
    external fun nativeSurfaceDestroyed()

    /** Applies a configuration. Missing JSON members keep their current value. */
    external fun nativeSetConfig(json: String?): String?

    /** The current configuration plus the resolution ladder it indexes. */
    external fun nativeConfigJson(): String

    /** What this build and this device can actually run, for greying out the UI. */
    external fun nativeFeatureJson(): String

    /**
     * Renders and presents one frame. `deltaSeconds` drives the animation and
     * the particle simulation, so the scene runs at the same wall-clock speed
     * whatever the frame rate is.
     */
    external fun nativeRenderFrame(deltaSeconds: Double, timeSeconds: Double): String?

    /** Everything the on-screen panel shows. */
    external fun nativeStatusJson(): String

    /** Scene composition: triangles, instances, particles. */
    external fun nativeSceneJson(): String

    /** The renderer's standing explanation, empty when there is nothing to say. */
    external fun nativeLastError(): String

    /** Starts one side of the native-vs-AI measurement. */
    external fun nativeBeginBenchmark(mode: Int): String?

    external fun nativeEndBenchmark()

    /** The comparison report, or how many frames each side still needs. */
    external fun nativeBenchmarkJson(): String
}
