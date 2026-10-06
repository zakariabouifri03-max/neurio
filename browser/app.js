(() => {
  'use strict';

  const KEY = 'neurio-browser-preview-v1';
  const HOME = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const safeJson = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
  const freshTab = () => ({ id: Date.now() + Math.floor(Math.random() * 1000), title: 'تبويب جديد', route: HOME, stack: [{ route: HOME, title: 'تبويب جديد' }], cursor: 0 });

  let saved = safeJson(localStorage.getItem(KEY), {});
  let state = {
    tabs: Array.isArray(saved.tabs) && saved.tabs.length ? saved.tabs : [freshTab()],
    currentId: saved.currentId,
    bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : [],
    history: Array.isArray(saved.history) ? saved.history : [],
    lite: Boolean(saved.lite),
    theme: saved.theme === 'dark' ? 'dark' : 'light',
  };
  if (!state.tabs.some(tab => tab.id === state.currentId)) state.currentId = state.tabs[0].id;
  let deferredInstallPrompt = null;
  let toastTimer = 0;

  const currentTab = () => state.tabs.find(tab => tab.id === state.currentId) || state.tabs[0];
  const currentRoute = () => currentTab()?.stack?.[currentTab().cursor]?.route ?? HOME;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const hostOf = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const prettyTitle = value => {
    const host = hostOf(value);
    if (host.includes('youtube.')) return 'YouTube';
    if (host.includes('google.')) return 'Google';
    if (host.includes('wikipedia.')) return 'Wikipedia';
    if (host.includes('maps.')) return 'Google Maps';
    return host || 'موقع جديد';
  };
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, tabs: state.tabs.map(({ id, title, stack, cursor }) => ({ id, title, stack, cursor })) }));
    } catch { /* private browsing or storage disabled */ }
  };

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function renderTabs() {
    const strip = $('#tabStrip');
    strip.replaceChildren();
    state.tabs.forEach(tab => {
      const wrapper = document.createElement('div');
      wrapper.className = `browser-tab${tab.id === state.currentId ? ' selected' : ''}`;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'tab-select';
      select.setAttribute('role', 'tab');
      select.setAttribute('aria-selected', String(tab.id === state.currentId));
      select.title = tab.title || 'تبويب جديد';
      const favicon = document.createElement('span');
      favicon.className = 'tab-favicon';
      favicon.textContent = tab.route ? (prettyTitle(tab.route).slice(0, 1).toUpperCase()) : 'N';
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title || 'تبويب جديد';
      select.append(favicon, label);
      select.addEventListener('click', () => { state.currentId = tab.id; render(); });
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.setAttribute('aria-label', 'إغلاق التبويب');
      close.title = 'إغلاق التبويب';
      close.textContent = '×';
      close.addEventListener('click', event => { event.stopPropagation(); closeTab(tab.id); });
      wrapper.append(select, close);
      strip.append(wrapper);
    });
    $('#tabCount').textContent = String(state.tabs.length);
    $('#mobileTabCount').textContent = String(state.tabs.length);
  }

  function render() {
    const route = currentRoute();
    const isHome = route === HOME;
    $('#homeView').hidden = !isHome;
    $('#externalPreview').hidden = isHome;
    $('#backButton').disabled = currentTab().cursor <= 0;
    $('#forwardButton').disabled = currentTab().cursor >= currentTab().stack.length - 1;
    $('#addressInput').value = isHome ? '' : route;
    $('#clearAddress').hidden = !$('#addressInput').value;
    $('#bookmarkCurrent').textContent = route && state.bookmarks.some(item => item.url === route) ? '★' : '☆';
    $('#bookmarkCurrent').setAttribute('aria-label', route && state.bookmarks.some(item => item.url === route) ? 'إزالة العلامة' : 'حفظ الصفحة');
    if (!isHome) {
      $('#previewTitle').textContent = prettyTitle(route);
      $('#previewUrl').textContent = route;
      $('#previewIcon').textContent = prettyTitle(route).slice(0, 1).toUpperCase();
      $('#openExternalLink').href = route;
      currentTab().title = prettyTitle(route);
    } else currentTab().title = 'تبويب جديد';
    $('#liteToggle').setAttribute('aria-checked', String(state.lite));
    $('#liteStatus').textContent = state.lite ? 'مفعّل في التطبيق' : 'متوقف في المعاينة';
    document.documentElement.dataset.theme = state.theme;
    $('#themeButton').setAttribute('aria-label', state.theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن');
    renderTabs();
    persist();
  }

  function makeSearchUrl(input) {
    const value = input.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) {
      try { return new URL(value).href; } catch { return `https://www.google.com/search?q=${encodeURIComponent(value)}`; }
    }
    if (/^(mailto:|tel:)/i.test(value)) return null;
    const hostLike = /^(localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?)$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(value);
    if (hostLike) {
      try { return new URL(`https://${value}`).href; } catch { /* treat as a query */ }
    }
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  function navigate(input, forcedTitle) {
    const value = input.trim();
    if (!value) { $('#addressInput').focus(); return; }
    const url = makeSearchUrl(value);
    if (!url) { toast('اكتب عنوان موقع أو كلمات البحث.'); return; }
    const tab = currentTab();
    tab.stack = tab.stack.slice(0, tab.cursor + 1);
    tab.stack.push({ route: url, title: forcedTitle || prettyTitle(url) });
    tab.cursor = tab.stack.length - 1;
    tab.title = forcedTitle || prettyTitle(url);
    const entry = { title: tab.title, url, visitedAt: Date.now() };
    state.history = [entry, ...state.history.filter(item => item.url !== url)].slice(0, 60);
    $('#suggestions').hidden = true;
    $('#addressInput').blur();
    render();
    // This static preview cannot keep arbitrary websites inside its own frame.
    // The native Android build in ../android does: it loads the URL in WebView.
    window.open(url, '_blank', 'noopener,noreferrer');
    toast('تفتح الصفحة في تبويب خارجي في المعاينة. تطبيق Android كيعرضها داخل المتصفح.');
  }

  function newTab() {
    const tab = freshTab();
    state.tabs.push(tab);
    state.currentId = tab.id;
    render();
    $('#addressInput').focus();
  }

  function closeTab(id) {
    if (state.tabs.length === 1) {
      state.tabs[0] = freshTab();
      state.currentId = state.tabs[0].id;
    } else {
      const index = state.tabs.findIndex(tab => tab.id === id);
      state.tabs = state.tabs.filter(tab => tab.id !== id);
      if (state.currentId === id) state.currentId = state.tabs[Math.max(0, index - 1)].id;
    }
    render();
  }

  function home() {
    const tab = currentTab();
    tab.stack = [{ route: HOME, title: 'تبويب جديد' }];
    tab.cursor = 0;
    tab.title = 'تبويب جديد';
    render();
  }

  function goBack() {
    const tab = currentTab();
    if (tab.cursor > 0) { tab.cursor -= 1; render(); }
  }
  function goForward() {
    const tab = currentTab();
    if (tab.cursor < tab.stack.length - 1) { tab.cursor += 1; render(); }
  }

  function toggleBookmark() {
    const route = currentRoute();
    if (!route) { toast('فتح شي موقع أولاً باش تحفظو.'); return; }
    const existing = state.bookmarks.findIndex(item => item.url === route);
    if (existing >= 0) {
      state.bookmarks.splice(existing, 1);
      toast('تحيدات العلامة من المحفوظات.');
    } else {
      state.bookmarks.unshift({ title: prettyTitle(route), url: route });
      toast('تحفظ الموقع في العلامات.');
    }
    render();
  }

  function showPanel(kind) {
    const backdrop = $('#sheetBackdrop');
    const title = $('#sheetTitle');
    const content = $('#sheetContent');
    const tabs = {
      bookmarks: ['العلامات المحفوظة', renderBookmarks],
      history: ['سجل التصفح', renderHistory],
      downloads: ['التنزيلات', renderDownloads],
      settings: ['إعدادات الأداء', renderSettings],
      about: ['عن Neurio', renderAbout],
      menu: ['المزيد', renderMenu],
      tabs: ['علامات التبويب', renderTabList],
      shortcuts: ['المواقع السريعة', renderShortcuts],
    };
    const selected = tabs[kind] || tabs.menu;
    title.textContent = selected[0];
    content.innerHTML = '';
    selected[1](content);
    backdrop.hidden = false;
    $('#closeSheet').focus();
  }

  function empty(icon, heading, copy) {
    const box = document.createElement('div');
    box.className = 'sheet-empty';
    box.innerHTML = `<span class="sheet-empty-icon">${escapeHtml(icon)}</span><b>${escapeHtml(heading)}</b><small>${escapeHtml(copy)}</small>`;
    return box;
  }

  function listRow(item, icon, onOpen, onDelete) {
    const row = document.createElement('div');
    row.className = 'list-row';
    const glyph = document.createElement('span');
    glyph.className = 'list-icon';
    glyph.textContent = icon;
    const main = document.createElement('div');
    main.className = 'list-row-main';
    main.setAttribute('role', 'button');
    main.tabIndex = 0;
    main.innerHTML = `<b>${escapeHtml(item.title || prettyTitle(item.url))}</b><small>${escapeHtml(item.url)}</small>`;
    main.addEventListener('click', onOpen);
    main.addEventListener('keydown', event => { if (event.key === 'Enter') onOpen(); });
    row.append(glyph, main);
    if (onDelete) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'row-delete';
      remove.setAttribute('aria-label', 'حذف');
      remove.textContent = '×';
      remove.addEventListener('click', onDelete);
      row.append(remove);
    }
    return row;
  }

  function renderBookmarks(content) {
    if (!state.bookmarks.length) { content.append(empty('☆', 'مازال ما حفظتي حتى موقع', 'منين تفتح موقع، ضغط على النجمة باش تلقاه هنا بسرعة.')); return; }
    state.bookmarks.forEach((item, index) => content.append(listRow(item, '☆', () => { closeSheet(); navigate(item.url, item.title); }, () => { state.bookmarks.splice(index, 1); persist(); showPanel('bookmarks'); })));
  }
  function renderHistory(content) {
    if (!state.history.length) { content.append(empty('◷', 'السجل فارغ', 'المواقع اللي كتفتح غادي يبانوا هنا.')); return; }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'danger-button';
    clear.textContent = 'مسح سجل التصفح';
    clear.addEventListener('click', () => { state.history = []; persist(); showPanel('history'); toast('تم مسح السجل المحلي.'); });
    content.append(clear);
    state.history.forEach(item => content.append(listRow(item, '◷', () => { closeSheet(); navigate(item.url, item.title); })));
  }
  function renderDownloads(content) {
    content.append(empty('↓', 'مدير التنزيلات في تطبيق Android', 'تطبيق Android يستعمل Download Manager ديال النظام، وكيقدر يستأنف التنزيل إلا كان الخادم كيدعم ذلك. نسخة الويب هنا ما كتسيرش تنزيلات المواقع.'));
    const note = document.createElement('div');
    note.className = 'settings-block';
    note.innerHTML = '<b>نصيحة للاتصال الضعيف</b><p>استعمل Wi‑Fi مستقر، ونزّل ملف واحد فكل مرة. سرعة التنزيل كتبقى مرتبطة بسرعة الشبكة والخادم.</p>';
    content.append(note);
  }
  function renderSettings(content) {
    const saver = document.createElement('div');
    saver.className = 'settings-block setting-line';
    saver.innerHTML = `<div><b>توفير البيانات</b><p>في تطبيق Android كيوقف تحميل الصور عبر الشبكة بعد تفعيل الخيار، وقد يحتاج تحديث الصفحة.</p></div><button class="switch" id="sheetLiteToggle" type="button" role="switch" aria-checked="${state.lite}" aria-label="توفير البيانات"><i></i></button>`;
    content.append(saver);
    $('#sheetLiteToggle', content).addEventListener('click', toggleLite);
    const video = document.createElement('div');
    video.className = 'settings-block';
    video.innerHTML = '<b>الفيديو والجودة</b><p>Neurio ما كيفرضش جودة YouTube. خليه على Auto باش المنصة تختار جودة مناسبة للتدفق؛ Wi‑Fi البطيء ما يقدرش يضمن 720p بلا تقطيع.</p>';
    content.append(video);
    const performance = document.createElement('div');
    performance.className = 'settings-block';
    performance.innerHTML = '<b>الأداء</b><p>التطبيق الأصلي كيستعمل Android System WebView المحدث. الصفحات الثقيلة والفيديوهات كيبقاو محتاجين اتصال وموارد من الجهاز.</p>';
    content.append(performance);
  }
  function renderAbout(content) {
    content.append(empty('N', 'متصفح Neurio', 'متصفح Android خفيف مبني على Android System WebView. يدعم المواقع العادية، التبويبات، العلامات، السجل، ملء الشاشة، والتنزيلات.'));
    const note = document.createElement('div');
    note.className = 'settings-block';
    note.innerHTML = '<b>مهم تعرف</b><p>هذا ليس نسخة من Chromium أو Chrome بكامل مزاياه. الإضافات ومزامنة حساب Google غير مضمنة. لا يمكن لأي تطبيق زيادة سرعة الإنترنت أو تجاوز حدود الموقع أو حقوق الفيديو.</p>';
    content.append(note);
  }
  function renderMenu(content) {
    const options = [
      ['＋', 'تبويب جديد', newTab], ['☆', 'العلامات', () => showPanel('bookmarks')],
      ['◷', 'السجل', () => showPanel('history')], ['↓', 'التنزيلات', () => showPanel('downloads')],
      ['⚙', 'إعدادات الأداء', () => showPanel('settings')], ['i', 'عن التطبيق', () => showPanel('about')],
    ];
    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    options.forEach(([icon, label, action]) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'menu-item';
      button.innerHTML = `<span>${escapeHtml(icon)}</span><b>${escapeHtml(label)}</b>`;
      button.addEventListener('click', () => { closeSheet(); action(); });
      grid.append(button);
    });
    content.append(grid);
  }
  function renderTabList(content) {
    state.tabs.forEach(tab => {
      const route = tab.stack?.[tab.cursor]?.route;
      content.append(listRow({ title: tab.title || 'تبويب جديد', url: route || 'صفحة رئيسية جديدة' }, '▢', () => { state.currentId = tab.id; closeSheet(); render(); }, () => { closeTab(tab.id); showPanel('tabs'); }));
    });
    const add = document.createElement('button');
    add.className = 'primary-link'; add.type = 'button'; add.textContent = '＋ تبويب جديد'; add.style.marginTop = '17px';
    add.addEventListener('click', () => { closeSheet(); newTab(); });
    content.append(add);
  }
  function renderShortcuts(content) {
    const note = document.createElement('div'); note.className = 'settings-block';
    note.innerHTML = '<b>اختصارات البداية</b><p>اختصارات Google وYouTube وWikipedia والخرائط مضافة للتجربة. تطبيق Android كيفتح المواقع مباشرة داخل WebView.</p>';
    content.append(note);
  }
  function closeSheet() { $('#sheetBackdrop').hidden = true; }
  function toggleLite() {
    state.lite = !state.lite;
    render();
    const toggle = $('#sheetLiteToggle');
    if (toggle) toggle.setAttribute('aria-checked', String(state.lite));
    toast(state.lite ? 'تفضيل توفير البيانات تفعّل. في المعاينة ما كيبدلش تحميل المواقع الخارجية.' : 'تفضيل توفير البيانات توقف.');
    if (!$('#sheetBackdrop').hidden) showPanel('settings');
  }
  function updateConnection() {
    const pill = $('#connectionPill');
    if (!navigator.onLine) {
      pill.classList.add('offline');
      $('#connectionText').textContent = 'بلا اتصال';
      return;
    }
    pill.classList.remove('offline');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const type = connection?.effectiveType;
    $('#connectionText').textContent = type ? `متصل · ${type.toUpperCase()}` : 'متصل بالإنترنت';
  }

  $('#addressForm').addEventListener('submit', event => { event.preventDefault(); navigate($('#addressInput').value); });
  $('#heroSearchForm').addEventListener('submit', event => { event.preventDefault(); const value = $('#heroSearchInput').value; $('#addressInput').value = value; navigate(value); });
  $('#addressInput').addEventListener('input', event => {
    $('#clearAddress').hidden = !event.target.value;
    $('#suggestions').hidden = Boolean(event.target.value.trim());
  });
  $('#addressInput').addEventListener('focus', () => { if (!$('#addressInput').value.trim()) $('#suggestions').hidden = false; });
  $('#addressInput').addEventListener('keydown', event => { if (event.key === 'Escape') $('#suggestions').hidden = true; });
  $('#clearAddress').addEventListener('click', () => { $('#addressInput').value = ''; $('#clearAddress').hidden = true; $('#addressInput').focus(); });
  $('#suggestions').addEventListener('click', event => { const button = event.target.closest('[data-query]'); if (button) { $('#addressInput').value = button.dataset.query; navigate(button.dataset.query); } });
  $('#backButton').addEventListener('click', goBack);
  $('#forwardButton').addEventListener('click', goForward);
  $('#homeButton').addEventListener('click', home);
  $('#mobileHome').addEventListener('click', home);
  $('#mobileTabs').addEventListener('click', () => showPanel('tabs'));
  $('#tabCountButton').addEventListener('click', () => showPanel('tabs'));
  $('#newTabButton').addEventListener('click', newTab);
  $('#bookmarkCurrent').addEventListener('click', toggleBookmark);
  $('#liteToggle').addEventListener('click', toggleLite);
  $('#themeButton').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; render(); });
  $('#aboutButton').addEventListener('click', () => showPanel('about'));
  $('#menuButton').addEventListener('click', () => showPanel('menu'));
  $('#mobileMenu').addEventListener('click', () => showPanel('menu'));
  $('#editShortcuts').addEventListener('click', () => showPanel('shortcuts'));
  $('#returnHome').addEventListener('click', home);
  $('#closeSheet').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', event => { if (event.target === $('#sheetBackdrop')) closeSheet(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSheet(); $('#suggestions').hidden = true; } });
  $$('[data-panel]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  $$('.shortcut-card[data-url]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.url, button.dataset.title)));
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  (navigator.connection || navigator.mozConnection || navigator.webkitConnection)?.addEventListener?.('change', updateConnection);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredInstallPrompt = event; $('#installButton').hidden = false;
  });
  $('#installButton').addEventListener('click', async () => {
    if (!deferredInstallPrompt) { toast('من قائمة المتصفح اختار "إضافة إلى الشاشة الرئيسية".'); return; }
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('#installButton').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installButton').hidden = true; toast('تثبت Neurio على جهازك.'); });

  updateConnection();
  render();
})();
