// NovaForge Engine - core/Log.h
// Categorised logging with a memory ring buffer (drives the editor Console panel)
// and a rotating log file under the project's Logs/ directory.
#pragma once

#include "core/Base.h"
#include <mutex>
#include <deque>

namespace nf {

namespace detail {
void assertFailed(const char* expr, const char* file, int line);
void todoStub(const char* msg, const char* file, int line);
}

enum class LogLevel : int { Trace = 0, Debug, Info, Warning, Error, Fatal, Off };
enum class LogCategory : int {
  Core = 0, Render, Scene, Asset, Physics, Audio, Animation, Script, AI, Input, Editor, Runtime, Build, Project, Count
};

const char* LogLevelName(LogLevel l);
const char* LogCategoryName(LogCategory c);

struct LogEntry {
  LogLevel level;
  LogCategory category;
  std::string message;
  std::string timestamp;   // HH:MM:SS.mmm
  u64 frame = 0;
  int count = 1;           // repeated identical messages are collapsed
};

class Log {
public:
  static Log& Get();

  void SetMinLevel(LogLevel level) { minLevel_ = level; }
  LogLevel MinLevel() const { return minLevel_; }
  void SetCategoryEnabled(LogCategory c, bool enabled);
  bool IsCategoryEnabled(LogCategory c) const;

  void Write(LogLevel level, LogCategory cat, const char* fmt, ...);

  // Ring buffer access for the editor console.
  std::vector<LogEntry> Snapshot() const;
  void Clear();
  u64 Version() const { return version_; }

  bool OpenFile(const std::string& path);
  void CloseFile();
  std::string FilePath() const { return filePath_; }

private:
  Log() = default;
  LogLevel minLevel_ = LogLevel::Info;
  bool categoryEnabled_[(int)LogCategory::Count];
  mutable std::mutex mutex_;
  std::deque<LogEntry> entries_;
  static constexpr usize kMaxEntries = 4000;
  std::FILE* file_ = nullptr;
  std::string filePath_;
  u64 version_ = 0;
  u64 frame_ = 0;
  friend void SetLogFrame(u64);
};

void SetLogFrame(u64 frame);
u64 GetLogFrame();

namespace detail {
void LogWriteV(LogLevel level, LogCategory cat, const char* fmt, void* vaList);
}

} // namespace nf

// ------------------------------------------------------------------------------ macros
#define NF_LOG(level, cat, ...) ::nf::Log::Get().Write(level, cat, __VA_ARGS__)
#define NF_TRACE(cat, ...)   NF_LOG(::nf::LogLevel::Trace,   cat, __VA_ARGS__)
#define NF_DEBUG_LOG(cat, ...) NF_LOG(::nf::LogLevel::Debug, cat, __VA_ARGS__)
#define NF_INFO(cat, ...)    NF_LOG(::nf::LogLevel::Info,    cat, __VA_ARGS__)
#define NF_WARN(cat, ...)    NF_LOG(::nf::LogLevel::Warning, cat, __VA_ARGS__)
#define NF_ERROR(cat, ...)   NF_LOG(::nf::LogLevel::Error,   cat, __VA_ARGS__)
#define NF_FATAL(cat, ...)   NF_LOG(::nf::LogLevel::Fatal,   cat, __VA_ARGS__)
