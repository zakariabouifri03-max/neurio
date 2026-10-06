// NovaForge Engine - core/ThreadPool.h
// Minimal job system used for asynchronous asset loading.
#pragma once

#include "core/Base.h"
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>

namespace nf {

class ThreadPool {
public:
  explicit ThreadPool(u32 threadCount = 0);
  ~ThreadPool();

  void Submit(std::function<void()> job);
  void WaitAll();
  u32 PendingJobs() const { return pending_.load(); }
  u32 ThreadCount() const { return (u32)threads_.size(); }

private:
  void WorkerLoop();

  std::vector<std::thread> threads_;
  std::queue<std::function<void()>> jobs_;
  mutable std::mutex mutex_;
  std::condition_variable cv_;
  std::condition_variable cvDone_;
  std::atomic<u32> pending_{0};
  bool stop_ = false;
};

} // namespace nf
