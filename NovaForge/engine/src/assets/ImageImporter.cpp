// NovaForge Engine - assets/ImageImporter.cpp
// stb_image backed texture loading (png/jpg/bmp/tga/psd/gif/hdr/pic/pnm).
#include "assets/Texture.h"
#include "core/FileSystem.h"
#include "core/Log.h"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_ONLY_BMP
#define STBI_ONLY_TGA
#define STBI_ONLY_GIF
#define STBI_ONLY_PSD
#define STBI_ONLY_HDR
#define STBI_ONLY_PNM
#define STBI_NO_STDIO
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

namespace nf {

namespace {
std::vector<u8> g_pendingWriteData;
}

std::shared_ptr<Texture> LoadTextureFromFile(const std::string& path, std::string* outError) {
  std::string readError;
  std::vector<u8> bytes = fs::ReadBinary(path, &readError);
  if (bytes.empty()) {
    if (outError) *outError = "file not found or empty (" + readError + ")";
    return nullptr;
  }
  stbi_set_flip_vertically_on_load(0);
  int width = 0, height = 0, channels = 0;
  u8* pixels = stbi_load_from_memory(bytes.data(), (int)bytes.size(), &width, &height, &channels, 4);
  if (!pixels) {
    if (outError) {
      const char* reason = stbi_failure_reason();
      *outError = std::string("decode failed: ") + (reason ? reason : "unknown format");
    }
    return nullptr;
  }
  auto texture = std::make_shared<Texture>();
  texture->name = fs::Stem(path);
  texture->sourcePath = path;
  texture->width = (u32)width;
  texture->height = (u32)height;
  texture->channels = 4;
  texture->format = TextureFormat::RGBA8;
  texture->pixels.assign(pixels, pixels + (usize)width * height * 4);
  stbi_image_free(pixels);
  NF_INFO(LogCategory::Asset, "Loaded texture '%s' (%dx%d)", fs::FileName(path).c_str(), width, height);
  return texture;
}

namespace {
void WriteCallback(void* context, void* data, int size) {
  NF_UNUSED(context);
  const u8* p = (const u8*)data;
  g_pendingWriteData.insert(g_pendingWriteData.end(), p, p + size);
}
} // namespace

// Encode a texture as PNG (used by the "render reference frame" head-less path
// and by the editor's viewport screenshot action). No file IO inside stb.
bool EncodePng(const u8* rgba, int width, int height, std::vector<u8>* outPng) {
  g_pendingWriteData.clear();
  int ok = stbi_write_png_to_func(WriteCallback, nullptr, width, height, 4, rgba, width * 4);
  if (!ok) return false;
  *outPng = g_pendingWriteData;
  return true;
}

bool WritePng(const std::string& path, const u8* rgba, int width, int height) {
  std::vector<u8> png;
  if (!EncodePng(rgba, width, height, &png)) return false;
  return fs::WriteBinary(path, png.data(), png.size());
}

} // namespace nf
