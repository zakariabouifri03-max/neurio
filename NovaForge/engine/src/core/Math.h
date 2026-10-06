// NovaForge Engine - core/Math.h
// Double-precision-free, self contained real-time math library (vec/mat/quat/aabb/ray).
#pragma once

#include "core/Base.h"

namespace nf {

constexpr f32 kPi = 3.14159265358979323846f;
constexpr f32 kTwoPi = 6.28318530717958647692f;
constexpr f32 kHalfPi = 1.57079632679489661923f;
constexpr f32 kDegToRad = kPi / 180.0f;
constexpr f32 kRadToDeg = 180.0f / kPi;
constexpr f32 kEpsilon = 1e-6f;

inline f32 Clamp(f32 v, f32 lo, f32 hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline f32 Saturate(f32 v) { return Clamp(v, 0.0f, 1.0f); }
inline f32 Lerp(f32 a, f32 b, f32 t) { return a + (b - a) * t; }
inline f32 Sign(f32 v) { return v < 0.0f ? -1.0f : 1.0f; }
inline f32 Sqrt(f32 v) { return std::sqrt(v); }
inline f32 Abs(f32 v) { return v < 0 ? -v : v; }
inline f32 Sin(f32 v) { return std::sin(v); }
inline f32 Cos(f32 v) { return std::cos(v); }
inline f32 Atan2(f32 y, f32 x) { return std::atan2(y, x); }
inline f32 Floor(f32 v) { return std::floor(v); }
inline f32 Round(f32 v) { return std::round(v); }
inline f32 Fmod(f32 a, f32 b) { return std::fmod(a, b); }
inline f32 MoveTowards(f32 cur, f32 target, f32 maxDelta) {
  f32 d = target - cur;
  if (Abs(d) <= maxDelta) return target;
  return cur + Sign(d) * maxDelta;
}

// ------------------------------------------------------------------------------ Vec2
struct Vec2 {
  f32 x = 0, y = 0;
  Vec2() = default;
  Vec2(f32 x_, f32 y_) : x(x_), y(y_) {}
  Vec2 operator+(const Vec2& o) const { return {x + o.x, y + o.y}; }
  Vec2 operator-(const Vec2& o) const { return {x - o.x, y - o.y}; }
  Vec2 operator*(f32 s) const { return {x * s, y * s}; }
  Vec2 operator/(f32 s) const { return {x / s, y / s}; }
  Vec2 operator-() const { return {-x, -y}; }
  bool operator==(const Vec2& o) const { return x == o.x && y == o.y; }
  bool operator!=(const Vec2& o) const { return !(*this == o); }
  Vec2& operator+=(const Vec2& o) { x += o.x; y += o.y; return *this; }
  Vec2& operator-=(const Vec2& o) { x -= o.x; y -= o.y; return *this; }
};
inline f32 Dot(const Vec2& a, const Vec2& b) { return a.x * b.x + a.y * b.y; }
inline f32 Length(const Vec2& v) { return Sqrt(Dot(v, v)); }

// ------------------------------------------------------------------------------ Vec3
struct Vec3 {
  f32 x = 0, y = 0, z = 0;
  Vec3() = default;
  Vec3(f32 x_, f32 y_, f32 z_) : x(x_), y(y_), z(z_) {}
  explicit Vec3(f32 s) : x(s), y(s), z(s) {}
  f32& operator[](int i) { return (&x)[i]; }
  f32 operator[](int i) const { return (&x)[i]; }
  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(f32 s) const { return {x * s, y * s, z * s}; }
  Vec3 operator*(const Vec3& o) const { return {x * o.x, y * o.y, z * o.z}; }
  Vec3 operator/(f32 s) const { return {x / s, y / s, z / s}; }
  Vec3 operator/(const Vec3& o) const { return {x / o.x, y / o.y, z / o.z}; }
  Vec3 operator-() const { return {-x, -y, -z}; }
  bool operator==(const Vec3& o) const { return x == o.x && y == o.y && z == o.z; }
  bool operator!=(const Vec3& o) const { return !(*this == o); }
  Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
  Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
  Vec3& operator*=(f32 s) { x *= s; y *= s; z *= s; return *this; }
};
inline Vec3 operator*(f32 s, const Vec3& v) { return v * s; }
inline f32 Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 Cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline f32 LengthSq(const Vec3& v) { return Dot(v, v); }
inline f32 Length(const Vec3& v) { return Sqrt(Dot(v, v)); }
inline f32 Distance(const Vec3& a, const Vec3& b) { return Length(b - a); }
inline Vec3 Normalize(const Vec3& v) {
  f32 len = Length(v);
  return len > kEpsilon ? v / len : Vec3(0, 0, 0);
}
inline Vec3 Lerp(const Vec3& a, const Vec3& b, f32 t) { return a + (b - a) * t; }
inline Vec3 Min(const Vec3& a, const Vec3& b) { return {std::min(a.x,b.x), std::min(a.y,b.y), std::min(a.z,b.z)}; }
inline Vec3 Max(const Vec3& a, const Vec3& b) { return {std::max(a.x,b.x), std::max(a.y,b.y), std::max(a.z,b.z)}; }
inline Vec3 Abs(const Vec3& v) { return {Abs(v.x), Abs(v.y), Abs(v.z)}; }
inline f32 MaxComponent(const Vec3& v) { return std::max(v.x, std::max(v.y, v.z)); }
inline f32 MinComponent(const Vec3& v) { return std::min(v.x, std::min(v.y, v.z)); }
inline Vec3 Reflect(const Vec3& v, const Vec3& n) { return v - n * (2.0f * Dot(v, n)); }
inline Vec3 MoveTowards(const Vec3& cur, const Vec3& target, f32 maxDelta) {
  Vec3 d = target - cur; f32 len = Length(d);
  if (len <= maxDelta || len < kEpsilon) return target;
  return cur + d / len * maxDelta;
}
inline Vec3 SlerpDir(const Vec3& a, const Vec3& b, f32 t) {
  f32 d = Saturate(Dot(Normalize(a), Normalize(b)));
  f32 theta = std::acos(d) * t;
  Vec3 rel = Normalize(b - a * Dot(a, b));
  return Normalize(a * std::cos(theta) + rel * std::sin(theta));
}

// ------------------------------------------------------------------------------ Vec4
struct Vec4 {
  f32 x = 0, y = 0, z = 0, w = 0;
  Vec4() = default;
  Vec4(f32 x_, f32 y_, f32 z_, f32 w_) : x(x_), y(y_), z(z_), w(w_) {}
  Vec4(const Vec3& v, f32 w_) : x(v.x), y(v.y), z(v.z), w(w_) {}
  f32& operator[](int i) { return (&x)[i]; }
  f32 operator[](int i) const { return (&x)[i]; }
  Vec3 xyz() const { return {x, y, z}; }
  Vec4 operator+(const Vec4& o) const { return {x+o.x, y+o.y, z+o.z, w+o.w}; }
  Vec4 operator-(const Vec4& o) const { return {x-o.x, y-o.y, z-o.z, w-o.w}; }
  Vec4 operator*(f32 s) const { return {x*s, y*s, z*s, w*s}; }
  bool operator==(const Vec4& o) const { return x == o.x && y == o.y && z == o.z && w == o.w; }
  bool operator!=(const Vec4& o) const { return !(*this == o); }
};
inline f32 Dot(const Vec4& a, const Vec4& b) { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; }

// ------------------------------------------------------------------------------ Mat4
// Column-major storage (matches OpenGL / GLSL): m[col * 4 + row].
struct Mat4 {
  f32 m[16] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};

  static Mat4 Identity() { return Mat4(); }
  static Mat4 Zero() { Mat4 r; for (int i = 0; i < 16; i++) r.m[i] = 0; return r; }

  f32& At(int row, int col) { return m[col * 4 + row]; }
  f32 At(int row, int col) const { return m[col * 4 + row]; }
  f32* data() { return m; }
  const f32* data() const { return m; }

  static Mat4 Translate(const Vec3& t) {
    Mat4 r; r.At(0,3) = t.x; r.At(1,3) = t.y; r.At(2,3) = t.z; return r;
  }
  static Mat4 Scale(const Vec3& s) {
    Mat4 r; r.At(0,0) = s.x; r.At(1,1) = s.y; r.At(2,2) = s.z; return r;
  }
  static Mat4 RotateX(f32 rad) {
    Mat4 r; f32 c = Cos(rad), s = Sin(rad);
    r.At(1,1) = c; r.At(1,2) = -s; r.At(2,1) = s; r.At(2,2) = c; return r;
  }
  static Mat4 RotateY(f32 rad) {
    Mat4 r; f32 c = Cos(rad), s = Sin(rad);
    r.At(0,0) = c; r.At(0,2) = s; r.At(2,0) = -s; r.At(2,2) = c; return r;
  }
  static Mat4 RotateZ(f32 rad) {
    Mat4 r; f32 c = Cos(rad), s = Sin(rad);
    r.At(0,0) = c; r.At(0,1) = -s; r.At(1,0) = s; r.At(1,1) = c; return r;
  }
  static Mat4 TRS(const Vec3& t, const struct Quat& q, const Vec3& s);
  static Mat4 Perspective(f32 fovYRad, f32 aspect, f32 nearZ, f32 farZ);
  static Mat4 Ortho(f32 l, f32 r, f32 b, f32 t, f32 n, f32 f);
  static Mat4 LookAt(const Vec3& eye, const Vec3& center, const Vec3& up);

  Mat4 operator*(const Mat4& o) const {
    Mat4 r;
    for (int c = 0; c < 4; c++)
      for (int row = 0; row < 4; row++) {
        f32 sum = 0;
        for (int k = 0; k < 4; k++) sum += At(row, k) * o.At(k, c);
        r.At(row, c) = sum;
      }
    return r;
  }
  Vec4 operator*(const Vec4& v) const {
    return {At(0,0)*v.x + At(0,1)*v.y + At(0,2)*v.z + At(0,3)*v.w,
            At(1,0)*v.x + At(1,1)*v.y + At(1,2)*v.z + At(1,3)*v.w,
            At(2,0)*v.x + At(2,1)*v.y + At(2,2)*v.z + At(2,3)*v.w,
            At(3,0)*v.x + At(3,1)*v.y + At(3,2)*v.z + At(3,3)*v.w};
  }
  Vec3 TransformPoint(const Vec3& p) const {
    Vec4 r = (*this) * Vec4(p, 1.0f);
    if (Abs(r.w) > kEpsilon && Abs(r.w - 1.0f) > kEpsilon) return r.xyz() / r.w;
    return r.xyz();
  }
  Vec3 TransformDir(const Vec3& d) const {
    return {At(0,0)*d.x + At(0,1)*d.y + At(0,2)*d.z,
            At(1,0)*d.x + At(1,1)*d.y + At(1,2)*d.z,
            At(2,0)*d.x + At(2,1)*d.y + At(2,2)*d.z};
  }
  Vec3 Translation() const { return {At(0,3), At(1,3), At(2,3)}; }
  Vec3 ScaleOf() const {
    return {Length(Vec3(At(0,0), At(1,0), At(2,0))),
            Length(Vec3(At(0,1), At(1,1), At(2,1))),
            Length(Vec3(At(0,2), At(1,2), At(2,2)))};
  }
  Mat4 Transposed() const {
    Mat4 r;
    for (int c = 0; c < 4; c++) for (int row = 0; row < 4; row++) r.At(row,c) = At(c,row);
    return r;
  }
  Mat4 Inverse() const;
  Mat4 NormalMatrix() const;   // inverse-transpose of the 3x3 part (rotation only result)
  f32 Determinant3x3() const;
};

// ------------------------------------------------------------------------------ Quat
struct Quat {
  f32 x = 0, y = 0, z = 0, w = 1;
  Quat() = default;
  Quat(f32 x_, f32 y_, f32 z_, f32 w_) : x(x_), y(y_), z(z_), w(w_) {}

  static Quat Identity() { return {}; }
  static Quat FromAxisAngle(const Vec3& axis, f32 rad);
  static Quat FromEuler(f32 pitchDeg, f32 yawDeg, f32 rollDeg);  // YXZ order (yaw, pitch, roll)
  static Quat FromMat4(const Mat4& m);
  static Quat FromTo(const Vec3& from, const Vec3& to);
  static Quat Slerp(const Quat& a, const Quat& b, f32 t);
  static Quat LookRotation(const Vec3& forward, const Vec3& up);

  Quat operator*(const Quat& o) const {
    return {w*o.x + x*o.w + y*o.z - z*o.y,
            w*o.y - x*o.z + y*o.w + z*o.x,
            w*o.z + x*o.y - y*o.x + z*o.w,
            w*o.w - x*o.x - y*o.y - z*o.z};
  }
  Vec3 operator*(const Vec3& v) const { return Rotate(v); }
  Quat operator*(f32 s) const { return {x*s, y*s, z*s, w*s}; }
  Quat operator+(const Quat& o) const { return {x+o.x, y+o.y, z+o.z, w+o.w}; }
  Quat& operator*=(const Quat& o) { *this = *this * o; return *this; }

  Vec3 Rotate(const Vec3& v) const;
  Quat Conjugate() const { return {-x, -y, -z, w}; }
  Quat Normalized() const;
  Mat4 ToMat4() const;
  Vec3 EulerDegrees() const;      // returns {pitch, yaw, roll} in degrees, YXZ
  static Quat RotateTowards(const Quat& a, const Quat& b, f32 maxRadians);
  static f32 AngleBetween(const Quat& a, const Quat& b);
};

// ------------------------------------------------------------------------- transforms
struct Transform {
  Vec3 position{0, 0, 0};
  Quat rotation = Quat::Identity();
  Vec3 scale{1, 1, 1};

  Mat4 Matrix() const { return Mat4::TRS(position, rotation, scale); }
  Vec3 Forward() const { return rotation * Vec3(0, 0, -1); }   // -Z forward (GL convention)
  Vec3 Right() const { return rotation * Vec3(1, 0, 0); }
  Vec3 Up() const { return rotation * Vec3(0, 1, 0); }
  static Transform FromMatrix(const Mat4& m);
  Transform Inverse() const;
};

// ------------------------------------------------------------------------------- AABB
struct AABB {
  Vec3 min{ 0, 0, 0 };
  Vec3 max{ 0, 0, 0 };

  bool IsValid() const { return min.x <= max.x && min.y <= max.y && min.z <= max.z; }
  Vec3 Center() const { return (min + max) * 0.5f; }
  Vec3 Extents() const { return (max - min) * 0.5f; }
  Vec3 Size() const { return max - min; }
  void Expand(const Vec3& p) { min = Min(min, p); max = Max(max, p); }        // include a point
  void Expand(const AABB& b) { min = Min(min, b.min); max = Max(max, b.max); }  // union
  void ExpandBy(const Vec3& amount) { min -= amount; max += amount; }           // inflate by a margin
  AABB Expanded(f32 amount) const { return {min - Vec3(amount), max + Vec3(amount)}; }
  bool Contains(const Vec3& p) const {
    return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
  }
  bool Intersects(const AABB& o) const {
    return min.x <= o.max.x && max.x >= o.min.x && min.y <= o.max.y && max.y >= o.min.y &&
           min.z <= o.max.z && max.z >= o.min.z;
  }
  static AABB FromCenterExtents(const Vec3& c, const Vec3& e) { return {c - e, c + e}; }
  static AABB Transform(const AABB& box, const Mat4& m);   // world-space AABB of a transformed box
};

// ------------------------------------------------------------------------------ Ray
struct Ray {
  Vec3 origin{0, 0, 0};
  Vec3 direction{0, 0, -1};
  Vec3 At(f32 t) const { return origin + direction * t; }
};
struct RayHit {
  bool hit = false;
  f32 distance = 0;
  Vec3 point{0, 0, 0};
  Vec3 normal{0, 1, 0};
  u64 entity = 0;      // EntityId of the hit object (0 = none)
};
bool RaycastAABB(const Ray& r, const AABB& box, f32* outT, Vec3* outNormal = nullptr);
bool RaycastSphere(const Ray& r, const Vec3& center, f32 radius, f32* outT);
bool RaycastPlane(const Ray& r, const Vec3& planePoint, const Vec3& planeNormal, f32* outT);
bool RaycastTriangle(const Ray& r, const Vec3& a, const Vec3& b, const Vec3& c, f32* outT,
                     f32* outU = nullptr, f32* outV = nullptr);
bool RaycastOBB(const Ray& r, const Vec3& center, const Vec3& extents, const Quat& rot, f32* outT);

bool SweepAABB(const AABB& box, const Vec3& delta, const AABB& target, Vec3* outNormal, f32* outT);

// ---------------------------------------------------------------------------- Frustum
struct Frustum {
  Vec4 planes[6];   // left, right, bottom, top, near, far (normal .xyz, d in .w)
  static Frustum FromMatrix(const Mat4& viewProj);
  bool TestAABB(const AABB& box) const;
  bool TestSphere(const Vec3& center, f32 radius) const;
};

// --------------------------------------------------------------------- misc utilities
inline Vec3 SphericalToDir(f32 yawRad, f32 pitchRad) {
  return {Cos(pitchRad) * Sin(yawRad), Sin(pitchRad), -Cos(pitchRad) * Cos(yawRad)};
}
inline f32 SmoothStep(f32 t) { t = Saturate(t); return t * t * (3.0f - 2.0f * t); }
inline f32 AngleLerp(f32 a, f32 b, f32 t) {
  f32 d = Fmod(b - a + kPi * 3.0f, kTwoPi) - kPi;
  return a + d * t;
}

} // namespace nf
