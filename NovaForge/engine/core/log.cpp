#include "core/log.h"

#include <cstdio>
#include <cstring>
#include <ctime>
#include <chrono>

namespace nf {

static double nowSeconds() {
    using namespace std::chrono;
    static auto t0 = steady_clock::now();
    return duration<double>(steady_clock::now() - t0).count();
}

Log& Log::get() {
    static Log inst;
    return inst;
}

const char* Log::levelName(LogLevel l) {
    switch (l) {
        case LogLevel::Trace: return "TRACE";
        case LogLevel::Debug: return "DEBUG";
        case LogLevel::Info: return "INFO";
        case LogLevel::Warning: return "WARN";
        case LogLevel::Error: return "ERROR";
        case LogLevel::Fatal: return "FATAL";
    }
    return "?";
}

void Log::setLogFile(const std::string& path) {
    std::lock_guard<std::mutex> lk(mutex_);
    if (file_) { std::fclose(file_); file_ = nullptr; }
    if (!path.empty()) {
        file_ = std::fopen(path.c_str(), "w");
        if (file_) {
            time_t t = time(nullptr);
            char buf[64];
            struct tm* tm = localtime(&t);
            strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", tm);
            std::fprintf(file_, "# NovaForge Engine log - started %s\n", buf);
            std::fflush(file_);
        }
    }
}

void Log::write(LogLevel l, const std::string& cat, const char* fmt, ...) {
    char buf[4096];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    if (l < minLevel_ && l != LogLevel::Error && l != LogLevel::Fatal) return;

    LogEntry e;
    e.level = l;
    e.category = cat;
    e.message = buf;
    e.time = nowSeconds();

    std::lock_guard<std::mutex> lk(mutex_);
    entries_.push_back(e);
    if (entries_.size() > 4000) entries_.pop_front();
    if (l == LogLevel::Error || l == LogLevel::Fatal) errorCount_++;
    if (file_) {
        std::fprintf(file_, "[%8.3f][%s][%s] %s\n", e.time, levelName(l), cat.c_str(), buf);
        std::fflush(file_);
    }
    if (l >= LogLevel::Info)
        std::fprintf(stdout, "[%s][%s] %s\n", levelName(l), cat.c_str(), buf);
    else
        std::fprintf(stdout, "[%s][%s] %s\n", levelName(l), cat.c_str(), buf);
    std::fflush(stdout);
    if (callback_) callback_(e);
}

std::vector<LogEntry> Log::entries() const {
    std::lock_guard<std::mutex> lk(const_cast<std::mutex&>(mutex_));
    return {entries_.begin(), entries_.end()};
}

size_t Log::count() const {
    std::lock_guard<std::mutex> lk(const_cast<std::mutex&>(mutex_));
    return entries_.size();
}

void Log::clear() {
    std::lock_guard<std::mutex> lk(mutex_);
    entries_.clear();
    errorCount_ = 0;
}

void Log::setCallback(std::function<void(const LogEntry&)> cb) {
    std::lock_guard<std::mutex> lk(mutex_);
    callback_ = std::move(cb);
}

}  // namespace nf
