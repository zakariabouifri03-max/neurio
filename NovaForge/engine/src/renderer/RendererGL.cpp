// NovaForge Engine - renderer/RendererGL.cpp
#include "renderer/RendererGL.h"
#include "assets/AssetDatabase.h"
#include "core/Log.h"

#include "core/StringUtil.h"

#include <algorithm>
#include <cstring>

namespace nf {
using namespace gl;

namespace {

// GL_SRGB8_ALPHA8 (not in our minimal constant set, kept local on purpose)
constexpr GLenum kSrgb8Alpha8 = 0x8C43;

const char* kForwardVertexShader = R"(#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aTangent;
layout(location = 4) in uvec4 aJoints;
layout(location = 5) in vec4 aWeights;
layout(location = 6) in mat4 aInstanceModel;

uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform mat4 uNormalMatrix;
uniform mat4 uLightMatrix;
uniform int uInstanced;
uniform int uSkinned;
uniform int uUseNormalMatrix;
uniform mat4 uBones[64];
uniform float uUvTiling;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec4 vShadowCoord;

void main() {
  mat4 model = (uInstanced == 1) ? aInstanceModel : uModel;
  vec4 localPosition = vec4(aPosition, 1.0);
  vec3 localNormal = aNormal;
  if (uSkinned == 1) {
    vec4 skinned = vec4(0.0);
    vec3 skinnedNormal = vec3(0.0);
    for (int i = 0; i < 4; ++i) {
      float weight = aWeights[i];
      if (weight <= 0.0001) continue;
      mat4 bone = uBones[aJoints[i]];
      skinned += (bone * vec4(aPosition, 1.0)) * weight;
      skinnedNormal += mat3(bone) * aNormal * weight;
    }
    localPosition = skinned;
    localNormal = skinnedNormal;
  }
  vec4 world = model * localPosition;
  vWorld = world.xyz;
  vNormal = (uInstanced == 0 && uUseNormalMatrix == 1)
                ? normalize(mat3(uNormalMatrix) * localNormal)
                : normalize(mat3(model) * localNormal);
  vUV = aUV * uUvTiling;
  vShadowCoord = uLightMatrix * world;
  gl_Position = uViewProjection * world;
}
)";

const char* kForwardFragmentShader = R"(#version 330 core
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec4 vShadowCoord;

out vec4 FragColor;

uniform vec3 uCameraPosition;
uniform vec3 uBaseColor;
uniform float uMetallic;
uniform float uRoughness;
uniform float uOpacity;
uniform float uEmissiveStrength;
uniform vec3 uEmissiveColor;
uniform int uUnlit;
uniform int uDoubleSided;
uniform int uHasBaseColorTexture;
uniform sampler2D uBaseColorTexture;

uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform int uDynamicLightCount;
uniform int uDirectionalCount;
uniform vec3 uLightPositions[8];
uniform vec3 uLightDirections[8];
uniform vec3 uLightColors[8];
uniform vec4 uLightParams[8];      // x = range, y = type, z = innerCos, w = outerCos

uniform int uShadowEnabled;
uniform float uShadowBias;
uniform float uShadowStrength;
uniform sampler2D uShadowMap;

uniform int uFogEnabled;
uniform float uFogStart;
uniform float uFogEnd;
uniform vec3 uFogColor;
uniform float uExposure;
uniform int uToneMapping;

float shadowFactor(vec3 worldPosition) {
  if (uShadowEnabled == 0) return 1.0;
  vec3 projected = vShadowCoord.xyz / max(vShadowCoord.w, 0.0001);
  projected = projected * 0.5 + 0.5;
  if (projected.x < 0.0 || projected.x > 1.0 || projected.y < 0.0 || projected.y > 1.0 ||
      projected.z > 1.0)
    return 1.0;
  float bias = max(uShadowBias, 0.0015 * (1.0 - dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))));
  float sum = 0.0;
  vec2 texel = vec2(1.0 / float(textureSize(uShadowMap, 0).x));
  for (int x = -1; x <= 1; ++x) {
    for (int y = -1; y <= 1; ++y) {
      float depth = texture(uShadowMap, projected.xy + vec2(x, y) * texel).r;
      sum += (projected.z - bias) <= depth ? 1.0 : 0.0;
    }
  }
  float lit = sum / 9.0;
  return mix(uShadowStrength, 1.0, lit);
}

void main() {
  vec3 albedo = uBaseColor;
  float alpha = uOpacity;
  if (uHasBaseColorTexture == 1) {
    vec4 texel = texture(uBaseColorTexture, vUV);
    albedo *= texel.rgb;
    alpha *= texel.a;
  }
  vec3 normal = normalize(vNormal);
  if (uDoubleSided == 1 && !gl_FrontFacing) normal = -normal;

  if (uUnlit == 1) {
    FragColor = vec4(albedo, alpha);
    return;
  }

  vec3 viewDirection = normalize(uCameraPosition - vWorld);
  float metallic = clamp(uMetallic, 0.0, 1.0);
  float roughness = clamp(uRoughness, 0.05, 1.0);
  float shininess = mix(4.0, 128.0, 1.0 - roughness);

  vec3 color = albedo * uAmbientColor * uAmbientIntensity;

  for (int i = 0; i < uDirectionalCount && i < 8; ++i) {
    vec3 toLight = normalize(-uLightDirections[i]);
    float ndotl = max(dot(normal, toLight), 0.0);
    if (ndotl <= 0.0) continue;
    vec3 halfVector = normalize(toLight + viewDirection);
    float specular = pow(max(dot(normal, halfVector), 0.0), shininess);
    float shadow = shadowFactor(vWorld);
    vec3 diffuse = albedo * (1.0 - metallic);
    vec3 specularColor = mix(vec3(0.04), albedo, metallic);
    color += uLightColors[i] * ndotl * shadow *
             (diffuse + specularColor * specular * (1.0 - roughness * 0.7));
  }

  for (int i = 0; i < uDynamicLightCount && i < 8; ++i) {
    vec3 offset = uLightPositions[i] - vWorld;
    float distance = length(offset);
    float range = uLightParams[i].x;
    float type = uLightParams[i].y;
    if (distance > range) continue;
    vec3 toLight = offset / max(distance, 0.0001);
    float ratio = clamp(1.0 - distance / max(range, 0.0001), 0.0, 1.0);
    float attenuation = ratio * ratio;
    if (type > 1.5) {
      float cosAngle = dot(-toLight, normalize(uLightDirections[i]));
      float outerCos = uLightParams[i].w;
      float innerCos = uLightParams[i].z;
      if (cosAngle < outerCos) continue;
      attenuation *= clamp((cosAngle - outerCos) / max(innerCos - outerCos, 0.0001), 0.0, 1.0);
    }
    float ndotl = max(dot(normal, toLight), 0.0);
    if (ndotl <= 0.0) continue;
    vec3 halfVector = normalize(toLight + viewDirection);
    float specular = pow(max(dot(normal, halfVector), 0.0), shininess);
    vec3 diffuse = albedo * (1.0 - metallic);
    vec3 specularColor = mix(vec3(0.04), albedo, metallic);
    color += uLightColors[i] * attenuation * ndotl *
             (diffuse + specularColor * specular * (1.0 - roughness * 0.7));
  }

  color += uEmissiveColor * uEmissiveStrength;

  if (uFogEnabled == 1) {
    float viewDistance = length(uCameraPosition - vWorld);
    float fog = clamp((viewDistance - uFogStart) / max(uFogEnd - uFogStart, 0.0001), 0.0, 1.0);
    color = mix(color, uFogColor, fog);
  }

  color *= uExposure;
  if (uToneMapping == 1) color = vec3(1.0) - exp(-color);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  FragColor = vec4(color, alpha);
}
)";

const char* kShadowVertexShader = R"(#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 4) in uvec4 aJoints;
layout(location = 5) in vec4 aWeights;
layout(location = 6) in mat4 aInstanceModel;

uniform mat4 uLightViewProjection;
uniform mat4 uModel;
uniform int uInstanced;
uniform int uSkinned;
uniform mat4 uBones[64];

void main() {
  mat4 model = (uInstanced == 1) ? aInstanceModel : uModel;
  vec4 localPosition = vec4(aPosition, 1.0);
  if (uSkinned == 1) {
    vec4 skinned = vec4(0.0);
    for (int i = 0; i < 4; ++i) {
      float weight = aWeights[i];
      if (weight <= 0.0001) continue;
      skinned += (uBones[aJoints[i]] * vec4(aPosition, 1.0)) * weight;
    }
    localPosition = skinned;
  }
  gl_Position = uLightViewProjection * model * localPosition;
}
)";

const char* kShadowFragmentShader = R"(#version 330 core
void main() {}
)";

const char* kLineVertexShader = R"(#version 330 core
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProjection;
void main() { gl_Position = uViewProjection * vec4(aPosition, 1.0); }
)";

const char* kLineFragmentShader = R"(#version 330 core
out vec4 FragColor;
uniform vec3 uColor;
uniform float uAlpha;
void main() { FragColor = vec4(uColor, uAlpha); }
)";

Mat4 BuildShadowMatrix(const RenderView& view, const Vec3& lightDirection, f32 distance) {
  Vec3 direction = Normalize(lightDirection);
  Vec3 center = view.position + view.forward * (distance * 0.35f);
  Vec3 eye = center - direction * (distance * 1.2f);
  Vec3 up(0, 1, 0);
  if (Abs(Dot(direction, up)) > 0.98f) up = Vec3(0, 0, 1);
  Mat4 lightView = Mat4::LookAt(eye, center, up);
  f32 extent = distance * 0.65f;
  Mat4 lightProjection = Mat4::Ortho(-extent, extent, -extent, extent, 0.1f, distance * 3.0f);
  return lightProjection * lightView;
}

} // namespace

// ------------------------------------------------------------------ lifetime
RendererGL::RendererGL() {}
RendererGL::~RendererGL() { Shutdown(); }

Renderer* Renderer::Create() { return new RendererGL(); }

bool RendererGL::Initialize(void* nativeWindowHandle, int width, int height, std::string* outError) {
  NF_UNUSED(nativeWindowHandle);
  if (initialized_) return true;
  width_ = width > 0 ? width : 1600;
  height_ = height > 0 ? height : 900;

  if (!gl::LoadGLFunctions()) {
    if (outError) *outError = std::string("OpenGL could not be initialised: ") + gl::GLLastLoadError();
    return false;
  }
  const char* version = glGetString ? (const char*)glGetString(GL_VERSION) : nullptr;
  const char* renderer = glGetString ? (const char*)glGetString(GL_RENDERER) : nullptr;
  const char* vendor = glGetString ? (const char*)glGetString(GL_VENDOR) : nullptr;
  driverInfo_ = std::string(renderer ? renderer : "unknown") + " - " + (vendor ? vendor : "") +
                " (GL " + (version ? version : "?") + ")";
  NF_INFO(LogCategory::Render, "Renderer: %s", driverInfo_.c_str());

  if (!CreateShaders(outError)) return false;
  if (!CreateShadowResources(outError)) return false;

  // white 1x1 fallback texture
  glGenTextures(1, &dummyTexture_);
  glBindTexture(GL_TEXTURE_2D, dummyTexture_);
  const u8 white[4] = {255, 255, 255, 255};
  glTexImage2D(GL_TEXTURE_2D, 0, (GLint)GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, white);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, (GLint)GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, (GLint)GL_NEAREST);

  glGenBuffers(1, &instanceVbo_);
  glGenVertexArrays(1, &lineVao_);
  glGenBuffers(1, &lineVbo_);
  glBindVertexArray(lineVao_);
  glBindBuffer(GL_ARRAY_BUFFER, lineVbo_);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(f32) * 3, (const void*)0);
  glBindVertexArray(0);

  glEnable(GL_DEPTH_TEST);
  glDepthFunc(GL_LEQUAL);
  glEnable(GL_CULL_FACE);
  glCullFace(GL_BACK);
  glFrontFace(0x0901 /*GL_CCW*/);
  glEnable(GL_MULTISAMPLE);
  initialized_ = true;
  return true;
}

void RendererGL::Shutdown() {
  if (!initialized_) return;
  ReleaseGpuResources();
  initialized_ = false;
}

void RendererGL::ReleaseGpuResources() {
  for (auto& entry : meshes_) {
    GpuMesh& mesh = entry.second;
    if (mesh.vao) glDeleteVertexArrays(1, &mesh.vao);
    if (mesh.vbo) glDeleteBuffers(1, &mesh.vbo);
    if (mesh.ebo) glDeleteBuffers(1, &mesh.ebo);
    if (mesh.boneVbo) glDeleteBuffers(1, &mesh.boneVbo);
  }
  meshes_.clear();
  for (auto& entry : textures_) {
    if (entry.second.handle) glDeleteTextures(1, &entry.second.handle);
  }
  textures_.clear();
  if (shadowFbo_) glDeleteFramebuffers(1, &shadowFbo_);
  if (shadowTexture_) glDeleteTextures(1, &shadowTexture_);
  if (forwardProgram_) glDeleteProgram(forwardProgram_);
  if (shadowProgram_) glDeleteProgram(shadowProgram_);
  if (lineProgram_) glDeleteProgram(lineProgram_);
  if (instanceVbo_) glDeleteBuffers(1, &instanceVbo_);
  if (lineVao_) glDeleteVertexArrays(1, &lineVao_);
  if (lineVbo_) glDeleteBuffers(1, &lineVbo_);
  if (dummyTexture_) glDeleteTextures(1, &dummyTexture_);
  if (targetFbo_) glDeleteFramebuffers(1, &targetFbo_);
  if (targetColor_) glDeleteTextures(1, &targetColor_);
  if (targetDepth_) glDeleteTextures(1, &targetDepth_);
  targetFbo_ = targetColor_ = targetDepth_ = 0;
  shadowFbo_ = shadowTexture_ = forwardProgram_ = shadowProgram_ = lineProgram_ = 0;
  instanceVbo_ = lineVao_ = lineVbo_ = dummyTexture_ = 0;
}

void RendererGL::PurgeAssetCache() {
  for (auto& entry : meshes_) {
    GpuMesh& mesh = entry.second;
    if (mesh.vao) glDeleteVertexArrays(1, &mesh.vao);
    if (mesh.vbo) glDeleteBuffers(1, &mesh.vbo);
    if (mesh.ebo) glDeleteBuffers(1, &mesh.ebo);
    if (mesh.boneVbo) glDeleteBuffers(1, &mesh.boneVbo);
  }
  meshes_.clear();
  for (auto& entry : textures_) {
    if (entry.second.handle) glDeleteTextures(1, &entry.second.handle);
  }
  textures_.clear();
}

bool RendererGL::BeginTarget(int width, int height) {
  width = std::max(8, width);
  height = std::max(8, height);
  if (!targetFbo_) {
    glGenFramebuffers(1, &targetFbo_);
    glGenTextures(1, &targetColor_);
    glGenTextures(1, &targetDepth_);
    glBindTexture(GL_TEXTURE_2D, targetColor_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, (GLint)GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, (GLint)GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (GLint)GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (GLint)GL_CLAMP_TO_EDGE);
    glBindFramebuffer(GL_FRAMEBUFFER, targetFbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, targetColor_, 0);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, targetDepth_, 0);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
      NF_ERROR(LogCategory::Render, "Viewport framebuffer incomplete (0x%X)", status);
      return false;
    }
    targetWidth_ = targetHeight_ = 0;
  }
  if (width != targetWidth_ || height != targetHeight_) {
    glBindTexture(GL_TEXTURE_2D, targetColor_);
    glTexImage2D(GL_TEXTURE_2D, 0, (GLint)GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                 nullptr);
    glBindTexture(GL_TEXTURE_2D, targetDepth_);
    glTexImage2D(GL_TEXTURE_2D, 0, (GLint)GL_DEPTH_COMPONENT24, width, height, 0,
                 GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
    targetWidth_ = width;
    targetHeight_ = height;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, targetFbo_);
  glViewport(0, 0, width, height);
  width_ = width;
  height_ = height;
  targetBound_ = true;
  return true;
}

u64 RendererGL::EndTarget() {
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  targetBound_ = false;
  return (u64)targetColor_;
}

u64 RendererGL::AssetTextureHandle(const std::string& assetPath) {
  if (assetPath.empty()) return 0;
  return (u64)GetTexture(assetPath, true);
}

void RendererGL::Resize(int width, int height) {
  width_ = std::max(1, width);
  height_ = std::max(1, height);
}

// ------------------------------------------------------------------ shaders
GLuint RendererGL::CompileProgram(const char* vertexSource, const char* fragmentSource,
                                  std::string* outError) {
  auto compile = [&](GLenum type, const char* source) -> GLuint {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint status = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
    if (!status) {
      char log[2048] = {0};
      glGetShaderInfoLog(shader, sizeof(log) - 1, nullptr, log);
      if (outError) *outError = std::string("shader compile failed: ") + log;
      NF_ERROR(LogCategory::Render, "Shader compile failed: %s", log);
      glDeleteShader(shader);
      return 0;
    }
    return shader;
  };
  GLuint vs = compile(GL_VERTEX_SHADER, vertexSource);
  GLuint fs = compile(GL_FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return 0;
  GLuint program = glCreateProgram();
  glAttachShader(program, vs);
  glAttachShader(program, fs);
  glLinkProgram(program);
  GLint status = 0;
  glGetProgramiv(program, GL_LINK_STATUS, &status);
  glDeleteShader(vs);
  glDeleteShader(fs);
  if (!status) {
    char log[2048] = {0};
    glGetProgramInfoLog(program, sizeof(log) - 1, nullptr, log);
    if (outError) *outError = std::string("shader link failed: ") + log;
    NF_ERROR(LogCategory::Render, "Shader link failed: %s", log);
    glDeleteProgram(program);
    return 0;
  }
  return program;
}

bool RendererGL::CreateShaders(std::string* outError) {
  forwardProgram_ = CompileProgram(kForwardVertexShader, kForwardFragmentShader, outError);
  if (!forwardProgram_) return false;
  shadowProgram_ = CompileProgram(kShadowVertexShader, kShadowFragmentShader, outError);
  if (!shadowProgram_) return false;
  lineProgram_ = CompileProgram(kLineVertexShader, kLineFragmentShader, outError);
  return lineProgram_ != 0;
}

bool RendererGL::CreateShadowResources(std::string* outError) {
  shadowResolution_ = 2048;
  glGenFramebuffers(1, &shadowFbo_);
  glGenTextures(1, &shadowTexture_);
  glBindTexture(GL_TEXTURE_2D, shadowTexture_);
  glTexImage2D(GL_TEXTURE_2D, 0, (GLint)GL_DEPTH_COMPONENT24, shadowResolution_, shadowResolution_,
               0, GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, (GLint)GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, (GLint)GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (GLint)GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (GLint)GL_CLAMP_TO_EDGE);
  glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo_);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, shadowTexture_, 0);
  glDrawBuffer(GL_NONE);
  GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  if (status != GL_FRAMEBUFFER_COMPLETE) {
    if (outError) *outError = "shadow map framebuffer is incomplete";
    NF_WARN(LogCategory::Render, "Shadow map framebuffer incomplete (0x%X) - shadows disabled",
            status);
    shadowFbo_ = 0;
    return true;   // shadows are optional, the renderer keeps working
  }
  return true;
}

// ------------------------------------------------------------------- meshes
RendererGL::GpuMesh* RendererGL::GetOrCreateMesh(const std::shared_ptr<Mesh>& mesh) {
  if (!mesh) return nullptr;
  auto it = meshes_.find(mesh.get());
  if (it != meshes_.end() && it->second.version == mesh->gpuVersion &&
      it->second.indexCount == (GLuint)mesh->indices.size())
    return &it->second;

  GpuMesh gpu;
  if (it != meshes_.end()) gpu = it->second;   // keep the handles, refill the data
  gpu.indexCount = (GLuint)mesh->indices.size();
  gpu.version = mesh->gpuVersion;
  gpu.skinned = mesh->hasSkinData && !mesh->skinnedVertices.empty();

  if (!gpu.vao) glGenVertexArrays(1, &gpu.vao);
  if (!gpu.vbo) glGenBuffers(1, &gpu.vbo);
  if (!gpu.ebo) glGenBuffers(1, &gpu.ebo);

  glBindVertexArray(gpu.vao);
  glBindBuffer(GL_ARRAY_BUFFER, gpu.vbo);
  if (gpu.skinned) {
    gpu.vertexCount = (GLuint)mesh->skinnedVertices.size();
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(gpu.vertexCount * sizeof(SkinnedVertex)),
                 mesh->skinnedVertices.data(), GL_STATIC_DRAW);
    const GLsizei stride = (GLsizei)sizeof(SkinnedVertex);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, stride, (const void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 3));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 6));
    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 8));
    glEnableVertexAttribArray(4);
    glVertexAttribIPointer(4, 4, GL_UNSIGNED_SHORT, stride, (const void*)(sizeof(f32) * 12));
    glEnableVertexAttribArray(5);
    glVertexAttribPointer(5, 4, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 12 + 8));
  } else {
    gpu.vertexCount = (GLuint)mesh->vertices.size();
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(gpu.vertexCount * sizeof(Vertex)),
                 mesh->vertices.data(), GL_STATIC_DRAW);
    const GLsizei stride = (GLsizei)sizeof(Vertex);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, stride, (const void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 3));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 6));
    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, stride, (const void*)(sizeof(f32) * 8));
  }
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, gpu.ebo);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(mesh->indices.size() * sizeof(u32)),
               mesh->indices.data(), GL_STATIC_DRAW);

  // per-instance model matrices (locations 6..9)
  glBindBuffer(GL_ARRAY_BUFFER, instanceVbo_);
  for (GLuint i = 0; i < 4; i++) {
    GLuint location = 6 + i;
    glEnableVertexAttribArray(location);
    glVertexAttribPointer(location, 4, GL_FLOAT, GL_FALSE, sizeof(f32) * 16,
                          (const void*)(sizeof(f32) * 4 * i));
    glVertexAttribDivisor(location, 1);
  }
  glBindVertexArray(0);
  glBindBuffer(GL_ARRAY_BUFFER, 0);

  stats_.meshesUploaded++;
  auto result = meshes_.insert_or_assign(mesh.get(), gpu);
  return &result.first->second;
}

GLuint RendererGL::GetTexture(const std::string& assetPath, bool srgb) {
  if (assetPath.empty()) return dummyTexture_;
  auto it = textures_.find(assetPath);
  if (it != textures_.end()) {
    it->second.lastUsedFrame = stats_.frameIndex;
    return it->second.handle;
  }
  GLuint handle = dummyTexture_;
  if (assets_) {
    auto texture = assets_->LoadTexture(assetPath);
    if (texture && texture->IsValid()) {
      glGenTextures(1, &handle);
      glBindTexture(GL_TEXTURE_2D, handle);
      GLenum internalFormat = srgb ? kSrgb8Alpha8 : GL_RGBA8;
      glTexImage2D(GL_TEXTURE_2D, 0, (GLint)internalFormat, (GLsizei)texture->width,
                   (GLsizei)texture->height, 0, GL_RGBA, GL_UNSIGNED_BYTE, texture->pixels.data());
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, (GLint)GL_LINEAR_MIPMAP_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, (GLint)GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (GLint)GL_REPEAT);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (GLint)GL_REPEAT);
      glGenerateMipmap(GL_TEXTURE_2D);
      glBindTexture(GL_TEXTURE_2D, 0);
      stats_.texturesUploaded++;
    } else {
      NF_WARN(LogCategory::Render, "Texture not found, using white fallback: %s", assetPath.c_str());
    }
  }
  GpuTexture entry;
  entry.handle = handle;
  entry.lastUsedFrame = stats_.frameIndex;
  textures_.insert_or_assign(assetPath, entry);
  return handle;
}

// ------------------------------------------------------------------- frames
void RendererGL::BeginFrame(const RenderSettings& settings) {
  stats_.drawCalls = 0;
  stats_.triangles = 0;
  stats_.instancedDraws = 0;
  stats_.instancesSaved = 0;
  stats_.shadowDrawCalls = 0;
  stats_.frameIndex++;
  if (settings.shadowsEnabled && settings.shadowResolution > 0)
    shadowResolution_ = std::min(4096, std::max(512, settings.shadowResolution));
  glViewport(0, 0, width_, height_);
  glClearColor(0.09f, 0.10f, 0.12f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
}

void RendererGL::RenderScene(const ::nf::RenderScene& scene, const RenderView& view,
                             const RenderSettings& settings, const DebugDrawList* debug) {
  Vec3 clear = scene.showSkybox ? (scene.skyTop * 0.5f + scene.skyBottom * 0.5f) : view.clearColor;
  glClearColor(clear.x, clear.y, clear.z, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  if (settings.shadowsEnabled && shadowFbo_) RenderShadowMap(scene, view, settings);

  // ---- forward pass (sky gradient is approximated by the clear colour; the editor
  //      draws a skybox grid in the viewport, gameplay uses fog + clear colour)
  glUseProgram(forwardProgram_);
  glUniform1i(glGetUniformLocation(forwardProgram_, "uUseNormalMatrix"), 1);
  UploadSceneUniforms(scene, view, settings);

  if (settings.wireframe) glPolygonMode(GL_FRONT_AND_BACK, GL_LINE);
  DrawItems(scene.items, settings, false);
  if (settings.wireframe) glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);

  if (!scene.transparentItems.empty()) {
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    if (settings.wireframe) glPolygonMode(GL_FRONT_AND_BACK, GL_LINE);
    DrawItems(scene.transparentItems, settings, true);
    if (settings.wireframe) glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
  }
  glUseProgram(0);
  glBindVertexArray(0);

  if (debug && settings.showGizmos) DrawDebug(*debug, view, settings);
}

void RendererGL::UploadSceneUniforms(const ::nf::RenderScene& scene, const RenderView& view,
                                     const RenderSettings& settings) {
  glUseProgram(forwardProgram_);
  auto set = [&](const char* name) { return glGetUniformLocation(forwardProgram_, name); };
  Mat4 viewProjection = view.projection * view.view;
  glUniformMatrix4fv(set("uViewProjection"), 1, GL_FALSE, viewProjection.data());
  glUniform3f(set("uCameraPosition"), view.position.x, view.position.y, view.position.z);
  glUniform3f(set("uAmbientColor"), scene.ambientColor.x, scene.ambientColor.y, scene.ambientColor.z);
  glUniform1f(set("uAmbientIntensity"), scene.ambientIntensity);
  glUniform1f(set("uExposure"), settings.exposure);
  glUniform1i(set("uToneMapping"), settings.toneMapping ? 1 : 0);

  int directionalCount = 0;
  int dynamicCount = 0;
  for (const auto& light : scene.lights) {
    if (light.type == 0 && directionalCount < 8) {
      std::string index = "[" + std::to_string(directionalCount) + "]";
      glUniform3f(set(("uLightDirections" + index).c_str()), light.direction.x, light.direction.y,
                  light.direction.z);
      glUniform3f(set(("uLightColors" + index).c_str()), light.color.x * light.intensity,
                  light.color.y * light.intensity, light.color.z * light.intensity);
      directionalCount++;
    } else if (light.type != 0 && dynamicCount < 8) {
      std::string index = "[" + std::to_string(dynamicCount) + "]";
      glUniform3f(set(("uLightPositions" + index).c_str()), light.position.x, light.position.y,
                  light.position.z);
      glUniform3f(set(("uLightDirections" + index).c_str()), light.direction.x, light.direction.y,
                  light.direction.z);
      glUniform3f(set(("uLightColors" + index).c_str()), light.color.x * light.intensity,
                  light.color.y * light.intensity, light.color.z * light.intensity);
      glUniform4f(set(("uLightParams" + index).c_str()), light.range, (f32)light.type,
                  light.innerCos, light.outerCos);
      dynamicCount++;
    }
  }
  glUniform1i(set("uDirectionalCount"), directionalCount);
  glUniform1i(set("uDynamicLightCount"), dynamicCount);

  bool shadows = settings.shadowsEnabled && shadowFbo_ && directionalCount > 0;
  glUniform1i(set("uShadowEnabled"), shadows ? 1 : 0);
  glUniform1i(set("uShadowMap"), 0);
  glUniform1f(set("uShadowBias"), scene.lights.empty() ? 0.0015f : scene.lights[0].shadowBias);
  glUniform1f(set("uShadowStrength"),
              scene.lights.empty() ? 0.8f : scene.lights[0].shadowStrength);
  glUniformMatrix4fv(set("uLightMatrix"), 1, GL_FALSE, shadowMatrix_.data());
  if (shadows) {
    glActiveTexture(GL_TEXTURE0 + 0);
    glBindTexture(GL_TEXTURE_2D, shadowTexture_);
  }

  glUniform1i(set("uFogEnabled"), scene.fogEnabled && settings.fogEnabled ? 1 : 0);
  glUniform1f(set("uFogStart"), scene.fogStart);
  glUniform1f(set("uFogEnd"), scene.fogEnd);
  glUniform3f(set("uFogColor"), scene.fogColor.x, scene.fogColor.y, scene.fogColor.z);
}

void RendererGL::BindMaterial(const Material& material) {
  auto set = [&](const char* name) { return glGetUniformLocation(forwardProgram_, name); };
  glUniform3f(set("uBaseColor"), material.baseColor.x, material.baseColor.y, material.baseColor.z);
  glUniform1f(set("uMetallic"), material.metallic);
  glUniform1f(set("uRoughness"), material.roughness);
  glUniform1f(set("uOpacity"), material.opacity * material.baseColor.w);
  glUniform1f(set("uEmissiveStrength"), material.emissiveStrength);
  glUniform3f(set("uEmissiveColor"), material.emissiveColor.x, material.emissiveColor.y,
              material.emissiveColor.z);
  glUniform1i(set("uUnlit"), material.unlit ? 1 : 0);
  glUniform1i(set("uDoubleSided"), material.doubleSided ? 1 : 0);
  glUniform1f(set("uUvTiling"), 1.0f);

  GLuint texture = GetTexture(material.baseColorTexture, true);
  glUniform1i(set("uHasBaseColorTexture"), material.baseColorTexture.empty() ? 0 : 1);
  glUniform1i(set("uBaseColorTexture"), 1);
  glActiveTexture(GL_TEXTURE0 + 1);
  glBindTexture(GL_TEXTURE_2D, texture);

  if (material.doubleSided) glDisable(GL_CULL_FACE);
  else glEnable(GL_CULL_FACE);
}

void RendererGL::DrawItems(const std::vector<RenderItem>& items, const RenderSettings& settings,
                           bool transparentPass) {
  NF_UNUSED(transparentPass);
  if (!forwardProgram_) return;

  // group consecutive items that share a mesh + material into an instanced draw
  usize index = 0;
  while (index < items.size()) {
    const RenderItem& first = items[index];
    if (!first.visible) {
      index++;
      continue;
    }
    GpuMesh* gpu = GetOrCreateMesh(first.mesh);
    if (!gpu || gpu->indexCount == 0) {
      index++;
      continue;
    }
    bool skinned = gpu->skinned && first.boneMatrices != nullptr;
    usize batchEnd = index + 1;
    if (settings.instancingEnabled && !skinned) {
      while (batchEnd < items.size() && batchEnd - index < 512) {
        const RenderItem& candidate = items[batchEnd];
        if (!candidate.visible) break;
        GpuMesh* otherGpu = GetOrCreateMesh(candidate.mesh);
        if (!otherGpu || otherGpu->skinned || candidate.boneMatrices) break;
        if (candidate.batchKey != first.batchKey || candidate.mesh.get() != first.mesh.get()) break;
        batchEnd++;
      }
    }

    BindMaterial(first.material);
    glBindVertexArray(gpu->vao);

    if (batchEnd - index > 1) {
      // instance transforms
      instanceScratch_.clear();
      instanceScratch_.reserve((batchEnd - index) * 16);
      for (usize i = index; i < batchEnd; i++) {
        const f32* data = items[i].world.data();
        instanceScratch_.insert(instanceScratch_.end(), data, data + 16);
      }
      glBindBuffer(GL_ARRAY_BUFFER, instanceVbo_);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(instanceScratch_.size() * sizeof(f32)),
                   instanceScratch_.data(), GL_STREAM_DRAW);
      glUniform1i(glGetUniformLocation(forwardProgram_, "uInstanced"), 1);
      glUniform1i(glGetUniformLocation(forwardProgram_, "uSkinned"), 0);
      glUniform1i(glGetUniformLocation(forwardProgram_, "uUseNormalMatrix"), 0);
      glUniformMatrix4fv(glGetUniformLocation(forwardProgram_, "uModel"), 1, GL_FALSE,
                         items[index].world.data());
      glUniformMatrix4fv(glGetUniformLocation(forwardProgram_, "uNormalMatrix"), 1, GL_FALSE,
                         items[index].normalMatrix.data());
      usize subMeshCount = first.mesh->submeshes.empty() ? 1 : first.mesh->submeshes.size();
      for (usize sub = 0; sub < subMeshCount; sub++) {
        GLuint offset = 0;
        GLuint count = gpu->indexCount;
        if (sub < first.mesh->submeshes.size()) {
          offset = first.mesh->submeshes[sub].indexOffset;
          count = first.mesh->submeshes[sub].indexCount;
        }
        glDrawElementsInstanced(GL_TRIANGLES, (GLsizei)count, GL_UNSIGNED_INT,
                                (const void*)(usize)(offset * sizeof(u32)),
                                (GLsizei)(batchEnd - index));
        stats_.drawCalls++;
        stats_.triangles += (count / 3) * (batchEnd - index);
      }
      stats_.instancedDraws++;
      stats_.instancesSaved += (batchEnd - index - 1) * (gpu->indexCount / 3);
      index = batchEnd;
      continue;
    }

    // single item
    glUniform1i(glGetUniformLocation(forwardProgram_, "uInstanced"), 0);
    glUniformMatrix4fv(glGetUniformLocation(forwardProgram_, "uModel"), 1, GL_FALSE,
                       first.world.data());
    glUniformMatrix4fv(glGetUniformLocation(forwardProgram_, "uNormalMatrix"), 1, GL_FALSE,
                       first.normalMatrix.data());
    if (skinned) {
      glUniform1i(glGetUniformLocation(forwardProgram_, "uSkinned"), 1);
      const auto& bones = *first.boneMatrices;
      usize boneCount = std::min<usize>(bones.size(), 64);
      if (boneCount > 0) {
        std::vector<f32> data;
        data.reserve(boneCount * 16);
        for (usize i = 0; i < boneCount; i++) {
          const f32* m = bones[i].data();
          data.insert(data.end(), m, m + 16);
        }
        glUniformMatrix4fv(glGetUniformLocation(forwardProgram_, "uBones"), (GLsizei)boneCount,
                           GL_FALSE, data.data());
      }
    } else {
      glUniform1i(glGetUniformLocation(forwardProgram_, "uSkinned"), 0);
    }
    GLuint offset = 0;
    GLuint count = gpu->indexCount;
    if (first.subMeshIndex < first.mesh->submeshes.size()) {
      offset = first.mesh->submeshes[first.subMeshIndex].indexOffset;
      count = first.mesh->submeshes[first.subMeshIndex].indexCount;
    }
    glDrawElements(GL_TRIANGLES, (GLsizei)count, GL_UNSIGNED_INT,
                   (const void*)(usize)(offset * sizeof(u32)));
    stats_.drawCalls++;
    stats_.triangles += count / 3;
    index++;
  }
  if (settings.wireframe) glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
}

void RendererGL::RenderShadowMap(const ::nf::RenderScene& scene, const RenderView& view,
                                 const RenderSettings& settings) {
  const RenderLight* directional = nullptr;
  for (const auto& light : scene.lights) {
    if (light.type == 0 && light.castShadows) {
      directional = &light;
      break;
    }
  }
  if (!directional) return;

  shadowMatrix_ = BuildShadowMatrix(view, directional->direction,
                                    std::max(10.0f, settings.shadowDistance));
  glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo_);
  glViewport(0, 0, shadowResolution_, shadowResolution_);
  glClear(GL_DEPTH_BUFFER_BIT);
  glUseProgram(shadowProgram_);
  glUniformMatrix4fv(glGetUniformLocation(shadowProgram_, "uLightViewProjection"), 1, GL_FALSE,
                     shadowMatrix_.data());
  glEnable(GL_CULL_FACE);
  glCullFace(GL_FRONT);
  glEnable(GL_DEPTH_TEST);

  for (const auto& item : scene.items) {
    if (!item.visible || !item.castShadows || !item.mesh) continue;
    GpuMesh* gpu = GetOrCreateMesh(item.mesh);
    if (!gpu || gpu->indexCount == 0) continue;
    bool skinned = gpu->skinned && item.boneMatrices != nullptr;
    glBindVertexArray(gpu->vao);
    glUniform1i(glGetUniformLocation(shadowProgram_, "uInstanced"), 0);
    glUniformMatrix4fv(glGetUniformLocation(shadowProgram_, "uModel"), 1, GL_FALSE, item.world.data());
    if (skinned) {
      glUniform1i(glGetUniformLocation(shadowProgram_, "uSkinned"), 1);
      const auto& bones = *item.boneMatrices;
      usize boneCount = std::min<usize>(bones.size(), 64);
      if (boneCount > 0) {
        std::vector<f32> data;
        for (usize i = 0; i < boneCount; i++) {
          const f32* m = bones[i].data();
          data.insert(data.end(), m, m + 16);
        }
        glUniformMatrix4fv(glGetUniformLocation(shadowProgram_, "uBones"), (GLsizei)boneCount,
                           GL_FALSE, data.data());
      }
    } else {
      glUniform1i(glGetUniformLocation(shadowProgram_, "uSkinned"), 0);
    }
    GLuint offset = 0;
    GLuint count = gpu->indexCount;
    if (item.subMeshIndex < item.mesh->submeshes.size()) {
      offset = item.mesh->submeshes[item.subMeshIndex].indexOffset;
      count = item.mesh->submeshes[item.subMeshIndex].indexCount;
    }
    glDrawElements(GL_TRIANGLES, (GLsizei)count, GL_UNSIGNED_INT,
                   (const void*)(usize)(offset * sizeof(u32)));
    stats_.shadowDrawCalls++;
  }

  glCullFace(GL_BACK);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(0, 0, width_, height_);
}

void RendererGL::DrawDebug(const DebugDrawList& debug, const RenderView& view,
                           const RenderSettings& settings) {
  NF_UNUSED(view);
  NF_UNUSED(settings);
  const auto& lines = debug.Lines();
  if (lines.empty() || !lineProgram_) return;
  std::vector<f32> data;
  data.reserve(lines.size() * 6);
  struct Range {
    Vec3 color;
    usize start;
    usize count;
    bool depthTest;
  };
  std::vector<Range> ranges;
  for (const auto& line : lines) {
    if (ranges.empty() || ranges.back().color.x != line.color.x ||
        ranges.back().color.y != line.color.y || ranges.back().color.z != line.color.z ||
        ranges.back().depthTest != line.depthTest) {
      ranges.push_back({line.color, data.size() / 3, 0, line.depthTest});
    }
    data.push_back(line.from.x);
    data.push_back(line.from.y);
    data.push_back(line.from.z);
    data.push_back(line.to.x);
    data.push_back(line.to.y);
    data.push_back(line.to.z);
    ranges.back().count += 2;
  }
  if (data.size() / 3 > lineCapacity_) {
    glBindBuffer(GL_ARRAY_BUFFER, lineVbo_);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(data.size() * sizeof(f32)), nullptr, GL_STREAM_DRAW);
    lineCapacity_ = data.size() / 3;
  }
  glBindBuffer(GL_ARRAY_BUFFER, lineVbo_);
  glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(data.size() * sizeof(f32)), data.data());

  Mat4 viewProjection = view.projection * view.view;
  glUseProgram(lineProgram_);
  glUniformMatrix4fv(glGetUniformLocation(lineProgram_, "uViewProjection"), 1, GL_FALSE,
                     viewProjection.data());
  glLineWidth(1.0f);
  glBindVertexArray(lineVao_);
  for (const auto& range : ranges) {
    glUniform3f(glGetUniformLocation(lineProgram_, "uColor"), range.color.x, range.color.y,
                range.color.z);
    glUniform1f(glGetUniformLocation(lineProgram_, "uAlpha"), 1.0f);
    if (!range.depthTest) glDisable(GL_DEPTH_TEST);
    glDrawArrays(GL_LINES, (GLint)range.start, (GLsizei)range.count);
    if (!range.depthTest) glEnable(GL_DEPTH_TEST);
    stats_.drawCalls++;
  }
  glBindVertexArray(0);
  glUseProgram(0);
}

void RendererGL::EndFrame(bool vsync) {
  NF_UNUSED(vsync);
  glFlush();
}

FrameCapture RendererGL::CaptureFrame() {
  FrameCapture capture;
  capture.width = width_;
  capture.height = height_;
  capture.rgba.resize((usize)width_ * height_ * 4);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, width_, height_, GL_RGBA, GL_UNSIGNED_BYTE, capture.rgba.data());
  // flip vertically so the image matches the editor's top-left origin
  usize rowBytes = (usize)width_ * 4;
  std::vector<u8> scratch(rowBytes);
  for (int y = 0; y < height_ / 2; y++) {
    u8* top = capture.rgba.data() + (usize)y * rowBytes;
    u8* bottom = capture.rgba.data() + (usize)(height_ - 1 - y) * rowBytes;
    std::memcpy(scratch.data(), top, rowBytes);
    std::memcpy(top, bottom, rowBytes);
    std::memcpy(bottom, scratch.data(), rowBytes);
  }
  capture.valid = true;
  return capture;
}

} // namespace nf
