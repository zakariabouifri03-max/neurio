// Minimal 3D math for the demo scene.
//
// Conventions, fixed here once because every other file depends on them:
//
//   * Mat4 is **column major** with m[column * 4 + row], which is what std430
//     and GLSL expect, so a Mat4 can be memcpy'd into a uniform buffer and read
//     as a `mat4` in a shader without transposing anything. Nothing in this
//     project transposes a matrix after building it; a transposed matrix here
//     would be a silent rendering bug rather than a compile error.
//
//   * Clip space is Vulkan's: x and y in [-1, 1] with **+y up**, z in [0, 1]
//     (not OpenGL's [-1, 1]). The y-up choice is deliberate — the demo flips it
//     in the viewport with a negative height, which is the usual way to reuse
//     ordinary right-handed world space on Vulkan and keeps the projection math
//     (and its unit tests) readable.
//
//   * World space is right handed, +y up, right-handed look-at.
#pragma once

#include <cmath>

namespace v4k {
namespace demo {

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

struct Vec4 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float w = 0.0f;
};

inline Vec3 operator+(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator*(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator*(float s, Vec3 a) { return a * s; }
inline Vec3 operator-(Vec3 a) { return {-a.x, -a.y, -a.z}; }
inline Vec3& operator+=(Vec3& a, Vec3 b) { a = a + b; return a; }

inline float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(Vec3 a, Vec3 b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float length(Vec3 v) { return std::sqrt(dot(v, v)); }
inline Vec3 normalize(Vec3 v) {
    const float len = length(v);
    return len > 1e-8f ? v * (1.0f / len) : Vec3{0.0f, 0.0f, 0.0f};
}
inline Vec3 lerp(Vec3 a, Vec3 b, float t) { return a + (b - a) * t; }
inline bool isFinite(Vec3 v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

struct Mat4 {
    // Column major: m[column * 4 + row].
    float m[16] = {1.0f, 0.0f, 0.0f, 0.0f,
                   0.0f, 1.0f, 0.0f, 0.0f,
                   0.0f, 0.0f, 1.0f, 0.0f,
                   0.0f, 0.0f, 0.0f, 1.0f};

    float& at(int row, int column) { return m[column * 4 + row]; }
    float at(int row, int column) const { return m[column * 4 + row]; }
};

inline Mat4 identity() { return Mat4{}; }

inline Mat4 operator*(const Mat4& a, const Mat4& b) {
    Mat4 out;
    for (int column = 0; column < 4; ++column) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) sum += a.at(row, k) * b.at(k, column);
            out.at(row, column) = sum;
        }
    }
    return out;
}

inline Vec4 operator*(const Mat4& a, const Vec4& v) {
    return {a.at(0, 0) * v.x + a.at(0, 1) * v.y + a.at(0, 2) * v.z + a.at(0, 3) * v.w,
            a.at(1, 0) * v.x + a.at(1, 1) * v.y + a.at(1, 2) * v.z + a.at(1, 3) * v.w,
            a.at(2, 0) * v.x + a.at(2, 1) * v.y + a.at(2, 2) * v.z + a.at(2, 3) * v.w,
            a.at(3, 0) * v.x + a.at(3, 1) * v.y + a.at(3, 2) * v.z + a.at(3, 3) * v.w};
}

inline Vec3 transformPoint(const Mat4& a, Vec3 p) {
    const Vec4 r = a * Vec4{p.x, p.y, p.z, 1.0f};
    return {r.x, r.y, r.z};
}

inline Vec3 transformDirection(const Mat4& a, Vec3 d) {
    const Vec4 r = a * Vec4{d.x, d.y, d.z, 0.0f};
    return {r.x, r.y, r.z};
}

inline Mat4 translation(Vec3 t) {
    Mat4 out;
    out.at(0, 3) = t.x;
    out.at(1, 3) = t.y;
    out.at(2, 3) = t.z;
    return out;
}

inline Mat4 scaling(Vec3 s) {
    Mat4 out;
    out.at(0, 0) = s.x;
    out.at(1, 1) = s.y;
    out.at(2, 2) = s.z;
    return out;
}

inline Mat4 rotationX(float radians) {
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    Mat4 out;
    out.at(1, 1) = c;
    out.at(1, 2) = -s;
    out.at(2, 1) = s;
    out.at(2, 2) = c;
    return out;
}

inline Mat4 rotationY(float radians) {
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    Mat4 out;
    out.at(0, 0) = c;
    out.at(0, 2) = s;
    out.at(2, 0) = -s;
    out.at(2, 2) = c;
    return out;
}

inline Mat4 rotationZ(float radians) {
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    Mat4 out;
    out.at(0, 0) = c;
    out.at(0, 1) = -s;
    out.at(1, 0) = s;
    out.at(1, 1) = c;
    return out;
}

// Right-handed look-at (the same matrix gluLookAt produced).
Mat4 lookAt(Vec3 eye, Vec3 target, Vec3 up);

// Vulkan-convention perspective: z maps to [0, 1], x/y to [-1, 1], +y up.
// `fovYRadians` is the full vertical field of view.
Mat4 perspective(float fovYRadians, float aspect, float nearPlane, float farPlane);

// Right-handed orthographic projection into [0, 1] depth, used for the sun's
// shadow map.
Mat4 orthographic(float left, float right, float bottom, float top, float nearPlane, float farPlane);

}  // namespace demo
}  // namespace v4k
