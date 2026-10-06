#include "core/thread_pool.h"

namespace nf {

ThreadPool::ThreadPool(int threads) {
    if (threads <= 0) {
        unsigned hc = std::thread::hardware_concurrency();
        threads = hc > 2 ? (int)hc - 1 : 1;
    }
    for (int i = 0; i < threads; ++i) {
        workers_.emplace_back([this] {
            for (;;) {
                std::function<void()> job;
                {
                    std::unique_lock<std::mutex> lk(mutex_);
                    cv_.wait(lk, [this] { return stopping_ || !jobs_.empty(); });
                    if (stopping_ && jobs_.empty()) return;
                    job = std::move(jobs_.front());
                    jobs_.pop();
                }
                job();
                if (pending_.fetch_sub(1) == 1) {
                    std::lock_guard<std::mutex> lk(mutex_);
                    doneCv_.notify_all();
                }
            }
        });
    }
}

ThreadPool::~ThreadPool() {
    {
        std::lock_guard<std::mutex> lk(mutex_);
        stopping_ = true;
    }
    cv_.notify_all();
    for (auto& w : workers_)
        if (w.joinable()) w.join();
}

void ThreadPool::waitIdle() {
    std::unique_lock<std::mutex> lk(mutex_);
    doneCv_.wait(lk, [this] { return pending_.load() == 0; });
}

}  // namespace nf
