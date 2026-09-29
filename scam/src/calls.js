/* ============================================================================
 * Scam Baqi — calls.js
 * واجهة و منطق المكالمة: أزرار الحيل، الكتابة الحرّة، مؤشر الثقة و الشك،
 * الوقت (الصبر)، الأدلة، و الـRemote Access.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  var holder = null, caller = null, busy = false;
  var els = {};

  function personaVoice(c) {
    if (!c) return { pitch: 1, gender: 'm' };
    var base = c.gender === 'f' ? 1.32 : 0.82;
    var mod = { kind: 0.05, fearful: 0.16, skeptic: -0.06, greedy: 0.0, proud: -0.12, grumpy: -0.18, lonely: 0.1, savvy: -0.08 }[c.persona.id] || 0;
    return { pitch: U.clamp(base + mod, 0.4, 1.9), gender: c.gender };
  }
  function rate(c) { return c && c.persona.id === 'grumpy' ? 1.15 : c && c.persona.id === 'savvy' ? 0.95 : 1; }

  // ------------------------------------------------------------------ rendering
  function mount(el) {
    holder = el;
    render();
  }

  function render() {
    if (!holder) return;
    U.clear(holder);
    if (!caller) {
      holder.appendChild(U.el('div', 'call-idle',
        '<div class="idle-ic">📞</div>' +
        '<h3>الخط فارغ</h3>' +
        '<p class="dim">إلا جات كولاية، غادي تسمع التيليفون كيدق. رجّع راسك للديسك باش ترد.</p>' +
        '<div class="idle-tips">' + D.tips.slice(0, 4).map(function (t) { return '<div>' + t + '</div>'; }).join('') + '</div>'));
      return;
    }

    var c = caller;
    var wrap = U.el('div', 'call');

    // ---- caller header
    var head = U.el('div', 'call-head');
    head.innerHTML =
      '<div class="ch-avatar">' + (c.gender === 'f' ? '👩' : '👨') + '</div>' +
      '<div class="ch-id">' +
        '<div class="ch-name">' + c.name + ' <span class="dim">' + c.city + '</span></div>' +
        '<div class="ch-sub">' + c.job + ' · ' + c.persona.emoji + ' ' + c.persona.label + '</div>' +
      '</div>' +
      '<div class="ch-ai" title="' + ((SWYF.ai && SWYF.ai.isOnline()) ? 'AI حقيقي محلي' : 'محرّك محلي مدرّب') + '">' +
        ((SWYF.ai && SWYF.ai.isOnline()) ? '🧠 AI حقيقي' : '🧠 محلي') + '</div>' +
      '<div class="ch-meters">' +
        meter('ثقة', c.trust, 'trust') +
        meter('شك', c.suspicion, 'susp') +
        meter('صبر', U.clamp(c.patience / ((c.persona.patience || 120) + 50) * 100, 0, 100), 'pat') +
      '</div>';
    wrap.appendChild(head);

    // ---- intel panel (facts stolen / persona read)
    var intel = U.el('div', 'call-intel');
    var read = {
      kind: '😇 كيسمعك و كيتكسف يسد — كون ودّي، دير المدح و الفهم.',
      fearful: '😰 كيترعب من السلطة — «المصلحة»، «البنك»، «الغرامة» كيخدمو عليه.',
      skeptic: '🤨 ما كيصدقش بلا ورقة — الوثائق، رقم الملف، التفصيل.',
      greedy: '🤑 الفلوس هي المفتاح — الجايزة، النسبة، «كتربح».',
      proud: '😎 مدح فيه — «راك ذكي»، «مختار من بين 300».',
      grumpy: '😤 قصير البال — خليك سريع و بلا هضرة زايدة.',
      lonely: '🥲 بغا شي واحد يهضر معاه — الكلام العاطفي خدام.',
      savvy: '🧐 واعي: إلا غلطت، سد التيليفون. كتابة أمينة و بلا استعجال.'
    }[c.persona.id];
    intel.innerHTML = '<span class="iq">👂 قراءة الصوت:</span> ' + read +
      (c.leverageUsed.length ? ' <span class="iq ok">🔓 ' + c.leverageUsed.length + ' معلومة مسروقة جاهزة</span>' : ' <span class="iq dim">جمع معلومات ب AnyViewer 🖥️</span>');
    wrap.appendChild(intel);

    // ---- transcript
    var log = U.el('div', 'call-log');
    var history = c.history.slice(-40);
    history.forEach(function (h) {
      var isAgent = h.who === 'agent';
      log.appendChild(U.el('div', 'bub ' + (isAgent ? 'me' : 'them'), (isAgent ? '' : '') + h.text));
    });
    log.appendChild(U.el('div', 'bub sys', '📞 المكالمة مفتوحة · ' + U.minutes(SWYF.Day.time()) + ' · الحاسوب: ' + c.facts.length + ' ملف'));
    wrap.appendChild(log);
    els.log = log;

    // ---- chips
    var chips = U.el('div', 'chips');
    var opts = SWYF.callers.optionsFor(c, { facts: c.facts });
    // group: leverage first, then phase tactics
    c.facts.forEach(function (f) {
      if (c.leverageUsed.indexOf(f.id) < 0) return;
      if (f._usedInTalk) return;
      var b = U.el('button', 'chip lev ui-block', '🔓 ' + f.label + ' — استعملها');
      U.on(b, 'click', function () {
        f._usedInTalk = true;
        doAction({ type: 'leverage', fact: f });
      });
      chips.appendChild(b);
    });
    opts.slice(0, 7).forEach(function (t) {
      var b = U.el('button', 'chip ui-block' + (t.recovery ? ' fix' : '') + (t.ask ? ' ask' : '') + (t.risky ? ' risky' : ''), t.label);
      U.on(b, 'click', function () { doAction({ type: 'tactic', id: t.id }); });
      chips.appendChild(b);
      if (t.risky) b.title = 'خطر: كيزيد الشك إلا ما كانش الضحية خايف/طمّاع';
    });
    var tip = SWYF.callers.advise ? SWYF.callers.advise(c, { facts: c.facts }) : null;
    if (tip) {
      var tb = U.el('button', 'chip tip ui-block', tip.label);
      U.on(tb, 'click', function () { doAction({ type: 'tactic', id: tip.tacticId }); });
      chips.appendChild(tb);
    }
    wrap.appendChild(chips);

    // ---- writer
    var writer = U.el('div', 'writer');
    writer.innerHTML =
      '<input class="ui-block talk" placeholder="كتب اللي بغيت تقول… (مثال: السلام عافاك، كاين ملف رسمي باسمك ف بنك…)" />' +
      '<button class="say ui-block primary">قول 🗣️</button>' +
      '<button class="hang ui-block danger">📴 سد</button>' +
      '<span class="ai-tag">' + ((SWYF.ai && SWYF.ai.isOnline()) ? '🧠 AI محلي: ' + (SWYF.ai.status().model || 'شغّال') : '🧠 محرّك محلي (offline)') + '</span>';
    var input = writer.querySelector('input');
    U.on(writer.querySelector('.say'), 'click', function () {
      var v = input.value.trim();
      if (!v) return;
      input.value = '';
      doAction({ type: 'text', text: v });
    });
    U.on(input, 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); writer.querySelector('.say').click(); }
      e.stopPropagation();
    });
    U.on(writer.querySelector('.hang'), 'click', function () { doAction({ type: 'hangup' }); });
    wrap.appendChild(writer);
    els.input = input;

    holder.appendChild(wrap);
    if (els.log) els.log.scrollTop = els.log.scrollHeight;
  }

  function meter(label, value, cls) {
    return '<div class="mtr ' + cls + '"><span class="m-lab">' + label + '</span>' +
      '<span class="m-bar"><i style="width:' + U.clamp(value, 0, 100) + '%"></i></span>' +
      '<span class="m-val">' + Math.round(value) + '</span></div>';
  }

  // -------------------------------------------------------------------- actions
  function doAction(action) {
    if (!caller || busy) return;
    var c = caller;
    // ── free text: if a local LLM is alive, let it answer (streamed) ─────────
    if (action.type === 'text' && SWYF.ai && SWYF.ai.isOnline()) { doTextLLM(action, c); return; }

    busy = true;
    var upg = SWYF.Day.upgrades();
    var res = SWYF.callers.act(c, action, { upgrades: upg, evidence: SWYF.Desktop.hasEvidence() });
    if (!holder) { busy = false; return; }
    pushTurnUI(res);
    var delay = U.clamp(420 + (res.callerLine || '').length * 18 + U.rnd(0, 380), 620, 3200);
    setTimeout(function () { applyResult(res); }, delay);
  }

  /** player bubble + "typing…" — shared by both paths */
  function pushTurnUI(res) {
    var log = els.log;
    if (log && res && res.playerLine) log.appendChild(U.el('div', 'bub me', res.playerLine));
    var typing = U.el('div', 'bub them typing', '<i></i><i></i><i></i>');
    if (log) { log.appendChild(typing); log.scrollTop = log.scrollHeight; }
    SWYF.audio.sfx('keypad');
    U.clear(document.querySelector('.chips'));
    U.clear(document.querySelector('.writer'));
    return typing;
  }

  /** The real-AI path: async, streamed, with an instant local fallback. */
  function doTextLLM(action, c) {
    busy = true;
    var log = els.log;
    if (log) log.appendChild(U.el('div', 'bub me', action.text));
    var typing = U.el('div', 'bub them typing', '<i></i><i></i><i></i>');
    if (log) { log.appendChild(typing); log.scrollTop = log.scrollHeight; }
    SWYF.audio.sfx('keypad');
    U.clear(document.querySelector('.chips'));
    U.clear(document.querySelector('.writer'));
    var settled = false;
    function finish(llm) {
      if (settled) return;
      settled = true;
      if (caller !== c) { busy = false; return; }
      var res = SWYF.callers.act(c, { type: 'text', text: action.text, llm: llm },
        { upgrades: SWYF.Day.upgrades(), evidence: SWYF.Desktop.hasEvidence() });
      applyResult(res, typing);
    }
    SWYF.ai.reply(c, action.text, {
      onToken: function (t) { if (typing && typing.parentNode) typing.textContent = '✍️ ' + String(t).slice(-150); }
    }).then(function (llm) {
      if (typing && typing.parentNode) typing.textContent = '<i></i><i></i><i></i>';
      finish(llm);
    }, function () { finish(null); });
  }

  /** Render the outcome of a turn (bubbles, voice, rewards, next chips). */
  function applyResult(res, typing) {
    var c = caller;
    if (!c) { busy = false; return; }
    if (typing && typing.parentNode) typing.remove();
    if (!holder) { busy = false; return; }
    var log = els.log;
    if (res.callerLine && log) log.appendChild(U.el('div', 'bub them' + (res.source === 'llm' ? ' llm' : ''), res.callerLine));
    if (log) log.scrollTop = log.scrollHeight;

    // speak it
    var v = personaVoice(c);
    SWYF.audio.speak(res.callerLine || '…', { pitch: v.pitch, gender: v.gender, rate: rate(c) });

    // rewards / lessons
    if (res.money > 0) {
      SWYF.audio.sfx('cash');
      SWYF.Day.takeMoney(res.money, c);
      var pop = U.el('div', 'money-pop', '+' + U.money(res.money));
      holder.appendChild(pop);
      setTimeout(function () { if (pop.parentNode) pop.remove(); }, 1900);
    }
    if (res.lesson) { SWYF.Desktop.addLesson(res.lesson); SWYF.Desktop.notify('lesson', res.lesson, 8000); }
    if (res.kind === 'success') SWYF.audio.sfx('success');
    if (res.virus) { SWYF.Day.infect('scambaiter'); }

    render();

    if (res.hangup || c.ended) {
      busy = false;
      setTimeout(function () { endCall(res); }, 1400);
      return;
    }
    busy = false;
  }

  function endCall(res) {
    if (!caller) return;
    var c = caller;
    var outcome = c.outcome || (c.money > 0 ? 'partial' : 'walked');
    var lesson = null;
    if (outcome === 'scambaiter') lesson = '📌 درس: «بلوكيست» + أسئلة على الملف = سكام بايتر. الحل الوحيد: سد التيليفون قبل ما تسول.';
    else if (outcome === 'hungup') lesson = '📌 درس: الزيادة ف الشك (شك ≥ 96) = الضحية كتسد و كتبلّغ.';
    else if (outcome === 'bored') lesson = '📌 درس: الطمع ف الوقت = خسارة الضحية. الناس اللي كيتعجلو هوما أول علامة.';
    else if (c.money > 0) lesson = U.pick(D.lessons);
    if (lesson) SWYF.Desktop.addLesson(lesson);
    SWYF.Day.finishCall({
      caller: c, outcome: outcome, money: c.money,
      trust: c.trust, suspicion: c.suspicion, virus: outcome === 'scambaiter'
    });
    caller = null;
    window.__swyfCaller = null;
    render();
  }

  // ------------------------------------------------------------------- public
  function begin(c) {
    caller = c;
    window.__swyfCaller = c;                 // used by the desktop's AnyViewer app
    if (SWYF.main && SWYF.main.buffs && SWYF.main.buffs.patience) {
      c.patience += SWYF.main.buffs.patience;   // ☕ coffee bought at the machine
      SWYF.main.buffs.patience = 0;
    }
    c.history = c.history || [];
    c.history.push({ who: 'sys', text: 'الكولاية بدات.' });
    render();
    var v = personaVoice(c);
    var intro = SWYF.callers.openLine ? SWYF.callers.openLine(c) : 'ألو؟ السلام عليكم، شكون؟';
    setTimeout(function () {
      SWYF.audio.speak(intro, { pitch: v.pitch, gender: v.gender, rate: rate(c) });
      if (holder) {
        var log = els.log;
        c.history.push({ who: 'caller', text: intro });
        if (log) { log.appendChild(U.el('div', 'bub them', intro)); log.scrollTop = log.scrollHeight; }
      }
    }, 700);
  }

  function giveLeverage(fact) {
    if (!caller) return null;
    if (!fact) return null;
    // mark for UI: available as a "use it" chip
    render();
    SWYF.Desktop.notify('anyviewer', '🔓 عندك معلومة جديدة: ' + fact.label + ' — استعملها ف المكالمة.');
    return fact;
  }

  function tick(dt) {
    if (!caller || caller.ended) return;
    // patience runs down in real time (coffee / chair slow it)
    var drain = 1 + (caller.persona.id === 'grumpy' ? 0.6 : 0) + (caller.persona.id === 'lonely' ? -0.35 : 0);
    caller.patience = Math.max(0, caller.patience - dt * drain * 0.9);
    if (caller.patience <= 0 && !caller.ended) {
      caller.ended = true; caller.outcome = 'bored';
      var line = 'سمح ليا، عندي حاجة. ما بقاش عندي وقت. سلام.';
      caller.history.push({ who: 'caller', text: line });
      SWYF.audio.speak(line, { pitch: personaVoice(caller).pitch, gender: caller.gender });
      SWYF.audio.sfx('hangup');
      var c = caller;
      setTimeout(function () { if (caller === c) endCall({}); }, 1200);
    }
    // live meters
    if (els && holder && holder.offsetParent !== null) {
      var m = document.querySelectorAll('.m-val');
      if (m && m.length === 3) {
        m[0].textContent = Math.round(caller.trust);
        m[1].textContent = Math.round(caller.suspicion);
        m[2].textContent = Math.round(U.clamp(caller.patience / ((caller.persona.patience || 120) + 50) * 100, 0, 100));
        var bars = document.querySelectorAll('.m-bar i');
        if (bars.length === 3) {
          bars[0].style.width = U.clamp(caller.trust, 0, 100) + '%';
          bars[1].style.width = U.clamp(caller.suspicion, 0, 100) + '%';
          bars[2].style.width = U.clamp(caller.patience / ((caller.persona.patience || 120) + 50) * 100, 0, 100) + '%';
        }
      }
    }
  }

  SWYF.Calls = {
    mount: mount, begin: begin, tick: tick, giveLeverage: giveLeverage,
    active: function () { return caller; },
    isBusy: function () { return busy; },
    focusInput: function () { if (els.input) setTimeout(function () { els.input.focus(); }, 60); },
    render: render,
    endNow: function () { if (caller) { caller.ended = true; caller.outcome = caller.money > 0 ? 'partial' : 'walked'; endCall({}); } }
  };
})();
