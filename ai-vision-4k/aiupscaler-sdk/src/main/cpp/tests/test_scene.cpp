// Tests for the demo scene's device-independent half (graphics/).
//
// The renderer itself needs a Vulkan device, so on a desktop these tests are the
// only thing standing between a typo and a black screen on someone's phone. What
// they cover is exactly the part that has a right and a wrong answer: matrix
// conventions, mesh integrity, instance placement, camera and light setup, the
// particle rules that the compute shader mirrors, and the configuration the
// benchmark screen is allowed to run.

#include "graphics/v4k_scene.h"

#include <cmath>
#include <string>
#include <vector>

#include "v4k_test.h"

using namespace v4k;
using namespace v4k::demo;

namespace {

/** Extracts translation and per-axis scale back out of an instance transform. */
void decompose(const Instance& instance, Vec3& translation, Vec3& scale) {
    translation = Vec3{instance.transform[12], instance.transform[13], instance.transform[14]};
    const Vec3 columnX{instance.transform[0], instance.transform[1], instance.transform[2]};
    const Vec3 columnY{instance.transform[4], instance.transform[5], instance.transform[6]};
    const Vec3 columnZ{instance.transform[8], instance.transform[9], instance.transform[10]};
    scale = Vec3{length(columnX), length(columnY), length(columnZ)};
}

bool finiteMesh(const Mesh& mesh) {
    for (const Vertex& vertex : mesh.vertices) {
        if (!std::isfinite(vertex.position[0]) || !std::isfinite(vertex.position[1]) ||
            !std::isfinite(vertex.position[2])) {
            return false;
        }
        if (!std::isfinite(vertex.normal[0]) || !std::isfinite(vertex.normal[1]) ||
            !std::isfinite(vertex.normal[2]) || !std::isfinite(vertex.uv[0]) ||
            !std::isfinite(vertex.uv[1])) {
            return false;
        }
    }
    return true;
}

bool indicesInRange(const Mesh& mesh) {
    for (uint32_t index : mesh.indices) {
        if (index >= mesh.vertexCount()) return false;
    }
    return true;
}

bool unitNormals(const Mesh& mesh, double tolerance = 1e-3) {
    for (const Vertex& vertex : mesh.vertices) {
        const double len = std::sqrt(static_cast<double>(vertex.normal[0]) * vertex.normal[0] +
                                     static_cast<double>(vertex.normal[1]) * vertex.normal[1] +
                                     static_cast<double>(vertex.normal[2]) * vertex.normal[2]);
        if (std::fabs(len - 1.0) > tolerance) return false;
    }
    return true;
}

}  // namespace

// ---------------------------------------------------------------------------
// Layout mirrors
// ---------------------------------------------------------------------------
//
// These sizes are asserted at compile time in v4k_scene.h; repeating them here
// means the test output says *why* they matter when someone changes a struct.

V4K_TEST(demo_struct_layouts_match_the_shaders) {
    CHECK_EQ_INT(sizeof(Vertex), 32u);          // scene.vert locations 0..2
    CHECK_EQ_INT(sizeof(Instance), 96u);        // scene.vert locations 3..8
    CHECK_EQ_INT(sizeof(SceneUniforms), 208u);  // scene.vert uniform block
    CHECK_EQ_INT(sizeof(Particle), 48u);        // particle_sim.comp Particle
    // A Mat4 must be a plain 16 floats in column-major order, nothing padded.
    CHECK_EQ_INT(sizeof(Mat4), 64u);
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

V4K_TEST(demo_projection_uses_vulkan_depth_range) {
    const float nearPlane = 0.5f;
    const float farPlane = 100.0f;
    const Mat4 projection = perspective(1.0f, 16.0f / 9.0f, nearPlane, farPlane);

    // A point on the near plane lands at z = 0, one on the far plane at z = 1:
    // that is Vulkan's clip space, and getting it wrong is the classic "nothing
    // renders, or everything does".
    const Vec4 nearPoint = projection * Vec4{0.0f, 0.0f, -nearPlane, 1.0f};
    const Vec4 farPoint = projection * Vec4{0.0f, 0.0f, -farPlane, 1.0f};
    CHECK_NEAR(nearPoint.z / nearPoint.w, 0.0, 1e-5);
    CHECK_NEAR(farPoint.z / farPoint.w, 1.0, 1e-5);

    // The view axis stays centred, and +y stays up.
    const Vec4 centre = projection * Vec4{0.0f, 0.0f, -10.0f, 1.0f};
    CHECK_NEAR(centre.x / centre.w, 0.0, 1e-6);
    CHECK_NEAR(centre.y / centre.w, 0.0, 1e-6);
    const Vec4 above = projection * Vec4{0.0f, 1.0f, -10.0f, 1.0f};
    CHECK_GT(above.y / above.w, 0.0);

    // A point *behind* the camera must end up with w <= 0 so it is clipped,
    // rather than being projected as if it were in front.
    const Vec4 behind = projection * Vec4{0.0f, 0.0f, 1.0f, 1.0f};
    CHECK(behind.w <= 0.0f);
}

V4K_TEST(demo_look_at_puts_the_target_on_the_view_axis) {
    const Vec3 eye{8.0f, 6.0f, 12.0f};
    const Vec3 target{0.0f, 1.0f, 0.0f};
    const Mat4 view = lookAt(eye, target, Vec3{0.0f, 1.0f, 0.0f});

    const Vec4 origin = view * Vec4{eye.x, eye.y, eye.z, 1.0f};
    CHECK_NEAR(origin.x, 0.0, 1e-5);
    CHECK_NEAR(origin.y, 0.0, 1e-5);
    CHECK_NEAR(origin.z, 0.0, 1e-5);   // the eye is the origin of view space

    const Vec4 looked = view * Vec4{target.x, target.y, target.z, 1.0f};
    CHECK_NEAR(looked.x, 0.0, 1e-5);
    CHECK_NEAR(looked.y, 0.0, 1e-5);
    CHECK_LT(looked.z, 0.0);           // in front of the camera is -z

    // Degenerate up vector (looking straight down) must not produce NaN.
    const Mat4 degenerate = lookAt(Vec3{0.0f, 10.0f, 0.0f}, Vec3{0.0f, 0.0f, 0.0f}, Vec3{0.0f, 1.0f, 0.0f});
    for (int i = 0; i < 16; ++i) CHECK(std::isfinite(degenerate.m[i]));
}

V4K_TEST(demo_orthographic_maps_the_frustum_into_the_unit_cube) {
    const Mat4 projection = orthographic(-10.0f, 10.0f, -10.0f, 10.0f, 1.0f, 21.0f);
    // Looking down -z, so a point at z = -near maps to depth 0.
    const Vec4 nearPoint = projection * Vec4{10.0f, -10.0f, -1.0f, 1.0f};
    CHECK_NEAR(nearPoint.x, 1.0, 1e-5);
    CHECK_NEAR(nearPoint.y, -1.0, 1e-5);
    CHECK_NEAR(nearPoint.z, 0.0, 1e-5);
    const Vec4 farPoint = projection * Vec4{-10.0f, 10.0f, -21.0f, 1.0f};
    CHECK_NEAR(farPoint.x, -1.0, 1e-5);
    CHECK_NEAR(farPoint.y, 1.0, 1e-5);
    CHECK_NEAR(farPoint.z, 1.0, 1e-5);
}

// ---------------------------------------------------------------------------
// Meshes and terrain
// ---------------------------------------------------------------------------

V4K_TEST(demo_terrain_is_deterministic_and_finite) {
    const Mesh first = buildTerrainMesh(1234u, 80.0f, 32);
    const Mesh second = buildTerrainMesh(1234u, 80.0f, 32);
    const Mesh other = buildTerrainMesh(4321u, 80.0f, 32);

    CHECK_EQ_INT(first.vertexCount(), 33u * 33u);
    CHECK_EQ_INT(first.indexCount(), 32u * 32u * 6u);
    CHECK(finiteMesh(first));
    CHECK(indicesInRange(first));
    CHECK(unitNormals(first, 1e-2));

    bool identical = first.vertexCount() == second.vertexCount();
    for (size_t i = 0; identical && i < first.vertices.size(); ++i) {
        identical = first.vertices[i].position[1] == second.vertices[i].position[1];
    }
    CHECK(identical);

    // A different seed must produce a different terrain, otherwise re-running a
    // benchmark "with a new scene" would be a lie.
    bool differs = false;
    for (size_t i = 0; i < first.vertices.size() && !differs; ++i) {
        differs = first.vertices[i].position[1] != other.vertices[i].position[1];
    }
    CHECK(differs);

    // Degenerate inputs return an empty mesh rather than a broken one.
    CHECK(buildTerrainMesh(1u, 80.0f, 1).empty());
    CHECK(buildTerrainMesh(1u, 0.0f, 32).empty());
}

V4K_TEST(demo_terrain_height_query_matches_the_mesh) {
    // The height query is what places buildings on the ground; if it disagreed
    // with the mesh, every building would float or sink.
    const uint64_t seed = 77u;
    const float size = 60.0f;
    const uint32_t resolution = 24;
    const Mesh mesh = buildTerrainMesh(seed, size, resolution);
    const float step = size / static_cast<float>(resolution);
    const float half = size * 0.5f;

    for (uint32_t z = 0; z <= resolution; z += 7) {
        for (uint32_t x = 0; x <= resolution; x += 5) {
            const Vec3 position{-half + static_cast<float>(x) * step, 0.0f,
                                -half + static_cast<float>(z) * step};
            const float queried = terrainHeightAt(seed, size, position);
            const Vertex& vertex = mesh.vertices[z * (resolution + 1) + x];
            CHECK_NEAR(queried, vertex.position[1], 1e-3);
        }
    }
}

V4K_TEST(demo_box_and_sphere_meshes_are_well_formed) {
    const Mesh box = buildBoxMesh();
    CHECK_EQ_INT(box.vertexCount(), 24u);
    CHECK_EQ_INT(box.indexCount(), 36u);
    CHECK_EQ_INT(box.triangleCount(), 12u);
    CHECK(indicesInRange(box));
    CHECK(unitNormals(box));
    CHECK(finiteMesh(box));
    // A cube with per-face normals has exactly six distinct normals.
    int distinct = 0;
    for (const Vertex& vertex : box.vertices) {
        bool seen = false;
        for (int i = 0; i < distinct; ++i) {
            const Vertex& previous = box.vertices[static_cast<size_t>(i) * 4u];
            if (previous.normal[0] == vertex.normal[0] && previous.normal[1] == vertex.normal[1] &&
                previous.normal[2] == vertex.normal[2]) {
                seen = true;
                break;
            }
        }
        if (!seen) ++distinct;
    }
    CHECK_EQ_INT(distinct, 6);

    const Mesh sphere = buildSphereMesh(16, 8);
    CHECK_EQ_INT(sphere.vertexCount(), 17u * 9u);
    CHECK_EQ_INT(sphere.indexCount(), 16u * 8u * 6u);
    CHECK(indicesInRange(sphere));
    CHECK(unitNormals(sphere));
    CHECK(finiteMesh(sphere));
    // Every vertex sits on the unit-diameter sphere.
    for (const Vertex& vertex : sphere.vertices) {
        const double radius = std::sqrt(static_cast<double>(vertex.position[0]) * vertex.position[0] +
                                        static_cast<double>(vertex.position[1]) * vertex.position[1] +
                                        static_cast<double>(vertex.position[2]) * vertex.position[2]);
        CHECK_NEAR(radius, 0.5, 1e-5);
    }

    CHECK(buildSphereMesh(2, 8).empty());
    CHECK(buildSphereMesh(16, 1).empty());
}

// ---------------------------------------------------------------------------
// Scene assembly
// ---------------------------------------------------------------------------

V4K_TEST(demo_scene_is_populated_and_sane_for_every_quality) {
    for (DemoQuality quality : {DemoQuality::Low, DemoQuality::Medium, DemoQuality::High}) {
        const SceneBuild scene = buildDemoScene(2026u, quality);
        CHECK(scene.valid());
        CHECK_GT(scene.terrainInstances.count(), 0u);
        CHECK_GT(scene.buildingInstances.count(), 0u);
        CHECK_GT(scene.movingObjectCount, 0u);
        CHECK_GT(scene.particleCount, 0u);
        CHECK(indicesInRange(scene.terrain));
        CHECK(indicesInRange(scene.box));
        CHECK(indicesInRange(scene.sphere));

        for (const Instance& instance : scene.buildingInstances.instances) {
            Vec3 translation;
            Vec3 scale;
            decompose(instance, translation, scale);
            CHECK(isFinite(translation));
            CHECK(isFinite(scale));
            CHECK_GT(scale.y, 0.0f);
            // Buildings stand on the terrain, within a reasonable tolerance of
            // the ground under their own centre.
            // The query must use the same terrain size the scene was built with,
            // which is why SceneBuild carries it.
            const float ground = terrainHeightAt(2026u, scene.terrainSize, translation);
            const float expectedCentre = ground + scale.y * 0.5f - 0.2f;
            CHECK_NEAR(translation.y, expectedCentre, 1e-3);
            // Colour and material stay inside the range the shader expects.
            CHECK(instance.color[3] >= 0.0f && instance.color[3] <= 1.0f);
            CHECK(instance.material[0] >= 0.0f && instance.material[0] <= 1.0f);
            CHECK(instance.material[1] >= 0.0f && instance.material[1] <= 1.0f);
        }

        // A larger quality setting must actually mean more geometry, otherwise
        // the setting is decorative.
        if (quality == DemoQuality::High) {
            CHECK_GT(scene.buildingInstances.count(), 20u);
            CHECK_GT(scene.terrain.vertexCount(), 10000u);
        }
    }
}

V4K_TEST(demo_moving_objects_are_deterministic_and_actually_move) {
    const Vec3 atFour = movingObjectPosition(0, 4.0);
    const Vec3 atFourAgain = movingObjectPosition(0, 4.0);
    const Vec3 later = movingObjectPosition(0, 4.25);

    CHECK_NEAR(atFour.x, atFourAgain.x, 0.0);
    CHECK_NEAR(atFour.z, atFourAgain.z, 0.0);
    CHECK(std::fabs(atFour.x - later.x) + std::fabs(atFour.z - later.z) > 1e-3);

    for (uint32_t index = 0; index < 5; ++index) {
        for (double t = 0.0; t < 8.0; t += 1.3) {
            const Vec3 position = movingObjectPosition(index, t);
            CHECK(isFinite(position));
            CHECK_GT(position.y, 1.0f);           // above the ground
            CHECK_LT(length(Vec3{position.x, 0.0f, position.z}), 40.0f);
        }
    }

    InstanceBatch batch;
    Vec3 emitter;
    animateMovingObjects(3, 2.5, batch, emitter);
    CHECK_EQ_INT(batch.count(), 3u);
    CHECK(isFinite(emitter));
    // The emitter trails the lead object.
    const Vec3 lead = movingObjectPosition(0, 2.5);
    CHECK_NEAR(emitter.x, lead.x, 1e-4);
    CHECK_LT(emitter.y, lead.y);

    // Two objects must not sit on top of each other.
    Vec3 firstTranslation;
    Vec3 firstScale;
    Vec3 secondTranslation;
    Vec3 secondScale;
    decompose(batch.instances[0], firstTranslation, firstScale);
    decompose(batch.instances[1], secondTranslation, secondScale);
    CHECK_GT(length(firstTranslation - secondTranslation), 1.0f);
}

// ---------------------------------------------------------------------------
// Camera and light
// ---------------------------------------------------------------------------

V4K_TEST(demo_orbit_camera_stays_outside_the_scene_and_moves) {
    const Camera first = orbitCamera(0.0, 30.0f, 14.0f, 0);
    const Camera later = orbitCamera(6.0, 30.0f, 14.0f, 0);
    const Camera otherPath = orbitCamera(0.0, 30.0f, 14.0f, 1);

    CHECK(isFinite(first.position));
    CHECK(length(first.position - later.position) > 1.0f);
    CHECK(length(first.position - otherPath.position) > 1.0f);

    for (double t = 0.0; t < 30.0; t += 2.5) {
        const Camera camera = orbitCamera(t, 30.0f, 14.0f, 0);
        CHECK_GT(camera.position.y, 5.0f);   // never dives into the terrain
        const float distance = length(camera.position - camera.target);
        CHECK_GT(distance, 20.0f);
        const Mat4 view = cameraViewMatrix(camera);
        const Mat4 projection = cameraProjectionMatrix(camera, 16.0f / 9.0f);
        for (int i = 0; i < 16; ++i) {
            CHECK(std::isfinite(view.m[i]));
            CHECK(std::isfinite(projection.m[i]));
        }
    }
}

V4K_TEST(demo_sun_is_a_unit_vector_and_its_shadow_box_contains_the_scene) {
    for (double t = 0.0; t < 40.0; t += 3.25) {
        const Vec3 sun = sunDirectionForTime(t);
        CHECK_NEAR(length(sun), 1.0, 1e-4);
        CHECK_GT(sun.y, 0.0f);   // the sun stays above the horizon

        const Vec3 centre{0.0f, 3.0f, 0.0f};
        const Mat4 lightViewProjection = sunViewProjection(sun, centre, 55.0f, 90.0f);
        const Vec4 clip = lightViewProjection * Vec4{centre.x, centre.y, centre.z, 1.0f};
        CHECK_GT(clip.w, 0.0f);
        const double x = clip.x / clip.w;
        const double y = clip.y / clip.w;
        const double z = clip.z / clip.w;
        CHECK(std::fabs(x) <= 1.0);
        CHECK(std::fabs(y) <= 1.0);
        CHECK(z >= 0.0 && z <= 1.0);
    }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

V4K_TEST(demo_particle_hash_matches_the_shader_algorithm) {
    // The shader's hash, evaluated here as a second implementation of the same
    // four steps. A drift between them would put the GPU and the CPU copy in
    // different states, which is exactly the sort of bug that only shows up as
    // "the particles look slightly wrong on device".
    auto reference = [](uint32_t x) {
        x ^= x >> 16;
        x *= 0x7feb352du;
        x ^= x >> 15;
        x *= 0x846ca68bu;
        x ^= x >> 16;
        return x;
    };
    for (uint32_t input : {0u, 1u, 12345u, 0xFFFFFFFFu, 0x80000000u}) {
        CHECK_EQ_INT(particleHash(input), reference(input));
    }

    uint32_t state = 99u;
    for (int i = 0; i < 32; ++i) {
        const float value = particleRandomFloat(state);
        CHECK(value >= 0.0f && value <= 1.0f);
    }
    uint32_t sphereState = 7u;
    for (int i = 0; i < 32; ++i) {
        const Vec3 unit = particleRandomUnitVector(sphereState);
        CHECK_NEAR(length(unit), 1.0, 1e-3);
    }
}

V4K_TEST(demo_particles_start_populated_and_stay_in_range) {
    std::vector<Particle> particles;
    resetParticles(particles, 512, 4242u, Vec3{0.0f, 8.0f, 0.0f});
    CHECK_EQ_INT(particles.size(), 512u);

    // The plume must start alive across a spread of ages, not all born at once.
    float minLife = 1.0f;
    float maxLife = 0.0f;
    for (const Particle& particle : particles) {
        CHECK(particle.colourLife[3] >= 0.0f && particle.colourLife[3] < 1.0f);
        CHECK(particle.positionSize[3] >= 0.06f && particle.positionSize[3] <= 0.11f);
        minLife = std::min(minLife, particle.colourLife[3]);
        maxLife = std::max(maxLife, particle.colourLife[3]);
        // Spawned within the emitter's jitter sphere.
        const Vec3 offset{particle.positionSize[0], particle.positionSize[1] - 8.0f, particle.positionSize[2]};
        CHECK_LT(length(offset), 0.36f);
    }
    CHECK_LT(minLife, 0.2f);
    CHECK_GT(maxLife, 0.5f);

    // Running the simulation must never produce a NaN, an out-of-range life or a
    // particle that escapes to infinity, even after long runs and big steps.
    for (int step = 0; step < 600; ++step) {
        stepParticles(particles, step % 7 == 0 ? 1.0f / 15.0f : 1.0f / 60.0f, 4242u, Vec3{0.0f, 8.0f, 0.0f});
    }
    for (const Particle& particle : particles) {
        CHECK(particle.colourLife[3] >= 0.0f && particle.colourLife[3] < 1.0f);
        CHECK(isFinite(Vec3{particle.positionSize[0], particle.positionSize[1], particle.positionSize[2]}));
        CHECK(isFinite(Vec3{particle.velocity[0], particle.velocity[1], particle.velocity[2]}));
        // Nothing should end up kilometres away from the emitter.
        CHECK_LT(length(Vec3{particle.positionSize[0], particle.positionSize[1] - 8.0f,
                             particle.positionSize[2]}),
                 40.0f);
    }
}

V4K_TEST(demo_particle_step_mirrors_the_shader_rules) {
    // Gravity, drag and life accumulation, checked one step at a time against
    // the arithmetic the shader performs.
    std::vector<Particle> particles;
    resetParticles(particles, 8, 11u, Vec3{1.0f, 2.0f, 3.0f});
    particles[0].colourLife[3] = 0.5f;
    particles[0].velocity[0] = 4.0f;
    particles[0].velocity[1] = 2.0f;
    particles[0].velocity[2] = 0.0f;
    particles[0].positionSize[0] = 1.0f;
    particles[0].positionSize[1] = 2.0f;
    particles[0].positionSize[2] = 3.0f;

    const float dt = 0.25f;
    stepParticles(particles, dt, 11u, Vec3{1.0f, 2.0f, 3.0f});

    const float damping = 1.0f - kParticleDrag * dt;
    CHECK_NEAR(particles[0].velocity[0], 4.0f * damping, 1e-6);
    CHECK_NEAR(particles[0].velocity[1], (2.0f - 6.0f * dt) * damping, 1e-6);
    CHECK_NEAR(particles[0].positionSize[0], 1.0f + particles[0].velocity[0] * dt, 1e-6);
    CHECK_NEAR(particles[0].positionSize[1], 2.0f + particles[0].velocity[1] * dt, 1e-6);
    CHECK_NEAR(particles[0].colourLife[3], 0.5f + dt * kParticleLifeRate, 1e-6);

    // A zero-length step must not move a live particle: the guard against a
    // pacing bug turning into a spinning simulation. Dead particles are excluded
    // on purpose -- life 0 is the shader's respawn flag and is acted on whatever
    // the timestep is, so those legitimately reappear at the emitter.
    std::vector<Particle> copy = particles;
    stepParticles(copy, 0.0f, 11u, Vec3{1.0f, 2.0f, 3.0f});
    int liveCompared = 0;
    for (size_t i = 0; i < copy.size(); ++i) {
        if (particles[i].colourLife[3] <= 0.0f) continue;
        ++liveCompared;
        CHECK_NEAR(copy[i].positionSize[0], particles[i].positionSize[0], 1e-6);
        CHECK_NEAR(copy[i].positionSize[1], particles[i].positionSize[1], 1e-6);
        CHECK_NEAR(copy[i].colourLife[3], particles[i].colourLife[3], 1e-6);
    }
    CHECK_GT(liveCompared, 0);

    // A dead particle respawns: life becomes small and it is placed at the
    // emitter with an upward kick.
    std::vector<Particle> dying;
    resetParticles(dying, 4, 3u, Vec3{0.0f, 5.0f, 0.0f});
    dying[2].colourLife[3] = 0.0f;
    dying[2].positionSize[0] = 500.0f;
    stepParticles(dying, 1.0f / 60.0f, 3u, Vec3{0.0f, 5.0f, 0.0f});
    CHECK_LT(dying[2].colourLife[3], 0.01f);
    CHECK_LT(std::fabs(dying[2].positionSize[0]), 1.0f);
    CHECK_GT(dying[2].velocity[1], 0.0f);

    // Life reaching 1.0 is a respawn flag, not an end state.
    dying[2].colourLife[3] = 0.999f;
    stepParticles(dying, 1.0f / 15.0f, 3u, Vec3{0.0f, 5.0f, 0.0f});
    CHECK_NEAR(dying[2].colourLife[3], 0.0, 1e-6);
    stepParticles(dying, 1.0f / 15.0f, 3u, Vec3{0.0f, 5.0f, 0.0f});
    CHECK_GT(dying[2].colourLife[3], 0.0f);

    // Determinism: same seed, same emitter, same result.
    std::vector<Particle> a;
    std::vector<Particle> b;
    resetParticles(a, 64, 9u, Vec3{0.0f, 1.0f, 0.0f});
    resetParticles(b, 64, 9u, Vec3{0.0f, 1.0f, 0.0f});
    for (int step = 0; step < 40; ++step) {
        stepParticles(a, 1.0f / 60.0f, 9u, Vec3{0.0f, 1.0f, 0.0f});
        stepParticles(b, 1.0f / 60.0f, 9u, Vec3{0.0f, 1.0f, 0.0f});
    }
    for (size_t i = 0; i < a.size(); ++i) {
        CHECK_NEAR(a[i].positionSize[0], b[i].positionSize[0], 0.0);
        CHECK_NEAR(a[i].positionSize[1], b[i].positionSize[1], 0.0);
        CHECK_NEAR(a[i].colourLife[3], b[i].colourLife[3], 0.0);
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

V4K_TEST(demo_config_validation_rejects_impossible_setups) {
    DemoConfig config;
    std::string error;

    CHECK(validateDemoConfig(config, &error));
    CHECK(isUpscaleConfig(config));

    // 4K output from a 720p render is the interesting case, and it is legal.
    config.renderIndex = 0;
    config.outputIndex = 4;
    CHECK(validateDemoConfig(config, &error));

    // Asking for a *smaller* output than the render is not upscaling.
    config.renderIndex = 3;
    config.outputIndex = 1;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "below the render resolution");
    CHECK(!isUpscaleConfig(config));

    // Out-of-range indices.
    config.renderIndex = kDemoResolutionCount;
    config.outputIndex = 2;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "render resolution index");
    config.renderIndex = 0;
    config.outputIndex = 99;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "output resolution index");

    // Presentation parameters.
    config.outputIndex = 2;
    config.splitPosition = 1.4f;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "split position");
    config.splitPosition = 0.5f;
    config.magnifierScale = 0.5f;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "magnifier");
    config.magnifierScale = 1.0f;
    config.durationSeconds = -1.0;
    CHECK(!validateDemoConfig(config, &error));
    CHECK_STR_CONTAINS(error, "duration");
    config.durationSeconds = 30.0;
    CHECK(validateDemoConfig(config, &error));

    // The ladder itself is ordered and named, because the UI and the profiles
    // screen both index into it by position.
    const Resolution* rungs = demoResolutions();
    for (uint32_t i = 1; i < kDemoResolutionCount; ++i) {
        CHECK_GT(rungs[i].width, rungs[i - 1].width);
        CHECK_GT(rungs[i].height, rungs[i - 1].height);
        CHECK(rungs[i].name != nullptr && rungs[i].name[0] != '\0');
    }
    CHECK_EQ_INT(rungs[0].width, 1280u);
    CHECK_EQ_INT(rungs[4].width, 3840u);
}

V4K_TEST(demo_mode_names_are_stable) {
    // These strings are shown in the UI and written into the benchmark report,
    // so they are part of the interface, not an implementation detail.
    CHECK_STR_CONTAINS(demoModeName(DemoMode::Native), "Native");
    CHECK_STR_CONTAINS(demoModeName(DemoMode::AiUpscaled), "AI");
    CHECK_STR_CONTAINS(demoModeName(DemoMode::SplitCompare), "Split");
    CHECK_STR_CONTAINS(demoModeName(static_cast<DemoMode>(99)), "Unknown");
}
