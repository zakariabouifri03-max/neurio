const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  video:
    "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M3 8h18 M8 3l4 5 M15 3l4 5 M10 12l5 3-5 3z",
  spark:
    "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z M20 2v4 M18 4h4",
  calendar:
    "M5 5h14a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a2 2 0 0 1 2-2 M7 3v4 M17 3v4 M3 11h18 M7 15h2 M13 15h2 M7 18h2",
  target: "M21 12a9 9 0 1 1-9-9 M17 12a5 5 0 1 1-5-5 M12 12l9-9 M16 3h5v5",
  chart: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  users:
    "M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 4a3 3 0 0 1 0 6 M21 14a5 5 0 0 1 2 4 M5 4a3 3 0 0 0 0 6 M3 14a5 5 0 0 0-2 4",
  tools:
    "m14 4 6 6 M13 5l-8 8 6 6 8-8 M3 21l4-4 M16 2l6 6 M2 5l3-3 M4 3l5 5 M16 16l5 5",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17h.01",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  up: "m7 14 5-5 5 5 M12 9v11 M5 4h14",
  trend: "m3 17 6-6 4 4 8-11 M15 4h6v6",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3a20 20 0 0 1 0 18 20 20 0 0 1 0-18",
  plus: "M12 5v14 M5 12h14",
  instagram:
    "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17.5 6.5h.01",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  heart: "M20 5c-3-3-7-1-8 2-1-3-5-5-8-2s0 8 8 15c8-7 11-12 8-15z",
  check: "m5 12 4 4L19 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  story:
    "M8 3a9 9 0 0 1 12 14 M16 21A9 9 0 0 1 4 7 M4 3h.01 M3 19h.01 M21 21h.01 M10 8l6 4-6 4z",
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3 1-6a8 8 0 1 1 18-5 M7 10h10 M7 14h6",
  crown: "m3 6 4 6 5-8 5 8 4-6-2 13H5z",
  logout: "M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5",
  copy: "M9 8h11v13H9z M15 8V3H3v13h6",
  send: "m3 3 18 9-18 9 4-9z M7 12h14",
  light: "M9 18h6 M10 21h4 M8 15a7 7 0 1 1 8 0l-1 3H9z",
  flag: "M5 22V3 M5 3c5-4 8 4 14 0v10c-6 4-9-4-14 0",
  image: "M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M16 7h.01",
  hash: "M9 3 7 21 M17 3l-2 18 M3 9h18 M2 15h18",
  text: "M4 5h16 M12 5v15 M8 20h8",
  link: "m10 13 4-4 M8 15l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0 M12 17a4 4 0 0 0 6 0l5-5a4 4 0 0 0-5-5l-2 2",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const logo = `<svg class="brand-symbol" viewBox="0 0 40 40" aria-hidden="true"><path fill="currentColor" d="m18 0 7 2-2 11 9-7 5 6-10 7 12 2-2 8-12-4 6 11-7 4-5-12-4 11-8-3 5-11-11 4-2-8 12-2L3 11l5-6 9 8z"/></svg>`;
const t = (en, ar) => (state.lang === "ar" ? ar : en);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const KEY = "neurio-workspace-v1";
const defaults = {
  lang: "en",
  profile: {
    name: "Zakaria",
    handle: "zakaria.creates",
    niche: "Lifestyle & creativity",
    bio: "Creating a life worth sharing.\nLifestyle • little adventures • creative moments\nFollow along for a little everyday inspiration.",
    followers: 24853,
  },
  tasks: [
    {
      id: "t1",
      title: "Post your morning routine reel",
      type: "Reel",
      time: "09:00",
      date: "2026-10-09",
      done: true,
    },
    {
      id: "t2",
      title: "Share a behind-the-scenes story",
      type: "Story",
      time: "13:00",
      date: "2026-10-09",
      done: false,
    },
    {
      id: "t3",
      title: "Connect with your community",
      type: "Engagement",
      time: "18:30",
      date: "2026-10-09",
      done: false,
    },
  ],
  goals: [
    {
      id: "g1",
      title: "Your first 100K followers",
      target: 100000,
      current: 24853,
      unit: "followers",
      done: false,
    },
    {
      id: "g2",
      title: "Build a consistent posting habit",
      target: 30,
      current: 12,
      unit: "days",
      done: false,
    },
    {
      id: "g3",
      title: "The one million milestone",
      target: 1000000,
      current: 24853,
      unit: "followers",
      done: false,
    },
    {
      id: "g4",
      title: "Dream big. Reach 10 million.",
      target: 10000000,
      current: 24853,
      unit: "followers",
      done: false,
    },
  ],
  content: [],
  messages: [],
};
let state;
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  state =
    saved &&
    Array.isArray(saved.tasks) &&
    Array.isArray(saved.goals) &&
    Array.isArray(saved.content) &&
    Array.isArray(saved.messages)
      ? {
          ...structuredClone(defaults),
          ...saved,
          profile: { ...defaults.profile, ...saved.profile },
        }
      : structuredClone(defaults);
} catch {
  state = structuredClone(defaults);
}
let route = "overview",
  period = "7d",
  filter = "All content",
  query = "",
  plannerDay = "2026-10-09",
  deferredInstall = null,
  modalFocus = null,
  previewURL = null,
  toastTimer;
const sampleContent = [
  {
    id: "s1",
    title: "Slow mornings, better days.",
    image: "assets/creator-desk.jpg",
    views: 18200,
    likes: 1240,
    comments: 86,
    score: 92,
    duration: "0:28",
    date: "Oct 8, 2026",
    type: "Reel",
    sample: true,
    advice:
      "The opening shot creates a clear, calm mood. Try adding the payoff in the first two seconds: “The 10-minute reset that changed my mornings.” End with one specific question to invite replies.",
  },
  {
    id: "s2",
    title: "A little escape to Marrakech.",
    image: "assets/marrakech.jpg",
    views: 12400,
    likes: 986,
    comments: 64,
    score: 86,
    duration: "0:34",
    date: "Oct 6, 2026",
    type: "Reel",
    sample: true,
    advice:
      "A strong sense of place makes this concept memorable. Introduce the location immediately, pair wide shots with small details, and add practical tips people can save.",
  },
  {
    id: "s3",
    title: "Offline is the new luxury.",
    image: "assets/mountain.jpg",
    views: 24800,
    likes: 1820,
    comments: 112,
    score: 95,
    duration: "0:21",
    date: "Oct 4, 2026",
    type: "Reel",
    sample: true,
    advice:
      "A clear emotional story gives this concept a strong foundation. Open with the view, then show how you got there. Keep captions readable and invite viewers to share their favorite escape.",
  },
];
const allContent = () => [...state.content, ...sampleContent];
const compact = (n) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const num = (n) => Intl.NumberFormat("en").format(n);
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast(
      t(
        "Storage is full. Export your workspace before leaving.",
        "التخزين عامر. صدّر البيانات ديالك قبل ما تخرج.",
      ),
    );
  }
}
function toast(msg) {
  const el = document.querySelector("#toast");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
}
const navItems = [
  ["overview", "grid", "Overview", "نظرة عامة"],
  ["content", "video", "Content library", "مكتبة المحتوى"],
  ["coach", "spark", "Your AI coach", "الـcoach ديالك"],
  ["planner", "calendar", "Content planner", "برنامج النشر"],
  ["goals", "target", "Growth goals", "أهداف النمو"],
  ["insights", "chart", "Insights", "الإحصائيات"],
  ["profile", "user", "Profile audit", "مراجعة البروفايل"],
  ["tools", "tools", "Creator tools", "أدوات المبدع"],
];
function nav() {
  return navItems
    .map(
      ([id, ic, en, ar]) =>
        `<button data-nav="${id}" class="${route === id ? "active" : ""}" ${route === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${t(en, ar)}</span>${id === "coach" ? '<span class="tag">AI</span>' : ""}${id === "tools" ? `<span class="tag">${t("NEW", "جديد")}</span>` : ""}</button>`,
    )
    .join("");
}
function render() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
  const page = navItems.find((x) => x[0] === route);
  document.title = `${page ? t(page[2], page[3]) : t("Settings", "الإعدادات")} · Neurio`;
  document.querySelector("#app").innerHTML =
    `<div class="mobile-overlay" data-action="close-menu"></div><aside class="sidebar" aria-label="${t("Main navigation", "القائمة الرئيسية")}"><a class="brand" href="#overview" style="text-decoration:none">${logo}neurio<span style="color:#c8ed83">.</span></a><button class="workspace" data-action="workspace"><span class="workspace-icon">${icon("instagram")}</span><span><strong>${t("My workspace", "المساحة ديالي")}</strong><small>${t("Creator account", "حساب مبدع")}</small></span>${icon("down", "chev")}</button><p class="nav-label">${t("Workspace", "المساحة ديالك")}</p><nav class="nav">${nav()}</nav><div class="nav-sep"></div><nav class="nav"><button data-nav="settings" class="${route === "settings" ? "active" : ""}">${icon("settings")}${t("Settings", "الإعدادات")}</button><button data-action="help">${icon("help")}${t("Help & getting started", "المساعدة والبداية")}</button></nav><div class="sidebar-bottom"><div class="upgrade"><div class="upgrade-head">${icon("spark")}${t("Your next chapter starts here", "الخطوة الجاية كتبدا هنا")}</div><p>${t("Big dreams. A little more direction.<br>Discover your creator toolkit.", "أحلام كبيرة، وخطة واضحة.<br>اكتشف الأدوات ديالك.")}</p><button data-nav="tools">${t("Explore creator tools", "اكتشف الأدوات")}${icon("arrow")}</button></div><button class="side-profile" data-nav="settings"><img class="avatar" src="assets/mountain.jpg" alt=""><span><strong>${esc(state.profile.name)}</strong><small>${t("Personal workspace", "مساحة شخصية")}</small></span>${icon("settings")}</button></div></aside><nav class="mobile-bottom-nav" aria-label="Quick navigation">${[
      ["overview", "grid", "Home", "الرئيسية"],
      ["content", "video", "Content", "المحتوى"],
      ["coach", "spark", "Coach", "المساعد"],
      ["planner", "calendar", "Planner", "البرنامج"],
      ["goals", "target", "Goals", "الأهداف"],
    ]
      .map(
        ([id, ic, en, ar]) =>
          `<button data-nav="${id}" class="${route === id ? "active" : ""}">${icon(ic)}${t(en, ar)}</button>`,
      )
      .join(
        "",
      )}</nav><div class="main"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu" data-action="menu" aria-label="Open navigation">${icon("menu")}</button><span>${t("Workspace", "المساحة")}</span>${icon("chevron")}<strong>${page ? t(page[2], page[3]) : t("Settings", "الإعدادات")}</strong></div><div class="top-actions"><button data-action="search" class="search-button" aria-label="Search workspace">${icon("search")}</button><button data-action="language" aria-label="Change language">${icon("globe")}<span>${state.lang === "en" ? "العربية" : "English"}</span></button><div class="divider"></div><button class="notification" data-action="notifications" aria-label="Notifications">${icon("bell")}</button><button data-nav="settings" aria-label="Your profile"><img class="avatar" src="assets/mountain.jpg" alt=""></button></div></header><main>${views[route] ? views[route]() : overview()}<footer class="footer"><span>${icon("spark")}${t("A little progress, every single day.", "خطوة صغيرة، كل نهار.")}</span><span><i class="dot"></i>${t("Demo workspace · Your plans are saved on this device", "مساحة تجريبية · الخطط محفوظة فهاد الجهاز")}</span></footer></main></div>`;
}
function heading(title, sub, actions = "", eyebrow = "") {
  return `<div class="page-title"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h1>${title}</h1><p class="subtitle">${sub}</p></div>${actions ? `<div class="title-actions">${actions}</div>` : ""}</div>`;
}
const btn = (label, action, ic = "plus", cls = "") =>
  `<button class="btn ${cls}" data-action="${action}">${icon(ic)}${label}</button>`;
const link = (label, to) =>
  `<button class="btn-text" data-nav="${to}">${label}${icon("arrow")}</button>`;
function heroArt() {
  return `<svg class="hero-art" viewBox="0 0 200 200" fill="none" aria-hidden="true"><circle cx="114" cy="96" r="75" stroke="#cddbb8" stroke-dasharray="3 5"/><ellipse cx="109" cy="101" rx="53" ry="78" transform="rotate(42 109 101)" stroke="#d1ddbe"/><circle cx="114" cy="97" r="50" fill="#dce9c8"/><path d="m70 116 35-34 19 16 38-41" stroke="#a6bd84" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity=".22"/><path d="m65 111 34-34 20 16 34-41" stroke="#6c8650" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="m126 52 29-2 1 30" stroke="#6c8650" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><rect x="129" y="126" width="51" height="31" rx="9" fill="#f7fbed" transform="rotate(-10 129 126)"/><path d="m142 139 5-6 4 2 5-6" stroke="#87a563" stroke-width="2"/><text x="160" y="140" fill="#728a56" font-family="Arial" font-size="9" transform="rotate(-10 160 140)">+24%</text><path d="m46 55 3-9 3 9 9 3-9 3-3 9-3-9-9-3z" fill="#b0c88c"/><circle cx="178" cy="95" r="5" fill="#aec68a"/><circle cx="69" cy="159" r="3" fill="#b9cc9d"/></svg>`;
}
function metrics() {
  return `<section class="metrics" aria-label="Demo performance metrics">${[
    ["users", "Total followers", "المتابعين", "24,853", "12.8%", "2,819"],
    ["eye", "Content reach", "وصول المحتوى", "186.2K", "24.6%", "36.7K"],
    ["heart", "Engagement rate", "نسبة التفاعل", "6.84%", "1.2%", "1.2%"],
    ["video", "Content published", "المنشورات", "24", "4", "4"],
  ]
    .map(
      ([ic, en, ar, v, g, d], i) =>
        `<div class="card metric"><div class="metric-title">${t(en, ar)}<span class="metric-icon">${icon(ic)}</span></div><div class="metric-value"><strong>${v}</strong><span class="pill green">${icon("trend")}${g}</span></div><div class="metric-foot">${icon("trend")}<b>+${d}</b>${t(i === 3 ? "vs. previous month" : "vs. previous 30 days", "مقارنة مع الشهر السابق")}</div></div>`,
    )
    .join("")}</section>`;
}
function chartCard() {
  const is7 = period === "7d";
  const values = is7
    ? ["Oct 3", "Oct 4", "Oct 5", "Oct 6", "Oct 7", "Oct 8", "Oct 9"]
    : ["Sep 10", "Sep 15", "Sep 20", "Sep 25", "Sep 30", "Oct 5", "Oct 9"];
  const line = is7
    ? "M38 110 C72 109 70 82 108 86 S163 110 190 70 S243 74 266 55 S321 92 344 55 S389 77 420 35 S466 53 502 17"
    : "M38 119 C72 114 80 119 108 102 S158 113 190 87 S242 94 266 70 S315 72 344 51 S395 62 420 32 S466 36 502 12";
  return `<section class="card chart-card"><div class="card-heading"><div><h2>${t("Your growth, at a glance", "النمو ديالك فنظرة")}</h2><p class="section-sub">${t("Small steps. Real momentum.", "خطوات صغيرة، وتقدم مستمر.")}</p></div><div class="segmented" aria-label="Chart period"><button data-period="7d" class="${is7 ? "active" : ""}">7 ${t("days", "أيام")}</button><button data-period="30d" class="${!is7 ? "active" : ""}">30 ${t("days", "يوم")}</button></div></div><div class="chart-summary"><strong>${is7 ? "2,819" : "8,452"}</strong><span class="pill green">${icon("trend")}${is7 ? "12.8" : "34.2"}%</span><span>${t("new followers · sample data", "متابع جديد · بيانات تجريبية")}</span></div><div class="chart"><svg viewBox="0 0 530 155" preserveAspectRatio="none" role="img" aria-label="Demo follower growth over ${is7 ? "7" : "30"} days"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7e6bd" stop-opacity=".6"/><stop offset="1" stop-color="#eaf1df" stop-opacity=".04"/></linearGradient></defs>${[20, 53, 86, 119].map((y, i) => `<line x1="38" y1="${y}" x2="512" y2="${y}" stroke="#edf0e8" stroke-dasharray="3 4"/><text x="0" y="${y + 3}">${["25K", "24K", "23K", "22K"][i]}</text>`).join("")}<path d="M38 119 Q75 115 108 109 T190 100 T266 96 T344 85 T420 76 T502 61" stroke="#d5dccb" stroke-width="1.8" stroke-dasharray="4 4" fill="none"/><path d="${line} L502 125 L38 125Z" fill="url(#fill)"/><path d="${line}" stroke="#96b16f" stroke-width="2.3" fill="none"/><circle cx="502" cy="${is7 ? 17 : 12}" r="4" fill="#99b773" stroke="white" stroke-width="2"/>${values.map((v, i) => `<text x="${38 + i * 77.3}" y="149" text-anchor="${i === 0 ? "start" : i === 6 ? "end" : "middle"}">${v}</text>`).join("")}</svg></div><div class="chart-legend"><span><i></i>${t("This period", "هاد الفترة")}</span><span><i></i>${t("Previous period", "الفترة السابقة")}</span></div></section>`;
}
function taskHTML(task) {
  return `<div class="task ${task.done ? "done" : ""}"><button class="check ${task.done ? "checked" : ""}" data-task="${esc(task.id)}" aria-label="${esc(task.title)}" aria-pressed="${task.done}">${task.done ? icon("check") : ""}</button><div class="task-body"><div class="task-title">${esc(task.title)}</div><div class="task-meta"><span class="task-type">${icon(task.type === "Reel" ? "video" : task.type === "Story" ? "story" : "chat")}${esc(task.type)}</span><span>·</span><span>${esc(task.time)}</span>${!task.done && task.type === "Story" ? `<span class="pill lime">${t("Suggested", "مقترح")}</span>` : ""}</div></div></div>`;
}
function planCard() {
  const tasks = state.tasks.filter((x) => x.date === "2026-10-09");
  return `<section class="card plan-card"><div class="card-heading"><h2>${t("Your plan for today", "برنامجك اليوم")}</h2><span class="pill">${icon("calendar")}${t("Fri, Oct 9", "الجمعة، 9 أكتوبر")}</span></div><div class="plan-list">${tasks.slice(0, 3).map(taskHTML).join("") || `<p class="section-sub">${t("A fresh day. Add your first task.", "نهار جديد. زيد أول مهمة.")}</p>`}</div><div class="plan-footer"><span>${tasks.filter((x) => x.done).length}/${tasks.length} ${t("completed", "كملو")}</span>${link(t("View planner", "شوف البرنامج"), "planner")}</div></section>`;
}
function contentCard(c) {
  return `<button class="card content-card" data-content="${esc(c.id)}"><div class="thumbnail"><img src="${esc(c.image || "assets/creator-desk.jpg")}" alt="" loading="lazy"><span class="thumb-type">${icon("video")}</span>${c.score != null ? `<span class="thumb-score">${icon("spark")}${c.score}/100</span>` : ""}<span class="thumb-time">${c.duration || t("Local draft", "مسودة محلية")}</span></div><div class="content-info"><h3>${esc(c.title)}</h3><div class="content-meta"><span>${icon("eye")}${compact(c.views || 0)}</span><span>${icon("heart")}${compact(c.likes || 0)}</span><span>${c.sample ? t("Demo reel", "ريل تجريبي") : t("Your draft", "المسودة ديالك")}</span></div></div></button>`;
}
function journey() {
  const g = state.goals[0] || defaults.goals[0];
  const percent = Math.min(100, (g.current / g.target) * 100);
  return `<section class="card journey-card"><div class="card-heading"><h2>${t("The journey to 1 million", "الطريق للمليون")}</h2><span class="pill green">${icon("flag")}${t("Let’s grow", "ننمو معاً")}</span></div><div class="goal-target"><span class="target-icon">${icon("target")}</span><div><h3>${t("Next stop: 100K", "المحطة الجاية: 100K")}</h3><p>${t("One meaningful connection at a time.", "علاقة حقيقية، خطوة بخطوة.")}</p></div></div><div class="progress-label"><span>${num(g.current)} / ${compact(g.target)} ${t("followers", "متابع")}</span><strong>${percent.toFixed(1)}%</strong></div><div class="progress-track"><span style="width:${percent}%"></span></div><div class="milestones"><span>0</span><span>25K</span><span>50K</span><span>75K</span><span>100K</span></div><p class="journey-note">${icon("light")}${t("Your next chapter is built on what you do today. Keep showing up.", "المرحلة الجاية كتبدا بداكشي اللي كتدير اليوم. استمر.")}</p><button class="btn" data-nav="goals">${t("See my growth roadmap", "شوف خارطة الأهداف")}${icon("arrow")}</button></section>`;
}
function overview() {
  return `<div class="overview">${heading(t(`Let’s make it a good one, ${esc(state.profile.name)} <span class="wave">${icon("spark")}</span>`, `نهار زوين، ${esc(state.profile.name)} <span class="wave">${icon("spark")}</span>`), t("A little clarity. Better content. Your next big milestone.", "خطة أوضح، محتوى أحسن، والهدف الجاي ديالك."), `${btn(t("Last 30 days", "آخر 30 يوم"), "date", "calendar")}${btn(t("Add content", "زيد محتوى"), "upload", "plus", "btn-primary")}`, t("YOUR CREATOR COMPANION", "رفيقك فصناعة المحتوى"))}<div class="hero-grid"><section class="coach-banner"><div class="coach-kicker">${icon("spark")}${t("A LITTLE DIRECTION, A LOT OF POTENTIAL", "توجيه بسيط، إمكانيات كبيرة")}</div><h2>${t("Your next move? Make it count.", "الخطوة الجاية؟ خليها تفرق.")}</h2><p>${t("Your ideas have potential. Let’s turn them into<br>a content plan that feels like you.", "الأفكار ديالك عندها قيمة. نحوّلوها لخطة<br>محتوى كتشبه ليك.")}</p><button class="btn btn-dark" data-nav="coach">${icon("spark")}${t("Meet your growth coach", "تعرف على الـcoach ديالك")}${icon("arrow")}</button>${heroArt()}</section><section class="card profile-card"><div class="card-heading"><h2>${icon("instagram")}${t("Your Instagram", "الإنستغرام ديالك")}</h2><span class="demo-pill">${t("Demo account", "حساب تجريبي")}</span></div><div class="profile-info"><img class="profile-avatar" src="assets/mountain.jpg" alt="Demo profile"><div><h3>@${esc(state.profile.handle)}</h3><p>${esc(state.profile.niche)}</p></div><button class="btn-text" style="margin-inline-start:auto" data-action="connect" aria-label="Instagram connection details">${icon("chevron")}</button></div><div class="profile-score"><span>${t("Profile score", "تقييم تجريبي")}</span><div class="score-bar"><span></span></div><strong>82<span style="color:#b0b7a4"> / 100</span></strong><button class="btn-text" data-nav="profile" aria-label="View profile audit">${icon("arrow")}</button></div></section></div>${metrics()}<div class="dashboard-grid">${chartCard()}${planCard()}</div><div class="dashboard-grid"><section class="recent-section"><div class="card-heading"><h2>${t("Your content, in the spotlight", "المحتوى ديالك تحت الأضواء")}</h2>${link(t("View all content", "شوف المحتوى كامل"), "content")}</div><div class="content-grid">${allContent().slice(0, 3).map(contentCard).join("")}</div></section>${journey()}</div></div>`;
}
function contentPage() {
  const list = allContent().filter(
    (c) =>
      (filter !== "My drafts" || !c.sample) &&
      (filter !== "Top rated" || c.score >= 90) &&
      c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return `<div class="page-content library">${heading(t("Make every post a little better.", "كل منشور، أحسن من اللي قبله."), t("Your ideas, drafts, and content reviews. All in one place.", "الأفكار، المسودات، ومراجعة المحتوى فبلاصة وحدة."), btn(t("Add content", "زيد محتوى"), "upload", "plus", "btn-primary"), t("CONTENT LIBRARY", "مكتبة المحتوى"))}<div class="notice">${icon("help")}<span>${t("Sample reels show how a review could look. Add your own video for a local preview and a transparent, self-assessed content score. No video is uploaded to a server.", "الريلز التجريبية كيبينو شكل المراجعة. زيد فيديو ديالك للمعاينة وتقييم ذاتي واضح. الفيديو ما كيتصيفط حتى لسيرفر.")}</span></div><div class="toolbar"><div class="filter-tabs">${["All content", "My drafts", "Top rated"].map((f, i) => `<button data-filter="${f}" class="${filter === f ? "active" : ""}">${t(f, ["المحتوى كامل", "مسوداتي", "الأعلى تقييماً"][i])}</button>`).join("")}</div><label class="searchbox">${icon("search")}<input id="content-search" aria-label="Search content" placeholder="${t("Search your content…", "قلب فالمحتوى…")}" value="${esc(query)}"></label></div><div class="content-grid" id="library-grid">${list.map(contentCard).join("") || empty(t("A little room for your next idea.", "بلاصة للفكرة الجاية."), t("No content matches this view. Try another filter or add a draft.", "ما كاين حتى محتوى هنا. بدّل الفلتر أو زيد مسودة."))}</div></div>`;
}
function empty(title, sub) {
  return `<div class="empty">${icon("video")}<h3>${title}</h3><p>${sub}</p></div>`;
}
function coachPage() {
  return `<div class="page-content">${heading(t("Big ideas. A clearer direction.", "أفكار كبيرة. اتجاه أوضح."), t("A thoughtful starting point for your next chapter as a creator.", "نقطة بداية مدروسة للمرحلة الجاية ديالك."), "", t("YOUR GROWTH COACH", "الـCOACH ديالك"))}<div class="coach-layout"><section class="card chat-card"><div class="chat-head"><div class="tool-icon">${icon("spark")}</div><div><h3>${t("Your creator companion", "رفيقك فالمحتوى")}</h3><p>${t("Local guided coach · Not connected to an AI model", "مساعد محلي بقواعد · ما مربوطش بنموذج ذكاء اصطناعي")}</p></div></div><div class="messages" id="messages"><div class="bubble">${t(`Hey ${esc(state.profile.name)}! 👋 Let’s make creating feel a little simpler.\n\nI can help you build a posting rhythm, shape a stronger hook, or find your next story idea for ${esc(state.profile.niche.toLowerCase())}. What would you like to work on?`, `أهلاً ${esc(state.profile.name)}! 👋 نخليو صناعة المحتوى أسهل.\n\nنقدر نعاونك ببرنامج النشر، بداية أقوى للفيديو، وأفكار للستوري حسب المجال ديالك. شنو بغيتي نخدمو عليه؟`)}</div>${state.messages.map((m) => `<div class="bubble ${m.role === "user" ? "user" : ""}">${esc(m.text)}</div>`).join("")}</div><form id="chat-form" class="chat-input"><input name="message" required maxlength="500" autocomplete="off" placeholder="${t("What are we working on today?", "شنو نخدمو عليه اليوم؟")}" aria-label="Message your coach"><button type="submit" aria-label="Send message">${icon("send")}</button></form></section><aside><section class="card prompt-card"><div class="eyebrow">${t("A LITTLE INSPIRATION", "شوية ديال الإلهام")}</div><h3>${t("Not sure where to start?", "ما عارفش منين تبدا؟")}</h3>${[
    ["calendar", "Build my posting rhythm", "نظم ليا برنامج النشر"],
    ["story", "What should I share in stories?", "شنو نحط فالستوري؟"],
    ["video", "Help me write a better hook", "عاونّي نكتب بداية أحسن"],
    ["target", "How do I reach my next goal?", "كيفاش نوصل للهدف الجاي؟"],
  ]
    .map(
      ([ic, en, ar]) =>
        `<button class="prompt" data-prompt="${esc(t(en, ar))}">${icon(ic)}${t(en, ar)}${icon("arrow")}</button>`,
    )
    .join(
      "",
    )}</section><div class="notice" style="margin-top:18px">${icon("shield")}<span>${t("Honest growth, always. These are rule-based suggestions, not a live analysis of your Instagram. No tool can promise followers or viral results.", "نمو بصراحة. هادو اقتراحات مبنية على قواعد، ماشي تحليل مباشر لإنستغرام. حتى أداة ما كتضمن المتابعين أو الانتشار.")}</span></div></aside></div></div>`;
}
function coachReply(message) {
  const m = message.toLowerCase(),
    n = state.profile.niche;
  let out;
  if (/stor|ستوري/.test(m))
    out = t(
      `For ${n}, try this three-story sequence:\n\n1. A real behind-the-scenes moment. Show what you’re working on.\n2. Add a poll: “Want the full process or the final result?”\n3. Share one useful takeaway and invite a reply.\n\nStart with 2–3 story frames when you have something meaningful to share. Quality beats filling every hour.`,
      `فمجال ${n}، جرب هاد السلسلة:\n\n1. لقطة من الكواليس ديالك.\n2. تصويت: «بغيتو الطريقة أو النتيجة؟»\n3. نصيحة مفيدة وسؤال باش يجاوبوك.\n\nبدا بـ2 حتى 3 ستوريات إلا كان عندك ما تشارك. الجودة أهم من الكثرة.`,
    );
  else if (/hook|title|بداية|عنوان/.test(m))
    out = t(
      `Try these hooks for ${n}:\n\n• “The one thing I wish I knew before I started…”\n• “Here’s what actually changed when I tried this for a week.”\n• “You don’t need more time. Start with these 10 minutes.”\n\nShow the outcome in the first two seconds, then explain the process. Pick a hook that genuinely matches your video—never promise a result you can’t show.`,
      `جرب هاد البدايات فمجال ${n}:\n\n• «الحاجة اللي تمنيت نعرف قبل ما نبدا…»\n• «ها شنو تبدل ملي جربت هادشي سيمانة.»\n• «ما محتاجش وقت بزاف. بدا بهاد 10 دقايق.»\n\nبيّن النتيجة فالأول، ثم الطريقة. العنوان خاصو يكون صادق مع الفيديو.`,
    );
  else if (/goal|million|grow|هدف|مليون/.test(m))
    out = t(
      "Break the big goal into things you can control:\n\n1. Choose one clear audience and three content themes.\n2. Publish 3–5 thoughtful reels a week for four weeks.\n3. Review saves, shares, and watch time every Sunday.\n4. Repeat the strongest concept with a fresh angle.\n\nTrack consistent actions first. 100K → 1M → 10M are ambitions, not guaranteed outcomes. Add a 30-day consistency goal to your roadmap.",
      "قسّم الهدف الكبير لخطوات كتقدر تتحكم فيها:\n\n1. اختار جمهور واضح و3 مواضيع أساسية.\n2. نشر 3 حتى 5 ريلز فالسيمانة لمدة شهر.\n3. راجع الحفظ والمشاركة ووقت المشاهدة كل أحد.\n4. عاود أقوى فكرة بزاوية جديدة.\n\n100 ألف، مليون و10 مليون طموحات، ماشي نتائج مضمونة. بدا بهدف الاستمرارية لمدة شهر.",
    );
  else if (/post|rhythm|day|نشر|نهار|برنامج/.test(m))
    out = t(
      "Start with a rhythm you can sustain:\n\n• 3–5 reels per week, rather than forcing several every day.\n• 2–3 useful story frames on your active days.\n• 15 minutes replying to thoughtful comments.\n• One weekly review of your real Instagram Insights.\n\nAfter two weeks, adjust using your audience’s actual activity and your available time. There is no universal best time or magic number of posts.",
      "بدا بإيقاع تقدر تستمر فيه:\n\n• 3 حتى 5 ريلز فالسيمانة، ماشي بزاف كل نهار.\n• 2 حتى 3 ستوريات مفيدة فالأيام اللي ناشط فيها.\n• ربع ساعة للرد على التعليقات.\n• مراجعة الإحصائيات الحقيقية كل سيمانة.\n\nبعد سيمانتين، عدل حسب وقتك وتفاعل جمهورك. ما كاين لا وقت سحري لا عدد مضمون.",
    );
  else
    out = t(
      `Let’s turn “${message}” into a useful next step for ${n}.\n\nChoose one specific audience question, answer it in a short reel, and end with an invitation to share an experience. Keep the opening clear and the takeaway practical.\n\nThis local coach uses preset guidance and cannot research or interpret your videos. For a more focused plan, ask about posting rhythm, stories, hooks, or goals.`,
      `نحوّلو «${message}» لخطوة فمجال ${n}.\n\nاختار سؤال محدد عند الجمهور ديالك، جاوب عليه فريل قصير، وسوّلهم على التجربة ديالهم.\n\nهاد المساعد المحلي كيستعمل إرشادات جاهزة، وما كيحللش الفيديوهات أو يقلب فالويب. سولني على النشر، الستوري، العناوين أو الأهداف.`,
    );
  return out;
}
function sendChat(message) {
  const text = message.trim();
  if (!text) return;
  state.messages.push(
    { role: "user", text },
    { role: "assistant", text: coachReply(text) },
  );
  state.messages = state.messages.slice(-40);
  save();
  render();
  document.querySelector("#messages").scrollTop = 100000;
  document.querySelector("#chat-form input").focus();
}
function plannerPage() {
  const monday = new Date(plannerDay + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + i);
    return date;
  });
  const weekLabel =
    week[0].toLocaleDateString(state.lang === "ar" ? "ar-MA" : "en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }) +
    " – " +
    week[6].toLocaleDateString(state.lang === "ar" ? "ar-MA" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  const tasks = state.tasks
    .filter((x) => x.date === plannerDay)
    .sort((a, b) => a.time.localeCompare(b.time));
  return `<div class="page-content">${heading(t("A little intention goes a long way.", "خطة بسيطة كتوصلك بعيد."), t("Make room for your ideas. Build a rhythm that works for you.", "عطي بلاصة للأفكار ديالك. لقى الإيقاع المناسب ليك."), btn(t("Add to planner", "زيد فالبرنامج"), "add-task", "plus", "btn-primary"), t("CONTENT PLANNER", "برنامج المحتوى"))}<div class="notice">${icon("calendar")}${t("Your personal plan, saved on this device. Posts are not automatically published to Instagram. All times use your own local schedule.", "برنامجك الشخصي محفوظ فهاد الجهاز. المنشورات ما كيتنشروش تلقائياً فInstagram. التوقيت حسب البرنامج المحلي ديالك.")}</div><div class="card-heading"><h2>${weekLabel}</h2><button class="btn-text" data-day="2026-10-09">${t("Back to today", "رجع لليوم")}${icon("arrow")}</button></div><div class="weekbar">${[
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
  ]
    .map((day, i) => {
      const date = week[i].toISOString().slice(0, 10);
      return `<button class="day ${plannerDay === date ? "active" : ""}" data-day="${date}">${t(day, ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"][i])}<strong>${week[i].getUTCDate()}</strong>${state.tasks.some((x) => x.date === date) ? '<i class="day-dot"></i>' : '<span style="display:block;height:11px"></span>'}</button>`;
    })
    .join(
      "",
    )}</div><div class="card schedule"><div class="card-heading"><h2>${t("Your daily line-up", "برنامج النهار")} <span style="color:#abb39e;font-weight:400;font-size:11px">· ${tasks.length} ${t("tasks", "مهام")}</span></h2><span class="pill green">${tasks.filter((x) => x.done).length} ${t("completed", "كملو")}</span></div>${tasks.length ? tasks.map((task) => `<div class="schedule-row ${task.done ? "done" : ""}"><div class="schedule-time">${esc(task.time)}</div><div class="tool-icon" style="margin:0">${icon(task.type === "Reel" ? "video" : task.type === "Story" ? "story" : "chat")}</div><div class="task-body"><h3>${esc(task.title)}</h3><p>${esc(task.type)} · ${t("Manual publishing", "نشر يدوي")}</p></div><button class="check ${task.done ? "checked" : ""}" data-task="${esc(task.id)}" aria-pressed="${task.done}" aria-label="Mark ${esc(task.title)} complete">${task.done ? icon("check") : ""}</button><button class="btn-text" data-delete-task="${esc(task.id)}" aria-label="Delete task">${icon("trash")}</button></div>`).join("") : empty(t("A fresh page for your ideas.", "صفحة جديدة للأفكار ديالك."), t("Add a reel, story, or a moment to connect with your community.", "زيد ريل، ستوري، أو وقت للتواصل مع الجمهور."))}</div><div style="margin:20px 0"><label class="field" style="max-width:220px">${t("Jump to another date", "اختار نهار آخر")}<input type="date" id="planner-date" value="${plannerDay}" min="2020-01-01" max="2100-12-31"></label></div></div>`;
}
function goalsPage() {
  return `<div class="page-content">${heading(t("Big dreams. Small, steady steps.", "أحلام كبيرة. خطوات صغيرة وثابتة."), t("From your next milestone to 10 million. Let’s make the journey intentional.", "من الهدف الجاي حتى 10 مليون. نمشيو بخطة واضحة."), btn(t("New goal", "هدف جديد"), "add-goal", "plus", "btn-primary"), t("YOUR GROWTH ROADMAP", "خارطة النمو ديالك"))}<div class="notice">${icon("target")}${t("Progress is entered manually. Follower milestones are ambitions, not promises. Complete a goal when you’ve genuinely reached it—your checkmark will stay saved.", "التقدم كتدخلو يدوياً. أهداف المتابعين طموحات، ماشي وعود. علّم على الهدف ملي تحققو فعلاً، والعلامة كتبقى محفوظة.")}</div><div class="goals-grid">${state.goals
    .map((g) => {
      const p = Math.min(100, (g.current / g.target) * 100);
      return `<section class="card goal-card ${g.done ? "completed" : ""}"><div class="card-heading"><span class="tool-icon" style="margin-bottom:13px">${icon(g.done ? "check" : "target")}</span><span class="pill ${g.done ? "green" : ""}">${g.done ? t("Milestone reached", "هدف تحقق") : t("In progress", "قيد الإنجاز")}</span></div><h3>${esc(g.title)}</h3><div class="goal-number">${num(g.current)} <small>/ ${num(g.target)} ${esc(g.unit)}</small></div><div class="progress-track"><span style="width:${p}%"></span></div><div class="progress-label"><span>${t("Your progress", "التقدم ديالك")}</span><strong>${p.toFixed(1)}%</strong></div><div class="goal-bottom"><label><input type="checkbox" data-goal-done="${esc(g.id)}" ${g.done ? "checked" : ""}>${t("Mark achieved", "علّم أنه تحقق")}</label><button class="btn-text" data-goal-edit="${esc(g.id)}">${t("Update progress", "حدّث التقدم")}${icon("arrow")}</button></div></section>`;
    })
    .join(
      "",
    )}</div><p class="subtitle" style="margin:22px 0">${t("Consistency is the goal you can control. The rest is an experiment worth showing up for.", "الاستمرارية هي الهدف اللي بيدك. الباقي تجربة كتستاهل المحاولة.")}</p></div>`;
}
const toolDefs = [
  [
    "caption",
    "text",
    "Caption writer",
    "كاتب الوصف",
    "Turn your idea into a caption that starts a conversation.",
    "حوّل الفكرة لوصف كيحل النقاش.",
  ],
  [
    "hooks",
    "video",
    "Hook & title lab",
    "مختبر العناوين",
    "Give your next reel an opening worth sticking around for.",
    "بداية كتخلي المشاهد يكمل الفيديو.",
  ],
  [
    "stories",
    "story",
    "Story inspiration",
    "أفكار الستوري",
    "Small moments. More meaningful connections.",
    "لحظات صغيرة، وتواصل حقيقي.",
  ],
  [
    "bio",
    "user",
    "Bio refresh",
    "جدّد البايو",
    "Make your first impression a little more you.",
    "خلي الانطباع الأول يشبه ليك.",
  ],
  [
    "hashtags",
    "hash",
    "Hashtag starter kit",
    "اقتراح هاشتاغات",
    "A focused set of relevant tags. No magic formulas.",
    "هاشتاغات مناسبة، بلا وصفات سحرية.",
  ],
  [
    "inspiration",
    "search",
    "Find your inspiration",
    "اكتشف الإلهام",
    "A research checklist for finding creators in your niche.",
    "طريقة بحث على مبدعين فالمجال ديالك.",
  ],
];
function toolsPage() {
  return `<div class="page-content">${heading(t("A little help for your next big idea.", "شوية مساعدة للفكرة الكبيرة الجاية."), t("Thoughtful tools for every part of your creator journey.", "أدوات لكل مرحلة من الرحلة ديالك."), "", t("THE CREATOR TOOLKIT", "أدوات المبدع"))}<div class="notice">${icon("spark")}${t("These tools create editable starting points from local templates. They do not call an AI service, search Instagram, or predict performance.", "هاد الأدوات كتعطيك مسودات قابلة للتعديل من قوالب محلية. ما كتستعملش خدمة AI، وما كتقلبش فInstagram أو كتتوقع النتائج.")}</div><div class="tools-grid">${toolDefs.map(([id, ic, en, ar, d, da]) => `<button class="card tool-card" data-tool="${id}"><span class="tool-icon">${icon(ic)}</span><h3>${t(en, ar)}</h3><p>${t(d, da)}</p><span class="btn-text">${t("Let’s create", "نبداو نبدعو")}${icon("arrow")}</span></button>`).join("")}</div></div>`;
}
function profilePage() {
  return `<div class="page-content">${heading(t("Make your first impression count.", "خلي الانطباع الأول يفرق."), t("A clear profile helps the right people feel at home.", "بروفايل واضح كيساعد الناس المناسبين يلقاوك."), btn(t("Edit my profile", "عدل البروفايل"), "workspace", "user", "btn-primary"), t("PROFILE AUDIT", "مراجعة البروفايل"))}<div class="notice">${icon("help")}${t("This is a demo profile and a manual review checklist—not an image analysis or a live Instagram audit. No changes here update your Instagram account.", "هاد بروفايل تجريبي ولائحة للمراجعة اليدوية، ماشي تحليل صورة أو حساب مباشر. التعديلات هنا ما كتبدلش حساب Instagram.")}</div><div class="profile-review"><section class="card profile-preview"><img class="profile-avatar" src="assets/mountain.jpg" alt="Demo avatar"><h3>@${esc(state.profile.handle)}</h3><p>${esc(state.profile.bio)}</p><div class="stats-row"><div><strong>24</strong><small>${t("Demo posts", "منشورات تجريبية")}</small></div><div><strong>${compact(state.profile.followers)}</strong><small>${t("Manual followers", "متابعين مدخلين يدوياً")}</small></div><div><strong>318</strong><small>${t("Demo following", "متابَعون تجريبيون")}</small></div></div><button class="btn btn-primary" data-tool="bio">${icon("spark")}${t("Draft a fresh bio", "كتب بايو جديد")}</button></section><section class="card audit-list"><h3>${t("Your profile check-up", "مراجعة البروفايل ديالك")}</h3>${[
    [
      "image",
      "A photo people can recognize",
      "تصويرة يقدرو يعرفوك بها",
      "Use a clear, well-lit portrait or a simple logo. Check it at thumbnail size; replace it if your face or mark is hard to recognize.",
      "استعمل صورة واضحة ومضوية أو لوغو بسيط. شوفها صغيرة؛ إلا ما بايناش مزيان بدلها.",
    ],
    [
      "text",
      "A name with a little context",
      "اسم فيه معنى",
      "Add your niche beside your name so new visitors quickly understand what you create.",
      "زيد المجال ديالك حدا الاسم باش الزائر يفهم شنو كتقدم.",
    ],
    [
      "user",
      "A bio that answers “why follow?”",
      "بايو كيجاوب «علاش نتابعك؟»",
      "Say who you help, what you share, and one clear next step. Skip vague claims and crowded emoji lists.",
      "قول شكون كتعاون، شنو كتشارك، وشنو يدير الزائر من بعد.",
    ],
    [
      "story",
      "Highlights with a purpose",
      "هايلايت عندها هدف",
      "Start with About, Best tips, and Behind the scenes. Keep covers readable and stories current.",
      "بدا بـ«عليّا»، «نصائح»، و«الكواليس». خلي الأغلفة واضحة والمحتوى جديد.",
    ],
  ]
    .map(
      ([ic, en, ar, d, da]) =>
        `<div class="audit-item">${icon(ic)}<div><h4>${t(en, ar)}</h4><p>${t(d, da)}</p></div></div>`,
    )
    .join("")}</section></div></div>`;
}
function insightsPage() {
  return `<div class="page-content">${heading(t("See the story behind the numbers.", "شوف القصة اللي ورا الأرقام."), t("A little perspective to help you decide what to create next.", "نظرة كتعاونك تختار المحتوى الجاي."), btn(t("Export workspace", "صدّر البيانات"), "export", "download"), t("CREATOR INSIGHTS", "إحصائيات المبدع"))}<div class="notice">${icon("chart")}${t("All charts here are illustrative sample data, not your Instagram analytics. A production integration requires Meta authorization, eligible accounts, permissions, and a secure backend.", "هاد الرسومات بيانات تجريبية، ماشي إحصائيات حسابك. الربط الحقيقي كيحتاج ترخيص Meta، حساب مؤهل، الصلاحيات، وسيرفر آمن.")}</div>${metrics()}<div class="insights-grid">${chartCard()}<section class="card insight-list"><h3>${t("What your audience connects with", "المحتوى اللي كيتفاعل معاه الجمهور")}</h3><p class="section-sub">${t("Example content mix · Demo", "مثال توزيع المحتوى · تجريبي")}</p>${[
    ["Everyday lifestyle", "الحياة اليومية", 64],
    ["Travel & discovery", "السفر والاكتشاف", 26],
    ["Creative process", "الإبداع والكواليس", 10],
  ]
    .map(
      ([en, ar, v]) =>
        `<div class="insight-row"><div><span>${t(en, ar)}</span><strong>${v}%</strong></div><div class="progress-track"><span style="width:${v}%"></span></div></div>`,
    )
    .join(
      "",
    )}</section><section class="card insight-list"><h3>${t("When your community shows up", "وقتاش الجمهور كيكون حاضر")}</h3><p class="section-sub">${t("Illustrative activity, not a posting-time recommendation", "مثال للنشاط، ماشي توصية بتوقيت النشر")}</p><div class="heatmap"><span></span>${["6am", "9am", "12pm", "3pm", "6pm", "9pm"].map((x) => `<span>${x}</span>`).join("")}${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => `<span>${d}</span>${[0, 1, 2, 3, 4, 5].map((j) => `<div class="heat h${((i + j * 2) % 4) + 1}" title="Demo activity"></div>`).join("")}`).join("")}</div></section><section class="card insight-list"><span class="tool-icon">${icon("light")}</span><h3>${t("Look for patterns, not one-off wins.", "قلب على النمط، ماشي ضربة حظ.")}</h3><p class="subtitle" style="margin:15px 0 22px">${t("Compare a few weeks of saves, shares, and watch time in your real Instagram Insights. Repeat the topics that create meaningful conversations, then test a fresh format.", "قارن الحفظ والمشاركة ووقت المشاهدة لأسابيع فإحصائيات Instagram الحقيقية. عاود المواضيع اللي كتحل نقاش مفيد، وجرب شكل جديد.")}</p>${link(t("Talk it through with your coach", "ناقش الخطة مع الـcoach"), "coach")}</section></div></div>`;
}
function settingsPage() {
  return `<div class="page-content">${heading(t("Your space. Your way.", "المساحة ديالك. على طريقتك."), t("A few small details to make Neurio feel more like you.", "تفاصيل بسيطة باش Neurio يشبه ليك."), "", t("WORKSPACE SETTINGS", "إعدادات المساحة"))}<form id="settings-form" class="card settings-card"><h3>${t("Creator profile", "بروفايل المبدع")}</h3>${profileFields()}<div class="notice">${icon("shield")}${t("Stored only in this browser. Never enter your Instagram password or access tokens here.", "محفوظ غير فهاد المتصفح. ما تدخلش كلمة السر أو رموز الدخول ديال Instagram هنا.")}</div><button class="btn btn-primary" type="submit">${icon("check")}${t("Save changes", "حفظ التغييرات")}</button></form><section class="card settings-card" style="margin-top:20px;margin-bottom:24px"><h3>${t("Your data & your device", "البيانات والجهاز ديالك")}</h3><p class="subtitle">${t("Take your plans with you, install Neurio, or start fresh. This workspace does not sync across devices.", "صدّر الخطط، ثبت Neurio، أو بدا من جديد. البيانات ما كتتزامنش بين الأجهزة.")}</p><div class="settings-actions">${btn(t("Export data", "صدّر البيانات"), "export", "download")}${btn(t("Install Neurio", "ثبت Neurio"), "install", "plus")}${btn(t("Reset workspace", "مسح المساحة"), "reset", "trash", "danger")}</div></section></div>`;
}
function profileFields() {
  return `<div class="form-grid"><label class="field">${t("Your name", "الاسم ديالك")}<input name="name" required maxlength="40" value="${esc(state.profile.name)}"></label><label class="field">${t("Instagram username", "اسم Instagram")}<input name="handle" required maxlength="30" pattern="[A-Za-z0-9_.]+" title="Letters, numbers, underscores, and periods only" value="${esc(state.profile.handle)}"></label></div><div class="form-grid"><label class="field">${t("Your niche", "المجال ديالك")}<input name="niche" required maxlength="70" value="${esc(state.profile.niche)}"></label><label class="field">${t("Follower count (manual)", "عدد المتابعين (يدوي)")}<input name="followers" type="number" min="0" max="10000000000" required value="${state.profile.followers}"></label></div><label class="field">${t("Profile bio", "وصف البروفايل")}<textarea name="bio" maxlength="300">${esc(state.profile.bio)}</textarea></label>`;
}
const views = {
  overview,
  content: contentPage,
  coach: coachPage,
  planner: plannerPage,
  goals: goalsPage,
  tools: toolsPage,
  profile: profilePage,
  insights: insightsPage,
  settings: settingsPage,
};
function navigate(page) {
  if (!views[page]) page = "overview";
  route = page;
  location.hash = page;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function openModal(title, desc, body, wide = false) {
  if (!document.querySelector(".modal")) modalFocus = document.activeElement;
  document.querySelector("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${title}</h2><button class="close" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></div>${desc ? `<p class="modal-desc">${desc}</p>` : ""}${body}</section></div>`;
  document.body.style.overflow = "hidden";
  document.querySelector(".modal input,.modal textarea,.modal button")?.focus();
}
function closeModal() {
  document.querySelector("#modal-root").innerHTML = "";
  document.body.style.overflow = "";
  if (previewURL) {
    URL.revokeObjectURL(previewURL);
    previewURL = null;
  }
  modalFocus?.focus();
}
function uploadModal() {
  openModal(
    t("Your next great piece of content.", "المحتوى الزوين الجاي ديالك."),
    t(
      "Preview a video privately, or start with an idea. Draft details are saved locally; the video itself is not stored.",
      "عاين الفيديو بخصوصية، أو بدا بفكرة. تفاصيل المسودة محفوظة محلياً؛ الفيديو ما كيتخزنش.",
    ),
    `<form id="upload-form"><div class="upload-zone">${icon("upload")}<p>${t("Choose a video to preview", "اختار فيديو للمعاينة")}<br><small>MP4, WebM, MOV · ${t("up to 100 MB", "حتى 100 MB")}</small></p><input id="video-file" type="file" accept="video/mp4,video/webm,video/quicktime" aria-label="Choose video"></div><div id="video-preview"></div><label class="field" style="margin-top:20px">${t("Give it a working title", "عنوان المسودة")}<input name="title" required maxlength="100" placeholder="${t("A little idea worth sharing…", "فكرة كتستاهل المشاركة…")}"></label><div class="form-grid"><label class="field">${t("Views (optional)", "المشاهدات (اختياري)")}<input type="number" name="views" min="0" max="1000000000" value="0"></label><label class="field">${t("Likes (optional)", "الإعجابات (اختياري)")}<input type="number" name="likes" min="0" max="1000000000" value="0"></label></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">${t("Cancel", "إلغاء")}</button><button class="btn btn-primary" type="submit">${icon("plus")}${t("Save draft & review", "حفظ ومراجعة")}</button></div></form>`,
  );
}
function detailModal(id) {
  const c = allContent().find((c) => c.id === id);
  if (!c) return;
  openModal(
    esc(c.title),
    c.sample
      ? t(
          "Sample content review · Illustrative score and metrics",
          "مراجعة تجريبية · التقييم والإحصائيات أمثلة",
        )
      : t(
          "Your local draft · Metrics entered by you",
          "مسودة محلية · إحصائيات دخلتيها نتا",
        ),
    `${c.sample ? `<img class="detail-cover" src="${c.image}" alt="Demo reel cover">` : ""}<div class="detail-stats"><div class="detail-stat"><strong>${compact(c.views || 0)}</strong><small>${t("Views", "المشاهدات")}</small></div><div class="detail-stat"><strong>${compact(c.likes || 0)}</strong><small>${t("Likes", "الإعجابات")}</small></div><div class="detail-stat"><strong>${c.score != null ? c.score : "—"}<span style="font-size:11px;color:#9ba88a">/100</span></strong><small>${c.sample ? t("Demo score", "تقييم تجريبي") : t("Self-review score", "تقييم ذاتي")}</small></div></div>${
      c.sample
        ? `<div class="output">${icon("spark")} ${esc(c.advice)}</div><div class="notice">${icon("help")}${t("This is an example, not a machine-generated analysis of a real reel. Add your own draft to use the self-review checklist.", "هاد مثال، ماشي تحليل آلي لفيديو حقيقي. زيد مسودة ديالك باش تستعمل لائحة التقييم الذاتي.")}</div>`
        : `<p class="modal-desc">${t("Review your video honestly. Each checked criterion contributes 20 points. This checklist does not inspect video or audio.", "راجع الفيديو بصراحة. كل معيار محقق كيعطي 20 نقطة. هاد اللائحة ما كتفحص لا الفيديو لا الصوت.")}</p><form id="review-form" data-id="${esc(c.id)}"><div class="rubric">${[
            [
              "The first 2 seconds clearly show the idea.",
              "أول ثانيتين كيبينو الفكرة بوضوح.",
            ],
            [
              "The viewer gets one useful takeaway.",
              "المشاهد كيخرج بفائدة واحدة واضحة.",
            ],
            ["The image and audio are clear.", "الصورة والصوت واضحين."],
            [
              "Captions are readable, with accessible contrast.",
              "الكتابة مقروءة بتباين واضح.",
            ],
            [
              "The ending invites one relevant action.",
              "النهاية كتطلب تفاعل واحد مناسب.",
            ],
          ]
            .map(
              ([en, ar], i) =>
                `<label><input type="checkbox" name="criterion" value="${i}" ${c.criteria?.includes(String(i)) ? "checked" : ""}>${t(en, ar)}</label>`,
            )
            .join(
              "",
            )}</div><div class="analysis-score" id="review-score"><strong>${c.score || 0}</strong> / 100</div><div class="modal-actions"><button class="btn btn-primary" type="submit">${icon("check")}${t("Save my review", "حفظ المراجعة")}</button></div></form>`
    }<div class="modal-actions">${c.sample ? `<button class="btn btn-primary" data-tool="hooks">${icon("spark")}${t("Try a fresh hook", "جرب عنوان جديد")}</button>` : `<button class="btn danger" data-delete-content="${esc(c.id)}">${icon("trash")}${t("Delete draft", "مسح المسودة")}</button>`}<button class="btn" data-action="close-modal">${t("Done", "صافي")}</button></div>`,
    true,
  );
}
function taskModal() {
  openModal(
    t("Make a little room for an idea.", "عطي بلاصة لفكرة جديدة."),
    t(
      "Add a manual reminder to your content plan. Neurio does not publish posts or send background notifications.",
      "زيد تذكير يدوي فالبرنامج. Neurio ما كينشرش وما كيصيفطش إشعارات فالخلفية.",
    ),
    `<form id="task-form"><label class="field">${t("What are you creating?", "شنو غادي تصاوب؟")}<input name="title" required maxlength="100" placeholder="${t("e.g. Three things I learned this week", "مثلاً: ثلاثة حوايج تعلمتهم هاد السيمانة")}"></label><div class="form-grid"><label class="field">${t("Format", "النوع")}<select name="type"><option>Reel</option><option>Story</option><option>Carousel</option><option>Engagement</option></select></label><label class="field">${t("Time", "الوقت")}<input name="time" type="time" required value="18:00"></label></div><label class="field">${t("Date", "التاريخ")}<input name="date" type="date" required min="2020-01-01" max="2100-12-31" value="${plannerDay}"></label><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">${t("Cancel", "إلغاء")}</button><button class="btn btn-primary" type="submit">${icon("plus")}${t("Add to my plan", "زيد فالبرنامج")}</button></div></form>`,
  );
}
function goalModal(id) {
  const g = state.goals.find((g) => g.id === id);
  openModal(
    g
      ? t("Every step counts.", "كل خطوة كتتحسب.")
      : t("Give your ambition a direction.", "عطي اتجاه للطموح ديالك."),
    t(
      "Choose a milestone that matters to you. Keep it specific, and update it as you go.",
      "اختار هدف مهم ليك. خليه محدد، وحدّثو مع التقدم.",
    ),
    `<form id="goal-form" data-id="${esc(id || "")}"><label class="field">${t("Goal name", "اسم الهدف")}<input name="title" required maxlength="80" value="${esc(g?.title || "")}" placeholder="${t("e.g. Publish 12 thoughtful reels", "مثلاً: نشر 12 ريل بجودة")}"></label><div class="form-grid"><label class="field">${t("Current progress", "التقدم الحالي")}<input name="current" type="number" min="0" max="10000000000" value="${g?.current || 0}" required></label><label class="field">${t("Target", "الهدف")}<input name="target" type="number" min="1" max="10000000000" required value="${g?.target || ""}"></label></div><label class="field">${t("Unit", "الوحدة")}<select name="unit">${["followers", "reels", "days", "saves", "shares"].map((u) => `<option ${g?.unit === u ? "selected" : ""}>${u}</option>`).join("")}</select></label><div class="modal-actions">${g ? `<button class="btn danger" type="button" data-delete-goal="${esc(g.id)}">${icon("trash")}</button>` : ""}<button class="btn" type="button" data-action="close-modal">${t("Cancel", "إلغاء")}</button><button class="btn btn-primary" type="submit">${icon("check")}${t("Save goal", "حفظ الهدف")}</button></div></form>`,
  );
}
function toolModal(id) {
  const tool = toolDefs.find((x) => x[0] === id);
  if (!tool) return;
  openModal(
    t(tool[2], tool[3]),
    t(
      "A useful first draft, made from local templates. Edit it to sound like you.",
      "مسودة مفيدة من قوالب محلية. عدلها باش تشبه ليك.",
    ),
    `<form id="tool-form" data-tool-id="${id}"><label class="field">${t("What’s your content about?", "على شنو المحتوى ديالك؟")}<input name="topic" required maxlength="150" value="${esc(state.profile.niche)}" placeholder="${t("e.g. A slow morning in Marrakech", "مثلاً: صباح هادئ فمراكش")}"></label>${["caption", "stories"].includes(id) ? `<label class="field">${t("The feeling", "النبرة")}<select name="tone"><option value="warm">${t("Warm & personal", "دافئة وشخصية")}</option><option value="educational">${t("Helpful & educational", "مفيدة وتعليمية")}</option><option value="playful">${t("Playful & light", "مرحة وخفيفة")}</option></select></label>` : ""}<button class="btn btn-primary" type="submit">${icon("spark")}${t("Create a starting point", "صاوب مسودة")}</button></form><div id="tool-output"></div>`,
  );
}
function createToolOutput(id, topic, tone) {
  const name = state.profile.name;
  const warm = t(
    `A little reminder to slow down and make room for ${topic}.`,
    `تذكير صغير باش نهدنو ونعطيو وقت لـ${topic}.`,
  );
  const intro =
    tone === "educational"
      ? t(`A simple place to start with ${topic}:`, `بداية بسيطة مع ${topic}:`)
      : tone === "playful"
        ? t(
            `${topic}? Okay, I’m officially obsessed.`,
            `واش ${topic}؟ صافي وليت مهووس بهادشي!`,
          )
        : warm;
  const outputs = {
    caption: t(
      `${intro}\n\nToday, I’m sharing a small piece of my process—the imperfect moments included. You don’t have to have it all figured out to start.\n\nWhat’s one thing you’d love to try? Tell me below. 🌿`,
      `${intro}\n\nاليوم كنشارك معاكم جزء من التجربة ديالي، حتى اللحظات اللي ماشي مثالية. ما خاصكش تعرف كلشي باش تبدا.\n\nشنو حاجة بغيتي تجربها؟ قولها ليا فالتعليقات. 🌿`,
    ),
    hooks: t(
      `1. What nobody told me about ${topic}.\n2. ${topic}: start with this one small change.\n3. I tried a different approach to ${topic}. Here’s what I learned.\n4. Your simple, no-pressure guide to ${topic}.\n5. Three things I wish I knew about ${topic}.\n\nChoose a title that matches what your video actually shows.`,
      `1. الحاجة اللي حتى حد ما قالها ليا على ${topic}.\n2. ${topic}: بدا بهاد التغيير الصغير.\n3. جربت طريقة جديدة فـ${topic}. ها شنو تعلمت.\n4. دليل بسيط وبلا ضغط لـ${topic}.\n5. ثلاثة حوايج تمنيت نعرفهم على ${topic}.\n\nاختار عنوان صادق مع الفيديو ديالك.`,
    ),
    stories: t(
      `${intro}\n\nFRAME 1 — A real moment\nShow your setup for ${topic}. Caption: “A little behind the scenes today.”\n\nFRAME 2 — Invite a choice\nPoll: “Want to see the process / the finished result?”\n\nFRAME 3 — Give something useful\nShare one lesson from ${topic}. Add a question sticker: “What would you like to know?”`,
      `${intro}\n\nالستوري 1 — لقطة حقيقية\nوري التحضيرات ديال ${topic}. كتب: «شوية ديال الكواليس اليوم».\n\nالستوري 2 — خليهم يختارو\nتصويت: «الطريقة / النتيجة؟»\n\nالستوري 3 — فائدة صغيرة\nشارك درس من ${topic}. زيد سؤال: «شنو بغيتي تعرف؟»`,
    ),
    bio: t(
      `${name} | ${topic}\nIdeas, little discoveries & the process in between.\nFollow for a fresh perspective. 🌿\n\nDISPLAY NAME IDEAS\n${name} Creates\n${name} | ${topic}\nLife with ${name}\n\nKeep your final Instagram bio within 150 characters.`,
      `${name} | ${topic}\nأفكار، اكتشافات صغيرة، والكواليس ديالها.\nتابعني لزاوية جديدة. 🌿\n\nاقتراحات الاسم\n${name} Creates\n${name} | ${topic}\nالحياة مع ${name}\n\nالبايو النهائي ديال Instagram خاصو ما يفوتش 150 حرف.`,
    ),
    hashtags: t(
      `Start with a small, relevant set:\n\n#${
        topic
          .replace(/[^\p{L}\p{N}\s]/gu, "")
          .trim()
          .replace(/\s+/g, "")
          .slice(0, 40) || "creativity"
      } #CreativeProcess #EverydayInspiration #BehindTheScenes #MoroccanCreators\n\nOnly use tags that accurately describe your post. Check them in Instagram before posting; availability and reach are not verified.`,
      `بدا بهاشتاغات قليلة ومناسبة:\n\n#${
        topic
          .replace(/[^\p{L}\p{N}\s]/gu, "")
          .trim()
          .replace(/\s+/g, "")
          .slice(0, 40) || "إبداع"
      } #صناعة_المحتوى #إبداع #كواليس #مبدعين_مغاربة\n\nاستعمل غير اللي كيوصف المحتوى بصراحة. تحقق منهم فInstagram؛ الوصول ديالهم ما معروفش.`,
    ),
    inspiration: t(
      `YOUR RESEARCH STARTER: ${topic}\n\n1. Search Instagram for “${topic}”, “${topic} tips”, and “${topic} Morocco”.\n2. Choose three creators with a similar audience—not just a high follower count.\n3. Note their opening, story structure, and the questions in their comments.\n4. Find a gap you can fill with your own experience.\n5. Make an original version; don’t copy someone’s footage, script, or identity.\n\nThis is a search plan. Neurio has not browsed Instagram or found verified accounts.`,
      `خطة بحث على: ${topic}\n\n1. قلب فInstagram على «${topic}» و«نصائح ${topic}» و«${topic} المغرب».\n2. اختار 3 مبدعين عندهم جمهور مشابه، ماشي غير متابعين بزاف.\n3. لاحظ البداية، القصة، والأسئلة فالتعليقات.\n4. لقى حاجة تقدر تزيدها بالتجربة ديالك.\n5. صاوب نسخة أصلية؛ ما تنسخش الفيديوهات أو الكلام أو الهوية.\n\nهادي خطة بحث. Neurio ما قلبش فInstagram وما لقا حتى حساب مؤكد.`,
    ),
  };
  return outputs[id];
}
function connectionModal() {
  openModal(
    t("Your Instagram, with transparency.", "الإنستغرام ديالك، بوضوح."),
    t(
      "This workspace isn’t connected to Instagram yet.",
      "هاد المساحة ما مربوطةش بـInstagram دابا.",
    ),
    `<div class="notice">${icon("shield")}<span>${t("Live imports require an official Meta login flow and a secure backend. Neither is configured in this version. We never ask for your Instagram password.", "استيراد البيانات كيحتاج دخول رسمي من Meta وسيرفر آمن. هادشي ما مهيأش فهاد النسخة. عمرنا نطلبو كلمة السر ديال Instagram.")}</span></div><p class="modal-desc">${t("You can still personalize your local workspace, review drafts, and plan your next posts. Entering a username does not connect or analyze an account.", "تقدر تخصص المساحة المحلية، تراجع المسودات، وتنظم المنشورات. إدخال الاسم ما كيربطش أو كيحلل الحساب.")}</p><div class="modal-actions"><button class="btn btn-primary" data-action="workspace">${t("Personalize my workspace", "خصص المساحة ديالي")}${icon("arrow")}</button></div>`,
  );
}
function workspaceModal() {
  openModal(
    t("Make yourself at home.", "خلي المساحة على قياسك."),
    t(
      "Personalize the local demo. These details don’t connect to Instagram or replace sample analytics.",
      "خصص المساحة المحلية. هاد المعلومات ما كتربطش Instagram وما كتبدلش الإحصائيات التجريبية.",
    ),
    `<form id="workspace-form">${profileFields()}<div class="modal-actions"><button class="btn btn-primary" type="submit">${icon("check")}${t("Save my workspace", "حفظ المساحة")}</button></div></form>`,
  );
}
function exportData() {
  const json = JSON.stringify(
    {
      app: "Neurio",
      version: 1,
      exportedAt: new Date().toISOString(),
      ...state,
    },
    null,
    2,
  );
  if (window.NeurioAndroid?.exportWorkspace) {
    window.NeurioAndroid.exportWorkspace(json);
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "neurio-workspace.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t("Your workspace export is ready.", "البيانات واجدة للتحميل."));
}
function helpModal() {
  openModal(
    t("A clearer path to your next chapter.", "طريق أوضح للمرحلة الجاية."),
    t(
      "Welcome to Neurio, your personal creator workspace.",
      "مرحباً بـNeurio، المساحة الشخصية ديال المبدع.",
    ),
    `<div class="output">${t("1. Personalize your profile in Settings.\n2. Add a video or idea to your Content library.\n3. Review it using the five-point checklist.\n4. Plan your reels and stories in Content planner.\n5. Set a goal and update your progress as you go.", "1. خصص البروفايل فالإعدادات.\n2. زيد فيديو أو فكرة لمكتبة المحتوى.\n3. راجعها بلائحة من 5 معايير.\n4. نظم الريلز والستوري فالبرنامج.\n5. حدد هدف وحدّث التقدم ديالك.")}</div><div class="notice">${icon("shield")}${t("This is a local-first prototype, not a connected AI analytics service. Sample metrics are labeled. Plans and drafts stay in this browser. Videos are previewed locally and are not stored.", "هاد نسخة أولية محلية، ماشي خدمة تحليل AI مربوطة. الإحصائيات التجريبية معلمة. الخطط والمسودات كيبقاو فالمتصفح. الفيديو للمعاينة فقط وما كيتخزنش.")}</div><div class="modal-actions">${btn(t("Install on my phone", "ثبت فالتلفون"), "install", "download", "btn-primary")}</div>`,
  );
}
async function installApp() {
  if (window.NeurioAndroid) {
    toast(
      t(
        "Neurio is already installed on your phone.",
        "Neurio راه مثبت دابا فالتلفون ديالك.",
      ),
    );
    return;
  }
  if (deferredInstall) {
    await deferredInstall.prompt();
    deferredInstall = null;
    return;
  }
  openModal(
    t("Your companion, on your home screen.", "رفيقك، فشاشة التلفون."),
    t(
      "Install Neurio as a web app—no app store needed.",
      "ثبت Neurio كتطبيق ويب، بلا متجر التطبيقات.",
    ),
    `<div class="output">${t("ANDROID · CHROME\nOpen the browser menu (⋮), then tap “Install app” or “Add to Home screen”.\n\nIPHONE · SAFARI\nTap Share, then “Add to Home Screen” → Add.\n\nDESKTOP\nLook for the install icon in the address bar or your browser menu.", "ANDROID · CHROME\nحل قائمة المتصفح (⋮)، ثم «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية».\n\nIPHONE · SAFARI\nاضغط مشاركة، ثم «إضافة للشاشة الرئيسية».\n\nالحاسوب\nقلب على علامة التثبيت فشريط العنوان أو قائمة المتصفح.")}</div><p class="modal-desc">${t("If you’re viewing an embedded preview, open its URL in a new browser tab first. Installation requires HTTPS. This is a web app, not a native APK.", "إلا كنت فمعاينة داخلية، حل الرابط فتبويب جديد أولاً. التثبيت كيحتاج HTTPS. هادا تطبيق ويب، ماشي APK أصلي.")}</p>`,
  );
}
const actions = {
  menu: () => {
    document.querySelector(".sidebar").classList.add("open");
    document.querySelector(".mobile-overlay").classList.add("show");
  },
  "close-menu": () => {
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector(".mobile-overlay").classList.remove("show");
  },
  "close-modal": closeModal,
  language: () => {
    state.lang = state.lang === "en" ? "ar" : "en";
    save();
    render();
  },
  upload: uploadModal,
  "add-task": taskModal,
  "add-goal": () => goalModal(),
  workspace: workspaceModal,
  connect: connectionModal,
  export: exportData,
  help: helpModal,
  install: installApp,
  notifications: () =>
    openModal(
      t("A little nudge for your day.", "تذكير صغير لنهارك."),
      t(
        "Local planner reminders · No background notifications",
        "تذكيرات البرنامج المحلي · بلا إشعارات فالخلفية",
      ),
      `<div class="plan-list">${
        state.tasks
          .filter((x) => !x.done && x.date === "2026-10-09")
          .map(taskHTML)
          .join("") ||
        `<div class="output">${t("You’re all caught up for today. Take a breath. 🌿", "كملتي برنامج اليوم. خذ نفس. 🌿")}</div>`
      }</div><div class="modal-actions"><button class="btn btn-primary" data-nav="planner">${t("Open planner", "حل البرنامج")}${icon("arrow")}</button></div>`,
    ),
  date: () =>
    openModal(
      t("A little context for the numbers.", "شوية توضيح على الأرقام."),
      t(
        "Dashboard metrics cover this fixed sample period.",
        "إحصائيات اللوحة كتمثل هاد الفترة التجريبية الثابتة.",
      ),
      `<div class="output">September 10 – October 9, 2026\n\n${t("The four metric cards are illustrative 30-day examples. Use the 7-day / 30-day switch on the growth chart to explore its two sample periods.", "البطاقات الأربعة أمثلة تجريبية لـ30 يوم. بدّل بين 7 و30 يوم فالرسم البياني باش تشوف الفترتين التجريبيتين.")}</div>`,
    ),
  search: () => {
    openModal(
      t("Find your next step.", "لقى الخطوة الجاية."),
      "",
      `<label class="field"><input id="global-search" placeholder="${t("Search pages, tools, or content…", "قلب فالصفحات، الأدوات، أو المحتوى…")}" aria-label="Search workspace"></label><div id="search-results" class="search-results"></div>`,
    );
    updateSearch("");
  },
  reset: () =>
    openModal(
      t("Start with a clean slate?", "تبغي تبدا من جديد؟"),
      t(
        "This permanently removes your saved drafts, goals, plans, chat, and profile from this browser and restores the demo. Export first if you want to keep them.",
        "هادشي غيمسح نهائياً المسودات، الأهداف، الخطط، الدردشة والبروفايل من هاد المتصفح ويرجع الديمو. صدّر البيانات قبل إلا بغيتي تحتافظ بها.",
      ),
      `<div class="modal-actions">${btn(t("Export first", "صدّر أولاً"), "export", "download")}${btn(t("Keep my workspace", "خلي المساحة"), "close-modal", "close")}${btn(t("Reset everything", "مسح كلشي"), "confirm-reset", "trash", "danger")}</div>`,
    ),
  "confirm-reset": () => {
    state = structuredClone(defaults);
    save();
    closeModal();
    navigate("overview");
    toast(
      t(
        "A fresh start. Your demo workspace is ready.",
        "بداية جديدة. المساحة التجريبية واجدة.",
      ),
    );
  },
};
function updateSearch(q) {
  const items = [
    ...navItems.map(([id, ic, en, ar]) => ({
      label: t(en, ar),
      kind: t("Page", "صفحة"),
      attrs: `data-nav="${id}"`,
      ic,
    })),
    ...toolDefs.map(([id, ic, en, ar]) => ({
      label: t(en, ar),
      kind: t("Tool", "أداة"),
      attrs: `data-tool="${id}"`,
      ic,
    })),
    ...allContent().map((c) => ({
      label: c.title,
      kind: t("Content", "محتوى"),
      attrs: `data-content="${esc(c.id)}"`,
      ic: "video",
    })),
  ]
    .filter((x) => x.label.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 9);
  document.querySelector("#search-results").innerHTML =
    items
      .map(
        (x) =>
          `<button class="search-result" ${x.attrs}>${icon(x.ic)}<span>${esc(x.label)}<small>${x.kind}</small></span></button>`,
      )
      .join("") ||
    empty(
      t("No matches yet.", "ما لقينا حتى نتيجة."),
      t("Try another word.", "جرب كلمة أخرى."),
    );
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,a,[data-action]");
  if (!el) {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
    return;
  }
  if (el.dataset.nav) {
    closeModal();
    navigate(el.dataset.nav);
  } else if (el.dataset.action) {
    actions[el.dataset.action]?.();
  } else if (el.dataset.period) {
    period = el.dataset.period;
    render();
  } else if (el.dataset.task) {
    const task = state.tasks.find((x) => x.id === el.dataset.task);
    if (task) {
      task.done = !task.done;
      save();
      render();
      if (document.querySelector(".modal")) actions.notifications();
      toast(
        task.done
          ? t("One little win. Nicely done!", "إنجاز صغير. برافو عليك!")
          : t("Task moved back to your plan.", "المهمة رجعات للبرنامج."),
      );
    }
  } else if (el.dataset.content) {
    detailModal(el.dataset.content);
  } else if (el.dataset.filter) {
    filter = el.dataset.filter;
    render();
  } else if (el.dataset.day) {
    plannerDay = el.dataset.day;
    render();
  } else if (el.dataset.prompt) {
    sendChat(el.dataset.prompt);
  } else if (el.dataset.tool) {
    toolModal(el.dataset.tool);
  } else if (el.dataset.goalEdit) {
    goalModal(el.dataset.goalEdit);
  } else if (el.dataset.deleteTask) {
    state.tasks = state.tasks.filter((x) => x.id !== el.dataset.deleteTask);
    save();
    render();
    toast(t("Task removed.", "تم مسح المهمة."));
  } else if (el.dataset.deleteGoal) {
    state.goals = state.goals.filter((x) => x.id !== el.dataset.deleteGoal);
    save();
    closeModal();
    render();
    toast(t("Goal removed.", "تم مسح الهدف."));
  } else if (el.dataset.deleteContent) {
    state.content = state.content.filter(
      (x) => x.id !== el.dataset.deleteContent,
    );
    save();
    closeModal();
    render();
    toast(t("Draft removed.", "تم مسح المسودة."));
  } else if (el.id === "copy-output") {
    const text = document.querySelector("#generated-text").textContent;
    if (window.NeurioAndroid?.copyText) {
      window.NeurioAndroid.copyText(text);
      return;
    }
    if (navigator.clipboard)
      navigator.clipboard
        .writeText(text)
        .then(() =>
          toast(t("Copied. Make it your own!", "تنسخ. عدلو على طريقتك!")),
        )
        .catch(() =>
          toast(
            t("Select and copy the text manually.", "حدد النص ونسخو يدوياً."),
          ),
        );
    else
      toast(t("Select and copy the text manually.", "حدد النص ونسخو يدوياً."));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "content-search") {
    query = e.target.value;
    const list = allContent().filter(
      (c) =>
        (filter !== "My drafts" || !c.sample) &&
        (filter !== "Top rated" || c.score >= 90) &&
        c.title.toLowerCase().includes(query.toLowerCase()),
    );
    document.querySelector("#library-grid").innerHTML =
      list.map(contentCard).join("") ||
      empty(
        t("No matching content.", "ما كاينش محتوى مطابق."),
        t(
          "Try another search or add a new draft.",
          "جرب بحث آخر أو زيد مسودة.",
        ),
      );
  }
  if (e.target.id === "global-search") updateSearch(e.target.value);
  if (e.target.name === "criterion") {
    const score =
      document.querySelectorAll("#review-form input:checked").length * 20;
    document.querySelector("#review-score").innerHTML =
      `<strong>${score}</strong> / 100`;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.goalDone) {
    const g = state.goals.find((x) => x.id === e.target.dataset.goalDone);
    g.done = e.target.checked;
    if (g.done) g.current = Math.max(g.current, g.target);
    save();
    render();
    toast(
      g.done
        ? t(
            "Milestone achieved. Take a moment to celebrate!",
            "الهدف تحقق. خذ لحظة تحتافل!",
          )
        : t(
            "Goal reopened. Progress kept.",
            "الهدف رجع مفتوح والتقدم بقى محفوظ.",
          ),
    );
  }
  if (e.target.id === "planner-date" && e.target.value) {
    plannerDay = e.target.value;
    render();
  }
  if (e.target.id === "video-file") {
    const file = e.target.files[0];
    const preview = document.querySelector("#video-preview");
    if (previewURL) {
      URL.revokeObjectURL(previewURL);
      previewURL = null;
    }
    preview.innerHTML = "";
    if (!file) return;
    if (
      file.size > 100 * 1024 * 1024 ||
      !["video/mp4", "video/webm", "video/quicktime"].includes(file.type)
    ) {
      toast(
        t(
          "Choose an MP4, WebM, or MOV video under 100 MB.",
          "اختار MP4 أو WebM أو MOV أقل من 100 MB.",
        ),
      );
      e.target.value = "";
      return;
    }
    previewURL = URL.createObjectURL(file);
    preview.innerHTML = `<video class="video-preview" src="${previewURL}" controls playsinline></video><p class="section-sub">${esc(file.name)} · ${t("Private local preview. Video will not be saved.", "معاينة محلية خاصة. الفيديو ما غيتحفظش.")}</p>`;
    const video = preview.querySelector("video");
    video.addEventListener("error", () =>
      toast(
        t(
          "This browser cannot play this video format. You can still save the draft.",
          "المتصفح ما قدرش يشغل هاد الصيغة. تقدر تحفظ المسودة.",
        ),
      ),
    );
    const title = document.querySelector("#upload-form [name=title]");
    if (!title.value)
      title.value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
  }
});
document.addEventListener("submit", (e) => {
  const form = e.target;
  e.preventDefault();
  const fd = new FormData(form);
  const val = (k) => String(fd.get(k) || "").trim();
  if (form.id === "chat-form") sendChat(val("message"));
  if (["settings-form", "workspace-form"].includes(form.id)) {
    if (!val("name") || !val("niche") || !val("handle"))
      return toast(
        t("Please fill in your profile details.", "كمل معلومات البروفايل."),
      );
    state.profile = {
      name: val("name"),
      handle: val("handle"),
      niche: val("niche"),
      bio: val("bio"),
      followers: Number(val("followers")),
    };
    save();
    closeModal();
    render();
    toast(
      t(
        "Your workspace feels a little more like you. Saved!",
        "المساحة ولات كتشبه ليك. تحفضات!",
      ),
    );
  }
  if (form.id === "upload-form") {
    if (!val("title")) return;
    const id = crypto.randomUUID();
    state.content.unshift({
      id,
      title: val("title"),
      views: Number(val("views")),
      likes: Number(val("likes")),
      sample: false,
      type: "Reel",
      score: null,
      date: new Date().toISOString(),
      image: "assets/creator-desk.jpg",
    });
    save();
    closeModal();
    navigate("content");
    detailModal(id);
  }
  if (form.id === "review-form") {
    const c = state.content.find((c) => c.id === form.dataset.id);
    c.criteria = fd.getAll("criterion");
    c.score = c.criteria.length * 20;
    save();
    closeModal();
    render();
    toast(
      t(
        `Review saved. Your self-assessment: ${c.score}/100.`,
        `تحفض التقييم الذاتي ديالك: ${c.score}/100.`,
      ),
    );
  }
  if (form.id === "task-form") {
    if (!val("title")) return;
    state.tasks.push({
      id: crypto.randomUUID(),
      title: val("title"),
      type: val("type"),
      time: val("time"),
      date: val("date"),
      done: false,
    });
    plannerDay = val("date");
    save();
    closeModal();
    navigate("planner");
    toast(
      t("A little intention, added to your day.", "خطوة جديدة تزادت للبرنامج."),
    );
  }
  if (form.id === "goal-form") {
    if (!val("title")) return;
    const existing = state.goals.find((x) => x.id === form.dataset.id);
    const g = {
      id: existing?.id || crypto.randomUUID(),
      title: val("title"),
      target: Number(val("target")),
      current: Number(val("current")),
      unit: val("unit"),
    };
    g.done = g.current >= g.target;
    if (existing) Object.assign(existing, g);
    else state.goals.push(g);
    save();
    closeModal();
    navigate("goals");
    toast(
      g.done
        ? t("Goal reached. Beautiful work!", "الهدف تحقق. برافو!")
        : t("Your next milestone is on the map.", "الهدف الجاي تزاد للخارطة."),
    );
  }
  if (form.id === "tool-form") {
    if (!val("topic")) return;
    const output = createToolOutput(
      form.dataset.toolId,
      val("topic"),
      val("tone"),
    );
    document.querySelector("#tool-output").innerHTML =
      `<div class="output" id="generated-text">${esc(output)}</div><div class="modal-actions"><button class="btn" id="copy-output">${icon("copy")}${t("Copy draft", "نسخ المسودة")}</button><button class="btn" data-action="add-task">${icon("calendar")}${t("Plan a post", "برمج منشور")}</button></div>`;
    document
      .querySelector("#tool-output")
      .scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});
document.addEventListener("keydown", (e) => {
  const modal = document.querySelector(".modal");
  if (e.key === "Escape") {
    closeModal();
    actions["close-menu"]();
  }
  if (e.key === "Tab" && modal) {
    const els = [
      ...modal.querySelectorAll(
        'button,a,input,select,textarea,[tabindex="0"]',
      ),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (views[next] && route !== next) {
    route = next;
    render();
  }
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
});
route = views[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
render();
