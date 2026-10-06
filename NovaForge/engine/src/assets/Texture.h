// NovaForge Engine - assets/Texture.h
#pragma once

#include "core/Base.h"
#include "core/Math.h"

namespace nf {

enum class TextureFormat : u32 { RGBA8 = 0, RGB8, R8, RGBA16F };

// CPU-side image data. The renderer uploads it and fills gpuHandle.
class Texture {
public:
  std::string name;
  std::string sourcePath;
  u32 width = 0;
  u32 height = 0;
  u32 channels = 4;
  TextureFormat format = TextureFormat::RGBA8;
  bool srgb = true;
  bool generateMipmaps = true;
  std::vector<u8> pixels;          // tightly packed, top-left origin

  u32 gpuHandle = 0;
  u64 gpuVersion = 0;
  bool cpuPixelsReleased = false;

  bool IsValid() const { return width > 0 && height > 0 && !pixels.empty(); }
  Vec3 SamplePixel(u32 x, u32 y) const;   // convenience for tools/tests

  static std::shared_ptr<Texture> CreateSolid(const std::string& name, const Vec4& color, u32 size = 4);
  static std::shared_ptr<Texture> CreateChecker(const std::string& name, u32 size = 256,
                                                const Vec4& a = Vec4(0.85f, 0.85f, 0.9f, 1),
                                                const Vec4& b = Vec4(0.2f, 0.22f, 0.28f, 1),
                                                u32 squares = 8);
  static std::shared_ptr<Texture> CreateNormalFlat(const std::string& name, u32 size = 4);
};

} // namespace nf
