const NATIVE_HOST = 'com.aidownloadmanager.pro';
const LINK_MENU_ID = 'aidmp-download-link';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LINK_MENU_ID,
      title: 'Download link with AI Download Manager Pro',
      contexts: ['link'],
    });
  });
});

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sendLink(url, callback) {
  if (!isWebUrl(url)) {
    callback?.({ ok: false, error: 'Only HTTP and HTTPS links can be sent.' });
    return;
  }
  let port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch {
    callback?.({ ok: false, error: 'Could not connect to the desktop application. Enable the browser bridge in AI Download Manager Pro settings.' });
    return;
  }
  const timer = setTimeout(() => {
    try { port.disconnect(); } catch { /* already disconnected */ }
    callback?.({ ok: false, error: 'The desktop application did not respond.' });
  }, 8000);
  port.onMessage.addListener((response) => {
    clearTimeout(timer);
    callback?.(response);
    try { port.disconnect(); } catch { /* already disconnected */ }
  });
  port.onDisconnect.addListener(() => {
    clearTimeout(timer);
    const message = chrome.runtime.lastError?.message;
    if (message) callback?.({ ok: false, error: 'Native messaging is not installed. Enable the browser bridge in the desktop app settings.' });
  });
  port.postMessage({ type: 'download', url });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === LINK_MENU_ID && info.linkUrl) sendLink(info.linkUrl);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'download-current-link') return false;
  sendLink(message.url, sendResponse);
  return true;
});
