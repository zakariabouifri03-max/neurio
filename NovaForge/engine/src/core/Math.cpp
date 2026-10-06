// NovaForge Engine - core/Math.cpp
#include "core/Math.h"

namespace nf {

// ------------------------------------------------------------------------------ Mat4
Mat4 Mat4::TRS(const Vec3& t, const Quat& q, const Vec3& s) {
  Mat4 r;
  f32 x = q.x, y = q.y, z = q.z, w = q.w;
  f32 x2 = x + x, y2 = y + y, z2 = z + z;
  f32 xx = x * x2, xy = x * y2, xz = x * z2;
  f32 yy = y * y2, yz = y * z2, zz = z * z2;
  f32 wx = w * x2, wy = w * y2, wz = w * z2;

  r.At(0,0) = (1 - (yy + zz)) * s.x;
  r.At(1,0) = (xy + wz) * s.x;
  r.At(2,0) = (xz - wy) * s.x;

  r.At(0,1) = (xy - wz) * s.y;
  r.At(1,1) = (1 - (xx + zz)) * s.y;
  r.At(2,1) = (yz + wx) * s.y;

  r.At(0,2) = (xz + wy) * s.z;
  r.At(1,2) = (yz - wx) * s.z;
  r.At(2,2) = (1 - (xx + yy)) * s.z;

  r.At(0,3) = t.x; r.At(1,3) = t.y; r.At(2,3) = t.z;
  r.At(3,3) = 1;
  return r;
}

Mat4 Mat4::Perspective(f32 fovYRad, f32 aspect, f32 nearZ, f32 farZ) {
  Mat4 r = Mat4::Zero();
  f32 f = 1.0f / std::tan(fovYRad * 0.5f);
  r.At(0,0) = f / aspect;
  r.At(1,1) = f;
  r.At(2,2) = (farZ + nearZ) / (nearZ - farZ);
  r.At(2,3) = (2.0f * farZ * nearZ) / (nearZ - farZ);
  r.At(3,2) = -1.0f;
  return r;
}

Mat4 Mat4::Ortho(f32 l, f32 r_, f32 b, f32 t, f32 n, f32 f) {
  Mat4 r = Mat4::Zero();
  r.At(0,0) = 2.0f / (r_ - l);
  r.At(1,1) = 2.0f / (t - b);
  r.At(2,2) = -2.0f / (f - n);
  r.At(0,3) = -(r_ + l) / (r_ - l);
  r.At(1,3) = -(t + b) / (t - b);
  r.At(2,3) = -(f + n) / (f - n);
  r.At(3,3) = 1.0f;
  return r;
}

Mat4 Mat4::LookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
  Vec3 f = Normalize(center - eye);
  Vec3 s = Normalize(Cross(f, up));
  Vec3 u = Cross(s, f);
  Mat4 r;
  r.At(0,0) = s.x; r.At(0,1) = s.y; r.At(0,2) = s.z; r.At(0,3) = -Dot(s, eye);
  r.At(1,0) = u.x; r.At(1,1) = u.y; r.At(1,2) = u.z; r.At(1,3) = -Dot(u, eye);
  r.At(2,0) = -f.x; r.At(2,1) = -f.y; r.At(2,2) = -f.z; r.At(2,3) = Dot(f, eye);
  r.At(3,0) = 0; r.At(3,1) = 0; r.At(3,2) = 0; r.At(3,3) = 1;
  return r;
}

f32 Mat4::Determinant3x3() const {
  return At(0,0) * (At(1,1) * At(2,2) - At(1,2) * At(2,1)) -
         At(0,1) * (At(1,0) * At(2,2) - At(1,2) * At(2,0)) +
         At(0,2) * (At(1,0) * At(2,1) - At(1,1) * At(2,0));
}

Mat4 Mat4::Inverse() const {
  // General 4x4 inverse (cofactor expansion), column-major aware.
  const f32* a = m;
  f32 inv[16];
  inv[0]  =  a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
  inv[4]  = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
  inv[8]  =  a[4]*a[9]*a[15]  - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]  + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
  inv[1]  = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
  inv[5]  =  a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
  inv[9]  = -a[0]*a[9]*a[15]  + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
  inv[13] =  a[0]*a[9]*a[14]  - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
  inv[2]  =  a[1]*a[6]*a[15]  - a[1]*a[7]*a[14]  - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7]  - a[13]*a[3]*a[6];
  inv[6]  = -a[0]*a[6]*a[15]  + a[0]*a[7]*a[14]  + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7]  + a[12]*a[3]*a[6];
  inv[10] =  a[0]*a[5]*a[15]  - a[0]*a[7]*a[13]  - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7]  - a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]  + a[0]*a[6]*a[13]  + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6]  + a[12]*a[2]*a[5];
  inv[3]  = -a[1]*a[6]*a[11]  + a[1]*a[7]*a[10]  + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7]   + a[9]*a[3]*a[6];
  inv[7]  =  a[0]*a[6]*a[11]  - a[0]*a[7]*a[10]  - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7]   - a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]  + a[0]*a[7]*a[9]   + a[4]*a[1]*a[11] - a[4]*a[3]*a[9]  - a[8]*a[1]*a[7]   + a[8]*a[3]*a[5];
  inv[15] =  a[0]*a[5]*a[10]  - a[0]*a[6]*a[9]   - a[4]*a[1]*a[10] + a[4]*a[2]*a[9]  + a[8]*a[1]*a[6]   - a[8]*a[2]*a[5];

  f32 det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  Mat4 out = Mat4::Identity();
  if (Abs(det) < 1e-12f) return out;
  det = 1.0f / det;
  for (int i = 0; i < 16; i++) out.m[i] = inv[i] * det;
  return out;
}

Mat4 Mat4::NormalMatrix() const {
  Mat4 r = Mat4::Identity();
  r.At(0,0) = At(0,0); r.At(0,1) = At(0,1); r.At(0,2) = At(0,2);
  r.At(1,0) = At(1,0); r.At(1,1) = At(1,1); r.At(1,2) = At(1,2);
  r.At(2,0) = At(2,0); r.At(2,1) = At(2,1); r.At(2,2) = At(2,2);
  // orient the 3x3 part for the row-vector style used by the shader: transpose(inverse(M3))
  Mat4 t = Mat4::Identity();
  t.At(0,0) = r.At(0,0); t.At(0,1) = r.At(1,0); t.At(0,2) = r.At(2,0);
  t.At(1,0) = r.At(0,1); t.At(1,1) = r.At(1,1); t.At(1,2) = r.At(2,1);
  t.At(2,0) = r.At(0,2); t.At(2,1) = r.At(1,2); t.At(2,2) = r.At(2,2);
  f32 det = t.Determinant3x3();
  if (Abs(det) < 1e-9f) return Mat4::Identity();
  f32 id = 1.0f / det;
  Mat4 adj = Mat4::Identity();
  adj.At(0,0) =  (t.At(1,1)*t.At(2,2) - t.At(1,2)*t.At(2,1)) * id;
  adj.At(1,0) = -(t.At(1,0)*t.At(2,2) - t.At(1,2)*t.At(2,0)) * id;
  adj.At(2,0) =  (t.At(1,0)*t.At(2,1) - t.At(1,1)*t.At(2,0)) * id;
  adj.At(0,1) = -(t.At(0,1)*t.At(2,2) - t.At(0,2)*t.At(2,1)) * id;
  adj.At(1,1) =  (t.At(0,0)*t.At(2,2) - t.At(0,2)*t.At(2,0)) * id;
  adj.At(2,1) = -(t.At(0,0)*t.At(2,1) - t.At(0,1)*t.At(2,0)) * id;
  adj.At(0,2) =  (t.At(0,1)*t.At(1,2) - t.At(0,2)*t.At(1,1)) * id;
  adj.At(1,2) = -(t.At(0,0)*t.At(1,2) - t.At(0,2)*t.At(1,0)) * id;
  adj.At(2,2) =  (t.At(0,0)*t.At(1,1) - t.At(0,1)*t.At(1,0)) * id;
  // transpose back
  Mat4 o = Mat4::Identity();
  o.At(0,0) = adj.At(0,0); o.At(0,1) = adj.At(1,0); o.At(0,2) = adj.At(2,0);
  o.At(1,0) = adj.At(0,1); o.At(1,1) = adj.At(1,1); o.At(1,2) = adj.At(2,1);
  o.At(2,0) = adj.At(0,2); o.At(2,1) = adj.At(1,2); o.At(2,2) = adj.At(2,2);
  return o;
}

// ------------------------------------------------------------------------------ Quat
Quat Quat::FromAxisAngle(const Vec3& axis, f32 rad) {
  Vec3 a = Normalize(axis);
  f32 h = rad * 0.5f, s = Sin(h);
  return {a.x * s, a.y * s, a.z * s, Cos(h)};
}

Quat Quat::FromEuler(f32 pitchDeg, f32 yawDeg, f32 rollDeg) {
  // YXZ: yaw (Y) * pitch (X) * roll (Z)
  Quat y = FromAxisAngle({0, 1, 0}, yawDeg * kDegToRad);
  Quat x = FromAxisAngle({1, 0, 0}, pitchDeg * kDegToRad);
  Quat z = FromAxisAngle({0, 0, 1}, rollDeg * kDegToRad);
  return y * x * z;
}

Quat Quat::FromMat4(const Mat4& m) {
  f32 sx = Length(Vec3(m.At(0,0), m.At(1,0), m.At(2,0)));
  f32 sy = Length(Vec3(m.At(0,1), m.At(1,1), m.At(2,1)));
  f32 sz = Length(Vec3(m.At(0,2), m.At(1,2), m.At(2,2)));
  if (sx < kEpsilon) sx = 1; if (sy < kEpsilon) sy = 1; if (sz < kEpsilon) sz = 1;
  f32 r00 = m.At(0,0)/sx, r01 = m.At(0,1)/sy, r02 = m.At(0,2)/sz;
  f32 r10 = m.At(1,0)/sx, r11 = m.At(1,1)/sy, r12 = m.At(1,2)/sz;
  f32 r20 = m.At(2,0)/sx, r21 = m.At(2,1)/sy, r22 = m.At(2,2)/sz;
  f32 tr = r00 + r11 + r22;
  Quat q;
  if (tr > 0) {
    f32 s = Sqrt(tr + 1.0f) * 2.0f;
    q.w = 0.25f * s; q.x = (r21 - r12) / s; q.y = (r02 - r20) / s; q.z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    f32 s = Sqrt(1.0f + r00 - r11 - r22) * 2.0f;
    q.w = (r21 - r12) / s; q.x = 0.25f * s; q.y = (r01 + r10) / s; q.z = (r02 + r20) / s;
  } else if (r11 > r22) {
    f32 s = Sqrt(1.0f + r11 - r00 - r22) * 2.0f;
    q.w = (r02 - r20) / s; q.x = (r01 + r10) / s; q.y = 0.25f * s; q.z = (r12 + r21) / s;
  } else {
    f32 s = Sqrt(1.0f + r22 - r00 - r11) * 2.0f;
    q.w = (r10 - r01) / s; q.x = (r02 + r20) / s; q.y = (r12 + r21) / s; q.z = 0.25f * s;
  }
  return q.Normalized();
}

Quat Quat::FromTo(const Vec3& from, const Vec3& to) {
  Vec3 f = Normalize(from), t = Normalize(to);
  f32 d = Dot(f, t);
  if (d >= 1.0f - 1e-6f) return Quat::Identity();
  if (d <= -1.0f + 1e-6f) {
    Vec3 axis = Cross(Vec3(1, 0, 0), f);
    if (LengthSq(axis) < 1e-6f) axis = Cross(Vec3(0, 1, 0), f);
    return FromAxisAngle(axis, kPi);
  }
  Vec3 c = Cross(f, t);
  f32 s = Sqrt((1.0f + d) * 2.0f);
  return Quat(c.x / s, c.y / s, c.z / s, s * 0.5f).Normalized();
}

Quat Quat::Slerp(const Quat& a, const Quat& b, f32 t) {
  Quat bb = b;
  f32 d = a.x*bb.x + a.y*bb.y + a.z*bb.z + a.w*bb.w;
  if (d < 0) { bb = {-bb.x, -bb.y, -bb.z, -bb.w}; d = -d; }
  if (d > 0.9995f) {
    return Quat(a.x + (bb.x - a.x) * t, a.y + (bb.y - a.y) * t,
                a.z + (bb.z - a.z) * t, a.w + (bb.w - a.w) * t).Normalized();
  }
  f32 theta0 = std::acos(Clamp(d, -1.0f, 1.0f));
  f32 theta = theta0 * t;
  f32 s0 = Sin(theta0 - theta) / Sin(theta0);
  f32 s1 = Sin(theta) / Sin(theta0);
  return Quat(a.x*s0 + bb.x*s1, a.y*s0 + bb.y*s1, a.z*s0 + bb.z*s1, a.w*s0 + bb.w*s1).Normalized();
}

Quat Quat::LookRotation(const Vec3& forward, const Vec3& up) {
  Vec3 f = Normalize(forward);
  if (LengthSq(f) < kEpsilon) f = Vec3(0, 0, -1);
  Vec3 r = Normalize(Cross(up, f));
  if (LengthSq(r) < kEpsilon) r = Normalize(Cross(Vec3(0, 1, 0), f));
  Vec3 u = Cross(f, r);
  Mat4 m;
  m.At(0,0) = r.x; m.At(1,0) = r.y; m.At(2,0) = r.z;
  m.At(0,1) = u.x; m.At(1,1) = u.y; m.At(2,1) = u.z;
  m.At(0,2) = -f.x; m.At(1,2) = -f.y; m.At(2,2) = -f.z;
  return FromMat4(m);
}

Vec3 Quat::Rotate(const Vec3& v) const {
  Vec3 qv(x, y, z);
  Vec3 t = Cross(qv, v) * 2.0f;
  return v + t * w + Cross(qv, t);
}

Quat Quat::Normalized() const {
  f32 len = Sqrt(x*x + y*y + z*z + w*w);
  if (len < kEpsilon) return Quat::Identity();
  f32 inv = 1.0f / len;
  return {x * inv, y * inv, z * inv, w * inv};
}

Mat4 Quat::ToMat4() const { return Mat4::TRS(Vec3(0,0,0), *this, Vec3(1,1,1)); }

Vec3 Quat::EulerDegrees() const {
  Mat4 m = ToMat4();
  f32 sx = Length(Vec3(m.At(0,0), m.At(1,0), m.At(2,0)));
  f32 sy = Length(Vec3(m.At(0,1), m.At(1,1), m.At(2,1)));
  f32 sz = Length(Vec3(m.At(0,2), m.At(1,2), m.At(2,2)));
  (void)sx; (void)sz;
  // YXZ decomposition
  f32 pitch, yaw, roll;
  f32 sp = -m.At(2,1);
  if (sp < 1.0f - 1e-4f) {
    if (sp > -1.0f + 1e-4f) {
      pitch = std::asin(sp);
      yaw = Atan2(m.At(2,0), m.At(2,2));
      roll = Atan2(m.At(0,1), m.At(1,1));
    } else {
      pitch = -kHalfPi;
      yaw = -Atan2(m.At(1,0), m.At(0,0));
      roll = 0;
    }
  } else {
    pitch = kHalfPi;
    yaw = Atan2(-m.At(1,0), m.At(0,0));
    roll = 0;
  }
  if (sy < 0) pitch = -pitch;
  return {pitch * kRadToDeg, yaw * kRadToDeg, roll * kRadToDeg};
}

Quat Quat::RotateTowards(const Quat& a, const Quat& b, f32 maxRadians) {
  f32 ang = AngleBetween(a, b);
  if (ang <= maxRadians || ang < kEpsilon) return b;
  return Slerp(a, b, maxRadians / ang);
}

f32 Quat::AngleBetween(const Quat& a, const Quat& b) {
  f32 d = Abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w);
  d = Clamp(d, -1.0f, 1.0f);
  return 2.0f * std::acos(d);
}

// ------------------------------------------------------------------------- Transform
Transform Transform::FromMatrix(const Mat4& m) {
  Transform t;
  t.position = m.Translation();
  Vec3 s = m.ScaleOf();
  Vec3 c0(m.At(0,0), m.At(1,0), m.At(2,0));
  Vec3 c1(m.At(0,1), m.At(1,1), m.At(2,1));
  Vec3 c2(m.At(0,2), m.At(1,2), m.At(2,2));
  t.scale = s;
  Mat4 rot;
  if (s.x > kEpsilon) { Vec3 v = c0 / s.x; rot.At(0,0)=v.x; rot.At(1,0)=v.y; rot.At(2,0)=v.z; }
  if (s.y > kEpsilon) { Vec3 v = c1 / s.y; rot.At(0,1)=v.x; rot.At(1,1)=v.y; rot.At(2,1)=v.z; }
  if (s.z > kEpsilon) { Vec3 v = c2 / s.z; rot.At(0,2)=v.x; rot.At(1,2)=v.y; rot.At(2,2)=v.z; }
  t.rotation = Quat::FromMat4(rot);
  return t;
}

Transform Transform::Inverse() const {
  Transform r;
  r.rotation = rotation.Conjugate();
  r.scale = Vec3(scale.x != 0 ? 1.0f / scale.x : 0.0f,
                 scale.y != 0 ? 1.0f / scale.y : 0.0f,
                 scale.z != 0 ? 1.0f / scale.z : 0.0f);
  Vec3 invScalePos = Vec3(-position.x * r.scale.x, -position.y * r.scale.y, -position.z * r.scale.z);
  r.position = r.rotation * invScalePos;
  return r;
}

// ------------------------------------------------------------------------------ AABB
AABB AABB::Transform(const AABB& box, const Mat4& m) {
  AABB out;
  const Vec3 corners[8] = {
    {box.min.x, box.min.y, box.min.z}, {box.max.x, box.min.y, box.min.z},
    {box.min.x, box.max.y, box.min.z}, {box.max.x, box.max.y, box.min.z},
    {box.min.x, box.min.y, box.max.z}, {box.max.x, box.min.y, box.max.z},
    {box.min.x, box.max.y, box.max.z}, {box.max.x, box.max.y, box.max.z}};
  out.min = Vec3(1e30f);
  out.max = Vec3(-1e30f);
  for (auto& c : corners) out.Expand(m.TransformPoint(c));
  return out;
}

// ------------------------------------------------------------------------- Raycasts
bool RaycastAABB(const Ray& r, const AABB& box, f32* outT, Vec3* outNormal) {
  f32 tmin = -1e30f, tmax = 1e30f;
  int axis = 0;
  f32 sign = 1;
  for (int i = 0; i < 3; i++) {
    f32 d = r.direction[i];
    f32 o = r.origin[i];
    if (Abs(d) < 1e-8f) {
      if (o < box.min[i] || o > box.max[i]) return false;
    } else {
      f32 inv = 1.0f / d;
      f32 t1 = (box.min[i] - o) * inv;
      f32 t2 = (box.max[i] - o) * inv;
      f32 s = -1;
      if (t1 > t2) { f32 tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  if (tmax < 0) return false;
  f32 t = tmin >= 0 ? tmin : tmax;
  if (outT) *outT = t;
  if (outNormal) {
    Vec3 n(0, 0, 0);
    n[axis] = sign;
    *outNormal = n;
  }
  return true;
}

bool RaycastSphere(const Ray& r, const Vec3& center, f32 radius, f32* outT) {
  Vec3 oc = r.origin - center;
  f32 a = Dot(r.direction, r.direction);
  f32 b = 2.0f * Dot(oc, r.direction);
  f32 c = Dot(oc, oc) - radius * radius;
  f32 disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  f32 sq = Sqrt(disc);
  f32 t0 = (-b - sq) / (2 * a);
  f32 t1 = (-b + sq) / (2 * a);
  f32 t = t0 >= 0 ? t0 : t1;
  if (t < 0) return false;
  if (outT) *outT = t;
  return true;
}

bool RaycastPlane(const Ray& r, const Vec3& pp, const Vec3& pn, f32* outT) {
  f32 denom = Dot(pn, r.direction);
  if (Abs(denom) < 1e-6f) return false;
  f32 t = Dot(pp - r.origin, pn) / denom;
  if (t < 0) return false;
  if (outT) *outT = t;
  return true;
}

bool RaycastTriangle(const Ray& r, const Vec3& a, const Vec3& b, const Vec3& c, f32* outT,
                     f32* outU, f32* outV) {
  Vec3 e1 = b - a, e2 = c - a;
  Vec3 p = Cross(r.direction, e2);
  f32 det = Dot(e1, p);
  if (Abs(det) < 1e-9f) return false;
  f32 invDet = 1.0f / det;
  Vec3 tv = r.origin - a;
  f32 u = Dot(tv, p) * invDet;
  if (u < -1e-6f || u > 1.0f + 1e-6f) return false;
  Vec3 q = Cross(tv, e1);
  f32 v = Dot(r.direction, q) * invDet;
  if (v < -1e-6f || u + v > 1.0f + 1e-6f) return false;
  f32 t = Dot(e2, q) * invDet;
  if (t < 0) return false;
  if (outT) *outT = t;
  if (outU) *outU = u;
  if (outV) *outV = v;
  return true;
}

bool RaycastOBB(const Ray& r, const Vec3& center, const Vec3& extents, const Quat& rot, f32* outT) {
  Quat inv = rot.Conjugate();
  Ray local;
  local.origin = inv * (r.origin - center);
  local.direction = inv * r.direction;
  AABB box = AABB::FromCenterExtents(Vec3(0, 0, 0), extents);
  return RaycastAABB(local, box, outT);
}

// Slab-based sweep of an AABB against a static AABB (used by the player controller).
bool SweepAABB(const AABB& box, const Vec3& delta, const AABB& target, Vec3* outNormal, f32* outT) {
  // Minkowski sum: expand target by box extents, ray cast from box center
  Vec3 halfA = box.Extents();
  AABB expanded{target.min - halfA, target.max + halfA};
  Vec3 center = box.Center();
  Ray r{center, delta};
  f32 len = Length(delta);
  if (len < 1e-8f) return false;
  r.direction = delta / len;
  Vec3 origin = center;
  // shrink the ray to the swept length by scaling t
  f32 t;
  Vec3 n;
  if (!RaycastAABB(r, expanded, &t, &n)) return false;
  if (t < 0 || t > len) return false;
  if (outT) *outT = t;
  if (outNormal) *outNormal = n;
  NF_UNUSED(origin);
  return true;
}

// --------------------------------------------------------------------------- Frustum
Frustum Frustum::FromMatrix(const Mat4& vp) {
  Frustum f{};
  // Rows of the view-projection matrix (row-major access on column-major storage).
  auto row = [&](int i) {
    return Vec4(vp.At(i,0), vp.At(i,1), vp.At(i,2), vp.At(i,3));
  };
  Vec4 r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  auto norm = [](Vec4 p) {
    f32 len = Sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
    if (len > 1e-9f) { p.x/=len; p.y/=len; p.z/=len; p.w/=len; }
    return p;
  };
  f.planes[0] = norm(r3 + r0);   // left
  f.planes[1] = norm(r3 - r0);   // right
  f.planes[2] = norm(r3 + r1);   // bottom
  f.planes[3] = norm(r3 - r1);   // top
  f.planes[4] = norm(r3 + r2);   // near
  f.planes[5] = norm(r3 - r2);   // far
  return f;
}

bool Frustum::TestAABB(const AABB& box) const {
  for (int i = 0; i < 6; i++) {
    const Vec4& p = planes[i];
    // "positive vertex" test
    Vec3 positive(p.x >= 0 ? box.max.x : box.min.x,
                  p.y >= 0 ? box.max.y : box.min.y,
                  p.z >= 0 ? box.max.z : box.min.z);
    if (p.x * positive.x + p.y * positive.y + p.z * positive.z + p.w < 0) return false;
  }
  return true;
}

bool Frustum::TestSphere(const Vec3& c, f32 radius) const {
  for (int i = 0; i < 6; i++) {
    const Vec4& p = planes[i];
    if (p.x * c.x + p.y * c.y + p.z * c.z + p.w < -radius) return false;
  }
  return true;
}

} // namespace nf
