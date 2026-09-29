/* ============================================================================
 * Scam Baqi — desktop.js
 * «ديسكتوب» المكتب: نظام نوافذ كامل داخل اللعبة + التطبيقات (Disscord, Scamazon,
 * AnyViewer, Paint, Recorder, Camera, Notes, Settings…)
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  var root = null, winsEl = null, iconsEl = null, tasksEl = null, startMenu = null;
  var open = [], zTop = 10, api = null;
  var meta = { lessons: [], evidence: { paint: false, rec: false, cam: false }, targets: [], feed: [] };

  var APPS = [
    { id: 'phone', name: 'التيليفون', icon: '📞', w: 720, h: 520, hint: 'الكولات' },
    { id: 'anyviewer', name: 'AnyViewer', icon: '🖥️', w: 660, h: 470, hint: 'دخول عن بعد' },
    { id: 'disscord', name: 'Disscord', icon: '💬', w: 640, h: 470, hint: 'شات' },
    { id: 'scamazon', name: 'Scamazon', icon: '🛒', w: 700, h: 500, hint: 'المتجر' },
    { id: 'notes', name: 'الملاحظات و الدروس', icon: '🗒️', w: 620, h: 470, hint: 'دروس و أهداف' },
    { id: 'paint', name: 'Paint', icon: '🎨', w: 620, h: 470, hint: 'وثيقة مزيفة' },
    { id: 'recorder', name: 'Recorder', icon: '🎥', w: 560, h: 420, hint: 'تسجيل الشاشة' },
    { id: 'camera', name: 'Camera', icon: '📷', w: 560, h: 420, hint: 'تصويرة' },
    { id: 'files', name: 'الملفات', icon: '📁', w: 600, h: 430, hint: 'حفظ / تصفير' },
    { id: 'ai', name: 'الذكاء (AI)', icon: '🧠', w: 680, h: 540, hint: 'AI حقيقي / محلي' },
    { id: 'settings', name: 'الإعدادات', icon: '⚙️', w: 580, h: 480, hint: 'صوت و مساعدة' }
  ];

  // ------------------------------------------------------------------- helpers
  function winEl(app) {
    var w = U.el('div', 'win win-' + app.id);
    w.style.width = app.w + 'px';
    w.style.height = app.h + 'px';
    w.innerHTML =
      '<div class="win-bar">' +
        '<span class="win-title">' + app.icon + ' ' + app.name + '</span>' +
        '<span class="win-btns"><button class="wb-min" title="صغّر">—</button><button class="wb-close" title="سد">✕</button></span>' +
      '</div>' +
      '<div class="win-body"></div>';
    U.on(w.querySelector('.wb-close'), 'click', function (e) { e.stopPropagation(); close(app.id); });
    U.on(w.querySelector('.wb-min'), 'click', function (e) { e.stopPropagation(); minimize(app.id); });
    U.on(w, 'mousedown', function () { focus(app.id); });
    U.on(w, 'touchstart', function () { focus(app.id); });
    var bar = w.querySelector('.win-bar'), drag = null;
    function down(e) {
      if (e.target.closest && e.target.closest('.win-btns')) return;
      var t = e.touches ? e.touches[0] : e;
      drag = { x: t.clientX, y: t.clientY, left: parseFloat(w.style.left) || 0, top: parseFloat(w.style.top) || 0 };
      U.on(document, 'mousemove', move); U.on(document, 'touchmove', move, { passive: false });
      e.preventDefault();
    }
    function move(e) {
      if (!drag) return;
      var t = e.touches ? e.touches[0] : e;
      w.style.left = U.clamp(drag.left + (t.clientX - drag.x), 4, window.innerWidth - 120) + 'px';
      w.style.top = U.clamp(drag.top + (t.clientY - drag.y), 4, window.innerHeight - 80) + 'px';
    }
    function up() {
      drag = null;
      U.on(document, 'mousemove', null); U.on(document, 'touchmove', up);
      document.removeEventListener('mousemove', move); document.removeEventListener('touchmove', move);
    }
    U.on(bar, 'mousedown', down); U.on(bar, 'touchstart', down, { passive: false });
    U.on(document, 'mouseup', up); U.on(document, 'touchend', up);
    return w;
  }

  function find(id) { for (var i = 0; i < open.length; i++) if (open[i].id === id) return open[i]; return null; }
  function focus(id) {
    var o = find(id);
    if (!o) return;
    o.win.style.zIndex = ++zTop;
    if (api) api.sfx('click');
  }

  function openApp(id, opts) {
    if (!api) return null;
    var app = null;
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) app = APPS[i];
    if (!app) return null;
    var existing = find(id);
    if (existing) {
      existing.win.classList.remove('minimized');
      existing.win.style.display = 'flex';
      focus(id);
      if (existing.instance && existing.instance.onShow) existing.instance.onShow(opts);
      return existing;
    }
    var w = winEl(app);
    var n = open.length;
    w.style.left = Math.max(10, Math.round((window.innerWidth - app.w) / 2) + (n % 4) * 24 - 60) + 'px';
    w.style.top = Math.max(8, Math.round((window.innerHeight - app.h) / 2) - 70 + (n % 4) * 20) + 'px';
    winsEl.appendChild(w);
    var body = w.querySelector('.win-body');
    var o = { id: id, app: app, win: w, body: body, instance: null };
    w.style.zIndex = ++zTop;
    open.push(o);
    try {
      o.instance = BUILDERS[id] ? BUILDERS[id](body, o) : null;
    } catch (e) { U.fail('تطبيق ' + app.name + ' طاح: ' + e.message); }
    api.sfx('open');
    taskbar();
    if (o.instance && o.instance.onShow) o.instance.onShow(opts);
    return o;
  }

  function close(id) {
    var o = find(id);
    if (!o) return;
    if (o.instance && o.instance.onClose) o.instance.onClose();
    if (o.win.parentNode) o.win.parentNode.removeChild(o.win);
    open = open.filter(function (x) { return x !== o; });
    if (api) api.sfx('close');
    taskbar();
  }
  function minimize(id) {
    var o = find(id);
    if (!o) return;
    o.win.classList.add('minimized');
    o.win.style.display = 'none';
    if (api) api.sfx('close');
    taskbar();
  }
  function closeAll() { open.slice().forEach(function (o) { close(o.id); }); }
  function taskbar() {
    if (!tasksEl) return;
    U.clear(tasksEl);
    open.forEach(function (o) {
      var b = U.el('button', 'tb-task', o.app.icon + ' ' + o.app.name);
      U.on(b, 'click', function () {
        if (o.win.style.display === 'none') { o.win.style.display = 'flex'; o.win.classList.remove('minimized'); }
        focus(o.id);
      });
      tasksEl.appendChild(b);
    });
  }

  function notify(appId, text, ms) {
    var host = document.getElementById('toasts');
    if (!host) return;
    if (api) api.sfx('notify');
    var who = appId === 'boss' ? '👔 البوس' : appId === 'disscord' ? '💬 Disscord' : appId === 'anyviewer' ? '🖥️ AnyViewer' : 'ℹ️ المكتب';
    var t = U.el('div', 'toast', '<b>' + who + '</b><br>' + text);
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { if (t.parentNode) t.remove(); }, 420); }, ms || 5200);
    if (appId === 'disscord') addFeed(text);
  }
  function addFeed(text) {
    meta.feed.unshift({ t: api ? U.minutes(api.getTime()) : '--:--', text: text });
    meta.feed = meta.feed.slice(0, 40);
    refresh('disscord');
  }

  function setVisible(on) { if (root) U.toggle(root, on); }
  function isVisible() { return !!root && !root.classList.contains('hidden'); }

  // ------------------------------------------------------------------ builders
  var BUILDERS = {};

  // ---- PHONE ----------------------------------------------------------------
  BUILDERS.phone = function (body) {
    body.classList.add('phone-app');
    var holder = U.el('div', 'call-holder');
    body.appendChild(holder);
    if (SWYF.Calls) SWYF.Calls.mount(holder);
    return { onShow: function () { if (SWYF.Calls) SWYF.Calls.focusInput(); }, holder: holder };
  };

  // ---- ANYVIEWER -------------------------------------------------------------
  BUILDERS.anyviewer = function (body) {
    var o = {
      render: function () {
        var caller = api.getCaller();
        U.clear(body);
        if (!caller) {
          body.innerHTML = '<div class="empty">📴 ما كايناش مكالمة دابا.<br><span class="dim">الدخول عن بعد كيتفتح غير وسط كولاية.</span></div>';
          return;
        }
        body.appendChild(U.el('div', 'av-head',
          '<b>🖥️ حاسوب ' + caller.name + '</b> <span class="dim">— ' + caller.city + ' · ' + caller.job + '</span>' +
          '<span class="av-risk ' + (caller.flags.hasBlocklist || caller.scambaiter ? 'risk-on' : '') + '">' +
          (caller.flags.hasBlocklist || caller.scambaiter ? '⚠️ ملف مشبوه' : 'الاتصال مستقر') + '</span>'));
        var grid = U.el('div', 'av-grid');
        caller.facts.forEach(function (f) {
          var taken = caller.leverageUsed.indexOf(f.id) >= 0;
          var card = U.el('div', 'av-file' + (taken ? ' taken' : '') + (f.trap ? ' trap' : ''));
          card.innerHTML = '<div class="av-ic">' + f.icon + '</div><div class="av-name">' + f.file + '</div>' +
            '<div class="av-lab">' + f.label + '</div>' +
            (taken ? '<div class="av-ok">✔ مسروق</div>' : '<div class="av-bar"><i></i></div>');
          U.on(card, 'click', function () { if (!taken) o.open(f, card); });
          grid.appendChild(card);
        });
        body.appendChild(grid);
        body.appendChild(U.el('div', 'av-foot', '<span>🗂️ ' + caller.leverageUsed.length + ' معلومة مجموعين</span>' +
          '<span class="dim">النقل كياخد وقت — الوقت كيدوز على المكالمة</span>'));
      },
      open: function (f, card) {
        if (card.classList.contains('busy')) return;
        card.classList.add('busy');
        var bar = card.querySelector('.av-bar i');
        var secs = f.trap ? 2.4 : U.rnd(2.6, 6.0);
        var t0 = performance.now();
        api.sfx('keypad');
        var iv = setInterval(function () {
          var k = (performance.now() - t0) / (secs * 1000);
          if (bar) bar.style.width = Math.min(100, k * 100) + '%';
          if (Math.random() < 0.22) api.sfx('typing');
          if (k >= 1) {
            clearInterval(iv);
            if (!api.getCaller()) { o.render(); return; }
            SWYF.Calls.giveLeverage(f);
            if (f.trap) { api.sfx('virus'); notify('anyviewer', '⚠️ لقينا ملف «بلوكيست» فيه أرقام مبلّغ عنها… هاد الضحية كتسجل.'); }
            else api.sfx('success');
            o.render();
          }
        }, 90);
        api.timeCost(secs);
      }
    };
    o.render();
    return o;
  };

  // ---- DISSCORD --------------------------------------------------------------
  BUILDERS.disscord = function (body) {
    var o = {
      ch: 0,
      render: function () {
        U.clear(body);
        var wrap = U.el('div', 'dc');
        var side = U.el('div', 'dc-side');
        ['#الجنرال', '#الضحايا', '#حرّاس-السكام', '#البوس'].forEach(function (ch, i) {
          var b = U.el('button', 'dc-ch' + (i === o.ch ? ' on' : ''), ch);
          U.on(b, 'click', function () { o.ch = i; o.render(); api.sfx('click'); });
          side.appendChild(b);
        });
        wrap.appendChild(side);
        var main = U.el('div', 'dc-main'), msgs = U.el('div', 'dc-msgs');
        if (o.ch === 1) {
          var targets = api.getTargets();
          if (!targets.length) msgs.innerHTML = '<div class="empty">ما كايناش ضحايا ف اللائحة. باقي ما دخلتش كولاية.</div>';
          targets.forEach(function (t) {
            msgs.innerHTML += '<div class="dc-target' + (t.done ? ' done' : '') + '">' +
              '<b>' + (t.done ? '✅' : '🎯') + ' ' + t.name + '</b> <span class="dim">' + t.city + ' · ' + t.job + '</span>' +
              '<div class="dim small">' + t.persona.emoji + ' ' + t.persona.label + ' — ' + t.persona.desc + '</div>' +
              (t.tip ? '<div class="dc-tip">💡 ' + t.tip + '</div>' : '') + '</div>';
          });
        } else if (o.ch === 2) {
          msgs.innerHTML =
            '<div class="dc-msg head">🧯 حرّاس السكام — قناة التحذير</div>' +
            '<div class="dc-msg">إلا سولك واحد على «رقم الملف» ولا «عنوان المكتب» — راه سكام بايتر كيلعب معاك.</div>' +
            '<div class="dc-msg">🔴 ملف «بلوكيست» ف حاسوب الضحية = هو كيسجل عليك. سد التيليفون بقا.</div>' +
            '<div class="dc-msg">قاعدة المكتب: <b>سد قبل ما تسول على الكود ولا الفلوس.</b></div>' +
            '<div class="dc-msg dim">(هاد القناة كتبيّن كيفاش كيتعرّف الناس على هاد الحيل ف الواقع.)</div>';
        } else if (o.ch === 3) {
          msgs.innerHTML =
            '<div class="dc-msg head">👔 السيد بولعيد</div>' +
            '<div class="dc-msg">«الكوتا اليومية كتبدل. اللي ما كيوصلش، كيمشي.»</div>' +
            '<div class="dc-msg">«بغيت الأرقام ف التقرير ديال 17:00 — ماشي أعذار.»</div>' +
            '<div class="dc-msg dim">«و اللي كيسدّ الكولات بلا فلوس… غادي نعرفو.»</div>';
        } else {
          var feed = meta.feed || [];
          msgs.innerHTML = '<div class="dc-msg head">#الجنرال — شات المكتب</div>';
          if (!feed.length) msgs.innerHTML += '<div class="dc-msg dim">ما كايناش رسائل دابا…</div>';
          feed.forEach(function (m) { msgs.innerHTML += '<div class="dc-msg"><span class="dim">[' + m.t + ']</span> ' + m.text + '</div>'; });
          var cw = U.pick(D.coworkers);
          msgs.innerHTML += '<div class="dc-msg dim">' + cw.name + ': «' + U.pick(cw.lines).replace(/[«»]/g, '') + '»</div>';
        }
        main.appendChild(msgs);
        var input = U.el('div', 'dc-input');
        input.innerHTML = '<input class="ui-block" placeholder="كتب رسالة…"><button class="ui-block">صيفط</button>';
        var inp = input.querySelector('input'), btn = input.querySelector('button');
        function send() {
          var v = inp.value.trim();
          if (!v) return;
          inp.value = '';
          addFeed('🧑‍💻 نتا: ' + v);
          api.sfx('notify');
          if (/فلوس|كوتا|ضحيه|نصب|سكام|محتال/.test(U.normAr(v)) && Math.random() < 0.5) {
            setTimeout(function () {
              notify('disscord', U.pick(['حسينة: «هضر بالعقل، البوس كيقرا الشات.»', 'مراد: «😂 ما تكتبش هاد الحوايج هنا!»', '👔 البوس غادي يجي…']));
            }, 900);
          }
        }
        U.on(btn, 'click', send);
        U.on(inp, 'keydown', function (e) { if (e.key === 'Enter') send(); });
        main.appendChild(input);
        wrap.appendChild(main);
        body.appendChild(wrap);
      }
    };
    o.render();
    return o;
  };

  // ---- SCAMAZON --------------------------------------------------------------
  BUILDERS.scamazon = function (body) {
    var o = {
      render: function () {
        U.clear(body);
        var st = api.getState();
        body.appendChild(U.el('div', 'shop-head', '<b>🛒 Scamazon</b> <span class="dim">— «كلشي كيوصل ف 30 دقيقة… ولا 3 أيام»</span>' +
          '<span class="wallet">💰 ' + U.money(st.cash) + '</span>'));
        var grid = U.el('div', 'shop-grid');
        D.upgrades.forEach(function (up) {
          var owned = !!st.upgrades[up.id];
          var rich = st.cash >= up.price;
          var c = U.el('div', 'shop-card' + (owned ? ' owned' : '') + (!owned && !rich ? ' poor' : ''));
          c.innerHTML = '<div class="shop-ic">' + up.emoji + '</div><div class="shop-nm">' + up.name + '</div>' +
            '<div class="shop-desc">' + up.desc + '</div><div class="shop-price">' + (owned ? '✔ مملوك' : U.money(up.price)) + '</div>';
          U.on(c, 'click', function () {
            if (owned) return;
            if (!rich) { api.sfx('error'); notify('scamazon', 'ما كايناش فلوس كافيين — خدم كولات أخرى!'); return; }
            if (api.buy(up.id)) { api.sfx('cash'); notify('scamazon', 'شريتي: ' + up.emoji + ' ' + up.name); }
            else api.sfx('error');
            o.render();
          });
          grid.appendChild(c);
        });
        body.appendChild(grid);
      }
    };
    o.render();
    return o;
  };

  // ---- NOTES -----------------------------------------------------------------
  BUILDERS.notes = function (body) {
    var o = {
      render: function () {
        var st = api.getState();
        U.clear(body);
        body.appendChild(U.el('div', 'notes',
          '<h4>🎯 أهداف اليوم ' + st.day + '</h4>' +
          '<ul class="tick">' +
            '<li class="' + (st.earnedToday >= st.quota ? 'ok' : '') + '">الكوتا: ' + U.money(st.earnedToday) + ' / ' + U.money(st.quota) + '</li>' +
            '<li class="' + (st.handled > 0 ? 'ok' : '') + '">كولات معالجة: ' + st.handled + '</li>' +
            '<li class="' + (st.scamsLanded > 0 ? 'ok' : '') + '">سكامات ناجحة: ' + st.scamsLanded + '</li>' +
            '<li class="' + (api.hasEvidence() ? 'ok' : '') + '">وثيقة / تسجيل / تصويرة (كتزيد الدخل)</li>' +
          '</ul>' +
          '<h4>📚 دفتر الدروس — كيفاش الناس كيتعرفو على النصب</h4>' +
          '<div class="lessons">' +
            (meta.lessons.length
              ? meta.lessons.map(function (l) { return '<div class="lesson">' + l + '</div>'; }).join('')
              : '<div class="dim">باقي ما جمعتيش دروس. كل حيلة كتخدمها كتفتح درس ديال الواقع.</div>') +
          '</div>' +
          '<h4>💡 نصائح المكتب</h4><ul class="small">' + D.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'));
      }
    };
    o.render();
    return o;
  };

  // ---- PAINT -----------------------------------------------------------------
  BUILDERS.paint = function (body) {
    body.innerHTML =
      '<div class="paint">' +
        '<div class="paint-bar">' +
          '<button class="p-stamp ui-block">خاتم رسمي</button>' +
          '<button class="p-mrz ui-block">صورة بطاقة</button>' +
          '<button class="p-inv ui-block">فاتورة</button>' +
          '<button class="p-save ui-block primary">استعملها ف المكالمة</button>' +
        '</div><canvas class="paint-canvas" width="560" height="360"></canvas>' +
      '</div>';
    var cv = body.querySelector('canvas'), g = cv.getContext('2d');
    function base() {
      g.fillStyle = '#f7f4ea'; g.fillRect(0, 0, cv.width, cv.height);
      g.direction = 'rtl'; g.textAlign = 'center';
      g.fillStyle = '#25303f'; g.font = 'bold 30px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillText('وثيقة رسمية — إدارة الملفات', cv.width / 2, 58);
      g.font = '22px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillStyle = '#48566b';
      g.fillText('مكتب الاتصال السريع · قسم التحقق', cv.width / 2, 98);
      g.textAlign = 'right';
      g.fillText('رقم الملف: ' + U.irnd(10000, 99999), cv.width - 40, 160);
      g.fillText('التاريخ: ' + new Date().toLocaleDateString('fr-MA'), cv.width - 40, 195);
      g.fillText('المبلغ المؤقت: ' + U.money(U.irnd(2500, 12000)), cv.width - 40, 230);
      g.strokeStyle = '#c0392b'; g.lineWidth = 4;
      g.beginPath(); g.arc(110, 285, 62, 0, 7); g.stroke();
      g.fillStyle = '#c0392b'; g.font = 'bold 20px "Noto Kufi Arabic",sans-serif';
      g.textAlign = 'center'; g.fillText('خاتم', 110, 278); g.fillText('الإدارة', 110, 302);
    }
    base();
    U.on(body.querySelector('.p-stamp'), 'click', function () {
      g.strokeStyle = '#c0392b'; g.beginPath(); g.arc(110, 285, 74, 0, 7); g.stroke();
      g.font = 'bold 16px "Noto Kufi Arabic",sans-serif'; g.fillText('مصادق', 110, 288);
      api.sfx('camera');
    });
    U.on(body.querySelector('.p-mrz'), 'click', function () {
      g.fillStyle = '#d8e6f5'; g.fillRect(cv.width - 230, 250, 190, 95);
      g.fillStyle = '#2b3a4d'; g.textAlign = 'center'; g.font = 'bold 20px "Noto Kufi Arabic",sans-serif';
      g.fillText('صورة بطاقة', cv.width - 135, 302); api.sfx('camera');
    });
    U.on(body.querySelector('.p-inv'), 'click', function () {
      g.fillStyle = '#ffffff'; g.fillRect(30, 320, 500, 28);
      g.fillStyle = '#2b3a4d'; g.textAlign = 'right'; g.font = '20px "Noto Kufi Arabic",sans-serif';
      g.fillText('فاتورة رقم ' + U.irnd(100, 999) + ' — خاصها تدفيع', cv.width - 40, 342); api.sfx('typing');
    });
    U.on(body.querySelector('.p-save'), 'click', function () {
      meta.evidence.paint = true;
      api.evidence('paint', '📄 الوثيقة المزيفة جاهزة — استعملها وسط المكالمة.');
    });
    return {};
  };

  // ---- RECORDER --------------------------------------------------------------
  BUILDERS.recorder = function (body) {
    body.innerHTML = '<div class="rec"><div class="rec-screen"><span class="rec-dot"></span> REC — تسجيل الشاشة</div>' +
      '<p class="dim">التسجيل كيخلي صوت «مكتب رسمي» يبان ف الخلفية — زيادة صغيرة ف الثقة.</p>' +
      '<button class="rec-go ui-block primary">بدا التسجيل</button><div class="rec-wave"></div></div>';
    var wave = body.querySelector('.rec-wave');
    U.on(body.querySelector('.rec-go'), 'click', function () {
      U.clear(wave);
      for (var i = 0; i < 40; i++) { var b = U.el('i'); b.style.height = U.irnd(6, 40) + 'px'; wave.appendChild(b); }
      var iv = setInterval(function () {
        Array.prototype.forEach.call(wave.children, function (c) { c.style.height = U.irnd(6, 40) + 'px'; });
      }, 220);
      setTimeout(function () { clearInterval(iv); }, 4200);
      meta.evidence.rec = true;
      api.sfx('keypad');
      api.evidence('rec', '🎥 التسجيل خدام — غادي يبان ف المكالمة.');
    });
    return {};
  };

  // ---- CAMERA ----------------------------------------------------------------
  BUILDERS.camera = function (body) {
    body.innerHTML = '<div class="cam"><div class="cam-lens"></div>' +
      '<p class="dim">صوّر شاشة الضحية باش تكون عندك «دليل» كيزيد ف نسبة الدخل.</p>' +
      '<button class="cam-go ui-block primary">📷 صوّر</button><div class="cam-shot"></div></div>';
    U.on(body.querySelector('.cam-go'), 'click', function () {
      var caller = api.getCaller();
      body.querySelector('.cam-shot').innerHTML =
        '<div class="shot">🖼️ تصويرة: ' + (caller ? caller.name + ' — ' + caller.facts[0].file : 'شاشة المكتب') + '</div>';
      meta.evidence.cam = true;
      api.sfx('camera');
      api.evidence('cam', '📷 التصويرة محفوظة — دليل ف الملف.');
    });
    return {};
  };

  // ---- FILES -----------------------------------------------------------------
  BUILDERS.files = function (body) {
    var st = api.getState();
    body.innerHTML = '<div class="files">' +
      '<div class="frow"><b>💾 الحفظ</b><span class="dim">اللعبة كتحفظ راسها ف المتصفح — بلا إنترنت.</span></div>' +
      '<div class="frow"><b>📊 الإحصائيات</b><span class="dim">أيام: ' + st.daysSurvived + ' · كولات: ' + st.answered + ' · فلوس: ' + U.money(st.totalEarned) + '</span></div>' +
      '<div class="frow"><b>🧹 تصفير</b><button class="file-reset ui-block danger">امسح كلشي</button></div>' +
      '<div class="frow dim small">كلشي مخزّن محلياً: بلا سيرفر، بلا حساب، بلا تتبع.</div></div>';
    U.on(body.querySelector('.file-reset'), 'click', function () {
      if (confirm('واش متأكد؟ غادي يتمسح كلشي.')) { U.wipe(); location.reload(); }
    });
    return {};
  };

  // ---- AI (local model bridge + offline brain) --------------------------------
  BUILDERS.ai = function (body) {
    var o = {
      render: function () {
        U.clear(body);
        var st = SWYF.ai ? SWYF.ai.status() : { mode: 'brain', online: false };
        var nlu = SWYF.nlu ? SWYF.nlu.selfTest() : { ok: false, total: 0, pass: 0 };
        var box = U.el('div', 'ai-box',
          '<div class="row"><b>🧠 الحالة:</b> ' +
            (st.online ? '<span class="ok">AI حقيقي شغّال — ' + (st.backend || '') + ' · ' + (st.model || '?') +
              ' · ' + st.latency + 'ms</span>'
              : '<span>محرّك محلي مدرّب (offline)</span>') +
          '</div>' +
          '<div class="row dim small">موديل اللغة العصبي: ' + (SWYF.nlu && SWYF.nlu.hasModel() ? 'شغّال ✅' : 'ما كاينش ❌') +
            ' · اختبار: ' + nlu.pass + '/' + nlu.total + ' · كولات متذكّرة: ' + (SWYF.brain ? SWYF.brain.memory.calls.length : 0) +
            ' · ردود AI: ' + (st.replies || 0) + ' · رجوع للمحلي: ' + (st.fallbacks || 0) + '</div>' +

          '<h4>⚙️ اختيار محرّك الهضرة</h4>' +
          '<div class="row">' +
            '<label><input type="radio" name="aimode" value="auto" ' + (st.mode === 'auto' ? 'checked' : '') + '> تلقائي</label>' +
            '<label><input type="radio" name="aimode" value="brain" ' + (st.mode === 'brain' ? 'checked' : '') + '> محلي فقط (offline 100%)</label>' +
            '<label><input type="radio" name="aimode" value="llm" ' + (st.mode === 'llm' ? 'checked' : '') + '> AI الحقيقي</label>' +
          '</div>' +
          '<div class="row"><span class="dim small">العنوان:</span>' +
            '<input type="text" class="ai-url" placeholder="فارغ = نفس السيرفر (api/ai)" value="' + (st.url === '(نفس السيرفر)' ? '' : st.url) + '">' +
            '<button class="ai-save">حفظ و جرّب الاتصال</button></div>' +
          '<div class="row dim small">' + (st.reason || '') + '</div>' +

          '<h4>🗣️ جرّب الهضرة (بلا مكالمة)</h4>' +
          '<div class="row"><input type="text" class="ai-probe" placeholder="مثال: السلام عليكم، شكون معايا؟">' +
            '<button class="ai-send">صيفط</button></div>' +
          '<div class="ai-think dim small">…</div>' +

          '<h4>🔌 كيفاش تشغّل AI حقيقي بلا إنترنت</h4>' +
          '<div class="dim small">ثبّت <b>Ollama</b> ولا <b>LM Studio</b> فالحاسوب ديالك، حمّل موديل صغير (مثال: ' +
            '<span class="mono">ollama pull qwen2.5:3b</span>), من بعد شغّل السيرفر ديال اللعبة: ' +
            '<span class="mono">node tools/scam-ai-server.mjs</span> — اللعبة غادي تلقاه بوحدها و كل شي كيبقى محلي.</div>' +
          '<div class="dim small">بلا موديل محلي، اللعبة كتخدم ب <b>محرّك الحوار المدرّب</b> ديالها: كيفهم الدارجة/العربية و اللاتينية، عندو ذاكرة و كيردّ بجمل متجددة — و هادشي 100% offline.</div>');
        body.appendChild(box);
        var out = box.querySelector('.ai-think');
        var pid = 'probe-in-' + Math.random().toString(36).slice(2);
        box.querySelector('.ai-probe').id = pid;

        U.on(box.querySelector('.ai-save'), 'click', function () {
          var u = box.querySelector('.ai-url').value.trim();
          out.innerHTML = '⏳ كنتحقق…';
          SWYF.ai.setUrl(u).then(function (st2) {
            out.innerHTML = st2.online
              ? '<span class="ok">✅ لقيت الموديل: ' + (st2.model || '?') + ' (' + (st2.backend || '') + ')</span>'
              : '<span class="bad">✖ ما لقيتش موديل. اللعبة غادي تخدم بالمحرّك المحلي.</span>';
            o.render();
          });
        });

        var send = function () {
          var txt = box.querySelector('.ai-probe').value.trim();
          if (!txt) return;
          out.innerHTML = '⏳ كيجاوب…';
          var c = SWYF.callers.createCaller({ day: SWYF.Day.state().day });
          SWYF.brain && SWYF.brain.newCall(c);
          var local = SWYF.brain ? SWYF.brain.respond(c, txt, {}) : null;
          if (!SWYF.ai.isOnline()) {
            out.innerHTML = '<b>🧠 محلي:</b> ' + (local ? local.text : '—') +
              '<div class="dim">(' + (local ? local.move : '') + ')</div>';
            return;
          }
          SWYF.ai.reply(c, txt, { timeout: 25000 }).then(function (r) {
            if (!r) {
              out.innerHTML = '<b>🧠 محلي (الAI ما جاوبش):</b> ' + (local ? local.text : '—') +
                '<div class="dim mono">' + (SWYF.ai.status().reason || '') + '</div>';
              return;
            }
            out.innerHTML = '<b>🧠 AI حقيقي:</b> ' + r.text + '<div class="dim">tags: ' + (r.tags || []).join(', ') + '</div>';
          });
        };
        U.on(box.querySelector('.ai-send'), 'click', send);
        U.on(box.querySelector('.ai-probe'), 'keydown', function (e) { if (e.key === 'Enter') send(); });

        Array.prototype.forEach.call(body.querySelectorAll('input[name=aimode]'), function (r) {
          U.on(r, 'change', function () { SWYF.ai.setMode(this.value); setTimeout(function () { o.render(); }, 900); });
        });
      }
    };
    o.render();
    return o;
  };

  // ---- SETTINGS --------------------------------------------------------------
  BUILDERS.settings = function (body) {
    var o = {
      render: function () {
        U.clear(body);
        var box = U.el('div', 'settings',
          '<label class="srow"><span>🔊 الأصوات</span><input type="checkbox" class="s-sfx" ' + (SWYF.audio.isEnabled() ? 'checked' : '') + '></label>' +
          '<label class="srow"><span>🗣️ الكلام (TTS ديال الجهاز)</span><input type="checkbox" class="s-tts" ' + (SWYF.audio.isVoiceOn() ? 'checked' : '') + '></label>' +
          '<label class="srow"><span>🎵 الموسيقى</span><input type="checkbox" class="s-mus" ' + (SWYF.audio.music.isOn() ? 'checked' : '') + '></label>' +
          '<div class="srow dim small">' + (SWYF.audio.hasArabicVoice()
            ? '✅ كاين صوت عربي ف الجهاز — الجرايات غادين يهضرو.'
            : (SWYF.audio.hasTTS() ? 'ℹ️ ما كاينش صوت عربي مثبّت — الجرايات غادين يهضرو بصوت «بليب» ريترو.' : 'ℹ️ ما كاينش TTS ف هاد المتصفح — غادي نستعملو البليبس.')) + '</div>' +
          '<h4>🎮 التحكم</h4><ul class="keys">' +
            '<li><b>W A S D</b> — المشي</li><li><b>الماوس / السحب</b> — النظر</li>' +
            '<li><b>E</b> — تفاعل</li><li><b>C</b> — تقوّس</li><li><b>Shift</b> — جري</li>' +
            '<li><b>Esc</b> — وقفة</li><li>الهاتف: عصا يسار + سحب يمين + زر تفاعل</li>' +
          '</ul>' +
          '<h4>ℹ️ على اللعبة</h4><p class="dim small">' + D.disclaimer + '</p>' +
          '<div class="dim small">لا إنترنت · لا سيرفر · لا سجلات. الشخصيات كلها مولّدة محلياً.</div>');
        body.appendChild(box);
        U.on(box.querySelector('.s-sfx'), 'change', function () { SWYF.audio.setEnabled(this.checked); });
        U.on(box.querySelector('.s-tts'), 'change', function () { SWYF.audio.setVoice(this.checked); });
        U.on(box.querySelector('.s-mus'), 'change', function () { SWYF.audio.music.set(this.checked); });
      }
    };
    o.render();
    return o;
  };

  // ------------------------------------------------------------------- public
  function init(a) {
    api = a;
    root = document.getElementById('desktop');
    if (!root) return;
    winsEl = document.getElementById('dt-windows');
    iconsEl = document.getElementById('dt-icons');
    tasksEl = document.getElementById('dt-tasks');
    startMenu = document.getElementById('start-menu');
    U.clear(iconsEl);
    APPS.forEach(function (app) {
      var b = U.el('button', 'dt-icon', '<span class="ic">' + app.icon + '</span><span class="nm">' + app.name + '</span><span class="hint">' + app.hint + '</span>');
      U.on(b, 'dblclick', function () { openApp(app.id); });
      U.on(b, 'click', function () { api.sfx('hover'); if (api.isTouch()) openApp(app.id); });
      iconsEl.appendChild(b);
    });
    U.on(document.getElementById('start-btn'), 'click', function () {
      var wasHidden = startMenu.classList.contains('hidden');
      startMenu.classList.toggle('hidden');
      api.sfx('click');
      if (wasHidden) renderStart();
    });
  }

  function renderStart() {
    U.clear(startMenu);
    startMenu.appendChild(U.el('div', 'sm-head', 'مكتب الاتصال السريع <span class="dim">— v1.0 offline</span>'));
    APPS.forEach(function (app) {
      var b = U.el('button', 'sm-item', app.icon + '  ' + app.name);
      U.on(b, 'click', function () { openApp(app.id); startMenu.classList.add('hidden'); });
      startMenu.appendChild(b);
    });
    startMenu.appendChild(U.el('div', 'sm-sep'));
    var b2 = U.el('button', 'sm-item', '🚪 وقفة / القائمة');
    U.on(b2, 'click', function () { SWYF.main.pause(); startMenu.classList.add('hidden'); });
    startMenu.appendChild(b2);
  }

  function refresh(id) {
    var o = find(id);
    if (o && o.instance && o.instance.render) o.instance.render();
  }

  SWYF.Desktop = {
    init: init, open: openApp, close: close, closeAll: closeAll, minimize: minimize,
    notify: notify, addFeed: addFeed, setVisible: setVisible, isVisible: isVisible,
    hasEvidence: function () { return meta.evidence.paint || meta.evidence.rec || meta.evidence.cam; },
    evidenceState: function () { return meta.evidence; },
    lessons: function () { return meta.lessons; },
    addLesson: function (l) {
      if (l && meta.lessons.indexOf(l) < 0 && meta.lessons.length < 40) meta.lessons.push(l);
      refresh('notes');
    },
    setTargets: function (list) { meta.targets = list || []; refresh('disscord'); },
    getTargets: function () { return meta.targets; },
    feed: function () { return meta.feed; },
    reset: function () { meta = { lessons: [], evidence: { paint: false, rec: false, cam: false }, targets: [], feed: [] }; },
    refresh: refresh,
    refreshAll: function () { open.forEach(function (o) { if (o.instance && o.instance.render) o.instance.render(); }); },
    apps: APPS
  };
})();
