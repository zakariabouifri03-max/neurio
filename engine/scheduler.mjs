export function isWithinSchedule(schedule, date = new Date()) {
  if (!schedule?.enabled) return true;
  const days = Array.isArray(schedule.days) ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  const [startHour, startMinute] = String(schedule.startTime || '00:00').split(':').map(Number);
  const [stopHour, stopMinute] = String(schedule.stopTime || '00:00').split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const stop = stopHour * 60 + stopMinute;
  const current = date.getHours() * 60 + date.getMinutes();
  if (start === stop) return days.includes(date.getDay());
  if (start < stop) return days.includes(date.getDay()) && current >= start && current < stop;
  // An overnight window belongs to the day on which it starts.
  if (current >= start) return days.includes(date.getDay());
  if (current < stop) return days.includes((date.getDay() + 6) % 7);
  return false;
}

export class Scheduler {
  constructor({ getSchedule, onWindowChange, onTick, intervalMs = 15_000 }) {
    this.getSchedule = getSchedule;
    this.onWindowChange = onWindowChange;
    this.onTick = onTick;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastInside = null;
  }

  current(date = new Date()) { return isWithinSchedule(this.getSchedule(), date); }

  start() {
    if (this.timer) return;
    this._tick();
    this.timer = setInterval(() => this._tick(), this.intervalMs);
    this.timer.unref?.();
  }

  _tick() {
    const inside = this.current();
    if (this.lastInside !== inside) {
      this.lastInside = inside;
      this.onWindowChange?.(inside);
    }
    this.onTick?.(inside);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
