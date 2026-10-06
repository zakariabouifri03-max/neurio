// NovaForge Engine - assets/Texture.cpp
#include "assets/Texture.h"
#include "core/Math.h"

namespace nf {

Vec3 Texture::SamplePixel(u32 x, u32 y) const {
  if (x >= width || y >= height || pixels.empty()) return Vec3(0, 0, 0);
  usize idx = ((usize)y * width + x) * channels;
  if (idx + 2 >= pixels.size()) return Vec3(0, 0, 0);
  return Vec3(pixels[idx] / 255.0f, pixels[idx + 1] / 255.0f, pixels[idx + 2] / 255.0f);
}

static void Fill(std::shared_ptr<Texture>& t, const Vec4& c) {
  t->channels = 4;
  t->format = TextureFormat::RGBA8;
  t->pixels.resize((usize)t->width * t->height * 4);
  for (usize i = 0; i < t->pixels.size(); i += 4) {
    t->pixels[i + 0] = (u8)(Saturate(c.x) * 255.0f);
    t->pixels[i + 1] = (u8)(Saturate(c.y) * 255.0f);
    t->pixels[i + 2] = (u8)(Saturate(c.z) * 255.0f);
    t->pixels[i + 3] = (u8)(Saturate(c.w) * 255.0f);
  }
}

std::shared_ptr<Texture> Texture::CreateSolid(const std::string& name, const Vec4& color, u32 size) {
  auto t = std::make_shared<Texture>();
  t->name = name;
  t->width = t->height = size;
  Fill(t, color);
  return t;
}

std::shared_ptr<Texture> Texture::CreateChecker(const std::string& name, u32 size, const Vec4& a,
                                                const Vec4& b, u32 squares) {
  auto t = std::make_shared<Texture>();
  t->name = name;
  t->width = t->height = size;
  t->channels = 4;
  t->pixels.resize((usize)size * size * 4);
  u32 cell = std::max(1u, size / std::max(1u, squares));
  for (u32 y = 0; y < size; y++) {
    for (u32 x = 0; x < size; x++) {
      bool odd = (((x / cell) + (y / cell)) % 2) != 0;
      // subtle gradient so checkerboards read as 3D in the viewport
      f32 shade = 1.0f - 0.06f * ((f32)y / (f32)size);
      Vec4 c = odd ? b : a;
      c.x *= shade; c.y *= shade; c.z *= shade;
      usize i = ((usize)y * size + x) * 4;
      t->pixels[i + 0] = (u8)(Saturate(c.x) * 255.0f);
      t->pixels[i + 1] = (u8)(Saturate(c.y) * 255.0f);
      t->pixels[i + 2] = (u8)(Saturate(c.z) * 255.0f);
      t->pixels[i + 3] = 255;
    }
  }
  return t;
}

std::shared_ptr<Texture> Texture::CreateNormalFlat(const std::string& name, u32 size) {
  auto t = std::make_shared<Texture>();
  t->name = name;
  t->width = t->height = size;
  t->channels = 4;
  t->srgb = false;
  t->pixels.resize((usize)size * size * 4);
  for (usize i = 0; i < t->pixels.size(); i += 4) {
    t->pixels[i + 0] = 128;
    t->pixels[i + 1] = 128;
    t->pixels[i + 2] = 255;
    t->pixels[i + 3] = 255;
  }
  return t;
}

} // namespace nf
