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
    staticTitle: '🔗 وضع «بلا سيرفر» — GitHub / ملف ثابت',
    staticBody: 'ما لقيناش سيرفر على هاد العنوان. مازال تقدر تجرب: نفس الجهاز (تبويبين)، ولا تربط جهاز آخر مباشرة (P2P).',
    staticBadge: 'بلا سيرفر',
    newRoomTitle: '🏠 غرفة جديدة', newRoomName: 'سمية الغرفة', newRoomPh: 'مثال: فريق الدار',
    newRoomCreate: 'إنشاء الغرفة', roomEmojiLabel: 'رمز الغرفة',
    connectTitle: '🔌 عندك سيرفر فالحاسوب؟', connectPh: 'http://192.168.1.5:8080',
    connectGo: 'اتصال', connectHint: 'شغّل <code>node tools/offline-chat/server.mjs</code> فالحاسوب، وحط هنا العنوان لي كيعطيك.',
    connectBad: 'العنوان ماشي صحيح — خاصو يبدا بـ http:// ولا https://',
    apkHint: '📱 فالتطبيق (APK): الدردشة كتخدم بلا إنترنت (P2P بين الهواتف). الصور والملفات والملاحظات الصوتية ماشي فالتطبيق — دوس على 🔗 دعوة ونسخ الرابط، وحلو فـ Chrome.',
    apkNoFiles: 'فالتطبيق ما كاينش اختيار الملفات 📎 — من 🔗 دعوة نسخ الرابط وحلو فـ Chrome باش تصيفط تصاور ولا ملفات.',
    apkNoMic: 'التسجيل الصوتي ما كاينش فالتطبيق 🎙️ — حل الرابط فـ Chrome.',
    p2pOpen: '🔗 جهاز آخر (P2P)', p2pTitle: '🔗 ربط جهاز آخر مباشرة (P2P)',
    p2pHint: 'خدمة بلا إنترنت وبلا سيرفر: الرمز كيدوز بين الجهازين بأي طريقة (واتساب، بلوتوث، نسخ يدوي…). الجوج خاصهم يكونو على نفس الشبكة المحلية.',
    p2pCreate: '1) أنا نبدا الدعوة', p2pCreateBtn: 'إنشاء رمز الدعوة', p2pCopy: '📋 نسخ الرمز',
    p2pPasteAnswer: 'الصق رمز الجواب هنا…', p2pAccept: '🔌 اتصال',
    p2pJoin: '2) أنا عندي رمز دعوة', p2pPasteOffer: 'الصق رمز الدعوة هنا…',
    p2pJoinBtn: 'توليد رمز الجواب',
    p2pWorking: 'كنجهزو الرمز…', p2pWaiting: 'الرمز واجد — صيفطو للجهاز الآخر 📤',
    p2pWaitingAnswer: 'تسنا الجواب…', p2pConnecting: 'كنتصلو… ⏳',
    p2pConnected: 'متصلين مباشرة ✅', p2pFailed: 'ماقدرناش نتصلو ❌ — تأكد أن الجهازين فنفس الشبكة',
    p2pBadCode: 'الرمز ماشي صحيح ❌', p2pLocalHint: 'ولا حِل التطبيق فتبويب آخر هو الآخر — غادي تشوفو بعضكم دغيا.',
    p2pNeedName: 'دخل للدردشة عاد ربط جهاز آخر',
    localMode: 'وضع بلا سيرفر: كل تبويب = مستخدم. حِل تبويب آخر باش تهدر مع راسك 😄',
    fileWait: '⏳ كيتحمّل…', fileGone: '⚠️ الملف ما بقاش متاح فهاد الجلسة',
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
    staticTitle: '🔗 Mode « sans serveur » — GitHub / fichier statique',
    staticBody: 'Aucun serveur à cette adresse. Vous pouvez quand même tester : même appareil (deux onglets) ou lier un autre appareil en direct (P2P).',
    staticBadge: 'sans serveur',
    newRoomTitle: '🏠 Nouveau salon', newRoomName: 'Nom du salon', newRoomPh: 'ex : Équipe maison',
    newRoomCreate: 'Créer', roomEmojiLabel: 'Icône du salon',
    connectTitle: '🔌 Un serveur tourne sur votre PC ?', connectPh: 'http://192.168.1.5:8080',
    connectGo: 'Connecter', connectHint: 'Lancez <code>node tools/offline-chat/server.mjs</code> sur le PC puis collez l’adresse affichée.',
    connectBad: 'Adresse invalide — elle doit commencer par http:// ou https://',
    apkHint: '📱 Dans l’APK : le chat marche sans internet (P2P entre téléphones). Photos, fichiers et notes vocales n’y sont pas — bouton 🔗 Inviter, copiez le lien et ouvrez-le dans Chrome.',
    apkNoFiles: 'L’APK n’a pas de sélecteur de fichiers 📎 — ouvrez le lien dans Chrome pour envoyer photos/fichiers.',
    apkNoMic: 'Notes vocales indisponibles dans l’APK 🎙️ — ouvrez le lien dans Chrome.',
    p2pOpen: '🔗 Autre appareil (P2P)', p2pTitle: '🔗 Lier un autre appareil (P2P)',
    p2pHint: 'Sans internet ni serveur : le code passe par n’importe quel canal (WhatsApp, Bluetooth, copier-coller…). Les deux appareils doivent être sur le même réseau local.',
    p2pCreate: '1) Je lance l’invitation', p2pCreateBtn: 'Créer le code', p2pCopy: '📋 Copier le code',
    p2pPasteAnswer: 'Collez le code de réponse…', p2pAccept: '🔌 Connecter',
    p2pJoin: '2) J’ai un code d’invitation', p2pPasteOffer: 'Collez le code d’invitation…',
    p2pJoinBtn: 'Générer la réponse',
    p2pWorking: 'Préparation du code…', p2pWaiting: 'Code prêt — envoyez-le à l’autre appareil 📤',
    p2pWaitingAnswer: 'En attente de la réponse…', p2pConnecting: 'Connexion… ⏳',
    p2pConnected: 'Connectés en direct ✅', p2pFailed: 'Connexion impossible ❌ — vérifiez le réseau local',
    p2pBadCode: 'Code invalide ❌', p2pLocalHint: 'Ou ouvrez l’app dans un autre onglet — vous vous verrez aussitôt.',
    p2pNeedName: 'Entrez d’abord dans le chat',
    localMode: 'Mode sans serveur : chaque onglet est un utilisateur. Ouvrez un autre onglet 😄',
    fileWait: '⏳ réception…', fileGone: '⚠️ Fichier indisponible dans cette session',
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
    staticTitle: '🔗 “No server” mode — GitHub / static file',
    staticBody: 'No server at this address. You can still try it: same device (two tabs) or link another device directly (P2P).',
    staticBadge: 'no server',
    newRoomTitle: '🏠 New room', newRoomName: 'Room name', newRoomPh: 'e.g. Home crew',
    newRoomCreate: 'Create room', roomEmojiLabel: 'Room icon',
    connectTitle: '🔌 Running a server on your PC?', connectPh: 'http://192.168.1.5:8080',
    connectGo: 'Connect', connectHint: 'Run <code>node tools/offline-chat/server.mjs</code> on the PC, then paste the address it prints.',
    connectBad: 'Invalid address — it must start with http:// or https://',
    apkHint: '📱 In the APK: chat works with no internet (P2P between phones). Photos, files and voice notes are not there — tap 🔗 Invite, copy the link and open it in Chrome.',
    apkNoFiles: 'The APK has no file picker 📎 — open the link in Chrome to send photos or files.',
    apkNoMic: 'Voice notes are unavailable in the APK 🎙️ — open the link in Chrome.',
    p2pOpen: '🔗 Another device (P2P)', p2pTitle: '🔗 Link another device (P2P)',
    p2pHint: 'No internet, no server: the code travels over any channel (WhatsApp, Bluetooth, copy-paste…). Both devices must be on the same local network.',
    p2pCreate: '1) I start the invite', p2pCreateBtn: 'Create invite code', p2pCopy: '📋 Copy code',
    p2pPasteAnswer: 'Paste the answer code…', p2pAccept: '🔌 Connect',
    p2pJoin: '2) I have an invite code', p2pPasteOffer: 'Paste the invite code…',
    p2pJoinBtn: 'Generate answer code',
    p2pWorking: 'Preparing the code…', p2pWaiting: 'Code ready — send it to the other device 📤',
    p2pWaitingAnswer: 'Waiting for the answer…', p2pConnecting: 'Connecting… ⏳',
    p2pConnected: 'Connected directly ✅', p2pFailed: 'Could not connect ❌ — check you are on the same network',
    p2pBadCode: 'Invalid code ❌', p2pLocalHint: 'Or open the app in another tab — you will see each other right away.',
    p2pNeedName: 'Enter the chat first',
    localMode: 'No-server mode: every tab is a user. Open a second tab 😄',
    fileWait: '⏳ receiving…', fileGone: '⚠️ File no longer available in this session',
  },
};
const LOCALES = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-GB' };
/* storage that can never break the app: WebViews, private mode and some
   file:// origins throw on localStorage — fall back to memory in that case */
const LS = (() => {
  try {
    const real = window['localStorage'];
    real.setItem('__nurio_probe', '1');
    real.removeItem('__nurio_probe');
    return real;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  }
})();
const IS_APK = location.protocol === 'file:';
const HOSTED_URL = 'https://cdn.jsdelivr.net/gh/zakariabouifri03-max/neurio@main/tools/offline-chat/public/';
let LANG = LS.getItem('nurio.lang') || 'ar';
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
const fileUrl = (f) => {
  if (!f) return '';
  if (f.blobUrl) return f.blobUrl;
  if (f.dataUrl) return f.dataUrl;
  if (f.url) return f.url;
  if (f.id && S.mode === 'server') return '/api/file/' + encodeURIComponent(f.id);
  return '';
};
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
const QS = new URLSearchParams(location.search);
const wantHttp = QS.get('transport') === 'poll';
const wantOffline = QS.get('mode') === 'local';     // force no-server mode

const S = {
  me: null,
  ws: null, conn: 'connecting', tries: 0, timer: null,
  transport: wantHttp || LS.getItem('nurio.transport') === 'http' ? 'http' : 'ws',
  opened: false, wsFails: 0, httpLoop: false,
  mode: 'server',            // server | local | p2p
  serverOK: null,            // null = still probing
  tabId: uid(3), localBC: null, localPeers: new Map(),
  pc: null, dc: null, peer: null, p2pRoom: null, recv: null,
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
    LS.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* quota — ignore */ }
}
function loadCache() {
  try { return JSON.parse(LS.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function saveQueue() { try { LS.setItem('nurio.queue.v1', JSON.stringify(S.queue)); } catch { } }
function loadQueue() { try { return JSON.parse(LS.getItem('nurio.queue.v1') || '[]'); } catch { return []; } }

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
  LS.setItem('nurio.lang', LANG);
  document.title = t('appName');
  if (S.me) renderAll();
}

async function checkServer() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    S.server = j;
    S.serverOK = true;
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
    S.serverOK = false;
    $('#srvDot').className = 'dot off';
    $('#srvName').textContent = t('staticBadge');
    $('#staticNote').classList.remove('hidden');
    return false;
  }
}

function startChat(profile) {
  S.me = { ...profile, id: profile.id || uid(6) };
  sessionStorage.setItem('nurio.me.session', JSON.stringify(S.me));
  if ($('#inRemember').checked) LS.setItem(ME_KEY, JSON.stringify(S.me));
  S.msgs = loadCache();
  S.queue = loadQueue();
  $('#meName').textContent = S.me.name;
  $('#meAvatar').textContent = S.me.emoji;
  $('#meAvatar').style.background = S.me.color + '33';
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (S.serverOK === false || wantOffline) {
    S.mode = 'local';                      // GitHub Pages / plain file: no backend at all
    S.me.id = 'tab-' + S.tabId;            // in this mode every tab is its own user
    startLocalHub();
  } else {
    connect();
  }
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission?.(), 3000);
  }
}

function logout() {
  LS.removeItem(ME_KEY);
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
  try { LS.setItem('nurio.transport', 'http'); } catch { }
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
  if (S.mode === 'local') return localHubSend(obj);
  if (S.mode === 'p2p') return p2pSend(obj);
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
  updateModeBadge();
  const r = roomName(S.active);
  const parts = [];
  parts.push(S.mode === 'p2p' ? 'P2P · ' + (S.conn === 'on' ? t('p2pConnected') : t('p2pWaitingAnswer'))
    : S.mode === 'local' ? t('staticBadge')
    : S.conn === 'on' ? t('online_') : t('offline'));
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
    if (m.file.missing || m.file.transferring) { img.alt = t(m.file.transferring ? 'fileWait' : 'fileGone'); img.style.opacity = '.45'; img.style.minHeight = '90px'; }
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
    const state = m.file.transferring ? t('fileWait') : m.file.missing ? t('fileGone') : t('download');
    a.innerHTML = `<span class="ico">${fileIcon(m.file.type, m.file.name)}</span>
      <span><b>${esc(m.file.name)}</b><small>${bytes(m.file.size)} · ${state}</small></span>`;
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
function uploadLocal(file) {
  return Promise.resolve({
    id: uid(8), name: file.name || 'file', size: file.size,
    type: file.type || 'application/octet-stream',
    blob: file, local: true,
  });
}

function upload(file, kind) {
  if (S.mode === 'local' || S.mode === 'p2p') return uploadLocal(file);
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
      const meta = {
        id: up.id, name: up.name, size: up.size, type: up.type,
        url: up.local ? '' : up.url,
      };
      if (up.local) { meta.blobUrl = URL.createObjectURL(up.blob); meta.blob = up.blob; }
      sendMessage({ kind, text: '', file: meta });
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
  } catch { toast(t(IS_APK ? 'apkNoMic' : 'micDenied')); return; }
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
      const meta = { id: up.id, name: up.name, size: up.size, type: up.type, url: up.url || '' };
      if (up.local) { meta.blobUrl = URL.createObjectURL(up.blob); meta.blob = up.blob; }
      sendMessage({ kind: 'voice', file: meta });
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
  $('#inName').value = (() => { try { return JSON.parse(LS.getItem(ME_KEY) || 'null')?.name || ''; } catch { return ''; } })();
  buildPicker();
  $('#btnEnter').onclick = () => {
    const name = $('#inName').value.trim();
    if (!name) { $('#inName').focus(); toast(t('nameTaken')); return; }
    chime('out');
    startChat({ name, emoji: draft.emoji, color: draft.color });
  };
  $('#inName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnEnter').click(); });
  $$('#langRow .lang').forEach((b) => b.onclick = () => { LANG = b.dataset.lang; applyLang(); checkServer(); });
  // in no-server mode the invite *is* the page URL (GitHub Pages / CDN / file)
  const inviteUrl = () => {
    const list = (S.server?.addresses || []).map((ip) => `${location.protocol}//${ip}:${location.port || 80}`);
    if (S.mode !== 'server' || !list.length) {
      // share the hosted copy when running from file:// (an APK cannot be shared)
      return IS_APK ? HOSTED_URL : location.href.split('#')[0];
    }
    return list[0] || location.origin;
  };
  const shareInvite = async () => {
    const url = inviteUrl();
    if (navigator.share && S.mode !== 'server') {          // phones: real share sheet
      try { await navigator.share({ title: t('appName'), text: t('tagline'), url }); return; } catch { }
    }
    toast((await copy(url)) ? t('linkCopied') : url, 3000);
  };
  $('#btnCopyInvite').onclick = shareInvite;

  /* sidebar */
  $('#btnOpenSide').onclick = toggleSide;
  $('#btnCloseSide').onclick = closeSide;
  $('#btnSwitch').onclick = logout;
  wireP2P();
  const ROOM_EMOJIS = ['💬', '🏠', '🎮', '⚽', '🎧', '🍕', '📚', '💼', '🚗', '🎉', '❤️', '🔥'];
  let roomEmoji = '💬';
  const paintRoomEmoji = () => {
    const box = $('#roomEmoji');
    box.textContent = '';
    for (const e of ROOM_EMOJIS) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = e;
      if (e === roomEmoji) b.classList.add('on');
      b.onclick = () => { roomEmoji = e; paintRoomEmoji(); };
      box.append(b);
    }
  };
  paintRoomEmoji();
  const closeRoomModal = () => $('#roomModal').classList.add('hidden');
  const createRoomNow = () => {
    const name = $('#roomNameIn').value.trim();
    if (!name) { $('#roomNameIn').focus(); return; }
    send({ t: 'room', name, emoji: roomEmoji });
    toast(t('roomMade'));
    $('#roomNameIn').value = '';
    closeRoomModal();
  };
  $('#btnNewRoom').onclick = () => {
    $('#roomModal').classList.remove('hidden');
    setTimeout(() => $('#roomNameIn').focus(), 50);
  };
  $('#roomClose').onclick = closeRoomModal;
  $('#roomCreate').onclick = createRoomNow;
  $('#roomNameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoomNow(); });
  $('#roomModal').addEventListener('click', (e) => { if (e.target.id === 'roomModal') closeRoomModal(); });

  // connect to a real LAN server (handy from the APK / static hosting)
  $('#connectBtn').onclick = () => {
    let url = $('#connectUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast(t('connectBad'), 3000); return; }
    if (!/:\d+/.test(url)) url = url.replace(/\/$/, '') + ':8080';
    location.href = url;
  };
  $('#btnInvite').onclick = () => $('#btnCopyInvite').click();
  $('#btnExport').onclick = () => downloadTranscript(S.active);
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

  $('#btnAttach').onclick = () => {
    if (IS_APK) { toast(t('apkNoFiles'), 5000); return; }   // no WebChromeClient in the shell
    $('#fileInput').click();
  };
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


/* ══════════════════════════════════════════════════════════════════════════
   بلا سيرفر / NO SERVER — two ways to chat without any backend
   1. local  : every tab of the same browser is a user (BroadcastChannel)
   2. p2p    : two devices on the same network talk directly (WebRTC, no ICE
               server → no internet needed; the handshake code is exchanged by
               any channel: WhatsApp, Bluetooth, copy-paste, …)
   ══════════════════════════════════════════════════════════════════════════ */

const LOCAL_ROOMS_KEY = 'nurio.local.rooms.v1';

/* ─────────────────── shared helpers ─────────────────── */
function myProfile() {
  return { id: S.me.id, name: S.me.name, color: S.me.color, emoji: S.me.emoji };
}

/** build a message exactly like the server would (so the UI can't tell) */
function localMessage(obj) {
  const file = obj.file && obj.file.id ? { ...obj.file } : null;
  return {
    id: obj.id || uid(6),
    room: obj.room || S.active,
    ts: Date.now(),
    from: myProfile(),
    kind: obj.kind || 'text',
    text: (obj.text || '').slice(0, 4000),
    file,
    replyTo: obj.replyTo && obj.replyTo.text ? obj.replyTo : null,
  };
}

/** attachments travel as blobs — each side makes its own object URL */
function stripBlob(msg) {
  if (!msg.file) return msg;
  const { blob, blobUrl, ...file } = msg.file;
  return { ...msg, file: { ...file, transferring: !!blob } };
}

function updateModeBadge() {
  const el = $('#modeBadge');
  if (!el) return;
  if (S.mode === 'server') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = S.mode === 'p2p' ? 'P2P' : t('staticBadge');
  el.title = S.mode === 'p2p' ? t('p2pConnected') : t('staticBody');
}

/* ─────────────────── 1) local hub: one browser, many tabs ─────────────────── */
function localRooms() {
  let saved = [];
  try { saved = JSON.parse(LS.getItem(LOCAL_ROOMS_KEY) || '[]'); } catch { }
  const base = [
    { id: 'general', name: LANG === 'ar' ? 'العامة' : 'General', kind: 'group', emoji: '💬', createdAt: 0 },
    { id: 'help', name: LANG === 'ar' ? 'المساعدة' : 'Help', kind: 'group', emoji: '🆘', createdAt: 0 },
  ];
  const out = [...base];
  for (const r of saved) if (!out.some((x) => x.id === r.id)) out.push(r);
  const tabs = S.localPeers.size + 1;
  for (const r of out) r.online = tabs;
  return out;
}

function addLocalRoom(room) {
  let saved = [];
  try { saved = JSON.parse(LS.getItem(LOCAL_ROOMS_KEY) || '[]'); } catch { }
  if (!saved.some((r) => r.id === room.id)) { saved.push(room); LS.setItem(LOCAL_ROOMS_KEY, JSON.stringify(saved)); }
  if (!S.rooms.some((r) => r.id === room.id)) S.rooms.push(room);
  renderRooms();
}

function localPeers() {
  return [myProfile(), ...[...S.localPeers.values()].map((p) => p.profile)]
    .map((p) => ({ ...p, devices: 1, joinedAt: 0 }));
}

function pushLocalPeers() {
  if (S.mode !== 'local') return;
  S.peers = localPeers();
  renderPeople();
}

let localHubTimer = null;

function startLocalHub() {
  try {
    S.localBC = new BroadcastChannel('nurio-local-hub');
  } catch {
    toast(t('p2pFailed'));
    return;
  }
  S.localBC.onmessage = (e) => localHubReceive(e.data);
  const announce = () => S.localBC.postMessage({ k: 'hello', from: S.tabId, profile: myProfile() });
  announce();
  clearInterval(localHubTimer);
  localHubTimer = setInterval(() => {
    announce();
    let changed = false;
    for (const [id, p] of S.localPeers) if (Date.now() - p.seen > 11000) { S.localPeers.delete(id); changed = true; }
    if (changed) pushLocalPeers();
  }, 3500);

  setConn('on');
  S.ready = true;
  updateModeBadge();
  const history = { general: S.msgs.general || [] };
  for (const r of S.rooms || []) if (S.msgs[r.id]) history[r.id] = S.msgs[r.id];
  handle({
    t: 'welcome', you: myProfile(),
    server: { name: LANG === 'ar' ? 'بلا سيرفر (محلي)' : 'No server (local)', version: 'local' },
    rooms: localRooms(), dms: S.dms, peers: localPeers(), history,
  });
  send({ t: 'open', room: S.active });
  toast(t('localMode'), 5000);
  banner(t('staticBody'));
}

function localHubReceive(d) {
  if (!d || d.from === S.tabId) return;
  switch (d.k) {
    case 'hello': {
      S.localPeers.set(d.from, { profile: d.profile, seen: Date.now() });
      pushLocalPeers();
      break;
    }
    case 'msg': {
      const msg = d.msg;
      if (d.blob && msg.file) msg.file.blobUrl = URL.createObjectURL(d.blob);
      handle({ t: 'msg', msg: { ...msg, pending: false } });
      break;
    }
    case 'typing': handle({ t: 'typing', room: d.room, on: d.on, from: d.who }); break;
    case 'delete': handle({ t: 'delete', room: d.room, id: d.id }); break;
    case 'room': addLocalRoom(d.room); break;
    case 'dm': {
      if (!(d.members || []).includes(S.me.id)) break;
      if (!S.dms.some((x) => x.id === d.room)) S.dms.unshift({ id: d.room, peer: d.peer, last: null });
      handle({ t: 'history', room: d.room, messages: S.msgs[d.room] || [] });
      renderDms();
      break;
    }
  }
}

function localHubSend(obj) {
  const bc = S.localBC;
  if (!bc) return false;
  switch (obj.t) {
    case 'hello':
      bc.postMessage({ k: 'hello', from: S.tabId, profile: myProfile() });
      return true;
    case 'msg': {
      const msg = localMessage(obj);
      handle({ t: 'msg', msg });                                   // our own copy (confirms ✓)
      bc.postMessage({ k: 'msg', from: S.tabId, msg: stripBlob(msg), blob: obj.file?.blob || null });
      return true;
    }
    case 'typing':
      bc.postMessage({ k: 'typing', from: S.tabId, room: obj.room, on: !!obj.on, who: { id: S.me.id, name: S.me.name } });
      return true;
    case 'open':
      handle({ t: 'history', room: obj.room, messages: S.msgs[obj.room] || [] });
      return true;
    case 'delete':
      S.msgs[obj.room] = (S.msgs[obj.room] || []).filter((x) => x.id !== obj.id);
      $$(`#messages [data-id="${obj.id}"]`).forEach((el) => el.remove());
      saveCache();
      bc.postMessage({ k: 'delete', from: S.tabId, room: obj.room, id: obj.id });
      return true;
    case 'room': {
      const room = {
        id: 'r-' + obj.name.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').slice(0, 24) + '-' + uid(2),
        name: obj.name, kind: 'group', emoji: obj.emoji || '💬', createdAt: Date.now(),
      };
      addLocalRoom(room);
      const sys = { id: uid(6), room: room.id, kind: 'system', ts: Date.now(), text: `${t('roomMade')} «${room.name}»` };
      handle({ t: 'msg', msg: sys });
      bc.postMessage({ k: 'room', from: S.tabId, room });
      bc.postMessage({ k: 'msg', from: S.tabId, msg: sys, blob: null });
      return true;
    }
    case 'dm': {
      const peer = obj.peer || {};
      const room = { id: 'dm:' + [S.me.id, peer.id].sort().join('|'), kind: 'dm', name: peer.name, emoji: peer.emoji };
      if (!S.dms.some((x) => x.id === room.id)) S.dms.unshift({ id: room.id, peer: { ...peer, online: true }, last: null });
      if (!S.msgs[room.id]) S.msgs[room.id] = [];
      renderDms();
      openRoom(room.id);
      bc.postMessage({ k: 'dm', from: S.tabId, room: room.id, members: [S.me.id, peer.id], peer: myProfile() });
      return true;
    }
    case 'rooms':
      handle({ t: 'rooms', rooms: localRooms() });
      return true;
  }
  return true;
}

/* ─────────────────── 2) p2p: two devices, one direct link ─────────────────── */
const RTC_CFG = { iceServers: [] };        // LAN only — nothing to reach on the internet

function packCode(type, sdp) { return btoa(JSON.stringify({ v: 1, t: type, s: sdp })); }
function unpackCode(code) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!clean) throw new Error('empty');
  const obj = JSON.parse(atob(clean));
  if (!obj || !obj.s) throw new Error('bad');
  return obj;
}

function p2pStatus(text, cls = '') {
  const el = $('#p2pStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'p2p-status ' + cls;
}

function iceComplete(pc, ms = 4000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
    const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function newPeerConnection() {
  const pc = new RTCPeerConnection(RTC_CFG);
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected' && S.mode !== 'p2p') p2pStatus(t('p2pConnecting'));
    if (st === 'failed') p2pStatus(t('p2pFailed'), 'err');
  };
  return pc;
}

async function p2pCreate() {
  p2pStatus(t('p2pWorking'));
  const pc = newPeerConnection();
  S.pc = pc;
  wireChannel(pc.createDataChannel('nurio', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await iceComplete(pc);
  return packCode('offer', pc.localDescription.sdp);
}

async function p2pJoin(code) {
  p2pStatus(t('p2pWorking'));
  const { t: type, s: sdp } = unpackCode(code);
  const pc = newPeerConnection();
  S.pc = pc;
  pc.ondatachannel = (e) => wireChannel(e.channel);
  await pc.setRemoteDescription({ type, sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await iceComplete(pc);
  return packCode('answer', pc.localDescription.sdp);
}

async function p2pAccept(code) {
  const { s: sdp } = unpackCode(code);
  if (!S.pc) throw new Error('no pc');
  await S.pc.setRemoteDescription({ type: 'answer', sdp });
  p2pStatus(t('p2pConnecting'));
}

function wireChannel(dc) {
  S.dc = dc;
  dc.binaryType = 'arraybuffer';
  dc.onopen = () => {
    p2pStatus(t('p2pConnecting'));
    dc.send(JSON.stringify({ t: 'hello', ...myProfile() }));
  };
  dc.onclose = () => {
    if (S.mode !== 'p2p') return;
    setConn('off');
    banner(t('offline'), true);
    p2pStatus(t('p2pFailed'), 'err');
  };
  dc.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return p2pChunk(ev.data);
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    p2pHandle(m);
  };
}

function p2pHandle(m) {
  switch (m.t) {
    case 'hello': {
      S.peer = m;
      S.mode = 'p2p';
      S.p2pRoom = 'dm:' + [S.me.id, m.id].sort().join('|');
      S.peers = [
        { ...myProfile(), devices: 1, joinedAt: 0 },
        { ...m, devices: 1, joinedAt: 1 },
      ];
      S.dms = [{ id: S.p2pRoom, peer: { id: m.id, name: m.name, color: m.color, emoji: m.emoji, online: true } }];
      S.rooms = [];
      setConn('on');
      updateModeBadge();
      p2pStatus(t('p2pConnected'), 'on');
      $('#p2pModal').classList.add('hidden');
      banner(null);
      renderAll();
      openRoom(S.p2pRoom);
      toast(t('p2pConnected'));
      break;
    }
    case 'msg': {
      const msg = m.msg;
      if (msg?.file?.transferring) msg.file.missing = true;   // until the transfer lands
      handle({ t: 'msg', msg: { ...msg, pending: false } });
      if (S.active === msg.room) renderMessages();
      break;
    }
    case 'history': {
      mergeHistory(m.room, m.messages || []);
      if (m.room === S.active) renderMessages();
      break;
    }
    case 'typing': handle({ t: 'typing', room: m.room, on: m.on, from: m.from }); break;
    case 'delete': handle({ t: 'delete', room: m.room, id: m.id }); break;
    case 'open': p2pSend({ t: 'history', room: m.room, messages: S.msgs[m.room] || [] }); break;
    case 'f-begin': S.recv = { id: m.id, name: m.name, type: m.type, size: m.size, chunks: [], got: 0 }; break;
    case 'f-end': p2pFinishTransfer(m.id); break;
  }
}

async function transferFile(msg) {
  const dc = S.dc;
  const blob = msg.file.blob;
  dc.send(JSON.stringify({ t: 'f-begin', id: msg.id, name: msg.file.name, type: msg.file.type, size: msg.file.size }));
  const buf = await blob.arrayBuffer();
  const CH = 16 * 1024;
  for (let off = 0; off < buf.byteLength; off += CH) {
    while (dc.bufferedAmount > 512 * 1024) await new Promise((r) => setTimeout(r, 20));
    if (dc.readyState !== 'open') return;
    dc.send(buf.slice(off, off + CH));
  }
  dc.send(JSON.stringify({ t: 'f-end', id: msg.id }));
}

function p2pChunk(data) {
  if (!S.recv) return;
  S.recv.chunks.push(data);
  S.recv.got += data.byteLength || 0;
}

function p2pFinishTransfer(id) {
  const recv = S.recv;
  S.recv = null;
  if (!recv) return;
  const blob = new Blob(recv.chunks, { type: recv.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  for (const list of Object.values(S.msgs)) {
    const msg = list.find((x) => x.id === id);
    if (msg && msg.file) {
      msg.file.blobUrl = url;
      msg.file.transferring = false;
      msg.file.missing = false;
      break;
    }
  }
  if (S.active) renderMessages();
}

function p2pSend(obj) {
  if (!S.dc || S.dc.readyState !== 'open') return false;
  if (obj.t === 'msg') {
    const msg = localMessage(obj);
    handle({ t: 'msg', msg });                       // echo locally, exactly like the server
    S.dc.send(JSON.stringify({ t: 'msg', msg: stripBlob(msg) }));
    if (msg.file?.blob) transferFile(msg).catch(() => { });
    return true;
  }
  S.dc.send(JSON.stringify(obj));
  return true;
}

/* ─────────────────── transcript export without a server ─────────────────── */
function downloadTranscript(room) {
  const list = S.msgs[room] || [];
  const txt = list.map((m) => {
    const d = new Date(m.ts).toLocaleString(LOCALES[LANG]);
    if (m.kind === 'system') return `— ${m.text} (${d})`;
    const body = m.file ? `${m.text ? m.text + ' ' : ''}[${m.file.name} ${bytes(m.file.size)}]` : m.text;
    return `[${d}] ${m.from?.name || '?'}: ${body}`;
  }).join('\n');
  const blob = new Blob(['\uFEFF' + txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chat-${String(room).replace(/[^\w\u0600-\u06ff-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ─────────────────── modal wiring ─────────────────── */
function wireP2P() {
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
  $('#btnP2P').onclick = () => {
    if (!S.me) { toast(t('p2pNeedName')); return; }
    $('#p2pStatus').textContent = S.mode === 'local' ? t('p2pLocalHint') : '';
    $('#p2pModal').classList.remove('hidden');
    p2pStatus(S.mode === 'local' ? t('p2pLocalHint') : '');
  };
  $('#p2pClose').onclick = () => $('#p2pModal').classList.add('hidden');

  $('#p2pCreateBtn').onclick = async () => {
    try {
      const code = await p2pCreate();
      $('#p2pOffer').value = code;
      show('#p2pOffer', true); show('#p2pCopyOffer', true);
      show('#p2pAnswerIn', true); show('#p2pAcceptBtn', true);
      p2pStatus(t('p2pWaiting'));
    } catch (err) { p2pStatus(t('p2pFailed') + ' ' + err.message, 'err'); }
  };
  $('#p2pCopyOffer').onclick = async () => toast((await copy($('#p2pOffer').value)) ? t('copied') : t('noCopy'));
  $('#p2pAcceptBtn').onclick = async () => {
    p2pStatus(t('p2pConnecting'));
    try { await p2pAccept($('#p2pAnswerIn').value); }
    catch (err) { p2pStatus(t('p2pBadCode') + ' ' + err.message, 'err'); }
  };

  $('#p2pJoinBtn').onclick = async () => {
    try {
      const code = await p2pJoin($('#p2pOfferIn').value);
      $('#p2pReply').value = code;
      show('#p2pReply', true); show('#p2pCopyReply', true);
      p2pStatus(t('p2pWaiting'));
    } catch (err) { p2pStatus(t('p2pBadCode') + ' ' + err.message, 'err'); }
  };
  $('#p2pCopyReply').onclick = async () => toast((await copy($('#p2pReply').value)) ? t('copied') : t('noCopy'));
}

/* ─────────────────────────────── debug hook ───────────────────────────────
   Handy from the console: __neurio.S.active, __neurio.S.queue, __neurio.say(…) */
window.__neurio = { S, send, say: (text) => sendMessage({ text }), version: 1 };

/* ─────────────────────────────── boot ─────────────────────────────── */
async function boot() {
  wire();
  // APK / WebView (file://) → explain what works offline in the app
  if (location.protocol === 'file:') {
    const hint = document.querySelector('.hint');
    if (hint) hint.insertAdjacentHTML('afterend', `<p class="hint">${t('apkHint')}</p>`);
  }
  applyLang();
  buildPicker();
  // decide the deployment mode before resuming a session: with no backend every
  // tab must start as its own user (otherwise tab #2 would be a clone of tab #1)
  const probe = await Promise.race([
    checkServer(),
    new Promise((r) => setTimeout(() => r(undefined), 2500)),
  ]);
  const hasServer = probe === true;
  setInterval(checkServer, 20000);

  // returning user? (session first so several tabs = several users)
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('nurio.me.session') || 'null'); } catch { }
  if (!saved && hasServer && !wantOffline) { try { saved = JSON.parse(LS.getItem(ME_KEY) || 'null'); } catch { } }
  if (!hasServer) {
    $('#staticNote').classList.remove('hidden');
    $('#connectBox').classList.remove('hidden');
  }
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
