/* ============================================================================
 * Scam Baqi — ui.js
 * القوائم، HUD، النوافذ، التنبيهات، شاشة التقييم، أزرار الهاتف.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  var $ = U.$;
  var H = {};    // hooks from main

  function isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }

  // ------------------------------------------------------------------ screens
  function show(id, on) { var n = document.getElementById(id); if (n) U.toggle(n, on !== false); }
  function hide(id) { show(id, false); }

  function init(hooks) {
    H = hooks || {};
    // menu buttons
    U.on($('#btn-start'), 'click', function () { SWYF.audio.init(); SWYF.audio.resume(); SWYF.audio.sfx('click'); H.onStart && H.onStart(false); });
    U.on($('#btn-continue'), 'click', function () { SWYF.audio.init(); SWYF.audio.resume(); SWYF.audio.sfx('click'); H.onStart && H.onStart(true); });
    U.on($('#btn-how'), 'click', function () { showHelp(true); });
    U.on($('#btn-help-close'), 'click', function () { showHelp(false); });
    U.on($('#btn-brief-go'), 'click', function () { hide('brief'); H.onBriefGo && H.onBriefGo(); });
    U.on($('#btn-board-close'), 'click', function () { hide('board'); });
    U.on($('#btn-virus-fix'), 'click', function () { cleanVirus(); });
    U.on($('#btn-pause'), 'click', function () { SWYF.main.pause(); });
    U.on($('#btn-resume'), 'click', function () { SWYF.main.resume(); });
    U.on($('#btn-pause-settings'), 'click', function () { hide('pause'); SWYF.Desktop.setVisible(true); SWYF.Desktop.open('settings'); });
    U.on($('#btn-restart'), 'click', function () {
      if (confirm('واش بغيت تبدا من جديد؟ غادي تخسر التقدم ديال هاد الـrun.')) { SWYF.Day.resetRun(); location.reload(); }
    });
    U.on($('#btn-menu'), 'click', function () { hide('pause'); SWYF.main.toMenu(); });
    U.on($('#btn-shop-go'), 'click', function () { hide('shop-between'); H.onShopGo && H.onShopGo(); });
    U.on($('#btn-review-go'), 'click', function () { hide('review'); H.onReviewGo && H.onReviewGo(); });
    U.on($('#btn-over-again'), 'click', function () { SWYF.Day.resetRun(); location.reload(); });
    U.on($('#btn-win-continue'), 'click', function () { hide('win'); H.onWinContinue && H.onWinContinue(); });
    U.on($('#btn-win-menu'), 'click', function () { hide('win'); SWYF.main.toMenu(); });

    // mobile controls
    var stick = $('#joy'), knob = $('#joy-knob'), act = $('#btn-act'), jump = $('#btn-run');
    U.on(window, 'stick', function (p) {
      if (!knob) return;
      knob.style.transform = 'translate(' + (p.x * 34) + 'px,' + (p.y * 34) + 'px)';
    });
    U.on(act, 'click', function () { if (H.onAction) H.onAction(); });
    U.on(jump, 'click', function () { SWYF.main.keys.ShiftLeft = !SWYF.main.keys.ShiftLeft; jump.classList.toggle('on'); });

    U.on(window, 'keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.code === 'Escape') {
        var p = document.getElementById('pause');
        if (p && p.classList.contains('hidden')) { if (H.onPause) H.onPause(); }
        else if (H.onResume) H.onResume();
      }
      if (e.code === 'KeyR') cleanVirus();
    });
    if (isTouch()) U.show($('#touch-ui'));
  }

  function showHelp(on) {
    var box = $('#help');
    if (on) {
      $('#help-body').innerHTML =
        '<h3>كيفاش تلعب</h3>' +
        '<ol>' +
        '<li>🖥️ <b>قاعَد ف الديسك</b> (زر تفاعل عند الكرسي) باش ترد على الكولات و تخدم ف الديسكتوب.</li>' +
        '<li>📞 <b>رد على الكولاية</b>: كتب اللي بغيت ولا ختار من الأزرار. حافظ على <b>الثقة (ثقة)</b> و خلي <b>الشك (شك)</b> هابط.</li>' +
        '<li>🖥️ <b>AnyViewer</b>: قبل ما تسول على الفلوس، دخل لحاسوب الضحية و سرق معلومة (البنك، الولد، الرصيد…) و استعملها ف الهضرة.</li>' +
        '<li>🎨 <b>Paint / Camera / Recorder</b>: صاوب وثيقة مزيفة ولا دليل — كيزيد ف نسبة الدخل.</li>' +
        '<li>💰 <b>الكوتا</b>: خاصك توصل للرقم قبل 18:00. إلا ما وصلتيش، البوس كيطردك.</li>' +
        '<li>🚨 <b>الأحداث</b>: فيروس، مداهمة، ضربة جوية، ضو مقطوع… كل واحد عندو حل (زر، ولا بلاصة كتمشي ليها).</li>' +
        '<li>🛒 <b>Scamazon</b>: بين النهارات شري ترقيات (سماعات، VPN، مضاد فيروسات…).</li>' +
        '</ol>' +
        '<h4>⚠️ ملاحظة</h4><p class="dim">' + D.disclaimer + '</p>';
      show('help', true);
    } else hide('help');
  }

  // ---------------------------------------------------------------------- HUD
  function hud(on) { show('hud', on !== false); }
  function refreshHud() {
    var st = SWYF.Day.state();
    var el = $('#hud');
    if (!el) return;
    $('#hud-day').textContent = 'اليوم ' + st.day;
    $('#hud-clock').textContent = U.minutes(SWYF.Day.time());
    var quotaPct = U.clamp((st.earnedToday / Math.max(1, st.quota)) * 100, 0, 100);
    $('#hud-bar i').style.width = quotaPct + '%';
    $('#hud-earned').textContent = U.money(Math.max(0, st.earnedToday)) + ' / ' + U.money(st.quota);
    $('#hud-cash').textContent = '💰 ' + U.money(st.cash);
    $('#hud-nerves i').style.width = st.nerves + '%';
    $('#hud-nerves').className = 'hud-nerves' + (st.nerves < 35 ? ' low' : '');
  }
  function flashQuota(amount) {
    var box = $('#hud-flash');
    if (!box) return;
    var n = U.el('div', 'flash', '+' + U.money(amount));
    box.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.remove(); }, 1800);
  }

  // -------------------------------------------------------------------- toasts
  function toast(text, ms) {
    var host = $('#toasts');
    if (!host) return;
    var t = U.el('div', 'toast sys', text);
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { if (t.parentNode) t.remove(); }, 400); }, ms || 4800);
  }

  // ------------------------------------------------------- modal with countdown
  function alertBox(title, text, actionLabel, seconds, onAction, onTimeout) {
    var box = $('#alert');
    box.innerHTML =
      '<div class="alert-card">' +
        '<h3>' + title + '</h3><p>' + text + '</p>' +
        '<div class="alert-row"><button class="ui-block primary" id="alert-go">' + actionLabel + '</button>' +
        '<span class="alert-timer" id="alert-timer">' + Math.round(seconds) + 's</span></div>' +
      '</div>';
    show('alert', true);
    var left = seconds, done = false;
    var iv = setInterval(function () {
      left -= 0.1;
      var t = $('#alert-timer');
      if (t) t.textContent = Math.max(0, Math.round(left * 10) / 10) + 's';
      if (left <= 0) { fail(); }
    }, 100);
    function cleanup() { clearInterval(iv); hide('alert'); }
    function ok() { if (done) return; done = true; cleanup(); SWYF.audio.sfx('success'); onAction && onAction(); }
    function fail() { if (done) return; done = true; cleanup(); SWYF.audio.sfx('error'); onTimeout && onTimeout(); }
    U.on($('#alert-go'), 'click', ok);
  }

  // ----------------------------------------------------------- incoming call
  var ringIv = null;
  function showRing(caller, secs, cb) {
    var box = $('#ringing');
    box.innerHTML =
      '<div class="ring-card">' +
        '<div class="ring-avatar">' + (caller.gender === 'f' ? '👩' : '👨') + '</div>' +
        '<div class="ring-info"><b>كولاية داخلة…</b>' +
          '<span>' + caller.name + ' — ' + caller.city + '</span>' +
          '<span class="dim small">' + caller.persona.emoji + ' ' + caller.persona.label + ' · ' + caller.job + '</span>' +
        '</div>' +
        '<div class="ring-btns"><button class="ui-block primary" id="ring-answer">رد 📞</button>' +
        '<button class="ui-block danger" id="ring-reject">رفض 📴</button></div>' +
        '<div class="ring-timer" id="ring-timer">' + Math.round(secs) + '</div>' +
      '</div>';
    show('ringing', true);
    var left = secs;
    U.on($('#ring-answer'), 'click', function () { cb.answer && cb.answer(); });
    U.on($('#ring-reject'), 'click', function () { cb.reject && cb.reject(); });
    if (ringIv) clearInterval(ringIv);
    ringIv = setInterval(function () {
      left -= 1;
      var t = $('#ring-timer');
      if (t) t.textContent = Math.max(0, left);
      if (left % 4 === 0 && left > 0) SWYF.audio.sfx('ring');
    }, 1000);
  }
  function hideRing() { if (ringIv) clearInterval(ringIv); ringIv = null; hide('ringing'); }

  // ------------------------------------------------------------------ brief
  function showBrief(day, quota, cb) {
    var el = $('#brief');
    el.querySelector('.brief-body').innerHTML =
      '<div class="brief-boss">👔</div>' +
      '<h3>السيد بولعيد — اليوم ' + day + '</h3>' +
      '<p class="boss-line">' + quote(U.pick(D.boss.lines.intro)) + '</p>' +
      '<div class="brief-quota">🎯 الكوتا ديال اليوم: <b>' + U.money(quota) + '</b></div>' +
      '<div class="brief-tips">' + D.tips.slice(0, 5).map(function (t) { return '<div>' + t + '</div>'; }).join('') + '</div>';
    show('brief', true);
    H.onBriefGo = function () { cb && cb(); };
  }

  // ------------------------------------------------------------------ review
  // «juste guillemets» — jamais de guillemets doubles si la ligne en a déjà
  function quote(t) {
    t = String(t == null ? '' : t).replace(/[«»]/g, '').replace(/^\s*"|"\s*$/g, '').trim();
    return '«' + t + '»';
  }

  function showReview(outcome, cb) {
    var rating = outcome.rating;
    var bossLine = rating === 'fired' ? U.pick(D.boss.lines.fired) : rating === 'great' ? U.pick(D.boss.lines.great) : rating === 'ok' ? U.pick(D.boss.lines.ok) : U.pick(D.boss.lines.bad);
    bossLine = quote(bossLine);
    var el = $('#review');
    el.querySelector('.review-body').innerHTML =
      '<div class="rev-boss">👔</div>' +
      '<h3>تقييم الأداء — نهاية اليوم</h3>' +
      '<div class="rev-line">' + bossLine + '</div>' +
      '<div class="rev-grid">' +
        '<div><span class="dim">اللي جمعتي</span><b>' + U.money(outcome.earned) + '</b></div>' +
        '<div><span class="dim">الكوتا</span><b>' + U.money(outcome.quota) + '</b></div>' +
        '<div><span class="dim">النتيجة</span><b class="' + (outcome.passed ? 'ok' : 'bad') + '">' + (outcome.passed ? 'قبلت ✅' : 'مطرود ❌') + '</b></div>' +
      '</div>' +
      (outcome.passed ? '<p class="dim">النسبة ديالك: ' + Math.round((outcome.earned / outcome.quota) * 100) + '% — ' +
        (rating === 'great' ? 'بوس غادي يفتخر بيك (و غادي يعطيك بونص).' : 'ماشي خايب، ولكن البوس بغا أكثر.') + '</p>'
        : '<p class="dim">ما وصلتيش للكوتا. الحل: جمع معلومات ب AnyViewer، استعمل الحيل اللي كتمشي مع الشخصية، و ردّ بسرعة.</p>');
    show('review', true);
    SWYF.audio.speak(bossLine.replace(/[«»]/g, ''), { pitch: 0.55, rate: 0.95 });
    H.onReviewGo = function () { cb && cb(); };
  }

  // --------------------------------------------------------------- shop modal
  function showShopBetweenDays(cb) {
    var el = $('#shop-between');
    el.querySelector('.sb-body').innerHTML = '<h3>🛒 بين الشيفتات — تشراو حوايج؟</h3><div class="sb-wallet">💰 ' + U.money(SWYF.Day.state().cash) + '</div><div class="sb-grid"></div>';
    var grid = el.querySelector('.sb-grid');
    function draw() {
      var st = SWYF.Day.state();
      el.querySelector('.sb-wallet').textContent = '💰 ' + U.money(st.cash);
      U.clear(grid);
      D.upgrades.forEach(function (up) {
        var owned = !!st.upgrades[up.id];
        var rich = st.cash >= up.price;
        var c = U.el('div', 'shop-card' + (owned ? ' owned' : '') + (!owned && !rich ? ' poor' : ''),
          '<div class="shop-ic">' + up.emoji + '</div><div class="shop-nm">' + up.name + '</div>' +
          '<div class="shop-desc">' + up.desc + '</div><div class="shop-price">' + (owned ? '✔ مملوك' : U.money(up.price)) + '</div>');
        U.on(c, 'click', function () {
          if (owned) return;
          if (!rich) { SWYF.audio.sfx('error'); return; }
          SWYF.Day.buy(up.id);
          SWYF.audio.sfx('cash');
          draw();
        });
        grid.appendChild(c);
      });
    }
    draw();
    show('shop-between', true);
    H.onShopGo = function () { cb && cb(); };
  }

  // ------------------------------------------------------------------ endings
  function showGameOver(stats, day) {
    var el = $('#over');
    el.querySelector('.over-body').innerHTML =
      '<div class="over-ico">📦</div><h2>YOU ARE FIRED!!!</h2>' +
      '<p class="dim">البوس دار لائحة جديدة… و سميتك كانت فيها.</p>' +
      '<div class="stats">' +
        '<div><span>وصلتي لليوم</span><b>' + day + '</b></div>' +
        '<div><span>كولات معالجة</span><b>' + stats.answered + '</b></div>' +
        '<div><span>فلوس مجموعين</span><b>' + U.money(stats.totalEarned) + '</b></div>' +
        '<div><span>فيروسات</span><b>' + stats.viruses + '</b></div>' +
      '</div>' +
      '<p class="dim small">' + D.disclaimer + '</p>';
    show('over', true);
  }
  function showWin(stats, day, cash) {
    var el = $('#win');
    el.querySelector('.win-body').innerHTML =
      '<div class="over-ico">🏆</div><h2>رقية!</h2>' +
      '<p>7 أيام، 7 كوطات… البوس قال ليك: <i>«راك مشرف دابا»</i> — و عندك مكتب جديد و مندوبين تحتك.</p>' +
      '<div class="stats">' +
        '<div><span>أيام</span><b>' + day + '</b></div>' +
        '<div><span>كولات</span><b>' + stats.answered + '</b></div>' +
        '<div><span>فلوس</span><b>' + U.money(stats.totalEarned) + '</b></div>' +
        '<div><span>الكاش ديالك</span><b>' + U.money(cash) + '</b></div>' +
      '</div>' +
      '<p class="dim small">تقدر تكمل ف «وضع الحرية» بلا كوتا… ولا تبدا run جديد و تعرف راسك كيفاش كتنصب — و كيفاش كيتعرفو عليك.</p>';
    show('win', true);
    H.onWinContinue = function () { SWYF.Day.startDay(day + 1); };
  }

  // ------------------------------------------------------------------ effects
  function virus(on) {
    var v = $('#virus');
    if (!v) return;
    if (on) {
      U.show(v);
      U.clear(v);
      var btn = U.el('div', 'virus-fix ui-block', '🧯 كليكي هنا باش تنظّف النظام (R)');
      U.on(btn, 'click', cleanVirus);
      v.appendChild(btn);
      U.on(btn, 'mousedown', cleanVirus);
    } else U.hide(v);
  }
  function cleanVirus() {
    if (!SWYF.Day.S.virusT) return;
    SWYF.Day.S.virusT = 0;
    SWYF.Day.S.upgrades.antivirus ? SWYF.audio.sfx('success') : SWYF.audio.sfx('cash');
    virus(false);
    toast(SWYF.Day.S.upgrades.antivirus ? '🛡️ المضاد ديالك مسح الفيروس ف ثانية.' : '🧹 نظّفت النظام. خدمة مزيانة!');
    SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves + 5, 0, 100);
    refreshHud();
  }
  function vignette(color) {
    var v = $('#vignette');
    if (!v) return;
    v.className = color ? 'on ' + color : '';
  }
  function shake(mag, time) { if (H.player) H.player.shake(mag, time); }
  function setInteract(label) {
    var el = $('#interact');
    if (!el) return;
    if (label) { el.textContent = (isTouch() ? '👆 ' : '[E] ') + label; U.show(el); }
    else U.hide(el);
  }
  function seatForCall() {
    if (H.seat) H.seat(true);
  }

  // --------------------------------------------------------------- whiteboard
  function showBoard() {
    var st = SWYF.Day.state();
    var lessons = SWYF.Desktop.lessons();
    var body = $('#board-body');
    if (body) {
      body.innerHTML =
        '<div class="logo">📋</div><h3>اللوحة — اليوم ' + st.day + '</h3>' +
        '<div class="rev-grid">' +
          '<div><span class="dim">الكوتا</span><b>' + U.money(st.quota) + '</b></div>' +
          '<div><span class="dim">جمعتي</span><b class="' + (st.earnedToday >= st.quota ? 'ok' : 'bad') + '">' + U.money(Math.max(0, st.earnedToday)) + '</b></div>' +
          '<div><span class="dim">كاش</span><b>' + U.money(st.cash) + '</b></div>' +
          '<div><span class="dim">توتر</span><b>' + Math.round(st.nerves) + '%</b></div>' +
        '</div>' +
        '<h4>📚 آخر الدروس</h4>' +
        '<div class="lessons">' + (lessons.length
          ? lessons.slice(-3).map(function (l) { return '<div class="lesson">' + l + '</div>'; }).join('')
          : '<div class="dim">باقي ما كاينش. كمّل كولات باش تفتح الدروس.</div>') + '</div>' +
        '<p class="dim small">' + D.disclaimer + '</p>';
    }
    show('board', true);
    SWYF.audio.sfx('open');
  }

  SWYF.ui = {
    init: init, hud: hud, refreshHud: refreshHud, flashQuota: flashQuota, toast: toast,
    alert: alertBox, showRing: showRing, hideRing: hideRing, showBrief: showBrief,
    showReview: showReview, showShopBetweenDays: showShopBetweenDays,
    showGameOver: showGameOver, showWin: showWin, showHelp: showHelp,
    virus: virus, vignette: vignette, shake: shake, setInteract: setInteract, showBoard: showBoard,
    seatForCall: seatForCall, isTouch: isTouch, show: show, hide: hide
  };
})();
