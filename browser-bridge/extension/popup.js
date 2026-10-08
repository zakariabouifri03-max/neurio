const sendButton = document.getElementById('send');
const status = document.getElementById('status');

sendButton.addEventListener('click', async () => {
  sendButton.disabled = true;
  status.textContent = 'Connecting to the desktop app…';
  status.className = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) throw new Error('The current tab is not an HTTP or HTTPS link.');
    const response = await chrome.runtime.sendMessage({ type: 'download-current-link', url: tab.url });
    if (!response?.ok) throw new Error(response?.error || 'The desktop app did not accept this URL.');
    status.textContent = 'Link sent. AI Download Manager Pro is opening.';
    status.className = 'success';
  } catch (error) {
    status.textContent = error.message || 'Could not send this link.';
    status.className = 'error';
  } finally {
    sendButton.disabled = false;
  }
});
