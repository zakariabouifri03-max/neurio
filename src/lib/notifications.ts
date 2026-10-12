/**
 * Desktop notifications and taskbar badge.
 * Uses the Web Notification API in the browser and the Electron bridge when
 * running as a desktop app (so Windows shows proper toasts).
 */

export interface NotifyOptions {
  channelId?: string;
  enabled?: boolean;
  playSound?: boolean;
}

let permissionRequested = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (permissionRequested) return false;
  permissionRequested = true;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export async function notify(title: string, body: string, options: NotifyOptions = {}): Promise<void> {
  if (options.enabled === false) return;
  const bridge = window.neurio;
  if (bridge?.notify) {
    bridge.notify(title, body, options.channelId);
  } else if (typeof Notification !== 'undefined') {
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    try {
      const notification = new Notification(title, {
        body,
        silent: !options.playSound,
        tag: options.channelId,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      /* notifications are a nicety, never a hard requirement */
    }
  }
  if (options.playSound) playChime();
}

/** Tiny synthesised chime — no audio asset to ship or download. */
export function playChime(): void {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    setTimeout(() => void context.close().catch(() => undefined), 600);
  } catch {
    /* no audio device — ignore */
  }
}

export function setBadge(count: number): void {
  const bridge = window.neurio;
  bridge?.setBadge?.(count);
  document.title = count > 0 ? `(${count}) Neurio` : 'Neurio';
}
