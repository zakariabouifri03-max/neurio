// Demo scene: geometry, animation and the particle system, with no Vulkan in
// sight.
//
// Everything in this file runs on the host and is covered by tests/test_scene.cpp.
// That split is deliberate: the renderer (demo/) can only be checked for syntax
// without a device, while the parts that decide *what* is drawn — mesh
// generation, instance transforms, the camera, the particle rules and the
// resolution/mode configuration — are ordinary deterministic code that a test
// can nail down. Field bugs on real hardware have a habit of being a NaN
// transform or an off-screen camera, and those are cheaper to catch here.
//
// The structs that cross into a shader (Instance, SceneUniforms, Particle) are
// byte-for-byte mirrors of the GLSL declarations in aiupscaler-sdk/src/main/cpp/
// shaders, and each one carries a static_assert on its size. If a shader changes
// its layout, the build fails instead of the demo rendering garbage.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_math.h"

namespace v4k {
namespace demo {

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

// Matches scene.vert locations 0..2 (aPosition, aNormal, aTexCoord).
struct Vertex {
    float position[3];
    float normal[3];
    float uv[2];
};
static_assert(sizeof(Vertex) == 32, "scene.vert vertex layout");

struct Mesh {
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;

    uint32_t vertexCount() const { return static_cast<uint32_t>(vertices.size()); }
    uint32_t indexCount() const { return static_cast<uint32_t>(indices.size()); }
    uint32_t triangleCount() const { return static_cast<uint32_t>(indices.size() / 3); }
    bool empty() const { return vertices.empty() || indices.empty(); }
};

// A heightfield grid, `resolution` quads per side, centred on the origin.
// Heights come from deterministic value noise: the same seed always produces
// the same terrain, which is what makes a benchmark run comparable between
// sessions.
Mesh buildTerrainMesh(uint64_t seed, float size, uint32_t resolution);

// Terrain height at a world position, using the same noise as the mesh. Used to
// sit buildings and props on the ground instead of floating them.
float terrainHeightAt(uint64_t seed, float size, Vec3 position);

// A unit cube centred on the origin, flat normals, 24 vertices (4 per face) and
// 36 indices. Buildings.
Mesh buildBoxMesh();

// A UV sphere of radius 0.5 centred on the origin. Moving objects and props.
Mesh buildSphereMesh(uint32_t segments, uint32_t rings);

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------
//
// Matches scene.vert locations 3..8: a mat4 (four vec4 rows) + vec4 colour +
// vec4 material. Written as float arrays rather than Vec4 so the struct is
// trivially copyable into a vertex buffer with no padding questions.
struct Instance {
    float transform[16];    // column major, see v4k_math.h
    float color[4];
    // x emissive, y roughness, z uvScale, w flags (bit0 = unlit)
    float material[4];
};
static_assert(sizeof(Instance) == 96, "scene.vert per-instance layout");

struct InstanceBatch {
    std::vector<Instance> instances;

    uint32_t count() const { return static_cast<uint32_t>(instances.size()); }
    void clear() { instances.clear(); }
};

struct SceneUniforms {
    Mat4 viewProjection;
    Mat4 lightViewProjection;
    float lightDirection[4];   // xyz direction, w intensity
    float cameraPosition[4];
    float fogColor[4];         // rgb, w density
    float ambientSky[4];       // rgb, w ground bounce
    float params[4];           // x time, y shadow strength, z shadow texel, w unused
};
static_assert(sizeof(SceneUniforms) == 208, "scene.vert SceneUniforms block");

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

enum class DemoQuality {
    Low,       // small terrain, few buildings, 1 moving object
    Medium,    // the default
    High,      // more of everything, a larger shadow map
};

struct SceneBuild {
    Mesh terrain;
    Mesh box;
    Mesh sphere;

    InstanceBatch terrainInstances;
    InstanceBatch buildingInstances;
    InstanceBatch propInstances;     // static spheres (a few floating markers)

    float terrainSize = 0.0f;        // side length of the heightfield, for queries
    Vec3 emitter;                    // particle emitter position
    Vec3 sunDirection;               // unit vector pointing *towards* the sun
    float fogDensity = 0.012f;
    Vec3 fogColor{0.62f, 0.70f, 0.82f};
    Vec3 ambientSky{0.28f, 0.34f, 0.45f};
    float groundBounce = 0.16f;

    uint32_t movingObjectCount = 0;
    uint32_t particleCount = 0;

    bool valid() const { return !terrain.empty() && !box.empty() && !sphere.empty(); }
};

SceneBuild buildDemoScene(uint64_t seed, DemoQuality quality);

// Where the `index`-th moving object is at time `t` (seconds), in world space.
// Deterministic, so a benchmark frame at t = 4.0s looks the same every run.
Vec3 movingObjectPosition(uint32_t index, double t);

// Fills `out` with the moving objects' transforms at time `t`, and writes the
// emitter position (which rides one of the objects).
void animateMovingObjects(uint32_t count, double t, InstanceBatch& out, Vec3& outEmitter);

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

struct Camera {
    Vec3 position{0.0f, 12.0f, 26.0f};
    Vec3 target{0.0f, 2.0f, 0.0f};
    Vec3 up{0.0f, 1.0f, 0.0f};
    float fovYDegrees = 60.0f;
    float nearPlane = 0.25f;
    float farPlane = 400.0f;
};

Mat4 cameraViewMatrix(const Camera& camera);
Mat4 cameraProjectionMatrix(const Camera& camera, float aspect);

// A slow orbit that never looks at the same place twice in a short window, so
// the upscaler's temporal path is exercised by real motion.
Camera orbitCamera(double t, float radius, float height, uint32_t path);

// The sun sweeps a fixed arc over the scene; `t` is seconds.
Vec3 sunDirectionForTime(double t);

// Light-space view-projection for the shadow map: an orthographic box centred on
// `centre`, `radius` wide, covering `depth` units along the sun direction.
Mat4 sunViewProjection(Vec3 sunDirection, Vec3 centre, float radius, float depth);

// ---------------------------------------------------------------------------
// Particles (CPU mirror of shaders/particle_sim.comp)
// ---------------------------------------------------------------------------
//
// The GPU path simulates the same particles in particle_sim.comp; this CPU copy
// exists so the rules can be tested without a device, and so the buffer has a
// correct initial state to upload. The two must stay in step: the constants
// below are the shader's constants.
struct Particle {
    float positionSize[4];   // xyz position, w size
    float colourLife[4];     // rgb colour, a life in [0, 1]
    float velocity[4];       // xyz velocity, w reserved
};
static_assert(sizeof(Particle) == 48, "particle_sim.comp Particle layout");

constexpr float kParticleGravity = 6.0f;
constexpr float kParticleDrag = 0.6f;
constexpr float kParticleLifeRate = 0.45f;

uint32_t particleHash(uint32_t x);
float particleRandomFloat(uint32_t& state);
Vec3 particleRandomUnitVector(uint32_t& state);

void resetParticles(std::vector<Particle>& particles, uint32_t count, uint32_t seed, Vec3 emitter);
// One simulation step, identical to the shader's main().
void stepParticles(std::vector<Particle>& particles, float deltaSeconds, uint32_t seed, Vec3 emitter,
                   float gravity = kParticleGravity);

// ---------------------------------------------------------------------------
// Demo configuration
// ---------------------------------------------------------------------------
//
// The render resolution ladder and the output ladder are the ones the profiles
// screen offers, so the demo's A/B is the same comparison the app advertises.
struct Resolution {
    uint32_t width;
    uint32_t height;
    const char* name;
};

constexpr uint32_t kDemoResolutionCount = 5;
inline const Resolution* demoResolutions() {
    static const Resolution kResolutions[kDemoResolutionCount] = {
        {1280, 720, "720p"},
        {1600, 900, "900p"},
        {1920, 1080, "1080p"},
        {2560, 1440, "1440p"},
        {3840, 2160, "4K"},
    };
    return kResolutions;
}

enum class DemoMode {
    Native,        // render directly at the output resolution, no AI stage
    AiUpscaled,    // render low, let the engine upscale to the output resolution
    SplitCompare,  // present both, split down the middle, with a magnifier inset
};

const char* demoModeName(DemoMode mode);

struct DemoConfig {
    DemoMode mode = DemoMode::SplitCompare;
    uint32_t renderIndex = 0;        // index into demoResolutions()
    uint32_t outputIndex = 2;        // index into demoResolutions()
    double durationSeconds = 0.0;    // 0 == run until stopped
    uint32_t seed = 20261006u;
    DemoQuality quality = DemoQuality::Medium;
    bool allowTemporal = true;
    float splitPosition = 0.5f;
    float magnifierScale = 1.0f;     // 1 == no magnifier inset
};

// Returns false with a reason when the configuration cannot be run: an output
// resolution below the render resolution, an index outside the ladder, or a
// duration that is negative. The UI calls this before starting so it can explain
// instead of failing inside the renderer.
bool validateDemoConfig(const DemoConfig& config, std::string* error);

// The measured scene is deliberately limited: 4K output with a 720p render is
// the interesting case, 720p output with a 4K render is not a demo of anything.
inline bool isUpscaleConfig(const DemoConfig& config) {
    const Resolution* rungs = demoResolutions();
    return rungs[config.outputIndex].width >= rungs[config.renderIndex].width;
}

}  // namespace demo
}  // namespace v4k
