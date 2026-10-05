/* Neurio Voice — voice demo: mic in (SpeechRecognition), voice out (speechSynthesis) */
(function () {
  'use strict';

  const chat = document.getElementById('d-chat');
  const input = document.getElementById('d-input');
  const sendBtn = document.getElementById('d-send');
  const micBtn = document.getElementById('d-mic');
  const statusEl = document.getElementById('d-status');
  const avatar = document.getElementById('d-avatar');
  const autoBtn = document.getElementById('d-auto');
  const muteBtn = document.getElementById('d-mute');
  const newBtn = document.getElementById('d-new');

  let sessionId = null;
  let busy = false;
  let autoConvo = false;
  let voiceOn = true;
  let recognizing = false;
  let recognition = null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.style.opacity = '.4';
    statusEl.textContent = 'Voice input needs Chrome or Edge — but typing works everywhere. Type below!';
  } else {
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e) => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      statusEl.textContent = fin ? 'Got it!' : '🎧 ' + interim;
      if (fin) { stopMicUI(); sendUserText(fin.trim()); }
    };
    recognition.onerror = (e) => {
      stopMicUI();
      if (e.error === 'not-allowed') statusEl.textContent = 'Microphone blocked — allow access or type below instead.';
      else if (e.error !== 'aborted') statusEl.textContent = 'Didn\'t catch that — tap the mic and try again, or type below.';
    };
    recognition.onend = () => { stopMicUI(); };
  }

  function setStatus(t) { statusEl.textContent = t; }
  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function pickVoice() {
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
    return voices.find((v) => /female|samantha|zira|aria|jenny|google us english/i.test(v.name)) || voices[0] || null;
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  function speak(text, onDone) {
    if (!voiceOn || !('speechSynthesis' in window)) { if (onDone) onDone(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.02;
    u.onstart = () => avatar.classList.add('speaking');
    u.onend = () => { avatar.classList.remove('speaking'); if (onDone) onDone(); };
    u.onerror = () => { avatar.classList.remove('speaking'); if (onDone) onDone(); };
    speechSynthesis.speak(u);
  }

  function startMicUI() {
    recognizing = true;
    micBtn.classList.add('live');
    micBtn.textContent = '⏹️';
    avatar.classList.add('listening');
  }
  function stopMicUI() {
    recognizing = false;
    micBtn.classList.remove('live');
    micBtn.textContent = '🎙️';
    avatar.classList.remove('listening');
  }

  async function sendUserText(text) {
    if (!text || busy) return;
    busy = true;
    bubble('user', text);
    setStatus('Thinking…');
    const typing = bubble('ai', '…');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      });
      const data = await r.json();
      sessionId = data.sessionId;
      typing.textContent = data.reply || 'Sorry, something went wrong.';
      chat.scrollTop = chat.scrollHeight;
      setStatus('Maya is speaking…');
      speak(data.reply, () => {
        setStatus(autoConvo ? 'Listening…' : 'Tap the microphone to reply, or type below.');
        if (autoConvo && recognition && !recognizing && voiceOn !== false) toggleMic(true);
      });
    } catch {
      typing.textContent = 'Connection error — please try again.';
      setStatus('Connection error.');
    }
    busy = false;
  }

  function toggleMic(forceOn) {
    if (!recognition) return;
    if (recognizing && !forceOn) { recognition.abort(); stopMicUI(); setStatus('Tap the microphone to reply, or type below.'); return; }
    if (busy) return;
    try {
      recognition.start();
      startMicUI();
      setStatus('🎧 Listening… speak now!');
    } catch { /* already running */ }
  }

  async function newCall() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    sessionId = null;
    chat.innerHTML = '';
    setStatus('Calling…');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: true }) });
      const data = await r.json();
      sessionId = data.sessionId;
      bubble('ai', data.reply);
      try {
        const g = await (await fetch('/api/greeting')).json();
        document.getElementById('d-agent').textContent = `${g.agentName} — AI Receptionist`;
        document.getElementById('d-biz').textContent = g.businessName;
      } catch { /* ignore */ }
      setStatus('Maya is speaking…');
      speak(data.reply, () => {
        setStatus(autoConvo ? 'Listening…' : 'Tap the microphone to reply, or type below.');
        if (autoConvo && recognition) toggleMic(true);
      });
    } catch {
      bubble('ai', 'Hi! How can I help you today?');
    }
  }

  micBtn.addEventListener('click', () => toggleMic(false));
  sendBtn.addEventListener('click', () => { const t = input.value.trim(); input.value = ''; if (t) sendUserText(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = input.value.trim(); input.value = ''; if (t) sendUserText(t); } });
  autoBtn.addEventListener('click', () => {
    autoConvo = !autoConvo;
    autoBtn.textContent = `🔁 Auto-conversation: ${autoConvo ? 'ON' : 'OFF'}`;
    if (autoConvo && recognition && !recognizing && !busy) toggleMic(true);
  });
  muteBtn.addEventListener('click', () => {
    voiceOn = !voiceOn;
    if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    muteBtn.textContent = voiceOn ? '🔊 Voice: ON' : '🔇 Voice: OFF';
  });
  newBtn.addEventListener('click', newCall);
  document.querySelectorAll('.tip').forEach((t) =>
    t.addEventListener('click', () => sendUserText(t.getAttribute('data-say')))
  );

  newCall();
})();
