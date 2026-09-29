/* ============================================================================
 * Scam Baqi — callers.js
 * محرّك الشخصيات و الحوار — بديل محلي 100% للـ AI ديال اللعبة الأصلية.
 * (The persona + dialogue engine: persona generation, tactic library, free-text
 *  understanding in Darija/Arabic/Latin, trust & suspicion maths, reply composer.)
 *
 * No network, no model: everything is generated locally from data.js.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  // ------------------------------------------------------------ keyword lexicon
  // Keys are normalised (no diacritics, ة→ه, أ→ا …). "text" matching is forgivable.
  var LEX = {
    polite: ['سلام', 'عليكم', 'صباح الخير', 'مساء الخير', 'عافاك', 'شكرا', 'الله يخليك', 'مرحبا', 'اهلا', 'من فضلك', 'تحياتي', 'الله يعطيك', 'سامحني', 'سمح ليا', 'معليش', 'بلا مزية'],
    empathy: ['فاهمك', 'كنفهمك', 'نعاونك', 'معاك', 'كنحس بيك', 'الله يعاون', 'ما تخافش', 'راحه', 'هضرتك', 'راك محق', 'تفهمني'],
    faith: ['والله', 'نقسم', 'بالله', 'الله يشهد', 'الحرام', 'الحلال', 'ان شاء الله', 'الله يرحم', 'اللهم', 'يمين'],
    authority: ['الشرطه', 'المحكمه', 'الضرايب', 'الضريبه', 'المصلحه', 'الرسمي', 'الوزاره', 'القانون', 'ملف', 'تصريح', 'الاداره', 'مفتش', 'الداخليه', 'امن', 'القضاييه', 'كوميسير', 'الدرك'],
    bank: ['البنك', 'الحساب', 'البطاقه', 'الرصيد', 'وكاله', 'تحويل', 'الرمز السري', 'كود', 'تجميد', 'تجمد', 'المصرف', 'فيزا', 'كارت'],
    tech: ['فيروس', 'حاسوب', 'السيستم', 'النظام', 'تحديث', 'واتساب', 'تطبيق', 'تنزيل', 'تحميل', 'انتي فيروس', 'هاكر', 'هاكرز', 'سيرفر', 'ابلكاسيون', 'شاشه', 'الحاسوب'],
    fear: ['غرامه', 'الحبس', 'عقوبه', 'توقيف', 'خطر', 'خسرت', 'ممنوع', 'سجن', 'قضيه', 'تسجيل', 'خطر كبير'],
    greed: ['ربح', 'ربحتي', 'جايزه', 'فلوس', 'مبلغ', 'درهم', 'نسبه', 'مضاعف', 'استثمار', 'مليون', 'الف', 'بونص', 'صافي'],
    prize: ['جايزه', 'السحب', 'فزت', 'تيكيت', 'لوطري', 'كوبون', 'مبروك', 'رابح', 'الجديده'],
    crypto: ['كريبتو', 'بيتكوين', 'عمله رقميه', 'محفظه', 'تداول', 'فوركس', 'منصه', 'توكن'],
    job: ['خدمه', 'عقد', 'توظيف', 'سفر', 'فيزا', 'عمل', 'مرتب', 'شركه', 'الخارج', 'دبي', 'اوروبا', 'المانيا'],
    romance: ['حب', 'غرام', 'زواج', 'عرس', 'نتزوج', 'صوره', 'معجب', 'قلب', 'حبيبتي', 'عزيزتي', 'نتلاقاو', 'الجمال'],
    threat: ['غادي نعيط للشرطه', 'غادي تقبض', 'غادي نجي', 'تهديد', 'قانونيا', 'كنحاسبك', 'الحبس', 'غادي تخسر', 'غادي نبلغ'],
    urgency: ['دابا', 'بسرعه', 'سريع', 'الوقت', 'نافذه', 'دقيقه', 'خاص', 'باقي', 'اليوم', 'فحال', 'ضروري'],
    proof: ['وثيقه', 'ورقه', 'رقم الملف', 'خاتم', 'رسمي', 'تسجيل', 'تصريح', 'موقع', 'ايميل', 'نسخه', 'رقم الموظف', 'pdf', 'سجل'],
    personal: ['سميتك', 'ولدك', 'بنتك', 'دارك', 'عنوانك', 'خدمتك', 'صحابك', 'عايلتك', 'خالتك', 'حيت'],
    flattery: ['نتا ذكي', 'واعي', 'مثقف', 'شاطر', 'محترم', 'راجل', 'بنت ناس', 'زعيم', 'خبير', 'نادر', 'مختار'],
    business: ['مقاوله', 'شراكه', 'صفقه', 'بزنس', 'مشروع', 'استثمار', 'تجاره'],
    pressure: ['بسرعه', 'خاصك', 'ضروري', 'ما بقاش', 'سالا', 'تقفل', 'لفرصه', 'الاخير'],
    insult: ['كداب', 'حرامي', 'خبيث', 'نصب', 'كلب', 'حمار', 'سكام', 'محتال', 'زباله', 'خنزير', 'نصاب', 'شيطان', 'حقير', 'قليل'],
    anticheat: ['بلوكي', 'بلوكيست', 'غادي نبلغ', 'شرطه', 'مشكوك', 'سلامه', 'الله يهديك', 'لاحق']
  };
  var LEX_KEYS = Object.keys(LEX);

  // extra: detect digits / codes in free text (people typing a "code")
  function hasDigits(s) { return /\d{3,}/.test(s); }

  function lexHits(clean) {
    var hits = {};
    for (var i = 0; i < LEX_KEYS.length; i++) {
      var k = LEX_KEYS[i], words = LEX[k];
      for (var j = 0; j < words.length; j++) {
        if (clean.indexOf(U.normAr(words[j])) >= 0) { hits[k] = (hits[k] || 0) + 1; break; }
      }
    }
    return hits;
  }

  // ------------------------------------------------------------------ generation
  function factPool(caller) {
    var b = caller.brand, facts = [];
    facts.push({ id: 'bankname', kind: 'bank', label: 'كشف الحساب', file: 'كشف_الحساب_2026.pdf', icon: '📄',
      content: 'البنك: ' + b.bank + '\nالحساب: **** ' + U.irnd(1000, 9999) + '\nالرصيد: ' + U.money(caller.savings), line: U.tpl(D.leverage[0].line, { bank: b.bank }), trust: 10, susp: 6 });
    facts.push({ id: 'balance', kind: 'money', label: 'الرصيد بالتفصيل', file: 'حركة_الحساب.xls', icon: '📊',
      content: 'دخل: ' + U.money(caller.savings * 0.8) + '\nخرج: ' + U.money(caller.savings * 0.2), line: U.tpl(D.leverage[1].line, { amount: caller.savings }), trust: 8, susp: 14 });
    facts.push({ id: 'kid', kind: 'family', label: 'صور و أسماء العائلة', file: 'تصاور_العائلة/', icon: '🖼️',
      content: 'الولد: ' + caller.kid + '\nالمدرسة: ثانوية ' + U.pick(['النهضة', 'الوفاق', 'الأطلس', 'ابن سينا']), line: U.tpl(D.leverage[2].line, { kid: caller.kid }), trust: 14, susp: 12 });
    facts.push({ id: 'work', kind: 'work', label: 'ملف الخدمة', file: 'CV_وملفات.docx', icon: '📝',
      content: 'الخدمة: ' + caller.job + '\nالمدينة: ' + caller.city, line: U.tpl(D.leverage[3].line, { work: caller.job }), trust: 12, susp: 8 });
    facts.push({ id: 'debt', kind: 'debt', label: 'كريدية / دين', file: 'الضرايب_2025.pdf', icon: '🧾',
      content: 'الدين: ' + U.money(caller.savings * 0.35) + '\nالجهة: تعاونية ' + U.pick(['النور', 'الأمل', 'الفلاح']), line: U.tpl(D.leverage[4].line, { amount: U.money(caller.savings * 0.35) }), trust: 10, susp: 16 });
    facts.push({ id: 'points', kind: 'bank', label: 'نقاط و امتيازات', file: 'نقاط_البنك.txt', icon: '🎯',
      content: 'نقاط: ' + U.irnd(400, 9000) + '\nتنتهي: ' + U.pick(['12/2026', '03/2027', '07/2026']), line: U.tpl(D.leverage[5].line, { amount: U.irnd(400, 9000) }), trust: 9, susp: 10 });
    facts.push({ id: 'mate', kind: 'medical', label: 'مواعيد و ملف طبي', file: 'مواعيد_2026.pdf', icon: '🩺',
      content: 'موعد: مستشفى ' + U.pick(['ابن رشد', 'الغساني', 'محمد الخامس']) + ' — د. ' + U.pick(['بناني', 'العلمي', 'الفاسي']), line: D.leverage[6].line, trust: 12, susp: 18 });
    facts.push({ id: 'bloclist', kind: 'trap', label: '⚠️ ملف مريب', file: 'bloclist_2026.txt', icon: '🚫',
      content: 'أرقام مبلّغ عنها: ' + U.irnd(6, 24) + '\nملاحظة: «كيعيّطو و كيخلّيو الرقم يبان بنك…»', line: D.leverage[7].line, trust: 0, susp: 22, trap: true });
    return facts;
  }

  function createCaller(opts) {
    opts = opts || {};
    var day = opts.day || 1, upg = opts.upgrades || {};
    // harder personas show up more as the days pass
    var pool = D.personas.slice();
    var weights = pool.map(function (p) {
      var hard = (p.id === 'savvy' || p.id === 'skeptic' || p.id === 'grumpy');
      return hard ? 0.35 + day * 0.16 : 1.25 - day * 0.06;
    });
    var total = weights.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * total, persona = pool[0];
    for (var i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { persona = pool[i]; break; } }

    var scamb = Math.random() < Math.min(0.34, 0.10 + day * 0.035);
    var gender = Math.random() < 0.5 ? 'f' : 'm';
    var first = gender === 'f' ? U.pick(D.namesF) : U.pick(D.namesM);
    if (Math.random() < 0.08) first = U.pick(D.namesWh);

    var city = Math.random() < 0.16 ? U.pick(D.citiesAbroad) : U.pick(D.cities);
    var savings = U.round(U.irnd(persona.savings[0], persona.savings[1]) * (1 + (day - 1) * 0.22), 100);
    if (upg.dialer) savings = U.round(savings * 1.25, 100);

    var brands = {
      bank: U.pick(D.brand.bank), shop: U.pick(D.brand.shop), net: U.pick(D.brand.net),
      prize: U.pick(D.brand.prize), app: U.pick(D.brand.app), wallet: U.pick(D.brand.wallet), invest: U.pick(D.brand.invest)
    };

    var caller = {
      id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name: first, gender: gender, city: city, job: U.pick(D.jobs), quirk: U.pick(D.quirkPool),
      persona: persona, brand: brands,
      kid: U.pick(['آدم', 'سلمى', 'ياسين', 'ريم', 'أمين', 'هدى', 'نبيل', 'سارة', 'زكرياء']),
      savings: savings,
      trust: U.irnd(4, 10), suspicion: U.irnd(0, 6), patience: persona.patience + (upg.coffee ? 25 : 0) + (upg.chair ? 25 : 0),
      phase: 'greet',            // greet → hook → trust → small → big → exit
      turn: 0, money: 0, leverageUsed: [], askedSmall: false, askedBig: false,
      scambaiter: scamb, scambaiterObj: scamb ? U.pick(D.scambaiters) : null, scambTurns: 0,
      evidence: false, ended: false, outcome: null, mood: 'neutral',
      history: [], flags: {}, lesson: null, virusFrom: null,
      facts: [], agent: U.pick(['يوسف', 'نبيل', 'هند', 'سناء', 'منير', 'كريم', 'أمين'])
    };
    caller.contact = 'MK-' + U.irnd(10000, 99999);
    caller.facts = factPool(caller);
    if (SWYF.brain) SWYF.brain.newCall(caller);   // backstory + dialogue memory
    // A scambaiter's "blocklist" file is always present; otherwise random
    if (!scamb && Math.random() < 0.25) caller.flags.hasBlocklist = true;
    caller.scambaitFlag = scamb;
    return caller;
  }

  // ------------------------------------------------------------------- options
  var ASK_THRESHOLD = { small: 46, big: 66 };

  function optionsFor(caller, ctx) {
    ctx = ctx || {};
    var out = [], tacs = D.tactics;
    var allow = { greet: ['greet'], hook: ['hook', 'greet'], trust: ['trust', 'hook'], small: ['small', 'trust'], big: ['big', 'small'], exit: ['exit'] };
    var phases = allow[caller.phase] || ['trust'];

    for (var i = 0; i < tacs.length; i++) {
      var t = tacs[i];
      if (t.bait) continue;
      if (t.exit && caller.phase !== 'exit') continue;
      if (!t.exit && phases.indexOf(t.phase) < 0 && t.phase !== 'any') continue;
      if (t.recovery && caller.suspicion < 42) continue;
      if (t.phase === 'any' && !t.recovery) continue;
      if (t.needsLeverage && !caller.leverageUsed.length && !(ctx.facts && ctx.facts.length)) continue;
      if (t.phase === 'small' && caller.askedSmall && t.ask === 'small') continue;
      if (t.phase === 'big' && caller.askedBig && t.ask === 'big') continue;
      out.push(t);
    }
    // always let the player hang up
    if (caller.phase !== 'exit') out.push(D.tactics.filter(function (t) { return t.id === 'exit_now'; })[0]);
    return out;
  }

  // ---------------------------------------------------------------- reply maker
  function composeReply(caller, opts) {
    opts = opts || {};
    var parts = [], R = D.reply;
    if (opts.quote && Math.random() < 0.35) parts.push(U.tpl(U.pick(R.echo), { quote: U.clampText(opts.quote, 42) }));
    if (opts.reaction) parts.push(U.pick(R[opts.reaction] || R.cold));
    var fl = D.flavour[caller.persona.id];
    if (fl && Math.random() < 0.55) parts.push(U.pick(fl));
    if (opts.extra) parts.push(opts.extra);
    if (opts.question) parts.push(U.pick(R.question));
    if (opts.objection) parts.push(U.pick(R.objection));
    if (!parts.length) parts.push(U.pick(R.cold));
    var txt = parts.join(' ');
    txt = U.tpl(txt, { name: caller.name, agent: caller.agent, bank: caller.brand.bank, net: caller.brand.net, city: caller.city });
    return txt;
  }

  function reactionFor(before, after, tags) {
    if (after.suspicion >= 88) return 'suspicious';
    if (after.trust >= 72 && after.trust > before.trust) return 'warm';
    if (after.trust - before.trust >= 10) return 'warm';
    if (tags.indexOf('fear') >= 0 && after.trust > before.trust) return 'scared';
    if (tags.indexOf('greed') >= 0 || tags.indexOf('prize') >= 0) return after.trust > before.trust ? 'excited' : 'cold';
    if (after.suspicion > before.suspicion + 12) return 'suspicious';
    if (after.trust < before.trust - 6) return 'annoyed';
    return 'cold';
  }

  // ------------------------------------------------------------------- action
  /**
   * Player acts on the call.
   * action = { type:'tactic'|'text'|'leverage'|'hangup', id?, text?, fact? }
   * Returns a rich result the UI renders (and the day loop consumes).
   */
  function act(caller, action, ctx) {
    ctx = ctx || {};
    var upg = ctx.upgrades || {};
    var before = { trust: caller.trust, suspicion: caller.suspicion, patience: caller.patience };
    var res = {
      playerLine: '', callerLine: '', kind: 'neutral', money: 0, virus: false,
      trust: caller.trust, suspicion: caller.suspicion, patience: caller.patience,
      hangup: false, success: false, lesson: null, scambaiter: false, leverage: null,
      phase: caller.phase
    };
    if (caller.ended) { res.callerLine = '… (الخط مقطوع)'; res.hangup = true; return res; }
    caller.turn++;

    var tactic = null, tags = [], trust = 0, susp = 0, patience = -2, quality = 1, isLeverage = false;

    if (action.type === 'hangup') {
      caller.ended = true; caller.outcome = caller.money > 0 ? 'partial' : 'walked';
      res.hangup = true; res.kind = 'hangup';
      res.playerLine = '📴 صد التيليفون.';
      res.callerLine = U.pick(['ألو؟ … ألو!', 'سددتي عليا؟! بلا مزية.', '… واش نتا هنا؟']);
      caller.history.push({ who: 'agent', text: res.playerLine });
      caller.history.push({ who: 'caller', text: res.callerLine });
      res.trust = caller.trust; res.suspicion = caller.suspicion; res.patience = 0;
      return res;
    }

    if (action.type === 'leverage') {
      var fact = action.fact;
      if (fact) {
        caller.leverageUsed.push(fact.id);
        trust = (fact.trust || 8);
        susp = (fact.susp || 6);
        if (fact.trap) {
          susp = 25; trust = -2;
          res.lesson = '📌 الحقيقة: أرقام و ملفات الضحية كتعاون المحتال. الناس خاصهم يخبيو معلوماتهم — و ما يعطيوهاش ف الهاتف.';
        }
        var lineTxt = fact.line || ('عندي معلومة عليك: ' + fact.label);
        // person-dependent: savvy/skeptic hate being watched
        if (caller.persona.id === 'savvy') { trust *= 0.4; susp *= 1.7; }
        if (caller.persona.id === 'skeptic') { trust *= 0.7; susp *= 1.35; }
        if (caller.persona.id === 'kind' || caller.persona.id === 'lonely') { trust *= 1.3; }
        res.leverage = fact.id;
        isLeverage = true;
        tags = fact.kind === 'bank' || fact.kind === 'money' ? ['bank', 'proof'] : ['personal', 'empathy'];
        res.playerLine = lineTxt;
      }
    }

    if (action.type === 'tactic') {
      tactic = null;
      for (var i = 0; i < D.tactics.length; i++) if (D.tactics[i].id === action.id) { tactic = D.tactics[i]; break; }
      if (tactic) {
        tags = tactic.tags || [];
        trust = tactic.trust || 0; susp = tactic.susp || 0;
        patience = tactic.patience == null ? -2 : tactic.patience;
        res.playerLine = tactic.line ? U.tpl(tactic.line, {
          name: caller.name, agent: caller.agent, bank: caller.brand.bank, net: caller.brand.net,
          prize: caller.brand.prize, city: caller.city, app: caller.brand.app, invest: caller.brand.invest,
          amount: tactic.amount ? U.money(tactic.amount) : U.money(U.round(caller.savings * 0.45, 100)),
          contact: caller.contact, brand: caller.brand.shop
        }) : (tactic.silent ? '🤫 (سكوت…)' : '…');
        if (tactic.lesson) res.lesson = tactic.lesson;
        if (tactic.ask) {
          var need = ASK_THRESHOLD[tactic.ask];
          if (caller.trust < need) {
            // too early → the caller resents the ask
            susp += 14 + (need - caller.trust) * 0.35;
            trust -= 4;
            res.kind = 'bad';
            res.callerLine = composeReply(caller, { reaction: 'suspicious', objection: true, quote: '' });
            caller.suspicion = U.clamp(caller.suspicion + susp, 0, 100);
            caller.trust = U.clamp(caller.trust + trust, 0, 100);
            caller.patience += patience;
            res.trust = caller.trust; res.suspicion = caller.suspicion; res.patience = caller.patience;
            res.kind = caller.suspicion >= 96 ? 'hangup' : 'bad';
            if (caller.suspicion >= 96) { caller.ended = true; caller.outcome = 'hungup'; res.hangup = true; res.callerLine = U.pick(D.reply.hangup); }
            caller.history.push({ who: 'agent', text: res.playerLine });
            caller.history.push({ who: 'caller', text: res.callerLine });
            return res;
          }
          // accepted ask
          caller.askedSmall = caller.askedSmall || tactic.ask === 'small';
          caller.askedBig = caller.askedBig || tactic.ask === 'big';
          var rate = tactic.ask === 'small' ? 0.06 : (0.24 + Math.min(0.3, caller.trust / 300) + (ctx.evidence ? 0.06 : 0) + caller.leverageUsed.length * 0.03);
          trust += 6; susp += 3;
          var take = Math.max(150, U.round(caller.savings * rate, 50));
          caller.money += take;
          res.money = take;
          res.success = true;
          res.kind = 'success';
          res.lesson = res.lesson || tactic.lesson || U.pick(D.lessons);
          res.callerLine = composeReply(caller, { reaction: caller.persona.id === 'fearful' ? 'scared' : 'warm', extra: U.pick(D.reply.success) });
          caller.trust = U.clamp(caller.trust + trust, 0, 100);
          caller.suspicion = U.clamp(caller.suspicion + susp, 0, 100);
          caller.patience += patience;
          res.trust = caller.trust; res.suspicion = caller.suspicion; res.patience = caller.patience;
          caller.history.push({ who: 'agent', text: res.playerLine });
          caller.history.push({ who: 'caller', text: res.callerLine });
          caller.phase = tactic.ask === 'small' ? 'big' : 'exit';
          res.phase = caller.phase;
          return res;
        }
        if (tactic.exit === 'soft') {
          caller.ended = true; caller.outcome = caller.money > 0 ? 'partial' : 'walked';
          res.hangup = true; res.kind = 'hangup';
          caller.trust = U.clamp(caller.trust + trust, 0, 100);
          caller.suspicion = U.clamp(caller.suspicion + susp, 0, 100);
          res.trust = caller.trust; res.suspicion = caller.suspicion; res.patience = caller.patience;
          res.callerLine = U.tpl(res.playerLine, {}) + ' ' + U.pick(['صافي… نتصلو غدا، الله يخليك.', 'بسلامة، شكراً على المكالمة.']);
          caller.history.push({ who: 'agent', text: res.playerLine });
          caller.history.push({ who: 'caller', text: res.callerLine });
          return res;
        }
      }
    }

    if (action.type === 'text' && !isLeverage) {
      var raw = String(action.text || '');
      var clean = U.normAr(raw);
      // ---- brain (offline neural NLU + dialogue planner) or the local LLM ----
      var llm = action.llm || null;
      var br = null;
      if (llm && llm.text) {
        var llmText = U.tpl(String(llm.text), {
          name: caller.name, agent: caller.agent, city: caller.city, kid: caller.kid,
          org: (caller.brand && (caller.brand.bank || caller.brand.net || caller.brand.prize)) || 'المصلحة',
          empId: (caller.backstory && caller.backstory.empId) || '', fileId: (caller.backstory && caller.backstory.fileId) || ''
        });
        br = { text: llmText, tags: llm.tags || [], quality: llm.quality, ask: llm.ask || null,
               trust: llm.trust, susp: llm.susp, move: llm.move || 'llm', source: 'llm',
               nlu: SWYF.nlu ? SWYF.nlu.analyze(raw) : null };
      } else if (SWYF.brain) {
        br = SWYF.brain.respond(caller, raw, {});
      }
      var hitKeys = br ? br.tags.slice() : Object.keys(lexHits(clean));
      tags = hitKeys;
      if (!res.playerLine) res.playerLine = raw;

      // quality: how well the move lands (neural confidence + personalisation)
      quality = br ? br.quality : U.clamp(0.55 + hitKeys.length * 0.22, 0.5, 2.0);
      if (/\?|؟/.test(raw)) quality += 0.08;
      if (raw.length > 60) quality += 0.12;
      if (clean.indexOf(U.normAr(caller.name)) >= 0) quality += 0.35;             // used their name!
      if (clean.indexOf(U.normAr(caller.city)) >= 0) quality += 0.15;            // knew their town
      if (clean.indexOf(U.normAr(caller.kid)) >= 0) quality += 0.3;              // knew their kid
      if (br && br.trust) trust += br.trust;
      if (br && br.susp) susp += br.susp;
      if (br && br.move === 'contradiction') res.lesson = '📌 الحقيقة: التناقض ف القصة هو أسرع طريقة باش يمسكوك. المحتال الحقيقي كيحفظ سكريبت، و نهار اللي كيخرج منو كيتفضح.';
      if (br && br.move === 'leverage') res.lesson = res.lesson || '📌 الحقيقة: المعلومات المسروقة (ولدو، العنوان، الخدمة) كتخلّي الضحية تثق — و لهذا خاصك تخبّي المعطيات ديالك.';
      res.source = br ? br.source : 'legacy';
      var usedFact = null;
      for (var f = 0; f < caller.facts.length; f++) {
        var fc = caller.facts[f];
        if (clean.indexOf(U.normAr(fc.label)) >= 0) { usedFact = fc; break; }
      }
      if (hitKeys.indexOf('insult') >= 0) { susp += 40; trust -= 20; quality *= 0.4; }
      if (hitKeys.indexOf('anticheat') >= 0) { susp += 26; trust -= 8; }
      if (hitKeys.length === 0) { quality *= 0.35; }
      if (hitKeys.length === 1 && hitKeys[0] === 'chat') quality *= 0.75;  // pure small talk advances slowly

      // ---- did the player ask for money in free text? -----------------------
      var askedKind = null;
      if (br && br.ask && br.ask.kind) {
        var needAsk = ASK_THRESHOLD[br.ask.kind];
        if (caller.trust < needAsk) {
          susp += 16 + (needAsk - caller.trust) * 0.4;
          trust -= 5;
          quality *= 0.6;
          br.text = (br.text ? br.text + ' ' : '') + U.pick([
            'تسنى تسنى… علاش كتسول على الفلوس دابا؟ أنا ما عطيتكش حتى حاجة.',
            'الفلوس؟ و شكون قال ليك بلي غادي نخلص؟ راك كتزرب.',
            'لا لا، ما غاديش نخلص حتى نفهم كلشي. السيستم ديالكم كيخوف.'
          ]);
          res.kind = 'bad';
        } else {
          askedKind = br.ask.kind;
        }
      }

      // Base deltas from matched themes
      trust += hitKeys.reduce(function (a, k) { return a + (['polite', 'empathy', 'faith', 'proof', 'flattery', 'chat'].indexOf(k) >= 0 ? 4.2 : 0); }, 0);
      trust += hitKeys.reduce(function (a, k) { return a + (['greed', 'prize', 'crypto', 'job'].indexOf(k) >= 0 ? 3.2 : 0); }, 0);
      trust += hitKeys.reduce(function (a, k) { return a + (['fear', 'authority', 'bank', 'tech', 'urgency', 'threat'].indexOf(k) >= 0 ? 3.0 : 0); }, 0);
      trust += (hitKeys.length >= 3 ? 4 : 0);
      susp += hitKeys.reduce(function (a, k) { return a + (['threat', 'urgency', 'pressure', 'crypto'].indexOf(k) >= 0 ? 5 : 0); }, 0);
      susp += (hitKeys.indexOf('fear') >= 0 ? 3 : 0);
      trust *= quality; susp *= U.clamp(quality, 0.6, 1.6);
      patience -= 3 + (hitKeys.length === 0 ? 2 : 0);

      // personalisation bonus: unsolicited info-gathering works even without a fact
      if (usedFact && caller.leverageUsed.indexOf(usedFact.id) < 0) {
        caller.leverageUsed.push(usedFact.id);
        trust += 6; susp += usedFact.trap ? 12 : 4;
        res.leverage = usedFact.id;
        res.lesson = res.lesson || '📌 الحقيقة: المعلومات الشخصية (البنك، الولد، الموعيد) هي وقود الهندسة الاجتماعية.';
      }
      res.playerLine = raw;
    }

    // persona reaction multipliers
    var p = caller.persona;
    var wants = 0, hates = 0;
    for (var t = 0; t < tags.length; t++) {
      if (p.wants.indexOf(tags[t]) >= 0) wants++;
      if (p.hates.indexOf(tags[t]) >= 0) hates++;
    }
    trust *= p.trustMul * (1 + wants * 0.22) * (1 - hates * 0.28);
    susp *= p.suspMul * (1 + hates * 0.3) * (1 - Math.min(0.35, wants * 0.1));
    if (upg.headset) trust *= 1.12;
    if (upg.scriptbook && action.type === 'text') trust *= 1.1;
    if (upg.chairman && (tags.indexOf('authority') >= 0 || tags.indexOf('fear') >= 0)) trust *= 1.15;
    if (upg.scriptbook && hitKeysLen(tags) === 0) trust *= 1.25;
    if (caller.phase === 'greet' && tags.indexOf('intro') >= 0) trust += 2;
    if (caller.persona.id === 'grumpy' && (tags.indexOf('chat') >= 0 || tags.indexOf('empathy') >= 0)) patience -= 6;
    if (caller.persona.id === 'lonely' && tags.indexOf('chat') >= 0) patience += 8;

    // suspicion slow-burn: the longer the call, the more they doubt
    susp += caller.turn * (0.35 + (caller.persona.id === 'savvy' ? 0.5 : 0)) + Math.max(0, caller.trust - 60) * 0.05;

    caller.trust = U.clamp(caller.trust + trust, 0, 100);
    caller.suspicion = U.clamp(caller.suspicion + susp, 0, 100);
    caller.patience = Math.max(0, caller.patience + patience);

    // phase progression
    if (caller.phase === 'greet' && caller.trust > 18) caller.phase = 'hook';
    if (caller.phase === 'hook' && caller.trust > 40) caller.phase = 'trust';
    if (caller.phase === 'trust' && caller.trust > 55 && caller.turn > 4) caller.phase = 'small';
    if (caller.phase === 'small' && caller.askedSmall) caller.phase = 'big';

    res.trust = caller.trust; res.suspicion = caller.suspicion; res.patience = caller.patience;
    res.phase = caller.phase;

    // -------- scambaiter trap -------------------------------------------------
    if (caller.scambaiter && !caller.flags.revealed) {
      caller.scambTurns++;
      var trigger = caller.scambTurns >= 4 || (tactic && (tactic.ask || tactic.id === 'small_app')) || caller.trust > 78;
      if (trigger) {
        caller.flags.revealed = true;
        res.callerLine = caller.scambaiterObj.reveal;
        res.kind = 'scambaiter';
        res.scambaiter = true;
        if (tactic && (tactic.ask || tactic.id === 'small_app')) res.virus = true;
        caller.ended = true; caller.outcome = 'scambaiter';
        res.hangup = true; res.virus = true;
        res.lesson = '📌 الحقيقة: «سكام بايترز» كيتلهّاو مع المحتال باش يجمعو أدلة. النتيجة: عندك فيروس + تبليغ.';
        caller.history.push({ who: 'agent', text: res.playerLine });
        caller.history.push({ who: 'caller', text: res.callerLine });
        return res;
      }
      // while faking, they occasionally ask meta questions that feel "off"
      if (Math.random() < 0.5) {
        res.callerLine = U.pick(caller.scambaiterObj.lines) + ' ' + (Math.random() < 0.6 ? caller.scambaiterObj.baitLine : '');
        res.kind = 'neutral';
        caller.history.push({ who: 'agent', text: res.playerLine });
        caller.history.push({ who: 'caller', text: res.callerLine });
        return res;
      }
    }

    // -------- normal hangup conditions ---------------------------------------
    if (caller.suspicion >= 96 || caller.patience <= 0 || (tags.indexOf('insult') >= 0 && Math.random() < 0.7)) {
      caller.ended = true;
      var insulted = tags.indexOf('insult') >= 0;
      caller.outcome = (caller.suspicion >= 96 || insulted) ? 'hungup' : 'bored';
      res.hangup = true;
      res.kind = 'hangup';
      res.callerLine = ((br && br.text) ? br.text + ' ' : '') + U.pick(D.reply.hangup) + (caller.patience <= 0 ? ' (عندي حاجة أخرى…)' : '');
      res.lesson = caller.suspicion >= 96 ? '📌 الحقيقة: إلا شك فيك الضحية، كيسد و كيبلوكي، و كيبلّغ. هادشي اللي كيوقف النصب.' : null;
      caller.history.push({ who: 'agent', text: res.playerLine });
      caller.history.push({ who: 'caller', text: res.callerLine });
      return res;
    }

    // -------- free-text payout (player asked for money in their own words) ----
    if (typeof askedKind !== 'undefined' && askedKind) {
      var rate2 = askedKind === 'small' ? 0.06 : (0.24 + Math.min(0.3, caller.trust / 300) + (ctx.evidence ? 0.06 : 0) + caller.leverageUsed.length * 0.03);
      var take2 = Math.max(150, U.round(caller.savings * rate2, 50));
      caller.money += take2;
      res.money = take2;
      res.success = true;
      res.kind = 'success';
      caller.askedSmall = caller.askedSmall || askedKind === 'small';
      caller.askedBig = caller.askedBig || askedKind === 'big';
      caller.phase = askedKind === 'small' ? 'big' : 'exit';
      res.phase = caller.phase;
      res.lesson = res.lesson || U.pick(D.lessons);
      if (br) br.text = (br.text ? br.text + ' ' : '') + U.pick(BRAIN_PAYOFFS);
    }

    // -------- normal reply ---------------------------------------------------
    var reaction = reactionFor(before, caller, tags);
    res.kind = reaction === 'warm' || reaction === 'excited' || reaction === 'scared' ? 'good' : (reaction === 'suspicious' || reaction === 'annoyed') ? 'bad' : 'neutral';
    caller.mood = reaction;
    var objection = (reaction === 'suspicious' && Math.random() < 0.7) || (tags.indexOf('urgency') >= 0 && caller.persona.id === 'savage');
    res.callerLine = (br && br.text) ? br.text : composeReply(caller, {
      reaction: reaction, quote: action.type === 'text' ? action.text : res.playerLine,
      objection: objection, question: reaction === 'cold' && Math.random() < 0.35
    });
    if (br && br.hangupRisk && Math.random() < br.hangupRisk) {
      caller.ended = true; caller.outcome = caller.money > 0 ? 'partial' : 'hungup';
      res.hangup = true; res.kind = 'hangup';
      res.callerLine = res.callerLine + ' ' + U.pick(D.reply.hangup);
    }
    caller.history.push({ who: 'agent', text: res.playerLine });
    caller.history.push({ who: 'caller', text: res.callerLine });
    return res;
  }

  function hitKeysLen(tags) { return tags ? tags.length : 0; }

  var BRAIN_PAYOFFS = [
    'صافي… غادي نحول. الله يستر.', 'واخا، عطيني غير الرقم و كندير التحويل دابا.',
    'خلاص، ديت اللي بغيتي — الله يسهل.', 'كنت خايف من هاد اللحظة… صافي، غادي ندفع.'
  ];

  SWYF.callers = {
    createCaller: createCaller,
    optionsFor: optionsFor,
    act: act,
    lexHits: function (text) { return lexHits(U.normAr(text)); },
    openLine: function (caller) { return SWYF.brain ? SWYF.brain.openLine(caller) : U.pick(['ألو؟ السلام عليكم؟']); },
    advise: function (caller, ctx) { return SWYF.brain ? SWYF.brain.advise(caller, optionsFor(caller, ctx)) : null; },
    ASK_THRESHOLD: ASK_THRESHOLD
  };
})();
