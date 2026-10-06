// NovaForge Engine - renderer/GLFunctions.cpp
#include "renderer/GLFunctions.h"
#include "core/Log.h"

#include <cstring>

#if NF_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace nf {
namespace gl {

#define NF_GL_DEFINE(ret, name, args) ret(*name) args = nullptr;
NF_GL_FUNCTIONS(NF_GL_DEFINE)
#undef NF_GL_DEFINE

namespace {
void* g_library = nullptr;
const char* g_lastError = "";
bool g_loaded = false;

#if NF_PLATFORM_WINDOWS
typedef void* (*WglGetProcAddressFn)(const char*);
WglGetProcAddressFn g_wglGetProcAddress = nullptr;
#else
typedef void* (*GLXGetProcAddressFn)(const char*);
GLXGetProcAddressFn g_glxGetProcAddress = nullptr;
#endif

void* PlatformProc(const char* name) {
#if NF_PLATFORM_WINDOWS
  if (g_wglGetProcAddress) {
    void* proc = g_wglGetProcAddress(name);
    if (proc && proc != (void*)1 && proc != (void*)2 && proc != (void*)3 &&
        proc != (void*)-1)
      return proc;
  }
  if (g_library) return (void*)GetProcAddress((HMODULE)g_library, name);
  return nullptr;
#else
  if (g_glxGetProcAddress) {
    void* proc = g_glxGetProcAddress(name);
    if (proc) return proc;
  }
  if (g_library) return dlsym(g_library, name);
  return nullptr;
#endif
}

bool OpenLibrary() {
  if (g_library) return true;
#if NF_PLATFORM_WINDOWS
  g_library = (void*)LoadLibraryA("opengl32.dll");
  if (g_library) {
    g_wglGetProcAddress = (WglGetProcAddressFn)(void*)GetProcAddress((HMODULE)g_library,
                                                                     "wglGetProcAddress");
  }
  if (!g_library) g_lastError = "opengl32.dll could not be loaded";
#else
  for (const char* name : {"libGL.so.1", "libGL.so", "libOpenGL.so.0"}) {
    g_library = dlopen(name, RTLD_LAZY | RTLD_GLOBAL);
    if (g_library) break;
  }
  if (g_library) g_glxGetProcAddress = (GLXGetProcAddressFn)dlsym(g_library, "glXGetProcAddressARB");
  if (!g_library) g_lastError = "libGL.so.1 could not be loaded";
#endif
  return g_library != nullptr;
}

} // namespace

bool GLFunctionsLoaded() { return g_loaded; }
const char* GLLastLoadError() { return g_lastError; }

bool LoadGLFunctions(GLProcLoader loader) {
  if (g_loaded) return true;
  if (!OpenLibrary()) return false;

  auto resolve = [&](const char* name) -> void* {
    void* proc = loader ? loader(name) : nullptr;
    if (!proc) proc = PlatformProc(name);
    return proc;
  };

  // GL 1.1 entry points always come from the library itself.
  auto resolveLibrary = [&](const char* name) -> void* {
#if NF_PLATFORM_WINDOWS
    return g_library ? (void*)GetProcAddress((HMODULE)g_library, name) : nullptr;
#else
    return g_library ? dlsym(g_library, name) : nullptr;
#endif
  };

#define NF_GL_RESOLVE(ret, name, args)                                    \
  name = (ret(*) args)resolve(#name);                                     \
  if (!name) name = (ret(*) args)resolveLibrary(#name);
  NF_GL_FUNCTIONS(NF_GL_RESOLVE)
#undef NF_GL_RESOLVE

  const char* required[] = {"glClear",  "glGenBuffers",  "glCreateShader", "glCreateProgram",
                            "glDrawElements", "glUseProgram", "glGenTextures", "glVertexAttribPointer"};
  for (const char* name : required) {
    bool found = false;
#define NF_GL_CHECK(ret, fname, args) if (std::strcmp(name, #fname) == 0) found = (fname != nullptr);
    NF_GL_FUNCTIONS(NF_GL_CHECK)
#undef NF_GL_CHECK
    if (!found) {
      g_lastError = "required OpenGL entry point missing";
      NF_ERROR(LogCategory::Render, "Required OpenGL function missing: %s", name);
      return false;
    }
  }

  g_loaded = true;
  NF_INFO(LogCategory::Render, "OpenGL loaded: %s | %s",
          glGetString ? (const char*)glGetString(GL_VERSION) : "unknown",
          glGetString ? (const char*)glGetString(GL_RENDERER) : "unknown");
  return true;
}

} // namespace gl
} // namespace nf
