const form = document.querySelector('#send-form');
const input = document.querySelector('#url');
const status = document.querySelector('#status');
const isFirefox = Boolean(globalThis.browser);
const browserApi = globalThis.browser || globalThis.chrome;

form.addEventListener('submit', event => {
  event.preventDefault();
  status.className = '';
  status.textContent = 'Sending selected link…';
  const message = { type: 'aidmp-enqueue', url: input.value.trim() };
  const done = response => {
    if (!response?.accepted) {
      status.className = 'error';
      status.textContent = response?.message || 'Could not connect to the desktop application.';
      return;
    }
    status.className = 'ok';
    status.textContent = response.message || 'Link added to the desktop inbox.';
    input.value = '';
  };
  if (isFirefox) {
    browserApi.runtime.sendMessage(message).then(done).catch(error => {
      status.className = 'error';
      status.textContent = error.message || 'Could not contact the browser background worker.';
    });
  } else {
    browserApi.runtime.sendMessage(message, response => {
      const error = browserApi.runtime.lastError;
      if (error) {
        status.className = 'error';
        status.textContent = error.message;
      } else done(response);
    });
  }
});
