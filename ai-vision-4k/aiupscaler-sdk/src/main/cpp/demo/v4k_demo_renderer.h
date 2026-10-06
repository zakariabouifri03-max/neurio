// The Vulkan demo scene: terrain, buildings, moving objects, GPU particles,
// shadows, and a live Native / AI-upscaling comparison.
//
// Shape of the thing:
//
//   * it owns its own Vulkan device and swapchain (a game would use its own);
//   * it renders the scene into an offscreen colour image at the *render*
//     resolution;
//   * in AI mode it hands that image to the engine, which records the upscale
//     into the output image on the same device -- this is the same
//     startSessionOnDevice()/processFrame() path a game uses, not a special case;
//   * it presents the result, optionally split against a plain resample of the
//     low-resolution render so the difference is visible side by side.
//
// Everything the panel shows is measured here: frame times from the wall clock
// around a presented frame, GPU stage times from the engine's timestamp queries.
// There is no synthetic number anywhere in this file, and `statusJson()` says
// "unavailable" rather than a zero when a value was not obtained.
//
// The class is a pimpl so no Vulkan type reaches the JNI bridge or the Kotlin
// layer, matching the engine's own style.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "../graphics/v4k_demo_metrics.h"
#include "../graphics/v4k_scene.h"

namespace v4k {

class Engine;

namespace demo {

class DemoRenderer {
public:
    DemoRenderer();
    ~DemoRenderer();

    DemoRenderer(const DemoRenderer&) = delete;
    DemoRenderer& operator=(const DemoRenderer&) = delete;

    /**
     * Creates the device, swapchain and passes. `engine` is borrowed and may be
     * null: the demo still renders (and says the AI stage is unavailable) so a
     * device without a usable engine can still show its scene.
     */
    bool initialise(Engine* engine, void* nativeWindow, uint32_t width, uint32_t height, std::string* error);

    void shutdown();
    bool initialised() const;

    /** The surface changed size (or was recreated by the OS). */
    bool resize(void* nativeWindow, uint32_t width, uint32_t height, std::string* error);

    /** Applies a configuration, rebuilding only what it has to. */
    bool setConfig(const DemoConfig& config, std::string* error);
    const DemoConfig& config() const;

    /**
     * Renders and presents one frame.
     *
     * `deltaSeconds` drives the animation and the particle simulation, so the
     * demo is frame-rate independent and a slow device shows the same scene at
     * the same wall-clock time as a fast one.
     */
    bool renderFrame(double deltaSeconds, double timeSeconds, std::string* error);

    /** Everything the on-screen panel displays, as JSON. */
    std::string statusJson() const;

    /** Runs/ends one side of the native-vs-AI measurement. */
    bool beginBenchmark(DemoMode mode, std::string* error);
    void endBenchmark();
    std::string benchmarkJson() const;

    /** Scene composition (triangles, instances, particles). */
    std::string sceneJson() const;

    const char* lastError() const;
    bool sessionActive() const;
    DemoMode mode() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace demo
}  // namespace v4k
