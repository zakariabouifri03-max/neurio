// NovaForge Engine - math library
// Self contained, header only, no external dependencies.
// Conventions: right handed, Y up, column major Mat4 (OpenGL style),
// angles in radians unless a name says Degrees.
#pragma once

#include <cmath>
#include <cstdint>
#include <algorithm>

namespace nf {

constexpr float PI = 3.14159265358979323846f;
constexpr float DEG2RAD = PI / 180.0f;
constexpr float RAD2DEG = 180.0f / PI;

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
// Scalar / vector lerp overloads (also used by the shaders)
inline float lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float signf(float v) { return v < 0 ? -1.0f : 1.0f; }

// ---------------------------------------------------------------- Vec2
struct Vec2 {
    float x = 0, y = 0;
    Vec2() {}
    Vec2(float x_, float y_) : x(x_), y(y_) {}
    explicit Vec2(float s) : x(s), y(s) {}
    Vec2 operator+(const Vec2& o) const { return {x + o.x, y + o.y}; }
    Vec2 operator-(const Vec2& o) const { return {x - o.x, y - o.y}; }
    Vec2 operator*(float s) const { return {x * s, y * s}; }
    Vec2 operator/(float s) const { return {x / s, y / s}; }
    Vec2& operator+=(const Vec2& o) { x += o.x; y += o.y; return *this; }
    float length() const { return std::sqrt(x * x + y * y); }
};
inline Vec2 lerp(const Vec2& a, const Vec2& b, float t) {
    return Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

// ---------------------------------------------------------------- Vec3
struct Vec3 {
    float x = 0, y = 0, z = 0;
    Vec3() {}
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
    explicit Vec3(float s) : x(s), y(s), z(s) {}
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(const Vec3& o) const { return {x * o.x, y * o.y, z * o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
    Vec3 operator/(const Vec3& o) const { return {x / o.x, y / o.y, z / o.z}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3& operator*=(float s) { x *= s; y *= s; z *= s; return *this; }
    Vec3& operator/=(float s) { float i = 1.0f / s; x *= i; y *= i; z *= i; return *this; }
    float& operator[](int i) { return (&x)[i]; }
    float operator[](int i) const { return (&x)[i]; }
    bool operator==(const Vec3& o) const { return x == o.x && y == o.y && z == o.z; }
    float length() const { return std::sqrt(x * x + y * y + z * z); }
    float sqLength() const { return x * x + y * y + z * z; }
    Vec3 normalized() const {
        float l = length();
        return l > 1e-8f ? *this / l : Vec3(0, 0, 0);
    }
};
inline Vec3 operator*(float s, const Vec3& v) { return v * s; }
inline float dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline Vec3 lerp(const Vec3& a, const Vec3& b, float t) { return a + (b - a) * t; }
inline float distance(const Vec3& a, const Vec3& b) { return (a - b).length(); }
inline Vec3 minv(const Vec3& a, const Vec3& b) { return {std::min(a.x,b.x), std::min(a.y,b.y), std::min(a.z,b.z)}; }
inline Vec3 maxv(const Vec3& a, const Vec3& b) { return {std::max(a.x,b.x), std::max(a.y,b.y), std::max(a.z,b.z)}; }
inline Vec3 absv(const Vec3& a) { return {std::fabs(a.x), std::fabs(a.y), std::fabs(a.z)}; }

// ---------------------------------------------------------------- Vec4
struct Vec4 {
    float x = 0, y = 0, z = 0, w = 0;
    Vec4() {}
    Vec4(float x_, float y_, float z_, float w_) : x(x_), y(y_), z(z_), w(w_) {}
    Vec4(const Vec3& v, float w_) : x(v.x), y(v.y), z(v.z), w(w_) {}
    Vec3 xyz() const { return {x, y, z}; }
    Vec3 rgb() const { return {x, y, z}; }
    Vec4 operator-() const { return {-x, -y, -z, -w}; }
    Vec4 operator+(const Vec4& o) const { return {x + o.x, y + o.y, z + o.z, w + o.w}; }
    Vec4 operator-(const Vec4& o) const { return {x - o.x, y - o.y, z - o.z, w - o.w}; }
    Vec4 operator*(float s) const { return {x * s, y * s, z * s, w * s}; }
    Vec4 operator*(const Vec4& o) const { return {x * o.x, y * o.y, z * o.z, w * o.w}; }
    Vec3 operator*(const Vec3& o) const { return {x * o.x, y * o.y, z * o.z}; }
    Vec4 operator/(float s) const { return {x / s, y / s, z / s, w / s}; }
    Vec4& operator+=(const Vec4& o) { x += o.x; y += o.y; z += o.z; w += o.w; return *this; }
    Vec4& operator-=(const Vec4& o) { x -= o.x; y -= o.y; z -= o.z; w -= o.w; return *this; }
    Vec4& operator*=(float s) { x *= s; y *= s; z *= s; w *= s; return *this; }
    // Magnitude of the colour channels (w is alpha and must not skew it).
    float length() const { return std::sqrt(x * x + y * y + z * z); }
    float alphaLength() const { return std::sqrt(x * x + y * y + z * z + w * w); }
    float sqLength() const { return x * x + y * y + z * z + w * w; }
    float& operator[](int i) { return (&x)[i]; }
    float operator[](int i) const { return (&x)[i]; }
};
inline float dot(const Vec4& a, const Vec4& b) { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; }
inline float length(const Vec4& v) { return std::sqrt(v.x*v.x + v.y*v.y + v.z*v.z + v.w*v.w); }
inline Vec4 lerp(const Vec4& a, const Vec4& b, float t) {
    return Vec4(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t,
                a.w + (b.w - a.w) * t);
}
// Colour * colour keeps alpha of the left operand (used by the shaders).
inline Vec4 mulRGB(const Vec4& c, const Vec3& rgb) {
    return Vec4(c.x * rgb.x, c.y * rgb.y, c.z * rgb.z, c.w);
}
inline Vec4 mulRGB(const Vec4& a, const Vec4& b) {
    return Vec4(a.x * b.x, a.y * b.y, a.z * b.z, a.w * b.w);
}

// ---------------------------------------------------------------- Mat4 (column major)
struct Mat4 {
    // m[col*4 + row] - same memory layout as OpenGL matrices.
    float m[16];

    Mat4() { identity(); }
    void identity() {
        for (int i = 0; i < 16; ++i) m[i] = 0;
        m[0] = m[5] = m[10] = m[15] = 1;
    }
    static Mat4 zero() { Mat4 r; for (int i = 0; i < 16; ++i) r.m[i] = 0; return r; }
    float& at(int col, int row) { return m[col * 4 + row]; }
    float at(int col, int row) const { return m[col * 4 + row]; }

    Vec4 col(int c) const { return {m[c*4], m[c*4+1], m[c*4+2], m[c*4+3]}; }
    Vec3 row3(int r) const { return {m[r], m[4+r], m[8+r]}; }

    Mat4 operator*(const Mat4& o) const {
        Mat4 r;
        for (int c = 0; c < 4; ++c)
            for (int row = 0; row < 4; ++row) {
                float s = 0;
                for (int k = 0; k < 4; ++k) s += at(k, row) * o.at(c, k);
                r.at(c, row) = s;
            }
        return r;
    }
    Vec4 operator*(const Vec4& v) const {
        Vec4 r(0, 0, 0, 0);
        for (int row = 0; row < 4; ++row) {
            float s = 0;
            for (int k = 0; k < 4; ++k) s += at(k, row) * v[k];
            r[row] = s;
        }
        return r;
    }
    Vec3 transformPoint(const Vec3& p) const {
        Vec4 r = (*this) * Vec4(p, 1.0f);
        return {r.x, r.y, r.z};
    }
    Vec3 transformDir(const Vec3& d) const {
        Vec4 r = (*this) * Vec4(d, 0.0f);
        return {r.x, r.y, r.z};
    }
    Vec3 transformPointDiv(const Vec3& p) const {
        Vec4 r = (*this) * Vec4(p, 1.0f);
        if (std::fabs(r.w) > 1e-8f) return {r.x / r.w, r.y / r.w, r.z / r.w};
        return {r.x, r.y, r.z};
    }

    static Mat4 translate(const Vec3& t) {
        Mat4 r; r.at(3,0) = t.x; r.at(3,1) = t.y; r.at(3,2) = t.z; return r;
    }
    static Mat4 scale(const Vec3& s) {
        Mat4 r; r.at(0,0) = s.x; r.at(1,1) = s.y; r.at(2,2) = s.z; return r;
    }
    static Mat4 rotateX(float a) {
        Mat4 r; float c = std::cos(a), s = std::sin(a);
        r.at(1,1)=c; r.at(1,2)=s; r.at(2,1)=-s; r.at(2,2)=c; return r;
    }
    static Mat4 rotateY(float a) {
        Mat4 r; float c = std::cos(a), s = std::sin(a);
        r.at(0,0)=c; r.at(0,2)=-s; r.at(2,0)=s; r.at(2,2)=c; return r;
    }
    static Mat4 rotateZ(float a) {
        Mat4 r; float c = std::cos(a), s = std::sin(a);
        r.at(0,0)=c; r.at(0,1)=s; r.at(1,0)=-s; r.at(1,1)=c; return r;
    }
    static Mat4 perspective(float fovYRad, float aspect, float zn, float zf) {
        Mat4 r = zero();
        float t = 1.0f / std::tan(fovYRad * 0.5f);
        r.at(0,0) = t / aspect;
        r.at(1,1) = t;
        r.at(2,2) = (zf + zn) / (zn - zf);
        r.at(2,3) = -1.0f;
        r.at(3,2) = (2.0f * zf * zn) / (zn - zf);
        return r;
    }
    static Mat4 ortho(float l, float rr, float b, float t, float zn, float zf) {
        Mat4 r = zero();
        r.at(0,0) = 2.0f / (rr - l);
        r.at(1,1) = 2.0f / (t - b);
        r.at(2,2) = -2.0f / (zf - zn);
        r.at(3,0) = -(rr + l) / (rr - l);
        r.at(3,1) = -(t + b) / (t - b);
        r.at(3,2) = -(zf + zn) / (zf - zn);
        r.at(3,3) = 1.0f;
        return r;
    }
    static Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
        Vec3 f = (center - eye).normalized();
        Vec3 s = cross(f, up).normalized();
        Vec3 u = cross(s, f);
        Mat4 r;
        r.at(0,0)=s.x; r.at(1,0)=s.y; r.at(2,0)=s.z;
        r.at(0,1)=u.x; r.at(1,1)=u.y; r.at(2,1)=u.z;
        r.at(0,2)=-f.x; r.at(1,2)=-f.y; r.at(2,2)=-f.z;
        r.at(3,0)=-dot(s, eye);
        r.at(3,1)=-dot(u, eye);
        r.at(3,2)=dot(f, eye);
        return r;
    }
    static Mat4 trs(const Vec3& t, const struct Quat& q, const Vec3& s);

    Mat4 transposed() const {
        Mat4 r;
        for (int c = 0; c < 4; ++c) for (int row = 0; row < 4; ++row) r.at(c,row) = at(row,c);
        return r;
    }
    Mat4 inverse() const;
    // inverse-transpose of upper 3x3, for normals (kept as Mat4)
    Mat4 normalMatrix() const;
    Vec3 translation() const { return {at(3,0), at(3,1), at(3,2)}; }
    // Inverse of Mat4::trs (see implementation below; needs a complete Quat).
    void decompose(Vec3& translation, Quat& rotation, Vec3& scale) const;
};

// ---------------------------------------------------------------- Quat
struct Quat {
    float x = 0, y = 0, z = 0, w = 1;
    Quat() {}
    Quat(float x_, float y_, float z_, float w_) : x(x_), y(y_), z(z_), w(w_) {}
    static Quat identity() { return {0, 0, 0, 1}; }
    static Quat fromAxisAngle(const Vec3& axis, float angle) {
        Vec3 a = axis.normalized();
        float h = angle * 0.5f, s = std::sin(h);
        return {a.x * s, a.y * s, a.z * s, std::cos(h)};
    }
    // YXZ order - the order used by most engines for euler angles (degrees).
    static Quat fromEulerDeg(const Vec3& deg) {
        float hx = deg.x * DEG2RAD * 0.5f, hy = deg.y * DEG2RAD * 0.5f, hz = deg.z * DEG2RAD * 0.5f;
        float cx = std::cos(hx), sx = std::sin(hx);
        float cy = std::cos(hy), sy = std::sin(hy);
        float cz = std::cos(hz), sz = std::sin(hz);
        Quat q;
        q.w = cy * cx * cz + sy * sx * sz;
        q.x = cy * sx * cz + sy * cx * sz;
        q.y = sy * cx * cz - cy * sx * sz;
        q.z = cy * cx * sz - sy * sx * cz;
        return q;
    }
    Vec3 toEulerDeg() const;
    Quat operator*(const Quat& o) const {
        return {
            w * o.x + x * o.w + y * o.z - z * o.y,
            w * o.y - x * o.z + y * o.w + z * o.x,
            w * o.z + x * o.y - y * o.x + z * o.w,
            w * o.w - x * o.x - y * o.y - z * o.z,
        };
    }
    Vec3 rotate(const Vec3& v) const {
        Vec3 u(x, y, z);
        Vec3 t = cross(u, v) * 2.0f;
        return v + t * w + cross(u, t);
    }
    Quat conjugate() const { return {-x, -y, -z, w}; }
    // Rotation matrix (row major 3x3, columns are basis vectors) -> quaternion
    static Quat fromMat3(const Vec3& c0, const Vec3& c1, const Vec3& c2) {
        float m00 = c0.x, m10 = c0.y, m20 = c0.z;
        float m01 = c1.x, m11 = c1.y, m21 = c1.z;
        float m02 = c2.x, m12 = c2.y, m22 = c2.z;
        float tr = m00 + m11 + m22;
        Quat q;
        if (tr > 0) {
            float sQ = std::sqrt(tr + 1.0f) * 2.0f;
            q.w = 0.25f * sQ;
            q.x = (m21 - m12) / sQ;
            q.y = (m02 - m20) / sQ;
            q.z = (m10 - m01) / sQ;
        } else if (m00 > m11 && m00 > m22) {
            float sQ = std::sqrt(1.0f + m00 - m11 - m22) * 2.0f;
            q.w = (m21 - m12) / sQ;
            q.x = 0.25f * sQ;
            q.y = (m01 + m10) / sQ;
            q.z = (m02 + m20) / sQ;
        } else if (m11 > m22) {
            float sQ = std::sqrt(1.0f + m11 - m00 - m22) * 2.0f;
            q.w = (m02 - m20) / sQ;
            q.x = (m01 + m10) / sQ;
            q.y = 0.25f * sQ;
            q.z = (m12 + m21) / sQ;
        } else {
            float sQ = std::sqrt(1.0f + m22 - m00 - m11) * 2.0f;
            q.w = (m10 - m01) / sQ;
            q.x = (m02 + m20) / sQ;
            q.y = (m12 + m21) / sQ;
            q.z = 0.25f * sQ;
        }
        return q.normalized();
    }
    float length() const { return std::sqrt(x*x + y*y + z*z + w*w); }
    Quat normalized() const {
        float l = length();
        return l > 1e-8f ? Quat(x/l, y/l, z/l, w/l) : identity();
    }
};
// Inverse of Mat4::trs - a mirrored matrix negates the X scale, which is what
// DCC tools report as well.
inline void Mat4::decompose(Vec3& translation, Quat& rotation, Vec3& scale) const {
    translation = {at(3, 0), at(3, 1), at(3, 2)};
    Vec3 c0(at(0, 0), at(0, 1), at(0, 2));
    Vec3 c1(at(1, 0), at(1, 1), at(1, 2));
    Vec3 c2(at(2, 0), at(2, 1), at(2, 2));
    float l0 = c0.length() > 1e-8f ? c0.length() : 1.0f;
    float l1 = c1.length() > 1e-8f ? c1.length() : 1.0f;
    float l2 = c2.length() > 1e-8f ? c2.length() : 1.0f;
    Vec3 sx = c0 / l0, sy = c1 / l1, sz = c2 / l2;
    scale = {l0, l1, l2};
    if (dot(cross(sx, sy), sz) < 0) scale.x = -scale.x;
    rotation = Quat::fromMat3(sx, sy, sz);
}

inline Mat4 Mat4::trs(const Vec3& t, const Quat& q, const Vec3& s) {
    Mat4 r;
    float xx=q.x*q.x, yy=q.y*q.y, zz=q.z*q.z;
    float xy=q.x*q.y, xz=q.x*q.z, yz=q.y*q.z;
    float wx=q.w*q.x, wy=q.w*q.y, wz=q.w*q.z;
    r.at(0,0)=(1-2*(yy+zz))*s.x; r.at(0,1)=(2*(xy+wz))*s.x;  r.at(0,2)=(2*(xz-wy))*s.x;
    r.at(1,0)=(2*(xy-wz))*s.y;   r.at(1,1)=(1-2*(xx+zz))*s.y; r.at(1,2)=(2*(yz+wx))*s.y;
    r.at(2,0)=(2*(xz+wy))*s.z;   r.at(2,1)=(2*(yz-wx))*s.z;   r.at(2,2)=(1-2*(xx+yy))*s.z;
    r.at(3,0)=t.x; r.at(3,1)=t.y; r.at(3,2)=t.z;
    return r;
}
inline Quat slerp(const Quat& a, const Quat& b, float t) {
    float d = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
    Quat bb = b;
    if (d < 0) { d = -d; bb = {-b.x, -b.y, -b.z, -b.w}; }
    if (d > 0.9995f) {
        return Quat(a.x + (bb.x-a.x)*t, a.y + (bb.y-a.y)*t,
                    a.z + (bb.z-a.z)*t, a.w + (bb.w-a.w)*t).normalized();
    }
    float theta = std::acos(clampf(d, -1.0f, 1.0f));
    float st = std::sin(theta);
    float wa = std::sin((1 - t) * theta) / st;
    float wb = std::sin(t * theta) / st;
    return Quat(a.x*wa + bb.x*wb, a.y*wa + bb.y*wb, a.z*wa + bb.z*wb, a.w*wa + bb.w*wb).normalized();
}

inline Vec3 Quat::toEulerDeg() const {
    // inverse of fromEulerDeg (YXZ), returns pitch(x), yaw(y), roll(z) in degrees
    Quat q = normalized();
    Vec3 r;
    float sinp = 2.0f * (q.w * q.x - q.y * q.z);
    if (std::fabs(sinp) >= 0.9999f) {
        r.x = signf(sinp) * PI * 0.5f;
        r.y = std::atan2(2.0f * (q.x * q.z + q.w * q.y), 1.0f - 2.0f * (q.x*q.x + q.y*q.y));
        r.z = 0.0f;
    } else {
        r.x = std::asin(sinp);
        r.y = std::atan2(2.0f * (q.w * q.y + q.x * q.z), 1.0f - 2.0f * (q.x*q.x + q.y*q.y));
        r.z = std::atan2(2.0f * (q.w * q.z + q.x * q.y), 1.0f - 2.0f * (q.x*q.x + q.z*q.z));
    }
    return {r.x * RAD2DEG, r.y * RAD2DEG, r.z * RAD2DEG};
}

inline Mat4 Mat4::inverse() const {
    const float* a = m;
    float inv[16];
    inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
    inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
    inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
    inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
    inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
    inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
    inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
    inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
    inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
    inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
    inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
    inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];
    inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
    inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
    inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
    inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];
    float det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
    Mat4 r;
    if (std::fabs(det) < 1e-12f) return r;  // singular -> identity
    det = 1.0f / det;
    for (int i = 0; i < 16; ++i) r.m[i] = inv[i] * det;
    return r;
}
inline Mat4 Mat4::normalMatrix() const {
    Mat4 r = *this;
    for (int c = 0; c < 3; ++c) { r.at(3, c) = 0; r.at(c, 3) = 0; }
    r.at(3, 3) = 1;
    Mat4 inv = r.inverse();
    Mat4 n = inv.transposed();
    n.at(3,0) = n.at(3,1) = n.at(3,2) = 0;
    n.at(0,3) = n.at(1,3) = n.at(2,3) = 0;
    n.at(3,3) = 1;
    return n;
}

// ---------------------------------------------------------------- AABB / Ray
struct AABB {
    Vec3 min{1e30f, 1e30f, 1e30f}, max{-1e30f, -1e30f, -1e30f};
    bool valid() const { return min.x <= max.x; }
    void expand(const Vec3& p) { min = minv(min, p); max = maxv(max, p); }
    void expand(const AABB& b) { if (b.valid()) { min = minv(min, b.min); max = maxv(max, b.max); } }
    Vec3 center() const { return (min + max) * 0.5f; }
    Vec3 extent() const { return (max - min) * 0.5f; }
    float radius() const { return (max - min).length() * 0.5f; }
    bool contains(const Vec3& p) const {
        return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
    }
    bool intersects(const AABB& o) const {
        return !(o.min.x > max.x || o.max.x < min.x || o.min.y > max.y ||
                 o.max.y < min.y || o.min.z > max.z || o.max.z < min.z);
    }
};
inline AABB transformAABB(const AABB& b, const Mat4& m) {
    AABB r;
    for (int i = 0; i < 8; ++i) {
        Vec3 c((i & 1) ? b.max.x : b.min.x, (i & 2) ? b.max.y : b.min.y, (i & 4) ? b.max.z : b.min.z);
        r.expand(m.transformPoint(c));
    }
    return r;
}

struct Ray {
    Vec3 origin, dir;
};
struct Plane {
    Vec3 n{0, 1, 0};
    float d = 0;  // plane: dot(n,p) + d = 0
    float distance(const Vec3& p) const { return dot(n, p) + d; }
};

// ---------------------------------------------------------------- Frustum (6 planes, world space)
struct Frustum {
    Plane planes[6];  // 0..5 = L,R,B,T,N,F
    static Frustum fromMatrix(const Mat4& vp) {
        Frustum f;
        auto set = [&](int i, float sx, float sy, float sz, float sw) {
            Vec4 a(vp.at(0,0), vp.at(1,0), vp.at(2,0), vp.at(3,0));
            Vec4 b(vp.at(0,1), vp.at(1,1), vp.at(2,1), vp.at(3,1));
            Vec4 c(vp.at(0,2), vp.at(1,2), vp.at(2,2), vp.at(3,2));
            Vec4 d(vp.at(0,3), vp.at(1,3), vp.at(2,3), vp.at(3,3));
            Vec4 p = a * sx + b * sy + c * sz + d * sw;
            Vec3 n(p.x, p.y, p.z);
            float len = n.length();
            if (len < 1e-8f) return;
            f.planes[i].n = n / len;
            f.planes[i].d = p.w / len;
        };
        set(0, 1, 0, 0, 1);   // left
        set(1, -1, 0, 0, 1);  // right
        set(2, 0, 1, 0, 1);   // bottom
        set(3, 0, -1, 0, 1);  // top
        set(4, 0, 0, 1, 1);   // near
        set(5, 0, 0, -1, 1);  // far
        return f;
    }
    bool intersectsAABB(const AABB& b) const {
        if (!b.valid()) return false;
        for (int i = 0; i < 6; ++i) {
            const Plane& p = planes[i];
            // positive vertex test: find the AABB vertex furthest along normal
            Vec3 v(p.n.x >= 0 ? b.max.x : b.min.x,
                   p.n.y >= 0 ? b.max.y : b.min.y,
                   p.n.z >= 0 ? b.max.z : b.min.z);
            if (p.distance(v) < 0) return false;
        }
        return true;
    }
    bool containsPoint(const Vec3& p) const {
        for (int i = 0; i < 6; ++i) if (planes[i].distance(p) < 0) return false;
        return true;
    }
};

// Ray vs AABB (slab method)
inline bool rayAABB(const Ray& r, const AABB& b, float& tOut) {
    float tmin = -1e30f, tmax = 1e30f;
    for (int i = 0; i < 3; ++i) {
        float ro = r.origin[i], rd = r.dir[i];
        if (std::fabs(rd) < 1e-8f) {
            if (ro < b.min[i] || ro > b.max[i]) return false;
        } else {
            float t1 = (b.min[i] - ro) / rd, t2 = (b.max[i] - ro) / rd;
            if (t1 > t2) std::swap(t1, t2);
            tmin = std::max(tmin, t1);
            tmax = std::min(tmax, t2);
            if (tmin > tmax) return false;
        }
    }
    tOut = tmin >= 0 ? tmin : tmax;
    return tOut >= 0;
}

// Moller-Trumbore
inline bool rayTriangle(const Ray& r, const Vec3& a, const Vec3& b, const Vec3& c, float& t) {
    Vec3 e1 = b - a, e2 = c - a;
    Vec3 p = cross(r.dir, e2);
    float det = dot(e1, p);
    if (std::fabs(det) < 1e-9f) return false;
    float inv = 1.0f / det;
    Vec3 tv = r.origin - a;
    float u = dot(tv, p) * inv;
    if (u < -1e-5f || u > 1.0f + 1e-5f) return false;
    Vec3 q = cross(tv, e1);
    float v = dot(r.dir, q) * inv;
    if (v < -1e-5f || u + v > 1.0f + 1e-5f) return false;
    t = dot(e2, q) * inv;
    return t > 1e-5f;
}

}  // namespace nf
