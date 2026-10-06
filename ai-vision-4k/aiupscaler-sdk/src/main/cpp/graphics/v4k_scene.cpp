#include "v4k_scene.h"

#include <algorithm>
#include <cmath>

namespace v4k {
namespace demo {
namespace {

constexpr float kPi = 3.14159265358979323846f;

float radians(float degrees) { return degrees * (kPi / 180.0f); }

// ---------------------------------------------------------------------------
// Deterministic value noise
// ---------------------------------------------------------------------------
//
// A hash rather than a stateful PRNG: any (seed, cell) pair resolves to the same
// value regardless of the order it is evaluated in, so a mesh, the height query
// used to place buildings on it and a later re-run all agree.
uint32_t hashU32(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

uint32_t hashCombine(uint64_t seed, int32_t x, int32_t y, uint32_t salt) {
    const uint64_t mixed = seed * 0x9e3779b97f4a7c15ull + static_cast<uint64_t>(static_cast<uint32_t>(x)) * 0x2545f4914f6cdd1dull +
                           static_cast<uint64_t>(static_cast<uint32_t>(y)) * 0x9e3779b97f4a7c15ull + salt;
    return hashU32(static_cast<uint32_t>(mixed ^ (mixed >> 32)));
}

float hashToUnitFloat(uint32_t h) {
    return static_cast<float>(h & 0x00FFFFFFu) / static_cast<float>(0x00FFFFFFu);
}

float smoothStep(float t) { return t * t * (3.0f - 2.0f * t); }

float valueNoise(uint64_t seed, float x, float y, uint32_t salt) {
    const float fx = std::floor(x);
    const float fy = std::floor(y);
    const int32_t x0 = static_cast<int32_t>(fx);
    const int32_t y0 = static_cast<int32_t>(fy);
    const float tx = smoothStep(x - fx);
    const float ty = smoothStep(y - fy);

    const float v00 = hashToUnitFloat(hashCombine(seed, x0, y0, salt));
    const float v10 = hashToUnitFloat(hashCombine(seed, x0 + 1, y0, salt));
    const float v01 = hashToUnitFloat(hashCombine(seed, x0, y0 + 1, salt));
    const float v11 = hashToUnitFloat(hashCombine(seed, x0 + 1, y0 + 1, salt));

    const float a = v00 + (v10 - v00) * tx;
    const float b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
}

/** Four octaves of value noise, in [0, 1]. */
float fractalNoise(uint64_t seed, float x, float y) {
    float sum = 0.0f;
    float amplitude = 0.5f;
    float frequency = 1.0f;
    float total = 0.0f;
    for (uint32_t octave = 0; octave < 4; ++octave) {
        sum += amplitude * valueNoise(seed, x * frequency, y * frequency, octave);
        total += amplitude;
        amplitude *= 0.5f;
        frequency *= 2.07f;   // non-integer so the octaves do not line up
    }
    return total > 0.0f ? sum / total : 0.0f;
}

}  // namespace

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

Mat4 lookAt(Vec3 eye, Vec3 target, Vec3 up) {
    const Vec3 forward = normalize(target - eye);
    Vec3 right = cross(forward, up);
    if (length(right) < 1e-5f) {
        // Degenerate: looking straight up or down. Pick any perpendicular axis
        // rather than producing NaNs.
        const Vec3 fallback = std::fabs(forward.y) > 0.99f ? Vec3{1.0f, 0.0f, 0.0f} : Vec3{0.0f, 1.0f, 0.0f};
        right = normalize(cross(forward, fallback));
    } else {
        right = normalize(right);
    }
    const Vec3 trueUp = cross(right, forward);

    // The basis vectors are the *rows* of the view matrix (the rotation part is
    // the inverse of the camera's orientation), and the translation sits in the
    // last column. Writing them as columns instead produces a matrix that looks
    // plausible and puts the camera somewhere else entirely.
    Mat4 out;
    out.at(0, 0) = right.x;
    out.at(0, 1) = right.y;
    out.at(0, 2) = right.z;
    out.at(0, 3) = -dot(right, eye);
    out.at(1, 0) = trueUp.x;
    out.at(1, 1) = trueUp.y;
    out.at(1, 2) = trueUp.z;
    out.at(1, 3) = -dot(trueUp, eye);
    out.at(2, 0) = -forward.x;
    out.at(2, 1) = -forward.y;
    out.at(2, 2) = -forward.z;
    out.at(2, 3) = dot(forward, eye);
    return out;
}

Mat4 perspective(float fovYRadians, float aspect, float nearPlane, float farPlane) {
    Mat4 out;
    const float focal = 1.0f / std::tan(fovYRadians * 0.5f);
    out.at(0, 0) = focal / (aspect > 0.0f ? aspect : 1.0f);
    out.at(1, 1) = focal;
    out.at(2, 2) = farPlane / (nearPlane - farPlane);
    out.at(2, 3) = (farPlane * nearPlane) / (nearPlane - farPlane);
    out.at(3, 2) = -1.0f;
    out.at(3, 3) = 0.0f;
    return out;
}

Mat4 orthographic(float left, float right, float bottom, float top, float nearPlane, float farPlane) {
    Mat4 out;
    const float width = right - left;
    const float height = top - bottom;
    const float depth = farPlane - nearPlane;
    out.at(0, 0) = width != 0.0f ? 2.0f / width : 0.0f;
    out.at(1, 1) = height != 0.0f ? 2.0f / height : 0.0f;
    // z_view = -near must land on 0 and -far on 1, which solves to
    // z = -z_view / depth - near / depth: note the *negative* sign. A positive
    // one (the shape a GL [-1, 1] mental model produces) pushes the whole scene
    // outside the depth range, so the shadow pass renders nothing -- which is
    // how this was caught.
    out.at(2, 2) = depth != 0.0f ? -1.0f / depth : 0.0f;
    out.at(0, 3) = width != 0.0f ? -(right + left) / width : 0.0f;
    out.at(1, 3) = height != 0.0f ? -(top + bottom) / height : 0.0f;
    out.at(2, 3) = depth != 0.0f ? -nearPlane / depth : 0.0f;
    return out;
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

float terrainHeightAt(uint64_t seed, float size, Vec3 position) {
    const float half = size * 0.5f;
    if (half <= 0.0f) return 0.0f;
    const float u = (position.x + half) / size;
    const float v = (position.z + half) / size;
    // Two scales: a rolling base and a finer detail layer.
    const float base = fractalNoise(seed, u * 3.0f, v * 3.0f);
    const float detail = valueNoise(seed ^ 0x51ed2701u, u * 11.0f, v * 11.0f, 7u);
    const float ridges = std::fabs(base * 2.0f - 1.0f);
    return (base * 7.0f - 3.0f) + detail * 0.9f + (1.0f - ridges) * 1.4f;
}

Mesh buildTerrainMesh(uint64_t seed, float size, uint32_t resolution) {
    Mesh mesh;
    if (resolution < 2 || size <= 0.0f) return mesh;

    const uint32_t verticesPerSide = resolution + 1;
    mesh.vertices.reserve(static_cast<size_t>(verticesPerSide) * verticesPerSide);
    const float step = size / static_cast<float>(resolution);
    const float half = size * 0.5f;
    // Finite-difference spacing for the normals: half a quad keeps the normal
    // step inside the rendered cell instead of straddling two.
    const float delta = step * 0.5f;

    for (uint32_t z = 0; z < verticesPerSide; ++z) {
        for (uint32_t x = 0; x < verticesPerSide; ++x) {
            const float worldX = -half + static_cast<float>(x) * step;
            const float worldZ = -half + static_cast<float>(z) * step;
            const float height = terrainHeightAt(seed, size, Vec3{worldX, 0.0f, worldZ});
            const float left = terrainHeightAt(seed, size, Vec3{worldX - delta, 0.0f, worldZ});
            const float right = terrainHeightAt(seed, size, Vec3{worldX + delta, 0.0f, worldZ});
            const float back = terrainHeightAt(seed, size, Vec3{worldX, 0.0f, worldZ - delta});
            const float front = terrainHeightAt(seed, size, Vec3{worldX, 0.0f, worldZ + delta});

            Vertex vertex{};
            vertex.position[0] = worldX;
            vertex.position[1] = height;
            vertex.position[2] = worldZ;
            const Vec3 normal = normalize(Vec3{-(right - left), 2.0f * delta, -(front - back)});
            vertex.normal[0] = normal.x;
            vertex.normal[1] = normal.y;
            vertex.normal[2] = normal.z;
            vertex.uv[0] = static_cast<float>(x) / static_cast<float>(resolution);
            vertex.uv[1] = static_cast<float>(z) / static_cast<float>(resolution);
            mesh.vertices.push_back(vertex);
        }
    }

    mesh.indices.reserve(static_cast<size_t>(resolution) * resolution * 6);
    for (uint32_t z = 0; z < resolution; ++z) {
        for (uint32_t x = 0; x < resolution; ++x) {
            const uint32_t topLeft = z * verticesPerSide + x;
            const uint32_t topRight = topLeft + 1;
            const uint32_t bottomLeft = topLeft + verticesPerSide;
            const uint32_t bottomRight = bottomLeft + 1;
            // Counter-clockwise when viewed from above, so a back-face cull keeps
            // the ground and drops the underside.
            mesh.indices.push_back(topLeft);
            mesh.indices.push_back(bottomLeft);
            mesh.indices.push_back(topRight);
            mesh.indices.push_back(topRight);
            mesh.indices.push_back(bottomLeft);
            mesh.indices.push_back(bottomRight);
        }
    }
    return mesh;
}

Mesh buildBoxMesh() {
    Mesh mesh;
    const float h = 0.5f;
    // Six faces, four vertices each: a cube with per-face normals (a shared
    // vertex would average the normals and round the corners).
    struct Face { float normal[3]; float corners[4][3]; };
    const Face faces[6] = {
        {{0, 0, 1},  {{-h, -h, h}, {h, -h, h}, {h, h, h}, {-h, h, h}}},
        {{0, 0, -1}, {{h, -h, -h}, {-h, -h, -h}, {-h, h, -h}, {h, h, -h}}},
        {{1, 0, 0},  {{h, -h, h}, {h, -h, -h}, {h, h, -h}, {h, h, h}}},
        {{-1, 0, 0}, {{-h, -h, -h}, {-h, -h, h}, {-h, h, h}, {-h, h, -h}}},
        {{0, 1, 0},  {{-h, h, h}, {h, h, h}, {h, h, -h}, {-h, h, -h}}},
        {{0, -1, 0}, {{-h, -h, -h}, {h, -h, -h}, {h, -h, h}, {-h, -h, h}}},
    };
    const float faceUv[4][2] = {{0, 1}, {1, 1}, {1, 0}, {0, 0}};
    for (const Face& face : faces) {
        const uint32_t base = mesh.vertexCount();
        for (int corner = 0; corner < 4; ++corner) {
            Vertex vertex{};
            vertex.position[0] = face.corners[corner][0];
            vertex.position[1] = face.corners[corner][1];
            vertex.position[2] = face.corners[corner][2];
            vertex.normal[0] = face.normal[0];
            vertex.normal[1] = face.normal[1];
            vertex.normal[2] = face.normal[2];
            vertex.uv[0] = faceUv[corner][0];
            vertex.uv[1] = faceUv[corner][1];
            mesh.vertices.push_back(vertex);
        }
        mesh.indices.push_back(base + 0);
        mesh.indices.push_back(base + 1);
        mesh.indices.push_back(base + 2);
        mesh.indices.push_back(base + 0);
        mesh.indices.push_back(base + 2);
        mesh.indices.push_back(base + 3);
    }
    return mesh;
}

Mesh buildSphereMesh(uint32_t segments, uint32_t rings) {
    Mesh mesh;
    if (segments < 3 || rings < 2) return mesh;
    const float radius = 0.5f;
    const uint32_t verticesPerRing = segments + 1;

    for (uint32_t ring = 0; ring <= rings; ++ring) {
        const float v = static_cast<float>(ring) / static_cast<float>(rings);
        const float polar = v * kPi;
        const float sinPolar = std::sin(polar);
        const float cosPolar = std::cos(polar);
        for (uint32_t segment = 0; segment <= segments; ++segment) {
            const float u = static_cast<float>(segment) / static_cast<float>(segments);
            const float azimuth = u * 2.0f * kPi;
            const Vec3 normal{sinPolar * std::cos(azimuth), cosPolar, sinPolar * std::sin(azimuth)};
            Vertex vertex{};
            vertex.position[0] = normal.x * radius;
            vertex.position[1] = normal.y * radius;
            vertex.position[2] = normal.z * radius;
            vertex.normal[0] = normal.x;
            vertex.normal[1] = normal.y;
            vertex.normal[2] = normal.z;
            vertex.uv[0] = u;
            vertex.uv[1] = v;
            mesh.vertices.push_back(vertex);
        }
    }

    for (uint32_t ring = 0; ring < rings; ++ring) {
        for (uint32_t segment = 0; segment < segments; ++segment) {
            const uint32_t a = ring * verticesPerRing + segment;
            const uint32_t b = a + verticesPerRing;
            mesh.indices.push_back(a);
            mesh.indices.push_back(b);
            mesh.indices.push_back(a + 1);
            mesh.indices.push_back(a + 1);
            mesh.indices.push_back(b);
            mesh.indices.push_back(b + 1);
        }
    }
    return mesh;
}

// ---------------------------------------------------------------------------
// Scene assembly
// ---------------------------------------------------------------------------

namespace {

Instance makeInstance(Vec3 position, float yaw, Vec3 scale, Vec3 color, float emissive,
                      float roughness, float uvScale) {
    // Note: the local is deliberately not called `translation`, which is also the
    // name of the matrix builder it calls.
    const Mat4 transform = translation(position) * rotationY(yaw) * scaling(scale);
    Instance instance{};
    for (int i = 0; i < 16; ++i) instance.transform[i] = transform.m[i];
    instance.color[0] = color.x;
    instance.color[1] = color.y;
    instance.color[2] = color.z;
    instance.color[3] = 1.0f;
    instance.material[0] = emissive;
    instance.material[1] = roughness;
    instance.material[2] = uvScale;
    instance.material[3] = 0.0f;
    return instance;
}

struct QualitySettings {
    uint32_t terrainResolution;
    float terrainSize;
    uint32_t buildingGrid;
    uint32_t movingObjects;
    uint32_t particles;
    uint32_t props;
};

QualitySettings settingsFor(DemoQuality quality) {
    switch (quality) {
        case DemoQuality::Low:    return {48, 60.0f, 3, 1, 1024, 0};
        case DemoQuality::High:   return {160, 140.0f, 6, 5, 16384, 24};
        case DemoQuality::Medium:
        default:                  return {96, 100.0f, 4, 3, 4096, 8};
    }
}

}  // namespace

SceneBuild buildDemoScene(uint64_t seed, DemoQuality quality) {
    const QualitySettings settings = settingsFor(quality);
    SceneBuild scene;
    scene.terrain = buildTerrainMesh(seed, settings.terrainSize, settings.terrainResolution);
    scene.box = buildBoxMesh();
    scene.sphere = buildSphereMesh(24, 16);
    scene.movingObjectCount = settings.movingObjects;
    scene.particleCount = settings.particles;
    scene.terrainSize = settings.terrainSize;

    // The ground is one instance at the origin: the mesh already carries world
    // positions, so its transform is the identity.
    scene.terrainInstances.instances.push_back(
        makeInstance(Vec3{0.0f, 0.0f, 0.0f}, 0.0f, Vec3{1.0f, 1.0f, 1.0f}, Vec3{0.34f, 0.46f, 0.28f}, 0.0f,
                     0.85f, 1.0f));

    // Buildings on a jittered grid, skipped where the hash says so, each one
    // dropped onto the terrain so nothing floats.
    const float spacing = settings.terrainSize / static_cast<float>(settings.buildingGrid * 2 + 1);
    const float half = settings.terrainSize * 0.42f;
    for (int gz = -static_cast<int>(settings.buildingGrid); gz <= static_cast<int>(settings.buildingGrid); ++gz) {
        for (int gx = -static_cast<int>(settings.buildingGrid); gx <= static_cast<int>(settings.buildingGrid); ++gx) {
            const uint32_t h = hashCombine(seed, gx, gz, 91u);
            if ((h % 100u) < 42u) continue;   // leave gaps: a grid looks synthetic

            const float jitterX = (hashToUnitFloat(hashU32(h ^ 0x1111u)) - 0.5f) * spacing * 0.6f;
            const float jitterZ = (hashToUnitFloat(hashU32(h ^ 0x2222u)) - 0.5f) * spacing * 0.6f;
            const float x = static_cast<float>(gx) * spacing + jitterX;
            const float z = static_cast<float>(gz) * spacing + jitterZ;
            if (std::fabs(x) > half || std::fabs(z) > half) continue;

            const float width = 2.2f + hashToUnitFloat(hashU32(h ^ 0x3333u)) * 2.6f;
            const float depth = 2.2f + hashToUnitFloat(hashU32(h ^ 0x4444u)) * 2.6f;
            const float height = 3.0f + hashToUnitFloat(hashU32(h ^ 0x5555u)) * 9.0f;
            const float yaw = hashToUnitFloat(hashU32(h ^ 0x6666u)) * kPi;
            const float ground = terrainHeightAt(seed, settings.terrainSize, Vec3{x, 0.0f, z});

            // Warm windows on the tall blocks, cool concrete on the low ones.
            const float lit = hashToUnitFloat(hashU32(h ^ 0x7777u));
            const Vec3 color = lit > 0.6f ? Vec3{0.72f, 0.62f, 0.48f} : Vec3{0.42f, 0.45f, 0.52f};
            scene.buildingInstances.instances.push_back(
                makeInstance(Vec3{x, ground + height * 0.5f - 0.2f, z}, yaw, Vec3{width, height, depth}, color,
                             lit > 0.8f ? 0.25f : 0.0f, 0.7f, 1.0f));
        }
    }

    // A few floating props give the temporal path something small and bright to
    // track — a still scene would let a broken motion path look fine.
    for (uint32_t i = 0; i < settings.props; ++i) {
        const uint32_t h = hashCombine(seed, static_cast<int32_t>(i), 0x50, 173u);
        const float angle = hashToUnitFloat(h) * 2.0f * kPi;
        const float radius = 12.0f + hashToUnitFloat(hashU32(h ^ 0xabcdu)) * 26.0f;
        const float x = std::cos(angle) * radius;
        const float z = std::sin(angle) * radius;
        const float y = terrainHeightAt(seed, settings.terrainSize, Vec3{x, 0.0f, z}) + 6.0f +
                        hashToUnitFloat(hashU32(h ^ 0x1234u)) * 6.0f;
        const float scale = 0.7f + hashToUnitFloat(hashU32(h ^ 0x9876u)) * 0.9f;
        scene.propInstances.instances.push_back(makeInstance(Vec3{x, y, z}, 0.0f, Vec3{scale, scale, scale},
                                                             Vec3{0.85f, 0.78f, 0.35f}, 0.45f, 0.4f, 1.0f));
    }

    scene.emitter = movingObjectPosition(0, 0.0);
    scene.sunDirection = sunDirectionForTime(0.0);
    return scene;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

Vec3 movingObjectPosition(uint32_t index, double t) {
    const double phase = static_cast<double>(index) * 2.09439510239;   // 120° apart
    const double speed = 0.36 + 0.07 * static_cast<double>(index % 3u);
    const double angle = t * speed + phase;
    const double radius = 13.0 + 3.5 * static_cast<double>(index % 4u);
    const double height = 7.5 + 2.6 * std::sin(t * 0.55 + phase) + 0.8 * static_cast<double>(index % 3u);
    return Vec3{static_cast<float>(std::cos(angle) * radius), static_cast<float>(height),
                static_cast<float>(std::sin(angle) * radius)};
}

void animateMovingObjects(uint32_t count, double t, InstanceBatch& out, Vec3& outEmitter) {
    out.clear();
    for (uint32_t i = 0; i < count; ++i) {
        const Vec3 position = movingObjectPosition(i, t);
        const float scale = 1.5f + 0.25f * static_cast<float>(i % 3u);
        const Vec3 color = (i % 3u) == 0u   ? Vec3{0.95f, 0.45f, 0.25f}
                           : (i % 3u) == 1u ? Vec3{0.35f, 0.75f, 0.95f}
                                            : Vec3{0.85f, 0.85f, 0.55f};
        // A spin around y keeps the silhouette moving even when the path is slow.
        out.instances.push_back(makeInstance(position, static_cast<float>(t * 0.9 + i), 
                                             Vec3{scale, scale, scale}, color, 0.2f, 0.35f, 1.0f));
    }
    // The emitter trails the lead object: the plume is then visibly attached to
    // something moving, so a broken particle transform is obvious.
    outEmitter = movingObjectPosition(0, t) + Vec3{0.0f, -0.7f, 0.0f};
}

// ---------------------------------------------------------------------------
// Camera and light
// ---------------------------------------------------------------------------

Mat4 cameraViewMatrix(const Camera& camera) { return lookAt(camera.position, camera.target, camera.up); }

Mat4 cameraProjectionMatrix(const Camera& camera, float aspect) {
    return perspective(radians(camera.fovYDegrees), aspect, camera.nearPlane, camera.farPlane);
}

Camera orbitCamera(double t, float radius, float height, uint32_t path) {
    Camera camera;
    const double yaw = t * 0.13 + static_cast<double>(path) * 1.71;
    const float centreY = 1.5f + static_cast<float>(std::sin(t * 0.31)) * 0.6f;
    camera.target = Vec3{0.0f, centreY, 0.0f};
    camera.position = Vec3{static_cast<float>(std::sin(yaw)) * radius,
                           height + static_cast<float>(std::sin(t * 0.21)) * 0.8f,
                           static_cast<float>(std::cos(yaw)) * radius};
    camera.up = Vec3{0.0f, 1.0f, 0.0f};
    return camera;
}

Vec3 sunDirectionForTime(double t) {
    const double azimuth = radians(40.0f) + t * 0.004;
    const double elevation = radians(34.0f) + std::sin(t * 0.03) * 0.09;
    const double cosElevation = std::cos(elevation);
    return normalize(Vec3{static_cast<float>(cosElevation * std::sin(azimuth)), static_cast<float>(std::sin(elevation)),
                          static_cast<float>(cosElevation * std::cos(azimuth))});
}

Mat4 sunViewProjection(Vec3 sunDirection, Vec3 centre, float radius, float depth) {
    const Vec3 eye = centre + sunDirection * (depth * 0.5f);
    const Mat4 view = lookAt(eye, centre, Vec3{0.0f, 1.0f, 0.0f});
    const Mat4 projection = orthographic(-radius, radius, -radius, radius, 0.05f, depth);
    return projection * view;
}

// ---------------------------------------------------------------------------
// Particles (mirror of shaders/particle_sim.comp)
// ---------------------------------------------------------------------------

uint32_t particleHash(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

float particleRandomFloat(uint32_t& state) {
    state = particleHash(state);
    return static_cast<float>(state & 0x00FFFFFFu) / static_cast<float>(0x00FFFFFFu);
}

Vec3 particleRandomUnitVector(uint32_t& state) {
    const float theta = particleRandomFloat(state) * 6.2831853f;
    const float z = particleRandomFloat(state) * 2.0f - 1.0f;
    const float r = std::sqrt(std::max(0.0f, 1.0f - z * z));
    return Vec3{r * std::cos(theta), z, r * std::sin(theta)};
}

namespace {

// One particle's respawn, factorised so reset and step cannot drift apart. The
// constants are the shader's, deliberately.
void respawn(Particle& particle, uint32_t& state, const Vec3& emitter) {
    const Vec3 offset = particleRandomUnitVector(state) * 0.35f;
    const Vec3 velocity = particleRandomUnitVector(state) * 1.2f + Vec3{0.0f, 1.6f, 0.0f};
    particle.positionSize[0] = emitter.x + offset.x;
    particle.positionSize[1] = emitter.y + offset.y;
    particle.positionSize[2] = emitter.z + offset.z;
    particle.velocity[0] = velocity.x;
    particle.velocity[1] = velocity.y;
    particle.velocity[2] = velocity.z;
    particle.colourLife[3] = 0.001f;
    particle.positionSize[3] = 0.06f + particleRandomFloat(state) * 0.05f;
    const float warm = particleRandomFloat(state);
    const Vec3 ember{1.0f, 0.45f, 0.12f};
    const Vec3 spark{0.35f, 0.7f, 1.0f};
    const Vec3 color = lerp(ember, spark, warm);
    particle.colourLife[0] = color.x;
    particle.colourLife[1] = color.y;
    particle.colourLife[2] = color.z;
}

}  // namespace

void resetParticles(std::vector<Particle>& particles, uint32_t count, uint32_t seed, Vec3 emitter) {
    particles.assign(count, Particle{});
    for (uint32_t i = 0; i < count; ++i) {
        // Stagger the initial life so the plume starts fully populated instead
        // of every particle dying on the same frame.
        uint32_t state = particleHash(i * 2654435761u + seed);
        respawn(particles[i], state, emitter);
        particles[i].colourLife[3] = particleRandomFloat(state) * 0.98f;
    }
}

void stepParticles(std::vector<Particle>& particles, float deltaSeconds, uint32_t seed, Vec3 emitter,
                   float gravity) {
    for (uint32_t i = 0; i < particles.size(); ++i) {
        Particle& particle = particles[i];
        uint32_t state = particleHash(i * 2654435761u + seed);
        if (particle.colourLife[3] <= 0.0f) {
            respawn(particle, state, emitter);
        }
        particle.velocity[1] -= gravity * deltaSeconds;
        const float damping = 1.0f - kParticleDrag * deltaSeconds;
        particle.velocity[0] *= damping;
        particle.velocity[1] *= damping;
        particle.velocity[2] *= damping;
        particle.positionSize[0] += particle.velocity[0] * deltaSeconds;
        particle.positionSize[1] += particle.velocity[1] * deltaSeconds;
        particle.positionSize[2] += particle.velocity[2] * deltaSeconds;
        particle.colourLife[3] += deltaSeconds * kParticleLifeRate;
        if (particle.colourLife[3] >= 1.0f) {
            particle.colourLife[3] = 0.0f;   // respawn flag, read on the next step
        }
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const char* demoModeName(DemoMode mode) {
    switch (mode) {
        case DemoMode::Native:       return "Native";
        case DemoMode::AiUpscaled:   return "AI upscaling";
        case DemoMode::SplitCompare: return "Split comparison";
    }
    return "Unknown";
}

bool validateDemoConfig(const DemoConfig& config, std::string* error) {
    const Resolution* rungs = demoResolutions();
    if (config.renderIndex >= kDemoResolutionCount) {
        if (error != nullptr) *error = "the render resolution index is outside the ladder";
        return false;
    }
    if (config.outputIndex >= kDemoResolutionCount) {
        if (error != nullptr) *error = "the output resolution index is outside the ladder";
        return false;
    }
    const Resolution& render = rungs[config.renderIndex];
    const Resolution& output = rungs[config.outputIndex];
    if (output.width < render.width || output.height < render.height) {
        if (error != nullptr) {
            *error = std::string("the output resolution (") + output.name + ") is below the render resolution (" +
                     render.name + "); upscaling to a smaller target is not a demo of anything";
        }
        return false;
    }
    if (config.splitPosition < 0.0f || config.splitPosition > 1.0f) {
        if (error != nullptr) *error = "the split position must be in [0, 1]";
        return false;
    }
    if (config.magnifierScale < 1.0f) {
        if (error != nullptr) *error = "the magnifier scale must be at least 1 (1 disables the inset)";
        return false;
    }
    if (config.durationSeconds < 0.0) {
        if (error != nullptr) *error = "the duration cannot be negative";
        return false;
    }
    return true;
}

}  // namespace demo
}  // namespace v4k
