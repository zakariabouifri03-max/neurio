const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

export class QueueManager {
  order(jobs) {
    return [...jobs].sort((a, b) => {
      const priority = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
      return priority || (Number(a.queueOrder) || 0) - (Number(b.queueOrder) || 0) || String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  next(jobs) {
    return this.order(jobs).find(job => job.status === 'queued' && !job.deferred && !job._running) || null;
  }

  reorder(jobs, ids) {
    const rank = new Map(ids.map((id, index) => [id, index]));
    const queueJobs = jobs.filter(job => ['queued', 'scheduled', 'paused'].includes(job.status));
    queueJobs.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || (a.queueOrder || 0) - (b.queueOrder || 0));
    queueJobs.forEach((job, index) => { job.queueOrder = index; });
  }
}
