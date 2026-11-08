/** Backend API client for the extension popup. */

import { fileToDataURL } from "../lib/image";

export interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  category?: string | null;
  provider?: string | null;
  mode?: string | null;
  result_url?: string | null;
  error?: string | null;
  meta?: Record<string, unknown>;
}

export interface HistoryItem {
  id: string;
  created_at: string;
  status: string;
  category?: string | null;
  person_url?: string | null;
  garment_url?: string | null;
  garment_source_url?: string | null;
  result_url?: string | null;
  provider?: string | null;
  mode?: string | null;
}

export interface Health {
  status: string;
  provider: string;
  provider_mode: string;
  provider_available: boolean;
  gpu: boolean;
  dev_mode: boolean;
  queue: number;
}

export interface ApiError {
  status: number;
  detail: string;
}

export class ApiClient {
  constructor(private baseURL: string, private apiKey: string = "") {}

  setBaseURL(url: string) {
    this.baseURL = url.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(`${this.baseURL}${path}`, { ...init, headers, signal: controller.signal });
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body?.detail) detail = String(body.detail);
        } catch {
          /* keep default */
        }
        throw { status: resp.status, detail } satisfies ApiError;
      }
      return resp.json() as Promise<T>;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw { status: 0, detail: `Request timed out — backend at ${this.baseURL} is not responding` } satisfies ApiError;
      }
      if (e && typeof e === "object" && "status" in e) throw e; // already an ApiError
      // Network failure (backend not running, DNS, CORS, etc.)
      throw {
        status: 0,
        detail: `Cannot reach backend at ${this.baseURL}. Start it with: uvicorn app.main:app --port 8000`,
      } satisfies ApiError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async health(): Promise<Health> {
    return this.request<Health>("/api/health");
  }

  async uploadFile(file: File): Promise<{ file_id: string; url: string; size: number; content_type: string }> {
    const form = new FormData();
    form.append("file", file);
    return this.request("/api/upload", { method: "POST", body: form });
  }

  async submitTryOn(opts: {
    personFile: File;
    garmentFile: File | null;
    garmentUrl: string | null;
    category: string;
  }): Promise<{ job_id: string; status: string; poll_url: string }> {
    const form = new FormData();
    form.append("person", opts.personFile);
    if (opts.garmentFile) form.append("garment", opts.garmentFile);
    if (opts.garmentUrl) form.append("garment_url", opts.garmentUrl);
    form.append("category", opts.category);
    return this.request("/api/tryon", { method: "POST", body: form });
  }

  async job(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/api/jobs/${jobId}`);
  }

  async history(): Promise<HistoryItem[]> {
    return this.request<HistoryItem[]>("/api/history");
  }

  async deleteHistory(id: string): Promise<void> {
    await this.request(`/api/history/${id}`, { method: "DELETE" });
  }

  /** Absolute URL for backend-served files (opaque UUID ids). */
  fileURL(fileId: string): string {
    return `${this.baseURL}/api/files/${fileId}`;
  }

  /** Resolve a relative /api/files/... URL returned by the backend. */
  resolveURL(url: string | null | undefined): string | null {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return `${this.baseURL}${url}`;
    return url;
  }
}

export { fileToDataURL };
