// NovaForge Engine - renderer/GLFunctions.h
// Self-contained OpenGL 3.3 core-profile loader.
//
// NovaForge deliberately does not depend on GLEW/GLAD or on system GL headers:
// the functions are declared here and resolved at runtime from opengl32.dll
// (Windows) or libGL.so.1 (Linux). That keeps the Windows cross-build free of
// extra dependencies and makes the renderer compile on any machine.
#pragma once

#include "core/Base.h"

namespace nf {
namespace gl {

using GLenum = unsigned int;
using GLboolean = unsigned char;
using GLbitfield = unsigned int;
using GLbyte = signed char;
using GLshort = short;
using GLint = int;
using GLsizei = int;
using GLubyte = unsigned char;
using GLushort = unsigned short;
using GLuint = unsigned int;
using GLfloat = float;
using GLclampf = float;
using GLdouble = double;
using GLchar = char;
using GLsizeiptr = ptrdiff_t;
using GLintptr = ptrdiff_t;
using GLvoid = void;

// ---------------------------------------------------------------- constants
enum : GLenum {
  GL_FALSE = 0,
  GL_TRUE = 1,
  GL_POINTS = 0x0000,
  GL_LINES = 0x0001,
  GL_TRIANGLES = 0x0004,
  GL_DEPTH_BUFFER_BIT = 0x00000100,
  GL_STENCIL_BUFFER_BIT = 0x00000400,
  GL_COLOR_BUFFER_BIT = 0x00004000,
  GL_NEVER = 0x0200,
  GL_LESS = 0x0201,
  GL_EQUAL = 0x0202,
  GL_LEQUAL = 0x0203,
  GL_GREATER = 0x0204,
  GL_GEQUAL = 0x0206,
  GL_ALWAYS = 0x0207,
  GL_SRC_ALPHA = 0x0302,
  GL_ONE_MINUS_SRC_ALPHA = 0x0303,
  GL_FRONT = 0x0404,
  GL_BACK = 0x0405,
  GL_FRONT_AND_BACK = 0x0408,
  GL_CULL_FACE = 0x0B44,
  GL_DEPTH_TEST = 0x0B71,
  GL_DEPTH_WRITEMASK = 0x0B72,
  GL_BLEND = 0x0BE2,
  GL_SCISSOR_TEST = 0x0C11,
  GL_UNPACK_ALIGNMENT = 0x0CF5,
  GL_PACK_ALIGNMENT = 0x0D05,
  GL_TEXTURE_2D = 0x0DE1,
  GL_UNSIGNED_BYTE = 0x1401,
  GL_UNSIGNED_SHORT = 0x1403,
  GL_UNSIGNED_INT = 0x1405,
  GL_FLOAT = 0x1406,
  GL_RED = 0x1903,
  GL_RGB = 0x1907,
  GL_RGBA = 0x1908,
  GL_RGB8 = 0x8051,
  GL_RGBA8 = 0x8058,
  GL_DEPTH_COMPONENT = 0x1902,
  GL_DEPTH_COMPONENT24 = 0x81A6,
  GL_VENDOR = 0x1F00,
  GL_RENDERER = 0x1F01,
  GL_VERSION = 0x1F02,
  GL_NEAREST = 0x2600,
  GL_LINEAR = 0x2601,
  GL_LINEAR_MIPMAP_LINEAR = 0x2703,
  GL_TEXTURE_MAG_FILTER = 0x2800,
  GL_TEXTURE_MIN_FILTER = 0x2801,
  GL_TEXTURE_WRAP_S = 0x2802,
  GL_TEXTURE_WRAP_T = 0x2803,
  GL_REPEAT = 0x2901,
  GL_CLAMP_TO_EDGE = 0x812F,
  GL_POLYGON_MODE = 0x0B40,
  GL_LINE = 0x1B01,
  GL_FILL = 0x1B02,
  GL_ARRAY_BUFFER = 0x8892,
  GL_ELEMENT_ARRAY_BUFFER = 0x8893,
  GL_STATIC_DRAW = 0x88E4,
  GL_DYNAMIC_DRAW = 0x88E8,
  GL_STREAM_DRAW = 0x88E0,
  GL_FRAGMENT_SHADER = 0x8B30,
  GL_VERTEX_SHADER = 0x8B31,
  GL_COMPILE_STATUS = 0x8B81,
  GL_LINK_STATUS = 0x8B82,
  GL_INFO_LOG_LENGTH = 0x8B84,
  GL_TEXTURE0 = 0x84C0,
  GL_TEXTURE1 = 0x84C1,
  GL_TEXTURE2 = 0x84C2,
  GL_TEXTURE3 = 0x84C3,
  GL_TEXTURE4 = 0x84C4,
  GL_TEXTURE5 = 0x84C5,
  GL_TEXTURE6 = 0x84C6,
  GL_TEXTURE7 = 0x84C7,
  GL_MULTISAMPLE = 0x809D,
  GL_FRAMEBUFFER = 0x8D40,
  GL_READ_FRAMEBUFFER = 0x8CA8,
  GL_DRAW_FRAMEBUFFER = 0x8CA9,
  GL_COLOR_ATTACHMENT0 = 0x8CE0,
  GL_DEPTH_ATTACHMENT = 0x8D00,
  GL_FRAMEBUFFER_COMPLETE = 0x8CD5,
  GL_DEPTH24_STENCIL8 = 0x88F0,
  GL_DEPTH_STENCIL_ATTACHMENT = 0x821A,
  GL_TEXTURE_MAX_LEVEL = 0x813D,
  GL_TEXTURE_BASE_LEVEL = 0x813C,
  GL_FRAMEBUFFER_SRGB = 0x8DB9,
  GL_DEBUG_OUTPUT = 0x92E0,
  GL_NONE = 0,
};

// ------------------------------------------------------- function pointers
#define NF_GL_FUNCTIONS(X)                                                                        \
  X(void, glClear, (GLbitfield))                                                                  \
  X(void, glClearColor, (GLfloat, GLfloat, GLfloat, GLfloat))                                     \
  X(void, glViewport, (GLint, GLint, GLsizei, GLsizei))                                           \
  X(void, glScissor, (GLint, GLint, GLsizei, GLsizei))                                            \
  X(void, glEnable, (GLenum))                                                                      \
  X(void, glDisable, (GLenum))                                                                     \
  X(void, glDepthFunc, (GLenum))                                                                   \
  X(void, glDepthMask, (GLboolean))                                                                \
  X(void, glCullFace, (GLenum))                                                                    \
  X(void, glFrontFace, (GLenum))                                                                   \
  X(void, glBlendFunc, (GLenum, GLenum))                                                           \
  X(void, glBlendFuncSeparate, (GLenum, GLenum, GLenum, GLenum))                                   \
  X(void, glPolygonMode, (GLenum, GLenum))                                                         \
  X(void, glLineWidth, (GLfloat))                                                                  \
  X(void, glPixelStorei, (GLenum, GLint))                                                          \
  X(void, glFinish, (void))                                                                        \
  X(void, glFlush, (void))                                                                         \
  X(GLenum, glGetError, (void))                                                                    \
  X(const GLubyte*, glGetString, (GLenum))                                                         \
  X(void, glGetIntegerv, (GLenum, GLint*))                                                         \
  X(void, glReadPixels, (GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*))                    \
  X(void, glGenBuffers, (GLsizei, GLuint*))                                                        \
  X(void, glBindBuffer, (GLenum, GLuint))                                                          \
  X(void, glBufferData, (GLenum, GLsizeiptr, const void*, GLenum))                                 \
  X(void, glBufferSubData, (GLenum, GLintptr, GLsizeiptr, const void*))                            \
  X(void, glDeleteBuffers, (GLsizei, const GLuint*))                                               \
  X(void, glGenVertexArrays, (GLsizei, GLuint*))                                                   \
  X(void, glBindVertexArray, (GLuint))                                                             \
  X(void, glDeleteVertexArrays, (GLsizei, const GLuint*))                                          \
  X(void, glEnableVertexAttribArray, (GLuint))                                                     \
  X(void, glDisableVertexAttribArray, (GLuint))                                                    \
  X(void, glVertexAttribPointer, (GLuint, GLint, GLenum, GLboolean, GLsizei, const void*))         \
  X(void, glVertexAttribIPointer, (GLuint, GLint, GLenum, GLsizei, const void*))                   \
  X(void, glVertexAttribDivisor, (GLuint, GLuint))                                                 \
  X(GLuint, glCreateShader, (GLenum))                                                              \
  X(void, glShaderSource, (GLuint, GLsizei, const GLchar* const*, const GLint*))                    \
  X(void, glCompileShader, (GLuint))                                                               \
  X(void, glGetShaderiv, (GLuint, GLenum, GLint*))                                                 \
  X(void, glGetShaderInfoLog, (GLuint, GLsizei, GLsizei*, GLchar*))                                \
  X(void, glDeleteShader, (GLuint))                                                                \
  X(GLuint, glCreateProgram, (void))                                                               \
  X(void, glAttachShader, (GLuint, GLuint))                                                        \
  X(void, glLinkProgram, (GLuint))                                                                 \
  X(void, glGetProgramiv, (GLuint, GLenum, GLint*))                                                \
  X(void, glGetProgramInfoLog, (GLuint, GLsizei, GLsizei*, GLchar*))                               \
  X(void, glUseProgram, (GLuint))                                                                  \
  X(void, glDeleteProgram, (GLuint))                                                               \
  X(GLint, glGetUniformLocation, (GLuint, const GLchar*))                                          \
  X(void, glUniform1i, (GLint, GLint))                                                             \
  X(void, glUniform1f, (GLint, GLfloat))                                                           \
  X(void, glUniform2f, (GLint, GLfloat, GLfloat))                                                  \
  X(void, glUniform3f, (GLint, GLfloat, GLfloat, GLfloat))                                         \
  X(void, glUniform4f, (GLint, GLfloat, GLfloat, GLfloat, GLfloat))                                \
  X(void, glUniform1fv, (GLint, GLsizei, const GLfloat*))                                          \
  X(void, glUniform3fv, (GLint, GLsizei, const GLfloat*))                                          \
  X(void, glUniformMatrix3fv, (GLint, GLsizei, GLboolean, const GLfloat*))                         \
  X(void, glUniformMatrix4fv, (GLint, GLsizei, GLboolean, const GLfloat*))                         \
  X(void, glGenTextures, (GLsizei, GLuint*))                                                       \
  X(void, glBindTexture, (GLenum, GLuint))                                                         \
  X(void, glTexImage2D, (GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*)) \
  X(void, glTexParameteri, (GLenum, GLenum, GLint))                                                \
  X(void, glDeleteTextures, (GLsizei, const GLuint*))                                              \
  X(void, glActiveTexture, (GLenum))                                                               \
  X(void, glGenerateMipmap, (GLenum))                                                              \
  X(void, glDrawElements, (GLenum, GLsizei, GLenum, const void*))                                  \
  X(void, glDrawArrays, (GLenum, GLint, GLsizei))                                                  \
  X(void, glDrawElementsInstanced, (GLenum, GLsizei, GLenum, const void*, GLsizei))                 \
  X(void, glGenFramebuffers, (GLsizei, GLuint*))                                                   \
  X(void, glBindFramebuffer, (GLenum, GLuint))                                                     \
  X(void, glFramebufferTexture2D, (GLenum, GLenum, GLenum, GLuint, GLint))                          \
  X(GLenum, glCheckFramebufferStatus, (GLenum))                                                    \
  X(void, glDeleteFramebuffers, (GLsizei, const GLuint*))                                          \
  X(void, glDrawBuffer, (GLenum))                                                                  \
  X(void, glDrawBuffers, (GLsizei, const GLenum*))

#define NF_GL_DECLARE(ret, name, args) extern ret(*name) args;
NF_GL_FUNCTIONS(NF_GL_DECLARE)
#undef NF_GL_DECLARE

// Resolves every function pointer. `loader` is a user supplied resolver used as a
// fallback (the Win32 platform passes wglGetProcAddress). Returns false when a
// required entry point is missing.
using GLProcLoader = void* (*)(const char*);
bool LoadGLFunctions(GLProcLoader loader = nullptr);
bool GLFunctionsLoaded();
const char* GLLastLoadError();

} // namespace gl
} // namespace nf
