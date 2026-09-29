/* ============================================================================
 * Scam Baqi — ai.js
 * Bridge to a *local* language model — the "real AI" mode.
 *
 * The game is 100% offline by default (brain.js). If the player runs a local
 * model (Ollama / LM Studio / llama.cpp / any OpenAI-compatible server) behind
 * tools/scam-ai-server.mjs, callers are then driven by that real LLM with a
 * Darija system prompt, streaming into the call screen.
 *
 * No cloud, no API keys, no telemetry: only same-origin /api/ai/* (the local
 * server) or an endpoint the player types in themselves.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  var state = {
    mode: (U.load && U.load('aiMode', 'auto')) || 'auto',   // auto | brain | llm
    url: (U.load && U.load('aiUrl', '')) || '',             // '' = same origin api/ai
    online: false, backend: '', model: '', reason: '', lastError: '',
    checked: 0, latency: 0, replies: 0, fallbacks: 0, stream: false, probing: false
  };

  function baseUrl() {
    if (state.url) return state.url.replace(/\/+$/, '');
    return '';
  }
  function ep(path) {
    var b = baseUrl();
    if (!b) return 'api/ai' + path;                      // same-origin relative
    if (/\/v1$/.test(b) || /\/api$/.test(b)) return b + path;
    return b + path;
  }

  function fetchT(url, opts, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, ms);
      opts = opts || {};
      if (ctl) opts.signal = ctl.signal;
      fetch(url, opts).then(function (r) {
        clearTimeout(t); resolve(r);
      }).catch(function (e) { clearTimeout(t); reject(e); });
    });
  }

  // -------------------------------------------------------------- probe
  function probe() {
    if (state.mode === 'brain') { state.online = false; state.reason = 'مختار: المحرك المحلي'; return Promise.resolve(status()); }
    state.probing = true;
    var t0 = Date.now();
    return fetchT(ep('/status'), { method: 'GET' }, 2500).then(function (r) { return r.json(); }).then(function (j) {
      state.probing = false;
      state.checked = Date.now();
      state.latency = Date.now() - t0;
      state.online = !!j.online;
      state.backend = j.backend || '';
      state.model = j.model || '';
      state.stream = !!j.streaming;
      state.reason = j.reason || (j.online ? '' : 'ما كاين حتى موديل محلي');
      return status();
    }).catch(function (e) {
      state.probing = false;
      state.checked = Date.now();
      state.online = false;
      state.reason = 'ما لقيتش سيرفر AI محلي';
      state.lastError = String(e && e.message || e);
      return status();
    });
  }

  function status() {
    var b = SWYF.brain && SWYF.brain.memory;
    return {
      mode: state.mode, online: state.online, backend: state.backend, model: state.model,
      reason: state.reason, url: state.url || '(نفس السيرفر)', latency: state.latency,
      replies: state.replies, fallbacks: state.fallbacks, probing: state.probing,
      lastError: state.lastError, stream: state.stream,
      memoryCalls: b ? b.calls.length : 0
    };
  }

  function setMode(m) { state.mode = m; U.save && U.save('aiMode', m); if (m === 'brain') { state.online = false; } else probe(); }
  function setUrl(u) { state.url = String(u || '').trim(); U.save && U.save('aiUrl', state.url); return probe(); }

  // ---------------------------------------------------------- prompt builder
  var SYSTEM = [
    'نتا كتّحرّك شخصية مغربية ف لعبة محادثة هاتفية (لعبة "سكام باقي").',
    'الهضرة ديالك بالدارجة المغربية فقط، قصيرة: جملة ولا جوج (بزاف 40 كلمة).',
    'قواعد صارمة:',
    '1. بقى دايماً ف الشخصية. عمرك ما تقول بلي نتا AI ولا موديل ولا برنامج.',
    '2. ما تعاودش نفس الجملة اللي گلتيها قبل.',
    '3. إلا شتمك اللي قدامك، زعف و رد بجدية (بلا سب). إلا شكّ فيك، دافع على راسك و طلب منه يتأكد.',
    '4. إلا سولك على معلوماتك، جاوب من "المعلومات الثابتة" بلا ما تناقض.',
    '5. إلا هضر معاك على حياة عادية (العائلة، الجو، الكورة، الماكلة…) جاوب بصدق و ضحكة، و من بعد رجّع الهضرة للملف إلا كنتي ماشي "وحيد".',
    '6. ما تسولش على الفلوس من راسك، خلي اللي قدامك هو اللي يقود، و لكن إلا طلب منك فلوس و الثقة عالية وافق بتردد، و إلا الثقة ضعيفة تشك و تسول على التفاصيل.',
    '7. ما تعطيش حتى شي معلومة حقيقية على الاحتيال ولا نصيحة كيفاش يتدار.'
  ].join('\n');

  function personaSheet(caller) {
    var p = caller.persona, bs = caller.backstory || {};
    return [
      '=== الشخصية ديالك (اللي كتهضر) ===',
      'سميتك: ' + caller.name + ' · ' + (caller.gender === 'f' ? 'مرا' : 'راجل') + ' · ' + (bs.age || 35) + ' عام',
      'مدينتك: ' + caller.city + ' · الخدمة: ' + caller.job,
      'طبعك: ' + p.label + ' — ' + p.desc,
      'كيتعصبك: ' + (p.hates || []).join(', ') + ' · كيعجبك: ' + (p.wants || []).join(', '),
      'خُلقك الخاص: ' + caller.quirk,
      '=== المعلومات الثابتة (ما تناقضهمش) ===',
      'الجهة: ' + (caller.brand && (caller.brand.bank || caller.brand.net)) + ' · رقم الموظف: ' + bs.empId +
        ' · القسم: ' + bs.dept + ' · رقم الملف: ' + bs.fileId + ' · تلفون المصلحة: ' + bs.orgPhone,
      'منين جبت الرقم: ' + bs.how,
      'المبلغ اللي كتهضر عليه: ' + U.money(bs.money)
    ].join('\n');
  }

  function stateSheet(caller) {
    var b = caller.brain || {};
    var lev = (caller.leverageUsed || []);
    return [
      '=== حالة المكالمة ===',
      'الثقة: ' + Math.round(caller.trust) + '/100 · الشك: ' + Math.round(caller.suspicion) + '/100 · الصبر: ' + Math.round(caller.patience) + ' ثانية',
      'المرحلة: ' + caller.phase,
      'معلومات سرقها منك اللي قدامك: ' + (lev.length ? lev.join(', ') : 'ما عندو حتى حاجة'),
      'آخر كلمة قالها: ' + (b.lastClaim ? 'كيدّعي بلي ' + b.lastClaim : '—')
    ].join('\n');
  }

  var CONTRACT = 'جاوب دابا بهضرة الشخصية فقط (بلا أي شرح)، و ف آخر سطر زيد بالضبط: %%{"trust":N,"susp":N,"ask":null,"hangup":false} '
    + '(trust و susp مابين -15 و +15 و كيمثلو التغيير، ask يكون null ولا "small" ولا "big" إلا كان اللي قدامك طلب فلوس، hangup دير true إلا بغيتي تسد التيفون دابا).';

  function buildMessages(caller, playerText, opts) {
    var msgs = [{ role: 'system', content: SYSTEM + '\n\n' + personaSheet(caller) + '\n\n' + stateSheet(caller) + '\n\n' + CONTRACT }];
    // one compact few-shot turn keeps small local models on-format
    msgs.push({ role: 'user', content: 'السلام عليكم، معاك الشرطة' });
    msgs.push({ role: 'assistant', content: 'ألو، السلام… الشرطة؟ {agent} أنا من المصلحة، ماشي الشرطة. عافاك وضّح ليا.\n%%{"trust":-2,"susp":6,"ask":null,"hangup":false}' });
    var hist = (caller.history || []).slice(-8);
    for (var i = 0; i < hist.length; i++) {
      var h = hist[i];
      if (h.who === 'agent') msgs.push({ role: 'user', content: String(h.text).slice(0, 240) });
      else msgs.push({ role: 'assistant', content: String(h.text).slice(0, 240) });
    }
    msgs.push({ role: 'user', content: String(playerText || '').slice(0, 400) });
    return msgs;
  }

  // --------------------------------------------------------------- parsing
  function parseControl(text) {
    var m = /%%\s*(\{[\s\S]*?\})\s*$/.exec(text);
    var ctl = null;
    if (m) {
      try { ctl = JSON.parse(m[1]); } catch (e) { ctl = null; }
      text = text.slice(0, m.index).trim();
    }
    // some models wrap the tag in <...> or put it on its own line with spaces
    text = text.replace(/^\s*%%\s*\{[\s\S]*\}\s*$/m, '').trim();
    text = text.replace(/^["«]|["»]$/g, '').trim();
    return { text: text, ctl: ctl };
  }

  function themesFromCtl(ctl, nlu) {
    var tags = (nlu && nlu.themes ? nlu.themes.slice() : []);
    if (!ctl) return tags;
    if (ctl.ask === 'big' || ctl.ask === 'small') { if (tags.indexOf('greed') < 0) tags.push('greed'); }
    if ((ctl.susp || 0) > 6 && tags.indexOf('anticheat') < 0) tags.push('anticheat');
    return tags;
  }

  /** Call the local model. Resolves null on any failure (caller keeps the local brain's line). */
  function reply(caller, playerText, opts) {
    opts = opts || {};
    if (state.mode === 'brain' || !state.online) return Promise.resolve(null);
    var nlu = (SWYF.nlu && SWYF.nlu.analyze(playerText)) || null;
    var msgs = buildMessages(caller, playerText, opts);
    var body = { messages: msgs, stream: true, temperature: 0.85, max_tokens: 160 };
    var t0 = Date.now();
    return fetchT(ep('/chat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, opts.timeout || 20000).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var ctype = (res.headers.get('content-type') || '');
      if (ctype.indexOf('text/event-stream') >= 0 && res.body) {
        return readStream(res.body, opts.onToken || function () {}).then(function (txt) { return txt; });
      }
      return res.json().then(function (j) {
        var txt = j.text || (j.choices && j.choices[0] && (j.choices[0].message ? j.choices[0].message.content : j.choices[0].text)) || '';
        if (opts.onToken) opts.onToken(txt);
        return txt;
      });
    }).then(function (raw) {
      var p = parseControl(String(raw || ''));
      if (!p.text || p.text.length < 2) throw new Error('empty');
      state.replies++;
      state.latency = Date.now() - t0;
      var ctl = p.ctl || {};
      return {
        text: p.text,
        move: ctl.move || 'llm',
        tags: themesFromCtl(ctl, nlu),
        quality: U.clamp(0.5 + Math.abs((ctl.trust || 3)) * 0.05 + (nlu ? nlu.conf * 0.3 : 0), 0.4, 2),
        ask: ctl.ask ? { kind: ctl.ask, amount: (nlu && nlu.money) || 0 } : null,
        hangupRisk: ctl.hangup ? 0.9 : 0,
        trust: typeof ctl.trust === 'number' ? ctl.trust : null,
        susp: typeof ctl.susp === 'number' ? ctl.susp : null,
        source: 'llm'
      };
    }).catch(function (e) {
      state.fallbacks++;
      state.lastError = String(e && e.message || e);
      return null;
    });
  }

  /** Read an SSE stream (works both for our server and OpenAI-compatible ones). */
  function readStream(stream, onToken) {
    if (typeof TextDecoder === 'undefined') return Promise.resolve('');
    var reader = stream.getReader(), dec = new TextDecoder(), buf = '', out = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return out;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') return out;
          var tok = '';
          try {
            var j = JSON.parse(payload);
            tok = j.t != null ? j.t : (j.token || (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '');
          } catch (e) { tok = payload; }
          if (tok) { out += tok; onToken(tok); }
        }
        return pump();
      });
    }
    return pump();
  }

  /** Quick "is the AI really alive?" test used by the in-game AI app. */
  function test() {
    var caller = SWYF.callers && SWYF.callers.createCaller ? SWYF.callers.createCaller({ day: 1 }) : null;
    if (!caller) return Promise.resolve({ ok: false, error: 'ما كاينش شخصية' });
    if (SWYF.brain) SWYF.brain.newCall(caller);
    var t0 = Date.now();
    return reply(caller, 'السلام عليكم، شكون معايا؟', { timeout: 25000 })
      .then(function (r) {
        if (!r) return { ok: false, error: state.lastError || 'ما جاوبش', ms: Date.now() - t0 };
        return { ok: true, text: r.text, ms: Date.now() - t0, source: r.source };
      });
  }

  function init() { return probe(); }

  SWYF.ai = {
    init: init, probe: probe, status: status, reply: reply, test: test,
    setMode: setMode, setUrl: setUrl,
    buildMessages: buildMessages, parseControl: parseControl,
    isOnline: function () { return !!state.online && state.mode !== 'brain'; },
    isStreaming: function () { return !!state.stream; }
  };
})();
