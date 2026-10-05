/* Neurio Voice — landing page: live chat widget + FAQ */
(function () {
  'use strict';

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // ---------- live chat widget ----------
  const chat = document.getElementById('w-chat');
  const input = document.getElementById('w-input');
  const sendBtn = document.getElementById('w-send');
  if (!chat || !input) return;

  let sessionId = null;
  let busy = false;

  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  async function init() {
    try {
      const r = await fetch('/api/greeting');
      const g = await r.json();
      document.getElementById('w-agent').textContent = `${g.agentName} — ${g.businessName}`;
      bubble('ai', g.greeting);
    } catch {
      bubble('ai', 'Hi! How can I help you today?');
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    bubble('user', text);
    const typing = bubble('ai', '…');
    typing.classList.add('typing');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      });
      const data = await r.json();
      sessionId = data.sessionId;
      typing.textContent = data.reply || 'Sorry, something went wrong.';
      typing.classList.remove('typing');
      chat.scrollTop = chat.scrollHeight;
    } catch {
      typing.textContent = 'Connection error — please try again.';
      typing.classList.remove('typing');
    }
    busy = false;
    input.focus();
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  init();
})();
