const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

export class QueueManager {
  constructor(downloadManager) {
    this.manager = downloadManager;
    this.paused = false;
  }

  ordered(items) {
    return [...items].sort((a, b) => {
      const priority = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
      if (priority) return priority;
      return (a.queuePosition ?? 0) - (b.queuePosition ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  async pauseAll() {
    this.paused = true;
    await Promise.all([...this.manager.downloads.values()].filter((entry) => ['queued', 'downloading', 'checking'].includes(entry.status)).map((entry) => this.manager.pauseDownload(entry.id, 'user')));
  }

  async resumeAll() {
    this.paused = false;
    for (const entry of this.manager.downloads.values()) {
      if (['paused', 'queued'].includes(entry.status)) {
        entry.autoStart = true;
        if (entry.status === 'paused') {
          entry.status = 'queued';
          entry.pauseReason = null;
        }
      }
    }
    await this.manager.persistState();
    this.manager._publishState();
    this.manager._pumpQueue();
  }

  async cancelAll() {
    await Promise.all([...this.manager.downloads.values()].filter((entry) => ['queued', 'downloading', 'checking', 'paused'].includes(entry.status)).map((entry) => this.manager.cancelDownload(entry.id)));
  }

  async reorder(ids) {
    const queued = this.ordered([...this.manager.downloads.values()].filter((entry) => entry.status === 'queued'));
    const byId = new Map(queued.map((entry) => [entry.id, entry]));
    let position = 0;
    for (const id of ids) {
      const entry = byId.get(id);
      if (entry) {
        entry.queuePosition = position++;
        byId.delete(id);
      }
    }
    for (const entry of this.ordered([...byId.values()])) entry.queuePosition = position++;
    await this.manager.persistState();
    this.manager._publishState();
  }
}
