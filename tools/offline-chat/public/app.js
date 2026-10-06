/* ══════════════════════════════════════════════════════════════════════════
   📡 نوريو تواصل — Offline Chat · client
   Pure ES module, zero dependencies. Talks to the LAN server over one
   WebSocket (own protocol) + three tiny HTTP endpoints (upload/file/export).
   ══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────── i18n ─────────────────────────────── */
const STRINGS = {
  ar: {
    appName: 'نوريو تواصل', tagline: 'دردشة بلا إنترنت — غير الشبكة المحلية (واي فاي / hotspot)',
    yourName: 'سميتك', namePlaceholder: 'مثال: يوسف', yourEmoji: 'الرمز ديالك', yourColor: 'اللون',
    remember: 'حفظ سميتي على هاد الجهاز', enter: 'دخول للدردشة 🚀',
    multiTabHint: 'بغيت تجرب بوحدك؟ حل التطبيق فنافذة خاصة (Private/Incognito) — غادي تكون مستخدم آخر.',
    server: 'السيرفر', copyInvite: '📋 نسخ رابط الدعوة', rooms: 'الغرف', dms: 'الخاص',
    online: 'الموجودين دابا', invite: '🔗 دعوة', export: '⬇️ تصدير', install: '📱 تثبيت',
    changeMe: 'تبديل المستخدم', searchPh: '🔍 بحث في الرسائل…', messagePh: 'كتب رسالة… (Enter للإرسال)',
    cancel: 'إلغاء', sendVoice: 'إرسال 🎙️',
    connecting: 'كنتصلو بالسيرفر…', online_: 'متصل — بلا إنترنت تمامًا', offline: 'السيرفر مقطوع — كنعاود المحاولة…',
    you: 'أنت', today: 'اليوم', yesterday: 'أمس', member: 'عضو', members: 'أعضاء', onlineNow: 'متصل دابا',
    msgCopied: 'تنسخت الرسالة ✅', linkCopied: 'تنسخ رابط الدعوة ✅', noCopy: 'ماقدرناش ننسخو — انسخ بيدك',
    nameTaken: 'دخل سميتك باش تبدأ', newRoom: 'سمية الغرفة الجديدة:', roomMade: 'تصاوبت الغرفة ✅',
    fileTooBig: 'الملف كبير بزاف (الحد 25 ميغا)', uploadFail: 'فشل تحميل الملف ❌',
    noMic: 'الميكرو ماشي متاح — خاصك تشغل السيرفر بـ --https أو تستعمل localhost',
    micDenied: 'ماسمحتش بالميكرو 🚫', recording: 'كنسجلو', voiceNote: 'رسالة صوتية',
    del: 'حذف', reply: 'رد', download: 'تحميل', save: 'تنزيل', empty: 'مازال ماكاينش رسائل — بدا الهضرة! 👋',
    you_typing: 'كيكتب…', someone: 'شي واحد', deleted: 'تحيدت رسالة', searchNo: 'ماكاينش نتيجة',
    copied: 'تنسخ ✅', reconnecting: 'كنعاود الاتصال…', joined: 'دخل',
    httpMode: 'الوضع البديل HTTP — الـ WebSocket محجوب هنا، والخدمة مستمرة 👌',
    pushDenied: 'التنبيهات مرفوضة', notify: 'صلاحيات التنبيهات؟', welcome: 'مرحبا بيك فالغرفة',
    dmEmpty: 'اضغط على شي واحد فقائمة الموجودين باش تبدا محادثة خاصة',
  },
  fr: {
    appName: 'Neurio Contact', tagline: 'Chat sans internet — réseau local uniquement (Wi-Fi / partage)',
    yourName: 'Votre nom', namePlaceholder: 'ex : Youssef', yourEmoji: 'Votre avatar', yourColor: 'Couleur',
    remember: 'Mémoriser mon nom sur cet appareil', enter: 'Entrer dans le chat 🚀',
    multiTabHint: 'Pour tester seul : ouvrez l’app en navigation privée — vous serez un autre utilisateur.',
    server: 'Serveur', copyInvite: '📋 Copier le lien d’invitation', rooms: 'Salons', dms: 'Privé',
    online: 'En ligne', invite: '🔗 Inviter', export: '⬇️ Exporter', install: '📱 Installer',
    changeMe: 'Changer d’utilisateur', searchPh: '🔍 Rechercher…', messagePh: 'Votre message… (Entrée pour envoyer)',
    cancel: 'Annuler', sendVoice: 'Envoyer 🎙️',
    connecting: 'Connexion au serveur…', online_: 'Connecté — 100 % hors ligne', offline: 'Serveur injoignable — reconnexion…',
    you: 'Vous', today: 'Aujourd’hui', yesterday: 'Hier', member: 'membre', members: 'membres', onlineNow: 'en ligne',
    msgCopied: 'Message copié ✅', linkCopied: 'Lien copié ✅', noCopy: 'Copie impossible — copiez à la main',
    nameTaken: 'Entrez votre nom pour commencer', newRoom: 'Nom du nouveau salon :', roomMade: 'Salon créé ✅',
    fileTooBig: 'Fichier trop lourd (25 Mo max)', uploadFail: 'Échec de l’envoi ❌',
    noMic: 'Micro indisponible — lancez le serveur avec --https ou utilisez localhost',
    micDenied: 'Micro refusé 🚫', recording: 'Enregistrement', voiceNote: 'Note vocale',
    del: 'Supprimer', reply: 'Répondre', download: 'Télécharger', save: 'Enregistrer', empty: 'Aucun message — lancez la discussion ! 👋',
    you_typing: 'écrit…', someone: 'quelqu’un', deleted: 'Message supprimé', searchNo: 'Aucun résultat',
    copied: 'Copié ✅', reconnecting: 'Reconnexion…', joined: 'a rejoint',
    httpMode: 'Mode de secours HTTP — WebSocket bloqué, le chat continue 👌',
    pushDenied: 'Notifications refusées', notify: 'Autoriser les notifications ?', welcome: 'Bienvenue',
    dmEmpty: 'Touchez quelqu’un dans « En ligne » pour démarrer un chat privé',
  },
  en: {
    appName: 'Neurio Contact', tagline: 'Chat with no internet — local network only (Wi-Fi / hotspot)',
    yourName: 'Your name', namePlaceholder: 'e.g. Youssef', yourEmoji: 'Your avatar', yourColor: 'Colour',
    remember: 'Remember my name on this device', enter: 'Enter the chat 🚀',
    multiTabHint: 'Testing alone? Open the app in a private window — you will be a second user.',
    server: 'Server', copyInvite: '📋 Copy invite link', rooms: 'Rooms', dms: 'Direct',
    online: 'Online now', invite: '🔗 Invite', export: '⬇️ Export', install: '📱 Install',
    changeMe: 'Switch user', searchPh: '🔍 Search messages…', messagePh: 'Write a message… (Enter to send)',
    cancel: 'Cancel', sendVoice: 'Send 🎙️',
    connecting: 'Connecting to server…', online_: 'Connected — fully offline', offline: 'Server unreachable — retrying…',
    you: 'You', today: 'Today', yesterday: 'Yesterday', member: 'member', members: 'members', onlineNow: 'online',
    msgCopied: 'Message copied ✅', linkCopied: 'Invite link copied ✅', noCopy: 'Copy blocked — copy manually',
    nameTaken: 'Enter your name to start', newRoom: 'New room name:', roomMade: 'Room created ✅',
    fileTooBig: 'File too large (25 MB max)', uploadFail: 'Upload failed ❌',
    noMic: 'Microphone unavailable — run the server with --https or use localhost',
    micDenied: 'Microphone permission denied 🚫', recording: 'Recording', voiceNote: 'Voice note',
    del: 'Delete', reply: 'Reply', download: 'Download', save: 'Save', empty: 'No messages yet — say hi! 👋',
    you_typing: 'typing…', someone: 'someone', deleted: 'Message deleted', searchNo: 'No results',
    copied: 'Copied ✅', reconnecting: 'Reconnecting…', joined: 'joined',
    httpMode: 'HTTP fallback mode — WebSocket blocked, chat keeps working 👌',
    pushDenied: 'Notifications blocked', notify: 'Allow notifications?', welcome: 'Welcome',
    dmEmpty: 'Tap someone under “online now” to start a private chat',
  },
};
const LOCALES = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-GB' };
let LANG = localStorage.getItem('nurio.lang') || 'ar';
const t = (k) => (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.ar[k] || k;

/* ─────────────────────────────── helpers ─────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const uid = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (ts) => new Date(ts).toLocaleTimeString(LOCALES[LANG], { hour: '2-digit', minute: '2-digit' });
const bytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const dayKey = (ts) => new Date(ts).toDateString();
/** every attachment gets its URL from the file id — old cached messages included */
const fileUrl = (f) => (f && (f.url || (f.id ? '/api/file/' + encodeURIComponent(f.id) : ''))) || '';
function dayLabel(ts) {
  if (dayKey(ts) === dayKey(Date.now())) return t('today');
  if (dayKey(ts) === dayKey(Date.now() - 864e5)) return t('yesterday');
  return new Date(ts).toLocaleDateString(LOCALES[LANG], { day: 'numeric', month: 'long', year: 'numeric' });
}

/** escape → light markdown (**bold** *italic* `code`) → linkify */
function format(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<i>$2</i>');
  h = h.replace(/(https?:\/\/[^\s<)]+)/g, (u) => `<a href="${u}" target="_blank" rel="noreferrer noopener">${u}</a>`);
  return h;
}

function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

/** soft notification chime (no audio file needed) */
let AC;
function chime(kind = 'in') {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const seq = kind === 'in' ? [660, 990] : [880, 660];
    seq.forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(.09, AC.currentTime + .02 + i * .09);
      g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + .22 + i * .09);
      o.connect(g).connect(AC.destination);
      o.start(AC.currentTime + i * .09); o.stop(AC.currentTime + .3 + i * .09);
    });
  } catch { /* audio blocked until first gesture — fine */ }
}

/* ─────────────────────────────── state ─────────────────────────────── */
const SID = (() => {
  let v = sessionStorage.getItem('nurio.sid');
  if (!v) { v = uid(8); sessionStorage.setItem('nurio.sid', v); }
  return v;
})();
const wantHttp = new URLSearchParams(location.search).get('transport') === 'poll';

const S = {
  me: null,
  ws: null, conn: 'connecting', tries: 0, timer: null,
  transport: wantHttp || localStorage.getItem('nurio.transport') === 'http' ? 'http' : 'ws',
  opened: false, wsFails: 0, httpLoop: false,
  server: null, rooms: [], dms: [], peers: [],
  active: 'general', msgs: {}, unread: {}, queue: [],
  typing: {}, replyTo: null, search: '', lastSound: 0, ready: false,
};
const CACHE_KEY = 'nurio.cache.v1';
const ME_KEY = 'nurio.me.v1';

function saveCache() {
  try {
    const out = {};
    for (const [room, list] of Object.entries(S.msgs)) out[room] = list.slice(-70);
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* quota — ignore */ }
}
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function saveQueue() { try { localStorage.setItem('nurio.queue.v1', JSON.stringify(S.queue)); } catch { } }
function loadQueue() { try { return JSON.parse(localStorage.getItem('nurio.queue.v1') || '[]'); } catch { return []; } }

/* ─────────────────────────────── login ─────────────────────────────── */
const EMOJIS = ['🙂', '😎', '🐱', '🦊', '🐼', '🦁', '🐬', '🦅', '🌟', '🎮', '🎧', '⚽', '🍕', '🚀', '👑', '🔥'];
const COLORS = ['#ff6b6b', '#f7b731', '#20bf6b', '#4b7bec', '#a55eea', '#fd79a8', '#00b8d4', '#e17055'];
let draft = { name: '', emoji: '🙂', color: COLORS[3] };

function buildPicker() {
  const e = $('#emojiPick'); e.textContent = '';
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = em;
    b.onclick = () => { draft.emoji = em; buildPicker(); };
    if (draft.emoji === em) b.classList.add('on');
    e.append(b);
  });
  const c = $('#colorPick'); c.textContent = '';
  COLORS.forEach((col) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'color'; b.style.setProperty('--c', col);
    b.onclick = () => { draft.color = col; buildPicker(); };
    if (draft.color === col) b.classList.add('on');
    c.append(b);
  });
}

function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('#langRow .lang').forEach((b) => b.classList.toggle('on', b.dataset.lang === LANG));
  localStorage.setItem('nurio.lang', LANG);
  document.title = t('appName');
  if (S.me) renderAll();
}

async function checkServer() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    S.server = j;
    $('#srvDot').className = 'dot on';
    $('#srvName').textContent = `${j.name} · v${j.version} · ${j.online} 👤`;
    const box = $('#srvAddrs'); box.textContent = '';
    const list = (j.addresses || []).map((ip) => `${location.protocol}//${ip}:${location.port || (j.https ? 443 : 80)}`);
    if (!list.length) list.push(location.origin);
    list.forEach((addr) => {
      const row = document.createElement('div'); row.className = 'addr';
      row.innerHTML = `<span>📱</span><code>${esc(addr)}</code>`;
      const b = document.createElement('button'); b.type = 'button'; b.textContent = '📋';
      b.onclick = async () => toast((await copy(addr)) ? t('linkCopied') : t('noCopy'));
      row.append(b); box.append(row);
    });
    return true;
  } catch {
    $('#srvDot').className = 'dot off';
    $('#srvName').textContent = t('offline');
    return false;
  }
}

function startChat(profile) {
  S.me = { ...profile, id: profile.id || uid(6) };
  sessionStorage.setItem('nurio.me.session', JSON.stringify(S.me));
  if ($('#inRemember').checked) localStorage.setItem(ME_KEY, JSON.stringify(S.me));
  S.msgs = loadCache();
  S.queue = loadQueue();
  $('#meName').textContent = S.me.name;
  $('#meAvatar').textContent = S.me.emoji;
  $('#meAvatar').style.background = S.me.color + '33';
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  connect();
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission?.(), 3000);
  }
}

function logout() {
  localStorage.removeItem(ME_KEY);
  sessionStorage.removeItem('nurio.me.session');
  location.reload();
}

/* ─────────────────────────────── WebSocket ─────────────────────────────── */
function connect() {
  clearTimeout(S.timer);
  setConn('connecting');
  if (S.transport === 'http') return connectHttp();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  S.opened = false;

  // a network that eats the WebSocket handshake must not eat the app:
  // either the handshake hangs (guard) or it fails instantly (opened === false)
  const guard = setTimeout(() => {
    if (ws.readyState !== 1 && S.transport !== 'http') {
      try { ws.close(); } catch { }
      if (S.conn !== 'on') useHttp();
    }
  }, 3500);

  ws.onopen = () => {
    clearTimeout(guard);
    S.opened = true;
    S.wsFails = 0;
    setConn('on');
    banner(null);
    ws.send(JSON.stringify({ t: 'hello', ...S.me }));   // identify ourselves on every (re)connect
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    handle(m);
  };
  ws.onclose = () => {
    clearTimeout(guard);
    if (S.transport === 'http') return;
    setConn('off');
    banner(t('offline'), true);
    if (!S.opened && ++S.wsFails >= 2) return useHttp();   // the handshake never worked → proxy blocks it
    retry();
  };
  ws.onerror = () => { try { ws.close(); } catch { } };
}

/* ── HTTP long-polling transport (proxies that block WebSocket) ─────────── */
function postIn(msg) {
  return fetch(`/api/poll/in?sid=${SID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid: SID, msg }),
  }).then((r) => { if (!r.ok) throw new Error('post ' + r.status); return r; });
}

function useHttp(quiet) {
  S.transport = 'http';
  try { localStorage.setItem('nurio.transport', 'http'); } catch { }
  if (!quiet) toast(t('httpMode'), 4000);
  connectHttp();
}

async function connectHttp() {
  if (S.httpLoop) return;
  S.httpLoop = true;
  try { await postIn({ t: 'hello', ...S.me }); } catch { /* the loop below retries */ }
  let cursor = 0, fails = 0;
  while (S.transport === 'http') {
    try {
      const r = await fetch(`/api/poll/out?sid=${SID}&cursor=${cursor}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      cursor = data.cursor;
      fails = 0;
      if (S.conn !== 'on') { setConn('on'); banner(null); }
      for (const m of data.messages) handle(m);
    } catch {
      if (fails++ === 0) { setConn('off'); banner(t('offline'), true); }
      await new Promise((r) => setTimeout(r, 1200));
      try { await postIn({ t: 'hello', ...S.me }); cursor = 0; } catch { /* keep trying */ }
    }
  }
  S.httpLoop = false;
}

function retry() {
  S.tries++;
  const wait = Math.min(1000 * Math.pow(1.6, S.tries - 1), 8000);
  clearTimeout(S.timer);
  S.timer = setTimeout(connect, wait);
}

function send(obj) {
  if (S.transport === 'http') {
    if (S.conn !== 'on') return false;
    postIn(obj).catch(() => {
      if (obj.t === 'msg' && !S.queue.some((q) => q.id === obj.id)) {   // never lose a message
        S.queue.push(obj);
        saveQueue();
        toast(t('offline'));
      }
    });
    return true;
  }
  if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
  return false;
}

function setConn(state) {
  S.conn = state;
  const b = $('#connBadge');
  b.className = 'conn ' + (state === 'on' ? 'on' : state === 'off' ? 'off' : '');
  b.title = state === 'on' ? t('online_') : state === 'off' ? t('offline') : t('connecting');
  if (state === 'on') S.tries = 0;
  updateRoomSub();
}

function handle(m) {
  switch (m.t) {
    case 'welcome': {
      S.ready = true;
      S.server = m.server;
      S.rooms = m.rooms; S.dms = m.dms; S.peers = m.peers;
      for (const [room, list] of Object.entries(m.history || {})) mergeHistory(room, list);
      if (S.active) send({ t: 'open', room: S.active, name: roomName(S.active).name });
      flushQueue();
      renderAll();
      break;
    }
    case 'peers': S.peers = m.peers; renderPeople(); break;
    case 'rooms': S.rooms = m.rooms; renderRooms(); break;
    case 'dms': S.dms = m.dms; renderDms(); break;
    case 'history': {
      mergeHistory(m.room, m.messages);
      if (m.dm) {
        if (!S.dms.some((d) => d.id === m.dm.id)) S.dms.unshift({ id: m.dm.id, peer: { ...m.dm.peer, online: true }, last: m.messages.at(-1) || null });
        S.active = m.dm.id;
        renderAll();
      } else if (m.room === S.active) renderMessages();
      break;
    }
    case 'msg': {
      const mine = m.msg.from && S.me && m.msg.from.id === S.me.id;
      mergeHistory(m.msg.room, [m.msg]);
      if (m.msg.room === S.active) appendMessage(m.msg);
      else if (!mine) S.unread[m.msg.room] = (S.unread[m.msg.room] || 0) + 1;
      if (!mine) notifyIncoming(m.msg);
      renderLists();
      break;
    }
    case 'delete': {
      S.msgs[m.room] = (S.msgs[m.room] || []).filter((x) => x.id !== m.id);
      $$(`#messages [data-id="${m.id}"]`).forEach((el) => el.remove());
      saveCache();
      break;
    }
    case 'typing': {
      if (!m.from || m.from.id === S.me.id) break;
      const room = m.room;
      S.typing[room] = S.typing[room] || {};
      if (m.on) S.typing[room][m.from.id] = { name: m.from.name, until: Date.now() + 3500 };
      else delete S.typing[room][m.from.id];
      renderTyping();
      break;
    }
    case 'pong': break;
  }
}

function mergeHistory(room, list) {
  const cur = S.msgs[room] || (S.msgs[room] = []);
  const index = new Map(cur.map((x, i) => [x.id, i]));
  let changed = false;
  for (const msg of list) {
    const at = index.get(msg.id);
    if (at === undefined) {
      cur.push(msg);
      index.set(msg.id, cur.length - 1);
      changed = true;
    } else if (cur[at].pending || msg.ts !== cur[at].ts) {
      cur[at] = { ...msg, pending: false };      // confirmed by the server → drop the 🕐
      changed = true;
    }
  }
  cur.sort((a, b) => a.ts - b.ts);
  if (cur.length > 400) cur.splice(0, cur.length - 400);
  if (changed) saveCache();
}

function notifyIncoming(msg) {
  const quiet = document.visibilityState === 'visible' && msg.room === S.active;
  if (quiet) return;
  if (Date.now() - S.lastSound > 900) { S.lastSound = Date.now(); chime('in'); }
  const room = [...S.rooms, ...S.dms].find((r) => r.id === msg.room);
  const title = (msg.from?.name || t('someone')) + ' · ' + (room?.name || msg.room);
  const n = Object.values(S.unread).reduce((a, b) => a + b, 0);
  document.title = (n > 0 ? `(${n}) ` : '') + title + ' — ' + t('appName');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, {
        body: msg.kind === 'text' ? (msg.text || '').slice(0, 120) : `📎 ${msg.file?.name || 'file'}`,
        icon: 'icon-192.png', tag: msg.room, silent: true,
      });
    } catch { /* ignore */ }
  }
}

function flushQueue() {
  if (!S.queue.length) return;
  const stuck = [];
  let sent = 0;
  for (const q of S.queue) {
    if (send({ t: 'msg', ...q })) sent++;
    else stuck.push(q);                 // still no socket → keep it queued
  }
  S.queue = stuck;
  saveQueue();
  if (sent) { chime('out'); toast(`${sent} ✉️`); }
}

/* ─────────────────────────────── rendering ─────────────────────────────── */
function renderAll() { renderRooms(); renderDms(); renderPeople(); renderHeader(); renderMessages(); }

function roomName(id) {
  const r = S.rooms.find((x) => x.id === id);
  if (r) return r;
  const d = S.dms.find((x) => x.id === id);
  if (d) return { id, name: d.peer.name, kind: 'dm', emoji: d.peer.emoji, color: d.peer.color };
  return { id, name: id, kind: 'group', emoji: '#' };
}

function renderHeader() {
  const r = roomName(S.active);
  $('#roomTitle').textContent = r.name;
  $('#roomAvatar').textContent = r.emoji || '#';
  $('#roomAvatar').style.background = (r.color || '#4b7bec') + '33';
  updateRoomSub();
}

function updateRoomSub() {
  const r = roomName(S.active);
  const parts = [];
  parts.push(S.conn === 'on' ? t('online_') : t('offline'));
  if (r.kind === 'dm') {
    const p = S.peers.find((x) => x.id === r.id || x.name === r.name);
    parts.push(p ? `🟢 ${t('onlineNow')}` : '⚪️ offline');
  } else {
    const online = S.rooms.find((x) => x.id === r.id)?.online || 0;
    parts.push(`${online} ${t('onlineNow')}`);
    const count = (S.msgs[r.id] || []).length;
    if (count) parts.push(`${count} 💬`);
  }
  $('#roomSub').textContent = parts.join(' · ');
}

function lastLine(msg) {
  if (!msg) return '';
  if (msg.kind === 'system') return '— ' + msg.text;
  const body = msg.kind === 'voice' ? `🎙️ ${t('voiceNote')}`
    : msg.kind === 'image' ? `🖼️ ${msg.file?.name || ''}`
    : msg.file ? `📎 ${msg.file.name}`
    : msg.text || '';
  const who = S.me && msg.from?.id === S.me.id ? t('you') : msg.from?.name || '';
  return `${who}: ${body}`.slice(0, 60);
}

function renderRooms() {
  const box = $('#roomList'); box.textContent = '';
  for (const r of S.rooms) {
    const el = document.createElement('div');
    el.className = 'item' + (r.id === S.active ? ' on' : '');
    const last = (S.msgs[r.id] || []).at(-1) || r.last;
    el.innerHTML = `
      <span class="avatar small">${esc(r.emoji || '#')}</span>
      <span class="txt"><b>${esc(r.name)}</b><span>${esc(lastLine(last)) || '&nbsp;'}</span></span>
      ${r.online ? `<span class="status-pill on">${r.online}</span>` : ''}
      ${S.unread[r.id] ? `<span class="unread">${S.unread[r.id]}</span>` : ''}`;
    el.onclick = () => openRoom(r.id);
    box.append(el);
  }
}

function renderDms() {
  const box = $('#dmList'); box.textContent = '';
  if (!S.dms.length) {
    const d = document.createElement('div');
    d.className = 'list-hint';
    d.textContent = t('dmEmpty');
    box.append(d);
    return;
  }
  for (const d of S.dms) {
    const el = document.createElement('div');
    el.className = 'item' + (d.id === S.active ? ' on' : '');
    const last = (S.msgs[d.id] || []).at(-1) || d.last;
    el.innerHTML = `
      <span class="avatar small" style="background:${esc(d.peer.color || '#8b95a5')}33">${esc(d.peer.emoji || '🙂')}</span>
      <span class="txt"><b>${esc(d.peer.name)}</b><span>${esc(lastLine(last)) || '&nbsp;'}</span></span>
      ${S.unread[d.id] ? `<span class="unread">${S.unread[d.id]}</span>` : ''}`;
    el.onclick = () => openRoom(d.id);
    box.append(el);
  }
}

function renderLists() { renderRooms(); renderDms(); renderPeople(); updateRoomSub(); }

function renderPeople() {
  const box = $('#peerList'); box.textContent = '';
  $('#onlineCount').textContent = String(S.peers.length);
  for (const p of S.peers) {
    const mine = p.id === S.me?.id;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <span class="avatar small" style="background:${esc(p.color)}33">${esc(p.emoji)}</span>
      <span class="txt"><b>${esc(p.name)}${mine ? ` <span class="muted">(${t('you')})</span>` : ''}</b>
      <span>${p.devices > 1 ? p.devices + ' 📱' : t('onlineNow')}</span></span>`;
    if (!mine) {
      el.style.cursor = 'pointer';
      el.onclick = () => { send({ t: 'dm', peer: { id: p.id, name: p.name, color: p.color, emoji: p.emoji } }); closeSide(); };
    }
    box.append(el);
  }
}

function matchSearch(msg) {
  if (!S.search) return true;
  const hay = `${msg.text || ''} ${msg.from?.name || ''} ${msg.file?.name || ''}`.toLowerCase();
  return hay.includes(S.search);
}

function renderMessages() {
  const box = $('#messages');
  box.textContent = '';
  const list = (S.msgs[S.active] || []).filter(matchSearch);
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'system';
    e.textContent = S.search ? t('searchNo') : t('empty');
    box.append(e);
    return;
  }
  let day = null;
  list.forEach((m) => {
    if (dayKey(m.ts) !== day) { day = dayKey(m.ts); box.append(sep(m.ts)); }
    box.append(buildMessage(m));
  });
  scrollBottom(true);
}

function sep(ts) {
  const d = document.createElement('div');
  d.className = 'date-sep';
  d.textContent = dayLabel(ts);
  return d;
}

function appendMessage(m) {
  if (m.room !== S.active) return;
  if (!matchSearch(m)) return;
  const box = $('#messages');
  const existing = box.querySelector(`[data-id="${m.id}"]`);
  if (existing) {                       // server echo of our own optimistic message
    const fresh = buildMessage(m);
    existing.replaceWith(fresh);
    if (S.me && m.from?.id === S.me.id && nearBottom()) scrollBottom();
    return;
  }
  const empty = box.querySelector('.system');
  if (empty && (empty.textContent === t('empty') || empty.textContent === t('searchNo'))) empty.remove();
  const list = [...box.children].filter((c) => c.dataset.ts);
  const last = list.at(-1);
  if (!last || dayKey(Number(last.dataset.ts)) !== dayKey(m.ts)) box.append(sep(m.ts));
  const stick = nearBottom();
  box.append(buildMessage(m));
  if (stick || (S.me && m.from?.id === S.me.id)) scrollBottom();
  else $('#btnJump').classList.remove('hidden');
}

function buildMessage(m) {
  const box = document.createElement('div');
  box.dataset.id = m.id;
  box.dataset.ts = m.ts;

  if (m.kind === 'system') {
    box.className = 'system';
    box.textContent = m.text;
    return box;
  }

  const mine = m.from?.id === S.me?.id;
  box.className = 'msg' + (mine ? ' me' : '');
  if (m.pending) box.classList.add('pending');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (m.replyTo && m.replyTo.text) {
    const q = document.createElement('div');
    q.className = 'reply-quote';
    q.innerHTML = `<b>${esc(m.replyTo.name || '')}</b>${esc(m.replyTo.text)}`;
    bubble.append(q);
  }
  if (!mine && roomName(m.room).kind !== 'dm') {
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = m.from?.color || '#fff';
    who.textContent = m.from?.name || '?';
    bubble.append(who);
  }

  if (m.kind === 'image' && m.file) {
    const a = document.createElement('a');
    a.href = fileUrl(m.file); a.target = '_blank'; a.rel = 'noreferrer';
    const img = document.createElement('img');
    img.className = 'photo'; img.src = fileUrl(m.file); img.alt = m.file.name; img.loading = 'lazy';
    if (m.file.missing) { img.alt = '⚠️ ' + m.file.name; img.style.opacity = '.4'; }
    img.onclick = (e) => { e.preventDefault(); openLightbox(fileUrl(m.file)); };
    a.append(img);
    bubble.append(a);
    const cap = document.createElement('div');
    cap.className = 'body small'; cap.innerHTML = format(m.text || '');
    if (m.text) bubble.append(cap);
  } else if (m.kind === 'voice' && m.file) {
    const wrap = document.createElement('div');
    wrap.className = 'audio-msg';
    const audio = document.createElement('audio');
    audio.controls = true; audio.preload = 'metadata'; audio.src = fileUrl(m.file);
    const tag = document.createElement('span');
    tag.className = 'voice-tag'; tag.textContent = `🎙️ ${bytes(m.file.size)}`;
    wrap.append(audio, tag);
    bubble.append(wrap);
  } else if (m.file) {
    const a = document.createElement('a');
    a.className = 'file-chip'; a.href = fileUrl(m.file); a.download = m.file.name;
    a.innerHTML = `<span class="ico">${fileIcon(m.file.type, m.file.name)}</span>
      <span><b>${esc(m.file.name)}</b><small>${bytes(m.file.size)} · ${t('download')}</small></span>`;
    bubble.append(a);
    if (m.text) {
      const c = document.createElement('div'); c.className = 'body small'; c.innerHTML = format(m.text);
      bubble.append(c);
    }
  } else {
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = format(m.text || '');
    bubble.append(body);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `${time(m.ts)}${mine ? ' <span class="tick">' + (m.pending ? '🕐' : '✓') + '</span>' : ''}`;
  bubble.append(meta);

  const acts = document.createElement('div');
  acts.className = 'acts';
  const bReply = document.createElement('button');
  bReply.textContent = '↩'; bReply.title = t('reply');
  bReply.onclick = () => setReply(m);
  acts.append(bReply);
  const bCopy = document.createElement('button');
  bCopy.textContent = '⧉'; bCopy.title = t('copied');
  bCopy.onclick = async () => toast((await copy(m.text || m.file?.name || '')) ? t('msgCopied') : t('noCopy'));
  acts.append(bCopy);
  if (mine) {
    const bDel = document.createElement('button');
    bDel.textContent = '🗑'; bDel.title = t('del');
    bDel.onclick = () => {
      S.msgs[m.room] = (S.msgs[m.room] || []).filter((x) => x.id !== m.id);
      box.remove(); saveCache();
      if (send({ t: 'delete', room: m.room, id: m.id })) { /* server echoes */ }
    };
    acts.append(bDel);
  }

  box.append(bubble, acts);
  return box;
}

function fileIcon(type = '', name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (/^video\//.test(type)) return '🎬';
  if (/^audio\//.test(type)) return '🎵';
  if (/pdf/.test(type) || ext === 'pdf') return '📕';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['doc', 'docx', 'odt'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '🖼️';
  if (['apk', 'exe', 'sh', 'bat'].includes(ext)) return '⚙️';
  return '📎';
}

function renderTyping() {
  const box = $('#typing');
  const map = S.typing[S.active] || {};
  const names = Object.values(map).filter((x) => x.until > Date.now()).map((x) => x.name);
  box.innerHTML = names.length
    ? `<span class="dots">${esc(names.join(', '))} ${LANG === 'ar' ? 'كيكتب' : t('you_typing').replace('…', '')}</span>`
    : '';
}
setInterval(renderTyping, 1200);

/* ─────────────────────────────── messages ─────────────────────────────── */
function nearBottom() {
  const b = $('#messages');
  return b.scrollHeight - b.scrollTop - b.clientHeight < 120;
}
function scrollBottom(instant) {
  const b = $('#messages');
  if (instant) { const prev = b.style.scrollBehavior; b.style.scrollBehavior = 'auto'; b.scrollTop = b.scrollHeight; b.style.scrollBehavior = prev; }
  else b.scrollTop = b.scrollHeight;
  $('#btnJump').classList.add('hidden');
}

function setReply(m) {
  S.replyTo = { id: m.id, name: m.from?.name || '', text: (m.text || m.file?.name || '').slice(0, 120) };
  $('#replyName').textContent = S.replyTo.name;
  $('#replyText').textContent = S.replyTo.text;
  $('#replyBar').classList.remove('hidden');
  $('#inMsg').focus();
}

function clearReply() { S.replyTo = null; $('#replyBar').classList.add('hidden'); }

function openRoom(id) {
  S.active = id;
  S.unread[id] = 0;
  S.search = ''; $('#inSearch').value = '';
  closeSide();
  renderHeader(); renderLists(); renderMessages();
  send({ t: 'open', room: id, name: roomName(id).name });
  $('#inMsg').focus();
}

function sendMessage({ text = '', file = null, kind = 'text' }) {
  const room = S.active;
  const msg = {
    id: uid(6), room, ts: Date.now(),
    from: { id: S.me.id, name: S.me.name, color: S.me.color, emoji: S.me.emoji },
    kind, text, file, replyTo: S.replyTo, pending: true,
  };
  mergeHistory(room, [msg]);
  appendMessage(msg);
  clearReply();
  const payload = { room, id: msg.id, text, kind, file, replyTo: msg.replyTo, roomName: roomName(room).name };
  if (send({ t: 'msg', ...payload })) { chime('out'); }
  else { S.queue.push(payload); saveQueue(); toast(t('offline')); }
}

/* ─────────────────────────────── uploads ─────────────────────────────── */
function upload(file, kind) {
  return new Promise((resolve, reject) => {
    if (file.size > 25 * 1024 * 1024) return reject(new Error('too-big'));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || 'file'));
    xhr.setRequestHeader('x-file-type', file.type || 'application/octet-stream');
    const bar = $('#uploadBar');
    bar.classList.remove('hidden');
    $('#upLabel').textContent = `${file.name} · ${bytes(file.size)}`;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('#upFill').style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = () => {
      bar.classList.add('hidden'); $('#upFill').style.width = '0%';
      if (xhr.status !== 200) return reject(new Error('http ' + xhr.status));
      try { resolve({ ...JSON.parse(xhr.responseText), kindOverride: kind }); }
      catch (e) { reject(e); }
    };
    xhr.onerror = () => { bar.classList.add('hidden'); reject(new Error('network')); };
    xhr.send(file);
  });
}

async function sendFiles(files) {
  for (const f of files) {
    try {
      const up = await upload(f);
      const isImg = /^image\//.test(up.type);
      const kind = /^audio\//.test(up.type) && f.name.startsWith('voice-') ? 'voice' : isImg ? 'image' : 'file';
      sendMessage({
        kind, text: '',
        file: { id: up.id, name: up.name, size: up.size, type: up.type, url: up.url },
      });
    } catch (err) {
      toast(err.message === 'too-big' ? t('fileTooBig') : t('uploadFail'));
    }
  }
}

/* ─────────────────────────────── voice notes ─────────────────────────────── */
let recorder = null, recChunks = [], recTimer = null, recStart = 0, recStream = null;

function micSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

async function startRecording() {
  if (!micSupported()) { toast(t('noMic'), 4000); return; }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { toast(t('micDenied')); return; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = async () => {
    recStream?.getTracks().forEach((tr) => tr.stop());
    const type = recorder.mimeType || 'audio/webm';
    const blob = new Blob(recChunks, { type });
    recorder = null;
    if (!blob.size || blob.size < 1200) return;
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: type.split(';')[0] });
    try {
      const up = await upload(file);
      sendMessage({ kind: 'voice', file: { id: up.id, name: up.name, size: up.size, type: up.type, url: up.url } });
    } catch { toast(t('uploadFail')); }
  };
  recorder.start();
  recStart = Date.now();
  $('#recBar').classList.remove('hidden');
  $('#btnMic').classList.add('live');
  banner(null);
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  chime('out');
}

function stopRecording(sendIt) {
  clearInterval(recTimer);
  $('#recBar').classList.add('hidden');
  $('#btnMic').classList.remove('live');
  if (!recorder) return;
  if (sendIt) recorder.stop();
  else { recorder.onstop = () => recStream?.getTracks().forEach((tr) => tr.stop()); recorder.stop(); recChunks = []; }
}

/* ─────────────────────────────── emoji panel ─────────────────────────────── */
const EMOJI_GROUPS = [
  ['😀', '😂', '🥰', '😎', '🤔', '😴', '😭', '😡', '🤩', '🥳', '🤝', '🙏', '👍', '👎', '👏', '💪', '✌️', '🫡', '👀', '🫶'],
  ['❤️', '🔥', '✨', '🎉', '🎁', '💯', '⚡', '🌟', '💧', '🌙', '☀️', '🌈', '🍀', '🏆', '🥇', '🎯', '🚀', '🛡️', '⏰', '📌'],
  ['🐱', '🐶', '🦊', '🐼', '🦁', '🐬', '🦅', '🐝', '🦋', '🌵', '🌴', '🍕', '🍵', '☕', '🍫', '⚽', '🎮', '🎧', '📱', '💻'],
];
function buildEmojiPanel() {
  const p = $('#emojiPanel');
  p.textContent = '';
  EMOJI_GROUPS.forEach((group, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    group.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = e;
      b.onclick = () => { insertAtCursor($('#inMsg'), e); };
      row.append(b);
    });
    p.append(row);
  });
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

/* ─────────────────────────────── sidebar / misc ─────────────────────────────── */
function closeSide() { $('#sidebar').classList.remove('open'); }
function toggleSide() { $('#sidebar').classList.toggle('open'); }

function openLightbox(src) {
  $('#lightImg').src = src;
  $('#lightbox').classList.remove('hidden');
}

function banner(text, isErr) {
  const b = $('#banner');
  if (!text) { b.classList.add('hidden'); return; }
  b.textContent = text;
  b.classList.toggle('err', !!isErr);
  b.classList.remove('hidden');
}

/* ─────────────────────────────── wiring ─────────────────────────────── */
function wire() {
  /* login */
  $('#inName').value = (() => { try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null')?.name || ''; } catch { return ''; } })();
  buildPicker();
  $('#btnEnter').onclick = () => {
    const name = $('#inName').value.trim();
    if (!name) { $('#inName').focus(); toast(t('nameTaken')); return; }
    chime('out');
    startChat({ name, emoji: draft.emoji, color: draft.color });
  };
  $('#inName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnEnter').click(); });
  $$('#langRow .lang').forEach((b) => b.onclick = () => { LANG = b.dataset.lang; applyLang(); checkServer(); });
  $('#btnCopyInvite').onclick = async () => {
    const list = (S.server?.addresses || []).map((ip) => `${location.protocol}//${ip}:${location.port || 80}`);
    const url = list[0] || location.origin;
    toast((await copy(url)) ? t('linkCopied') : url, 3000);
  };

  /* sidebar */
  $('#btnOpenSide').onclick = toggleSide;
  $('#btnCloseSide').onclick = closeSide;
  $('#btnSwitch').onclick = logout;
  $('#btnNewRoom').onclick = () => {
    const name = prompt(t('newRoom'));
    if (name && name.trim()) { send({ t: 'room', name: name.trim(), emoji: '💬' }); toast(t('roomMade')); }
  };
  $('#btnInvite').onclick = $('#btnCopyInvite').click;
  $('#btnExport').onclick = () => {
    const url = `/api/export?room=${encodeURIComponent(S.active)}`;
    const a = document.createElement('a');
    a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove();
  };
  $('#inSearch').oninput = (e) => { S.search = e.target.value.trim().toLowerCase(); renderMessages(); };

  /* composer */
  const ta = $('#inMsg');
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  let typingSent = 0;
  ta.addEventListener('input', () => {
    autosize();
    const now = Date.now();
    if (now - typingSent > 1800) {
      typingSent = now;
      send({ t: 'typing', room: S.active, on: true });
      setTimeout(() => send({ t: 'typing', room: S.active, on: false }), 2600);
    }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').onsubmit = (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    sendMessage({ text });
    ta.value = ''; autosize();
  };

  $('#btnEmoji').onclick = (e) => { e.stopPropagation(); $('#emojiPanel').classList.toggle('hidden'); };
  document.addEventListener('click', (e) => {
    if (!$('#emojiPanel').classList.contains('hidden') && !$('#emojiPanel').contains(e.target) && e.target !== $('#btnEmoji')) {
      $('#emojiPanel').classList.add('hidden');
    }
  });
  buildEmojiPanel();

  $('#btnAttach').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { sendFiles([...e.target.files]); e.target.value = ''; };

  /* drag & drop + paste */
  const dropZone = $('#messages');
  ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.style.background = 'rgba(34,211,238,.06)'; }));
  ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, () => { dropZone.style.background = ''; }));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) sendFiles([...e.dataTransfer.files]); });
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && S.me) { e.preventDefault(); sendFiles(files); }
  });

  /* voice */
  $('#btnMic').onclick = () => {
    if (recorder) stopRecording(true);
    else startRecording();
  };
  $('#btnRecCancel').onclick = () => stopRecording(false);
  $('#btnRecSend').onclick = () => stopRecording(true);

  /* misc */
  $('#btnCancelReply').onclick = clearReply;
  $('#btnJump').onclick = () => scrollBottom();
  $('#lightbox').onclick = () => $('#lightbox').classList.add('hidden');
  $('#messages').addEventListener('scroll', () => { if (nearBottom()) $('#btnJump').classList.add('hidden'); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { document.title = t('appName'); S.unread[S.active] = 0; renderLists(); }
  });
  window.addEventListener('beforeunload', saveCache);

  /* PWA install */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    $('#btnInstall').classList.remove('hidden');
  });
  $('#btnInstall').onclick = async () => {
    if (!deferred) return toast('iOS: Share → Add to Home Screen / شارك → أضف للشاشة');
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('#btnInstall').classList.add('hidden');
  };
}

/* ─────────────────────────────── debug hook ───────────────────────────────
   Handy from the console: __neurio.S.active, __neurio.S.queue, __neurio.say(…) */
window.__neurio = { S, send, say: (text) => sendMessage({ text }), version: 1 };

/* ─────────────────────────────── boot ─────────────────────────────── */
function boot() {
  wire();
  applyLang();
  buildPicker();
  checkServer();
  setInterval(checkServer, 20000);

  // returning user? (session first so several tabs = several users)
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('nurio.me.session') || 'null'); } catch { }
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { } }
  if (saved?.name) {
    draft = { name: saved.name, emoji: saved.emoji || '🙂', color: saved.color || COLORS[3] };
    startChat(saved);
  } else {
    $('#inName').focus();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  }
}
boot();
