/**
 * Content script: injected on all pages.
 *  - detects product garment images (heuristics in detect.ts)
 *  - manual on-page picking (picker.ts)
 *  - drag-and-drop: dragging a garment image on the page preloads the popup
 *  - fetches images to data URLs (with graceful cross-origin fallback)
 */

import { collectCandidates } from "./detect";
import { PagePicker } from "./picker";
import { blobToDataURL, imageToDataURL, isProbablyImageUrl } from "../lib/image";
import { ContentRequest, ContentEvent, MSG } from "../lib/messages";

const picker = new PagePicker();

function send(event: ContentEvent) {
  chrome.runtime.sendMessage({ ...event, source: "content" });
}

// --- inbound requests from background ---
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  const req = msg?.request as ContentRequest | undefined;
  if (!req) return false;

  switch (req.type) {
    case "get-candidates": {
      sendResponse({ ok: true, candidates: collectCandidates(document) });
      return false;
    }
    case "enter-picker": {
      picker.setHandler((src, name) => send({ type: "picked", src, name }));
      picker.enter(collectCandidates(document));
      sendResponse({ ok: true });
      return false;
    }
    case "cancel-picker": {
      picker.leave();
      sendResponse({ ok: true });
      return false;
    }
    case "fetch-image": {
      imageToDataURL(req.url)
        .then((dataURL) => sendResponse({ ok: true, dataURL }))
        .catch(() => sendResponse({ ok: true, dataURL: null }));
      return true; // async response
    }
  }
  return false;
});

// --- drag-and-drop interception: drag a garment image onto the page ---
function setupDragInterception() {
  let draggedSrc: string | null = null;

  document.addEventListener(
    "dragstart",
    (e) => {
      const target = e.target as HTMLElement;
      const img = target?.closest?.("img") as HTMLImageElement | null;
      if (img) {
        const src = img.currentSrc || img.getAttribute("src") || "";
        if (src && isProbablyImageUrl(src) && !src.startsWith("data:")) {
          draggedSrc = src;
        }
      }
    },
    true
  );

  document.addEventListener(
    "dragover",
    (e) => {
      if (draggedSrc) {
        e.preventDefault();
        e.dataTransfer && (e.dataTransfer.dropEffect = "copy");
      }
    },
    true
  );

  document.addEventListener(
    "drop",
    (e) => {
      if (!draggedSrc) return;
      e.preventDefault();
      e.stopPropagation();
      send({ type: "drag-image", src: draggedSrc, name: document.title });
      draggedSrc = null;
    },
    true
  );
}

// Re-scan lazily as the user scrolls (product galleries load on demand).
let lastScan = 0;
window.addEventListener("scroll", () => {
  const now = Date.now();
  if (now - lastScan > 2500) {
    lastScan = now;
    send({ type: "candidates", candidates: collectCandidates(document) });
  }
}, { passive: true });

setupDragInterception();

// Initial scan shortly after load so lazy images have a chance.
window.setTimeout(() => send({ type: "candidates", candidates: collectCandidates(document) }), 600);
