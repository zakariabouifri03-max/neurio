/**
 * Background service worker (MV3):
 *  - relays messages between popup and content scripts
 *  - resolves the active tab (user-facing tab, not the popup itself)
 *  - forwards content-script events to the open popup
 */

import { BackgroundEvent, CandidateImage, ContentRequest, MSG } from "../lib/messages";

interface Forwarded {
  event: BackgroundEvent;
}

/** The active user tab — excludes extension pages and chrome:// URLs. */
async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://"))) {
    return null;
  }
  return tab;
}

async function sendToContent(tabId: number, request: ContentRequest): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, { request });
  } catch {
    // Content script not loaded yet (e.g. page opened before install).
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return await chrome.tabs.sendMessage(tabId, { request });
    } catch {
      return { ok: false, error: "content-script-unavailable" };
    }
  }
}

// --- popup → background ---
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  const req = msg?.request;
  if (!req || typeof req !== "object") return false;

  (async () => {
    if (req.type === "get-candidates" || req.type === "enter-picker" || req.type === "cancel-picker") {
      const tab = await getActiveTab();
      if (!tab || tab.id === undefined) {
        sendResponse({ ok: false, error: "no-active-tab" });
        return;
      }
      const res = await sendToContent(tab.id, req);
      sendResponse(res);
    } else if (req.type === "fetch-image") {
      const tab = await getActiveTab();
      if (!tab || tab.id === undefined) {
        sendResponse({ ok: false, error: "no-active-tab" });
        return;
      }
      // Prefer the active page (same-origin as the image); fall back to a
      // generic content fetch by injecting into the tab.
      const res = await sendToContent(tab.id, req);
      sendResponse(res);
    } else if (req.type === "page-info") {
      const tab = await getActiveTab();
      sendResponse({
        ok: !!tab,
        title: tab?.title || "",
        url: tab?.url || "",
      });
    } else {
      sendResponse({ ok: false, error: "unknown-request" });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async
});

// --- content script → background → popup ---
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.source === "content") {
    const event = { ...msg } as BackgroundEvent;
    delete (event as any).source;
    // Forward to the popup if it's listening.
    chrome.runtime
      .sendMessage({ type: MSG.BG_EVENT, event })
      .catch(() => {
        /* popup not open — ignore */
      });
  }
  return false;
});
