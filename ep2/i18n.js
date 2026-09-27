// ============================================================
// ep2/i18n.js — bilingual text system (العربية / English)
// S(en, ar) picks by current language; dict holds menu strings.
// ============================================================

let LANG = 'ar';
export const setLang = (l) => { LANG = l === 'en' ? 'en' : 'ar'; };
export const getLang = () => LANG;
export const isRTL = () => LANG === 'ar';

// story/dialogue helper: returns the string for the active language
export function S(en, ar) { return LANG === 'ar' ? (ar ?? en) : en; }

// static menu / UI strings
const DICT = {
  // main menu
  title: { en: 'LAST CALL', ar: 'آخر نداء' },
  subtitle: { en: "starview: episode 2 — owl's nest diner, route 9", ar: 'ستارفيو: الحلقة الثانية — مقهى عش البومة، الطريق 9' },
  new_shift: { en: 'NEW SHIFT', ar: 'وردية جديدة' },
  continue: { en: 'CONTINUE', ar: 'متابعة' },
  chapters: { en: 'CHAPTERS', ar: 'الفصول' },
  settings: { en: 'SETTINGS', ar: 'الإعدادات' },
  help: { en: 'HOW TO PLAY', ar: 'كيف تلعب' },
  credits: { en: 'CREDITS', ar: 'الاعتمادات' },
  back: { en: 'BACK', ar: 'رجوع' },
  resume: { en: 'RESUME', ar: 'متابعة' },
  restart: { en: 'RESTART CHECKPOINT', ar: 'إعادة نقطة الحفظ' },
  quit: { en: 'QUIT TO MENU', ar: 'العودة للقائمة' },
  paused: { en: 'PAUSED', ar: 'توقف' },
  // settings
  master_vol: { en: 'Master volume', ar: 'مستوى الصوت' },
  mouse_sens: { en: 'Mouse sensitivity', ar: 'حساسية الفأرة' },
  invert_y: { en: 'Invert Y', ar: 'عكس عمودي Y' },
  fov: { en: 'Field of view', ar: 'مجال الرؤية' },
  grain: { en: 'Film grain', ar: 'تموجات الفيلم' },
  brightness: { en: 'Brightness', ar: 'السطوع' },
  subtitles_s: { en: 'Subtitles', ar: 'الترجمة النصية' },
  quality: { en: 'Graphics quality', ar: 'جودة الرسومات' },
  language: { en: 'Language / اللغة', ar: 'اللغة / Language' },
  on: { en: 'ON', ar: 'مفعّل' },
  off: { en: 'OFF', ar: 'معطّل' },
  // quality names
  q0: { en: 'VERY LOW', ar: 'منخفضة جداً' },
  q1: { en: 'LOW', ar: 'منخفضة' },
  q2: { en: 'MEDIUM', ar: 'متوسطة' },
  q3: { en: 'HIGH', ar: 'عالية' },
  q4: { en: 'VERY HIGH', ar: 'عالية جداً' },
  q5: { en: 'ULTRA', ar: 'فائقة' },
  q6: { en: 'EXTREME', ar: 'قصوى' },
  q7: { en: 'MAX', ar: 'قصوى+' },
  q8: { en: 'SUPER MAX', ar: 'أقصى ما يمكن' },
  q9: { en: '4K', ar: '4K' },
  // hud
  objective_tag: { en: 'OBJECTIVE', ar: 'المهمة' },
  hint_press: { en: 'click to capture mouse', ar: 'انقر للتحكم بالفأرة' },
  leave_hide: { en: 'Leave the hiding spot', ar: 'اخرج من المخبأ' },
  you_died: { en: "YOU DIDN'T MAKE IT", ar: 'لم تصمد الليلة' },
  retry: { en: 'TRY AGAIN', ar: 'حاول مجدداً' },
  main_menu: { en: 'MAIN MENU', ar: 'القائمة الرئيسية' },
  // phone
  messages: { en: 'Messages', ar: 'الرسائل' },
  notes: { en: 'Notes', ar: 'المهام' },
  light: { en: 'Light', ar: 'المصباح' },
  camera_app: { en: 'Camera', ar: 'الكاميرا' },
  camera_no: { en: 'Snap a photo', ar: 'التقط صورة' },
  battery: { en: 'Battery', ar: 'البطارية' },
  no_service: { en: 'NO SERVICE', ar: 'لا شبكة' },
  write_reply: { en: 'Reply', ar: 'رد' },
  // credits / help
  credits_body: {
    en: 'an original episode made of procedural code and canvas paint.\nevery texture, every sound, every letter rendered live.\nnames, places and events are fiction.',
    ar: 'حلقة أصلية مبنية بالكود والرسم على الكنفس.\nكل نسيج، كل صوت، كل حرف يُرسم حياً.\nالأسماء والأماكن والأحداث من نسج الخيال.',
  },
  help_move: { en: 'Move', ar: 'التحرك' },
  help_look: { en: 'Look', ar: 'النظر' },
  help_run: { en: 'Run (makes noise)', ar: 'الجري (يصدر ضجيجاً)' },
  help_crouch: { en: 'Crouch (quiet)', ar: 'الانخفاض (هادئ)' },
  help_interact: { en: 'Interact', ar: 'تفاعل' },
  help_throw: { en: 'Throw held object', ar: 'ارمِ الشيء بيدك' },
  help_phone: { en: 'Smartphone', ar: 'الهاتف' },
  help_light: { en: 'Phone light', ar: 'مصباح الهاتف' },
  help_choice: { en: 'Dialogue choice', ar: 'اختيار الرد' },
  help_pause: { en: 'Pause', ar: 'توقف' },
  help_tip: {
    en: 'sound is your guide. they hear running. they wait outside light. save batteries.',
    ar: 'الصوت دليلك. سيسمع الجري. سينتظر خارج الضوء. وفّر بطارية هاتفك.',
  },
  chapter_done: { en: '✓ shift completed — thank you for surviving', ar: '✓ أنهيت الوردية — شكراً للنجاة' },
};
export function M(id) { const d = DICT[id]; return d ? S(d.en, d.ar) : id; }

// apply static text + direction to the DOM (menus, apps, hints)
export function applyDOM() {
  const map = {
    'menu-title': 'title', 'menu-sub': 'subtitle', 'btn-new': 'new_shift', 'btn-continue': 'continue',
    'btn-chapters': 'chapters', 'btn-settings': 'settings', 'btn-help': 'help', 'btn-credits': 'credits',
    'btn-set-back': 'back', 'btn-help-back': 'back', 'btn-ch-back': 'back', 'btn-cr-back': 'back',
    'btn-resume': 'resume', 'btn-restart': 'restart', 'btn-quit': 'quit', 'btn-retry': 'retry',
    'btn-dead-menu': 'main_menu', 'dead-title': 'you_died',
    'pause-title': 'paused',
    'lb-vol': 'master_vol', 'lb-sens': 'mouse_sens', 'lb-inv': 'invert_y', 'lb-fov': 'fov',
    'lb-grain': 'grain', 'lb-bright': 'brightness', 'lb-subs': 'subtitles_s',
    'lb-quality': 'quality', 'lb-lang': 'language',
    'objective-tag': 'objective_tag', 'lock-hint': 'hint_press',
  };
  for (const [elId, key] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el) el.textContent = M(key);
  }
  for (const app of document.querySelectorAll('.ph-app-name')) {
    const t = app.textContent.trim().toLowerCase();
    if (t.includes('message') || t.includes('رسائل')) app.textContent = M('messages');
    else if (t.includes('note') || t.includes('مهام')) app.textContent = M('notes');
    else if (t.includes('light') || t.includes('مصباح')) app.textContent = M('light');
    else if (t.includes('cam') || t.includes('كاميرا')) app.textContent = M('camera_app');
  }
  const msg = document.getElementById('ph-cam-msg');
  if (msg) msg.textContent = M('camera_no');
  document.documentElement.lang = LANG;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  document.body.classList.toggle('lang-ar', isRTL());
}
