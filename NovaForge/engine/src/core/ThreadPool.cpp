// NovaForge Engine - core/ThreadPool.cpp
#include "core/ThreadPool.h"

namespace nf {

ThreadPool::ThreadPool(u32 threadCount) {
  if (threadCount == 0) {
    threadCount = std::thread::hardware_concurrency();
    if (threadCount == 0) threadCount = 2;
    if (threadCount > 8) threadCount -= 1;   // leave a core for the main thread
  }
  for (u32 i = 0; i < threadCount; i++)
    threads_.emplace_back([this] { WorkerLoop(); });
}

ThreadPool::~ThreadPool() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stop_ = true;
  }
  cv_.notify_all();
  for (auto& t : threads_)
    if (t.joinable()) t.join();
}

void ThreadPool::Submit(std::function<void()> job) {
  pending_.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    jobs_.push(std::move(job));
  }
  cv_.notify_one();
}

void ThreadPool::WaitAll() {
  std::unique_lock<std::mutex> lock(mutex_);
  cvDone_.wait(lock, [this] { return pending_.load() == 0; });
}

void ThreadPool::WorkerLoop() {
  while (true) {
    std::function<void()> job;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      cv_.wait(lock, [this] { return stop_ || !jobs_.empty(); });
      if (stop_ && jobs_.empty()) return;
      job = std::move(jobs_.front());
      jobs_.pop();
    }
    job();
    if (pending_.fetch_sub(1) == 1) {
      std::lock_guard<std::mutex> lock(mutex_);
      cvDone_.notify_all();
    }
  }
}

} // namespace nf
