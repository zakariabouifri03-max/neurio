// NovaForge Engine - minimal thread pool used for async asset loading
#pragma once
#include <atomic>
#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace nf {

class ThreadPool {
public:
    explicit ThreadPool(int threads = 0);
    ~ThreadPool();

    template <typename F>
    auto submit(F&& f) -> std::future<decltype(f())> {
        using R = decltype(f());
        auto task = std::make_shared<std::packaged_task<R()>>(std::forward<F>(f));
        std::future<R> fut = task->get_future();
        {
            std::lock_guard<std::mutex> lk(mutex_);
            if (stopping_) return fut;
            jobs_.emplace([task]() { (*task)(); });
        }
        cv_.notify_one();
        pending_.fetch_add(1);
        return fut;
    }

    int pending() const { return pending_.load(); }
    int threadCount() const { return (int)workers_.size(); }
    void waitIdle();

private:
    std::vector<std::thread> workers_;
    std::queue<std::function<void()>> jobs_;
    std::mutex mutex_;
    std::condition_variable cv_;
    std::condition_variable doneCv_;
    std::atomic<int> pending_{0};
    bool stopping_ = false;
};

}  // namespace nf
