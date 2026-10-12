import { io, type Socket } from "socket.io-client";
export interface User {
  id: string;
  username: string;
  displayName: string;
  status: string;
  bio: string;
  preferences?: {
    theme?: string;
    notifications?: boolean;
    allowFriendRequests?: boolean;
  };
}
export interface Channel {
  id: string;
  name: string;
  kind: string;
  serverId?: string;
  private: boolean;
  category: string;
  position: number;
  members?: { user: User; userId: string }[];
}
export interface Community {
  id: string;
  name: string;
  description: string;
  channels: Channel[];
  members: { role: string }[];
  _count: { members: number };
}
export interface Message {
  id: string;
  conversationId: string;
  body: string;
  author: User;
  authorId: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  replyToId?: string;
  pinned: boolean;
  uploads: { id: string; name: string; mime: string; size: number }[];
  reactions: { userId: string; emoji: string }[];
}
declare global {
  interface Window {
    voxora?: {
      loadToken: () => Promise<string | null>;
      saveToken: (token: string | null) => Promise<void>;
      notify: (title: string, body: string) => void;
      badge: (count: number) => void;
      captureSources: () => Promise<
        { id: string; name: string; thumbnail: string }[]
      >;
      selectCapture: (id: string) => Promise<void>;
    };
  }
}
export const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
let desktopToken: string | null = null;
export async function restore() {
  if (window.voxora) desktopToken = await window.voxora.loadToken();
}
export async function saveToken(token: string | null) {
  desktopToken = token;
  await window.voxora?.saveToken(token);
}
export async function api<T = any>(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`${base}/api${route}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(desktopToken ? { Authorization: `Bearer ${desktopToken}` } : {}),
      ...(window.voxora ? { "X-Voxora-Desktop": "1" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: "Service unavailable" }));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
export function socket(): Socket {
  return io(base || window.location.origin, {
    withCredentials: true,
    auth: { token: desktopToken },
    autoConnect: false,
  });
}
export function upload(
  channelId: string,
  file: File,
  progress: (n: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/conversations/${channelId}/uploads`);
    xhr.withCredentials = true;
    if (desktopToken)
      xhr.setRequestHeader("Authorization", `Bearer ${desktopToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Upload interrupted"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        xhr.status < 300
          ? resolve(data)
          : reject(new Error(data.error || "Upload failed"));
      } catch {
        reject(new Error("Upload failed"));
      }
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
export async function attachment(id: string) {
  const r = await fetch(`${base}/api/uploads/${id}`, {
    credentials: "include",
    headers: desktopToken ? { Authorization: `Bearer ${desktopToken}` } : {},
  });
  if (!r.ok) throw new Error("Attachment unavailable");
  return URL.createObjectURL(await r.blob());
}
