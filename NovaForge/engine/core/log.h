// NovaForge Engine - logging subsystem
// Ring buffer + file sink + stdout sink, thread safe.
#pragma once
#include <cstdarg>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

namespace nf {

enum class LogLevel { Trace = 0, Debug, Info, Warning, Error, Fatal };

struct LogEntry {
    LogLevel level;
    std::string category;
    std::string message;
    double time;  // seconds since app start
};

class Log {
public:
    static Log& get();

    void setMinLevel(LogLevel l) { minLevel_ = l; }
    LogLevel minLevel() const { return minLevel_; }
    void setLogFile(const std::string& path);  // "" disables file logging
    void write(LogLevel l, const std::string& cat, const char* fmt, ...);

    // Console panel queries
    std::vector<LogEntry> entries() const;
    size_t count() const;
    size_t errorCount() const { return errorCount_; }
    void clear();
    void setCallback(std::function<void(const LogEntry&)> cb);

    static const char* levelName(LogLevel l);

private:
    Log() = default;
    std::mutex mutex_;
    std::deque<LogEntry> entries_;
    std::function<void(const LogEntry&)> callback_;
    LogLevel minLevel_ = LogLevel::Trace;
    FILE* file_ = nullptr;
    size_t errorCount_ = 0;
};

#define NF_LOG_TRACE(cat, ...) ::nf::Log::get().write(::nf::LogLevel::Trace, cat, __VA_ARGS__)
#define NF_LOG_DEBUG(cat, ...) ::nf::Log::get().write(::nf::LogLevel::Debug, cat, __VA_ARGS__)
#define NF_LOG_INFO(cat, ...)  ::nf::Log::get().write(::nf::LogLevel::Info, cat, __VA_ARGS__)
#define NF_LOG_WARN(cat, ...)  ::nf::Log::get().write(::nf::LogLevel::Warning, cat, __VA_ARGS__)
#define NF_LOG_ERROR(cat, ...) ::nf::Log::get().write(::nf::LogLevel::Error, cat, __VA_ARGS__)
#define NF_LOG_FATAL(cat, ...) ::nf::Log::get().write(::nf::LogLevel::Fatal, cat, __VA_ARGS__)

}  // namespace nf
