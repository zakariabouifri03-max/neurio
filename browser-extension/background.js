const isFirefox = Boolean(globalThis.browser);
const browserApi = globalThis.browser || globalThis.chrome;
const HOST_NAME = 'com.neurio.aidownloadmanagerpro';

browserApi.runtime.onInstalled.addListener(() => {
  browserApi.contextMenus.create({
    id: 'aidmp-download-link',
    title: 'Download link with AI Download Manager Pro',
    contexts: ['link', 'video', 'audio'],
  });
});

function sendSelectedUrl(url, reply) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    reply?.({ accepted: false, message: 'Only HTTP and HTTPS links are supported.' });
    return;
  }
  const respond = value => reply?.(value);
  try {
    const message = { type: 'enqueue-url', url };
    if (isFirefox) {
      browserApi.runtime.sendNativeMessage(HOST_NAME, message).then(respond).catch(error => respond({ accepted: false, message: error.message }));
    } else {
      browserApi.runtime.sendNativeMessage(HOST_NAME, message, response => {
        const error = browserApi.runtime.lastError;
        if (error) respond({ accepted: false, message: error.message });
        else respond(response);
      });
    }
  } catch (error) {
    respond({ accepted: false, message: error.message || 'Could not contact the native host.' });
  }
}

browserApi.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId !== 'aidmp-download-link') return;
  sendSelectedUrl(info.linkUrl || info.srcUrl, () => {});
});

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'aidmp-enqueue') return false;
  sendSelectedUrl(message.url, sendResponse);
  return true;
});
