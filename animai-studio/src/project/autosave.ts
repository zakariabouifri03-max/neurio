import { AnimationDocument } from "../engine/document";
import { deserializeProject, serializeProject } from "./format";
import { log } from "../core/logger";

const LS_KEY = "animai.autosave.b64";
const LS_META = "animai.autosave.meta";

export class AutosaveService {
  private timer: number | null = null;
  private busy = false;

  start(getDoc: () => AnimationDocument, intervalMs = 45000): void {
    this.stop();
    this.timer = window.setInterval(() => {
      void this.save(getDoc());
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  async save(doc: AnimationDocument): Promise<void> {
    if (this.busy || !doc.dirty) return;
    this.busy = true;
    try {
      const bytes = await serializeProject(doc);
      const b64 = uint8ToB64(bytes);
      localStorage.setItem(LS_KEY, b64);
      localStorage.setItem(LS_META, JSON.stringify({ savedAt: Date.now(), name: doc.settings.name }));
      if (window.animaiDesktop) await window.animaiDesktop.writeAutosave(b64);
      log.info("Autosave written");
    } catch (err) {
      log.error("Autosave failed", err);
    } finally {
      this.busy = false;
    }
  }

  async recover(): Promise<AnimationDocument | null> {
    try {
      if (window.animaiDesktop) {
        const rec = await window.animaiDesktop.readAutosave();
        if (rec?.dataBase64) {
          const bytes = b64ToUint8(rec.dataBase64);
          return await deserializeProject(bytes);
        }
      }
      const b64 = localStorage.getItem(LS_KEY);
      if (!b64) return null;
      return await deserializeProject(b64ToUint8(b64));
    } catch (err) {
      log.error("Autosave recovery failed", err);
      return null;
    }
  }

  meta(): { savedAt: number; name?: string } | null {
    try {
      const raw = localStorage.getItem(LS_META);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

function uint8ToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
