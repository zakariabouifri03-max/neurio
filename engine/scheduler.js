export class Scheduler {
  constructor(manager, { intervalMs = 15_000 } = {}) {
    this.manager = manager;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastAllowed = null;
  }

  isInsideWindow(now = new Date(), schedule = this.manager.settings?.schedule) {
    if (!schedule?.enabled) return true;
    if (schedule.startTime === schedule.stopTime) return true;
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [stopHour, stopMinute] = schedule.stopTime.split(':').map(Number);
    const current = now.getHours() * 60 + now.getMinutes();
    const start = startHour * 60 + startMinute;
    const stop = stopHour * 60 + stopMinute;
    if (start < stop) return current >= start && current < stop;
    return current >= start || current < stop;
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  async tick() {
    const settings = this.manager.settings;
    const allowed = this.isInsideWindow(new Date(), settings?.schedule);
    if (this.lastAllowed === allowed) return;
    this.lastAllowed = allowed;
    if (!settings?.schedule?.enabled) {
      this.manager.limiter.setRate(settings?.bandwidthLimitBps);
      this.manager._publish('schedule', { active: true, enabled: false });
      return;
    }
    if (allowed) {
      this.manager.logger?.info('Scheduled window started; queued downloads may run.', { startTime: settings.schedule.startTime, stopTime: settings.schedule.stopTime });
      this.manager.limiter.setRate(settings.schedule.bandwidthLimitBps);
      this.manager._publish('schedule', { active: true, enabled: true });
      await this.manager._onScheduleStart();
    } else {
      this.manager.logger?.info('Scheduled window ended; active downloads were paused safely.', { startTime: settings.schedule.startTime, stopTime: settings.schedule.stopTime });
      this.manager._publish('schedule', { active: false, enabled: true });
      await this.manager._onScheduleStop();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
