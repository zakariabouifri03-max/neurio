export function formatTime(seconds, fps = 30, timecode = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(safe);
  const ms = Math.floor((safe - whole) * 1000);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  if (!timecode) return `${String(mm + hh * 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const frame = Math.floor((safe - whole) * fps);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  if (safe >= 3600) return `${Math.floor(safe / 3600)}h ${Math.floor((safe % 3600) / 60)}m`;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
