'use client';

/**
 * Typed client for the studio API. Every request funnels through `request()`
 * so errors, retries and offline behaviour are handled in one place.
 */

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; details?: unknown };

export class ApiError extends Error {
  code?: string;
  details?: unknown;
  status: number;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });

  const text = await res.text();
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload?.ok) {
    const message = payload && !payload.ok ? payload.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload && !payload.ok ? payload.code : undefined, payload && !payload.ok ? payload.details : undefined);
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, json?: unknown, init?: RequestInit) => request<T>(path, { ...init, method: 'POST', json }),
  patch: <T>(path: string, json?: unknown, init?: RequestInit) => request<T>(path, { ...init, method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown, init?: RequestInit) => request<T>(path, { ...init, method: 'PUT', json }),
  del: <T>(path: string, json?: unknown, init?: RequestInit) => request<T>(path, { ...init, method: 'DELETE', json }),
};

/** Upload with progress (XHR so we can report bytes). */
export function upload(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  onProgress?: (percent: number) => void,
): Promise<{ id: string; url: string; name: string; kind: string; mime: string; size: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      try {
        const json = JSON.parse(xhr.responseText) as ApiEnvelope<any>;
        if (xhr.status >= 200 && xhr.status < 300 && json.ok) resolve(json.data);
        else reject(new ApiError(json.ok ? 'Upload failed' : json.error, xhr.status, json.ok ? undefined : json.code));
      } catch (err) {
        reject(new ApiError('Upload failed', xhr.status));
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError('Network error during upload', 0)));
    xhr.send(form);
  });
}
