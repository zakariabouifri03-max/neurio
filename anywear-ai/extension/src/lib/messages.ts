/** Message protocol between popup ↔ background ↔ content scripts. */

export interface CandidateImage {
  id: string;
  src: string;
  width: number;
  height: number;
  score: number;
  source: "meta" | "img" | "ldjson" | "drag";
  name?: string;
}

// popup → background
export type PopupRequest =
  | { type: "get-candidates" }
  | { type: "select-on-page" }
  | { type: "cancel-picker" }
  | { type: "fetch-image"; url: string }
  | { type: "page-info" };

// background → content
export type ContentRequest =
  | { type: "get-candidates" }
  | { type: "enter-picker" }
  | { type: "cancel-picker" }
  | { type: "fetch-image"; url: string };

// content → background (forwarded to popup)
export type ContentEvent =
  | { type: "candidates"; candidates: CandidateImage[] }
  | { type: "picked"; src: string; name: string }
  | { type: "drag-image"; src: string; name: string };

// background → popup
export type BackgroundEvent =
  | { type: "candidates"; candidates: CandidateImage[] }
  | { type: "picked"; src: string; name: string }
  | { type: "drag-image"; src: string; name: string }
  | { type: "page-info"; title: string; url: string };

export interface PageInfo {
  title: string;
  url: string;
}

export const MSG = {
  POPUP_REQUEST: "popup-request",
  BG_EVENT: "bg-event",
  CONTENT_EVENT: "content-event",
} as const;
