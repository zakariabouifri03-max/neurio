/** Backend API client shared with the extension popup. */

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

export class ApiClient {
  constructor(public baseURL: string, public apiKey: string = "") {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const resp = await fetch(`${this.baseURL}${path}`, { ...init, headers });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        if (body?.detail) detail = String(body.detail);
      } catch {
        /* keep default */
      }
      throw new Error(detail);
    }
    return resp.json() as Promise<T>;
  }

  async health(): Promise<Health> {
    return this.request<Health>("/api/health");
  }

  async uploadFile(file: File): Promise<{ file_id: string; url: string }> {
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

  resolveURL(url: string | null | undefined): string | null {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return `${this.baseURL}${url}`;
    return url;
  }
}
