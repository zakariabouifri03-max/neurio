// NovaForge Engine - core/Log.cpp
#include "core/Log.h"

#include <cstdarg>
#include <ctime>
#include <atomic>

#if NF_PLATFORM_WINDOWS
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#endif

namespace nf {

static std::atomic<u64> g_logFrame{0};

void SetLogFrame(u64 f) { g_logFrame.store(f, std::memory_order_relaxed); }
u64 GetLogFrame() { return g_logFrame.load(std::memory_order_relaxed); }

const char* LogLevelName(LogLevel l) {
  switch (l) {
    case LogLevel::Trace: return "TRACE";
    case LogLevel::Debug: return "DEBUG";
    case LogLevel::Info: return "INFO";
    case LogLevel::Warning: return "WARN";
    case LogLevel::Error: return "ERROR";
    case LogLevel::Fatal: return "FATAL";
    default: return "OFF";
  }
}

const char* LogCategoryName(LogCategory c) {
  switch (c) {
    case LogCategory::Core: return "Core";
    case LogCategory::Render: return "Render";
    case LogCategory::Scene: return "Scene";
    case LogCategory::Asset: return "Asset";
    case LogCategory::Physics: return "Physics";
    case LogCategory::Audio: return "Audio";
    case LogCategory::Animation: return "Animation";
    case LogCategory::Script: return "Script";
    case LogCategory::AI: return "AI";
    case LogCategory::Input: return "Input";
    case LogCategory::Editor: return "Editor";
    case LogCategory::Runtime: return "Runtime";
    case LogCategory::Build: return "Build";
    case LogCategory::Project: return "Project";
    default: return "?";
  }
}

Log& Log::Get() {
  static Log instance;
  static bool init = [] { return true; }();
  (void)init;
  if (!instance.categoryEnabled_[0]) {
    for (int i = 0; i < (int)LogCategory::Count; i++) instance.categoryEnabled_[i] = true;
    instance.categoryEnabled_[0] = true;
  }
  return instance;
}

void Log::SetCategoryEnabled(LogCategory c, bool enabled) {
  std::lock_guard<std::mutex> lock(mutex_);
  categoryEnabled_[(int)c] = enabled;
}

bool Log::IsCategoryEnabled(LogCategory c) const {
  return categoryEnabled_[(int)c];
}

void Log::Write(LogLevel level, LogCategory cat, const char* fmt, ...) {
  if (level < minLevel_ || level == LogLevel::Off) return;
  if (!categoryEnabled_[(int)cat]) return;

  char buffer[2048];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  LogEntry entry;
  entry.level = level;
  entry.category = cat;
  entry.message = buffer;
  entry.frame = g_logFrame.load(std::memory_order_relaxed);

  // timestamp
  {
    std::time_t t = std::time(nullptr);
    std::tm tmv{};
#if NF_PLATFORM_WINDOWS
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    char ts[32];
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d", tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
    entry.timestamp = ts;
  }

  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!entries_.empty() && entries_.back().message == entry.message &&
        entries_.back().level == entry.level && entries_.back().category == entry.category) {
      entries_.back().count++;
      entry.count = entries_.back().count;
      entries_.pop_back();
    }
    entries_.push_back(entry);
    while (entries_.size() > kMaxEntries) entries_.pop_front();
    version_++;

    if (file_) {
      fprintf(file_, "[%s][%s][%s] %s\n", entry.timestamp.c_str(), LogLevelName(level),
              LogCategoryName(cat), entry.message.c_str());
      fflush(file_);
    }
  }

#if NF_PLATFORM_WINDOWS
  if (level >= LogLevel::Error) {
    char line[2200];
    snprintf(line, sizeof(line), "[%s][%s] %s\n", LogLevelName(level), LogCategoryName(cat),
             entry.message.c_str());
    OutputDebugStringA(line);
  }
#else
  // Native (dev) builds log to stderr so tests and headless runs show output.
  fprintf(stderr, "[%s][%s] %s\n", LogLevelName(level), LogCategoryName(cat), entry.message.c_str());
#endif

  if (level == LogLevel::Fatal) {
    CloseFile();
#if NF_PLATFORM_WINDOWS
    if (IsDebuggerPresent()) __debugbreak();
#endif
  }
}

std::vector<LogEntry> Log::Snapshot() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return {entries_.begin(), entries_.end()};
}

void Log::Clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  entries_.clear();
  version_++;
}

bool Log::OpenFile(const std::string& path) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (file_) fclose(file_);
  file_ = fopen(path.c_str(), "w");
  filePath_ = path;
  return file_ != nullptr;
}

void Log::CloseFile() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (file_) { fclose(file_); file_ = nullptr; }
}

namespace detail {

void assertFailed(const char* expr, const char* file, int line) {
  NF_LOG(LogLevel::Error, LogCategory::Core, "ASSERTION FAILED: %s\n    at %s:%d", expr, file, line);
}

void todoStub(const char* msg, const char* file, int line) {
  NF_LOG(LogLevel::Warning, LogCategory::Core, "Not implemented in V1: %s (%s:%d)", msg, file, line);
}

} // namespace detail
} // namespace nf
