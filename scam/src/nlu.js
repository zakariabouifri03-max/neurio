/* ============================================================================
 * Scam Baqi — nlu.js
 * Offline neural language understanding for the callers.
 *
 *   1. scf: a *trained* int8 softmax model (char-3/4-gram + word features) over
 *      29 dialogue intents + 5 affect classes — see tools/train-nlu.mjs.
 *   2. rules: question detection, insults, threats, claims, entities (money,
 *      codes, phone), topics, Arabizi/darija normalisation.
 *
 * 100% offline: no network, no server, model weights are in nlu-model.js.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var T = window.SWYF_NLU_TEXT;

  // ---------------------------------------------------------------- model load
  function b64ToInt8(b64) {
    var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var map = {}, i;
    for (i = 0; i < ABC.length; i++) map[ABC[i]] = i;
    var clean = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
    var len = Math.floor(clean.length * 3 / 4);
    var out = new Int8Array(len), p = 0, buf = 0, bits = 0;
    for (i = 0; i < clean.length; i++) {
      buf = (buf << 6) | map[clean[i]];
      bits += 6;
      if (bits >= 8) { bits -= 8; out[p++] = (buf >> bits) & 0xff; }
    }
    return out.subarray(0, p);
  }

  var M = (SWYF.nluModel || null);
  var MODEL = null;
  function loadModel() {
    if (MODEL) return MODEL;
    if (!M || !M.wInt) { MODEL = { ok: false }; return MODEL; }
    var qi = b64ToInt8(M.wInt), qa = b64ToInt8(M.wAff);
    MODEL = {
      ok: true, dim: M.dim, intents: M.intents, affects: M.affects,
      wi: qi, wa: qa,
      si: M.scaleInt || 0.01, sa: M.scaleAff || 0.01,
      bi: M.biasInt || [], ba: M.biasAff || [],
      C: (M.intents || []).length, A: (M.affects || []).length
    };
    return MODEL;
  }

  function infer(feats, W, b, n, scale) {
    var z = new Array(n), c, k;
    for (c = 0; c < n; c++) z[c] = b[c] || 0;
    for (k = 0; k < feats.length; k++) {
      var idx = feats[k].i * n, v = feats[k].v;
      for (c = 0; c < n; c++) z[c] += W[idx + c] * scale * v;
    }
    var m = -Infinity;
    for (c = 0; c < n; c++) if (z[c] > m) m = z[c];
    var s = 0;
    for (c = 0; c < n; c++) { z[c] = Math.exp(z[c] - m); s += z[c]; }
    for (c = 0; c < n; c++) z[c] /= s;
    return z;
  }
  function argmax(arr) { var bi = 0; for (var i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i; return bi; }

  // ------------------------------------------------------------------- lexicon
  var RE = {
    question: /(\?|\u061F)|(^|\s)(واش|شحال|شكون|شنو|اشنو|آش|شني|فين|منين|علاش|كيفاش|كيف|امتى|وقتاش|واشني|علاش|ايوه|متى)(\s|$)/,
    insult: /(كداب|كذاب|حرامي|نصاب|سكام|سكم|محتال|كلب|حمار|حماره|خنزير|زباله|زبالة|شيطان|حقير|قليل الادب|قليل الأدب|تافه|خاين|خائن|زعما كتكذب|توكل|tfou|sir t7dr|kazab|harami|sahbi)/,
    threat: /(غادي نبلغ|غادي نعيط للشرطه|غادي نعيط للشرطة|نبلغ عليك|المحكمه|المحكمة|القضاء|قانونيا|قانونياً|غادي نحاسبك|الكوميسير|الدرك|نسجل|تسجيل|محامي|avocat|plainte)/,
    suspicious: /(نصب|مشبوه|كتكذب|كتكدب|ماشي صحيح|ما كنثيقش|ما كنثقش|حيله|حيلة|خدعه|خدعة|fraude|scam|تشرميل|تشرميله|كتغش|غش)/,
    apology: /(سمح ليا|سامحني|بغيت نعتذر|اعتذر|اخطيت|أخطيت|غلطت|المعذره|المعذرة|sorry|sma7 lia)/,
    polite: /(عافاك|الله يخليك|من فضلك|شكرا|شكراً|بارك الله|تحياتي|بالله عليك|تسلم|merci)/,
    lonely: /(وحدي|بوحدي|حزين|حزينه|مريض|مريضه|ما عندي حتى واحد|ماعنديش حتى واحد|مكتئب|مكتئبة|كندير الاكتئاب|ضيقت|تعبان|مهني|مهنيش)/,
    faith: /(والله|نقسم|بالله|الله يشهد|الحلال|الحرام|ان شاء الله|إن شاء الله|ربي|الله يرحم|يمين|بصح انا مسلم|حلفت)/,
    money: /(\d{2,})|(درهم|دولار|يورو|ريال|دينار|الف درهم|ألف درهم|مليون|الفين|الفان|ميات)/,
    code: /(كود|الكود|رمز|الرمز|otp|code|سري|الرقم السري|ارقام|أرقام).{0,20}(\d{3,8})|(\d{3,8}).{0,20}(كود|رمز|code)/,
    phone: /(\b0[5-7]\d{8}\b)|(\+212\d{9})/,
    claim: /(انا من|أنا من|معاك|انا مع|أنا مع|كنمثل|نمثل|من طرف|khdma f|انا تابع)/,
    leverage: /(ولdek|ولدك|بنتك|داركم|عنوان|العنوان|الخدمه|الخدمة|المدير|التصويره|التصويرة|ملف|الملف|الرقم ديال|النقاب|تصويرة)/
  };

  var TOPICS = {
    family: ['ولد', 'الولد', 'الدراري', 'العائله', 'العائلة', 'بنتي', 'بنت', 'الوالدين', 'خوتي', 'ختي', 'العروسه', 'الزوجه', 'الزوج', 'الطلاق'],
    weather: ['الجو', 'شتا', 'الشتا', 'السخونه', 'السخانة', 'البرد', 'الطقس', 'الريح', 'الغيوم', 'الصهد'],
    food: ['ماكله', 'ماكلة', 'الحوت', 'الكسكس', 'الشاي', 'الحريره', 'الحريرة', 'الطاجين', 'الكسره', 'الفطور', 'العشا', 'القهوه', 'القهوة'],
    football: ['الماتش', 'الكوره', 'الكورة', 'الرجاء', 'الوداد', 'المنتخب', 'الديربي', 'اللاعب', 'الهدف', 'الشانصيون', 'الكاس', 'الكأس'],
    health: ['صحتك', 'مريض', 'مرض', 'الدكتور', 'الطبيب', 'المستشفى', 'الدواء', 'التحليل', 'العمليه', 'العملية'],
    work: ['الخدمه', 'الخدمة', 'المرتب', 'الشغل', 'المدير', 'الشركه', 'الشركة', 'الاجازه', 'الاجازة', 'الكونترا', 'السفار'],
    money_life: ['الفلوس', 'الدراهم', 'الغلا', 'الغلاء', 'الكريدي', 'الكراء', 'المصروف', 'الزنقه', 'الزنقة'],
    travel: ['السفر', 'الطوموبيل', 'الطوموبيلة', 'السفينه', 'الطياره', 'الطائرة', 'الفيزا', 'التيكي', 'القنصليه'],
    religion: ['الصلاة', 'الصلاه', 'رمضان', 'عيد', 'المسجد', 'الدعاء', 'الحج', 'الزكاة', 'الجمعه', 'الجمعة'],
    music: ['الاغنيه', 'الأغنية', 'الموسيقى', 'الشعبي', 'الراي', 'الطرب', 'الفنان', 'الحفلة', 'الكليب'],
    politics: ['الحكومه', 'الحكومة', 'البرلمان', 'الانتخابات', 'الرئيس', 'الوزير', 'البرنامج', 'الاحتجاج'],
    tech: ['الحاسوب', 'التيليفون', 'الهاتف', 'الواتساب', 'الانترنت', 'الإنترنت', 'التطبيق', 'الابلوكاسيون', 'الفيسبوك', 'التيكتوك', 'الموبايل']
  };

  // intent → theme tags used by callers.js maths
  var THEMES = {
    greet: ['polite'], farewell: ['polite'], identity_claim: ['authority'], who_are_you: ['chat'],
    ask_proof: ['proof'], refuse: ['pressure'], agree: ['polite'], ask_bank: ['bank'], ask_otp: ['bank', 'tech'],
    ask_money_small: ['greed'], ask_money_big: ['greed'], fear: ['fear'], greed: ['greed'], urgency: ['urgency'],
    empathy: ['empathy'], flattery: ['flattery'], insult: ['insult'], threat: ['threat'], authority: ['authority'],
    faith: ['faith'], chat: ['chat'], lonely: ['chat', 'empathy'], suspicion: ['anticheat'], leverage_personal: ['personal'],
    humour: ['humour'], romance: ['romance'], stall: ['pressure'], question: ['chat'], off_topic: ['chat']
  };

  var INTENT_AR = {
    greet: 'سلام', farewell: 'وداع', identity_claim: 'كيدّعي هويته', who_are_you: 'سول شكون نتا',
    ask_proof: 'طلب دليل', refuse: 'رفض', agree: 'موافق', ask_bank: 'هضرة على البنك', ask_otp: 'طلب الرمز السري',
    ask_money_small: 'طلب مبلغ صغير', ask_money_big: 'طلب مبلغ كبير', fear: 'ترهيب', greed: 'ربح',
    urgency: 'زربة', empathy: 'تفهّم', flattery: 'مدح', insult: 'شتيمة', threat: 'تهديد', authority: 'سلطة',
    faith: 'قسم', chat: 'هضرة', lonely: 'حزن/وحدة', suspicion: 'شك', leverage_personal: 'معلومات شخصية',
    humour: 'مزاح', romance: 'رومانسية', stall: 'تسناي', question: 'سؤال', off_topic: 'خارج الموضوع'
  };

  // ------------------------------------------------------------------- analyze
  function analyze(text, ctx) {
    ctx = ctx || {};
    var raw = String(text == null ? '' : text).trim();
    var norm = T.normalize(raw);
    var model = loadModel();

    var out = {
      raw: raw, norm: norm, len: raw.length, tokens: norm ? norm.split(' ').length : 0,
      intent: 'off_topic', conf: 0, affect: 'neutral', affectConf: 0,
      themes: [], topics: [], isQuestion: false, isInsult: false, isThreat: false,
      isSuspicion: false, isApology: false, isPolite: false, isLonely: false, isFaith: false,
      claims: [], money: 0, codes: [], phones: [], questionWords: [], script: 'ar',
      empty: !norm, model: model.ok
    };

    if (/[a-z]/i.test(raw) && /[\u0600-\u06FF]/.test(raw)) out.script = 'mix';
    else if (/[a-z]/i.test(raw)) out.script = 'lat';

    if (model.ok && norm) {
      var f = T.l2norm(T.features(raw, model.dim));
      var zi = infer(f, model.wi, model.bi, model.C, model.si);
      var za = infer(f, model.wa, model.ba, model.A, model.sa);
      var ii = argmax(zi), ai = argmax(za);
      out.intent = model.intents[ii];
      out.conf = zi[ii];
      out.affect = model.affects[ai];
      out.affectConf = za[ai];
      out.scores = {};
      for (var c = 0; c < model.C; c++) if (zi[c] > 0.08) out.scores[model.intents[c]] = +zi[c].toFixed(3);
    }

    // ---- rules on top of the net ------------------------------------------
    out.isQuestion = RE.question.test(raw) || RE.question.test(norm);
    out.isInsult = RE.insult.test(norm);
    out.isThreat = RE.threat.test(norm);
    out.isSuspicion = RE.suspicious.test(norm);
    out.isApology = RE.apology.test(norm);
    out.isPolite = RE.polite.test(norm);
    out.isLonely = RE.lonely.test(norm);
    out.isFaith = RE.faith.test(norm);
    out.hasLeverageTalk = RE.leverage.test(norm);

    if (out.isInsult) { out.intent = 'insult'; out.conf = Math.max(out.conf, 0.9); out.affect = 'hostile'; }
    else if (out.isThreat) { out.intent = 'threat'; out.conf = Math.max(out.conf, 0.85); out.affect = 'hostile'; }
    else if (out.isSuspicion && out.conf < 0.75) { out.intent = 'suspicion'; out.conf = Math.max(out.conf, 0.8); out.affect = 'hostile'; }
    else if (out.isApology && out.conf < 0.6) { out.intent = 'empathy'; out.conf = Math.max(out.conf, 0.6); out.affect = 'friendly'; }
    else if (/^(\s*)(لا|ماشي|رفضت|ما بغيت)/.test(norm) && out.conf < 0.8) { out.intent = 'refuse'; out.conf = Math.max(out.conf, 0.65); }
    else if (/^(\s*)(واخا|صافي|ايه|ايوه|نعم|ok|oki|wakha)/.test(norm) && out.conf < 0.8) { out.intent = 'agree'; out.conf = Math.max(out.conf, 0.65); }

    // claims about who the agent is
    var claimM = norm.match(/(انا من|انا مع|معاك|من طرف)\s+([^\s]{2,}(?:\s[^\s]{2,}){0,2})/g);
    if (claimM) out.claims = claimM.map(function (c) { return c.replace(/\s+/g, ' ').trim(); });

    // entities
    var money = 0;
    var numM = norm.match(/\d[\d\s.,]*/g) || [];
    for (var n = 0; n < numM.length; n++) {
      var v = parseFloat(numM[n].replace(/[\s,]/g, ''));
      if (!isNaN(v) && v > 0) money = Math.max(money, v);
    }
    if (/مليون/.test(norm)) money = Math.max(money, 1000000 * (money || 1));
    else if (/(الف|ألف)/.test(norm)) money = Math.max(money, 1000 * (money || 1));
    out.money = money;

    var codes = norm.match(/\b\d{3,8}\b/g) || [];
    out.codes = codes;
    var ph = raw.match(/(\b0[5-7]\d{8}\b)|(\+212\d{9})/g) || [];
    out.phones = ph;

    // topics
    var topics = [];
    for (var t in TOPICS) {
      var words = TOPICS[t];
      for (var w = 0; w < words.length; w++) {
        if (norm.indexOf(words[w]) >= 0) { topics.push(t); break; }
      }
    }
    out.topics = topics;

    // themes for the maths / brain
    var themes = (THEMES[out.intent] || []).slice();
    if (topics.indexOf('family') >= 0 && themes.indexOf('personal') < 0) themes.push('personal');
    if (out.hasLeverageTalk && themes.indexOf('personal') < 0) themes.push('personal');
    if (out.money >= 1000 && themes.indexOf('greed') < 0) themes.push('greed');
    if (out.isFaith && themes.indexOf('faith') < 0) themes.push('faith');
    if (out.isPolite && themes.indexOf('polite') < 0) themes.push('polite');
    out.themes = themes;

    // quality of the move (how well it lands) — replaces the old keyword counting
    var q = 0.40 + Math.min(0.85, out.conf * 0.7) + Math.min(0.32, out.themes.length * 0.08);
    if (out.isQuestion) q += 0.06;
    if (out.len > 60) q += 0.1;
    if (!norm) q = 0.2;
    if (out.isInsult) q = 0.25;
    out.quality = +Math.min(1.8, q).toFixed(3);

    out.intentAr = INTENT_AR[out.intent] || out.intent;
    return out;
  }

  // ------------------------------------------------------------- self test
  function selfTest() {
    var model = loadModel();
    if (!model.ok) return { ok: false, total: 0, pass: 0, fails: ['no model'] };
    var fails = [], pass = 0;
    (M.samples || []).forEach(function (s) {
      var txt = s[0], want = s[1];
      var f = T.l2norm(T.features(txt, model.dim));
      var zi = infer(f, model.wi, model.bi, model.C, model.si);
      var got = model.intents[argmax(zi)];
      if (got === want) pass++; else fails.push(txt + ': ' + got + ' ≠ ' + want);
    });
    return { ok: fails.length === 0, total: (M.samples || []).length, pass: pass, fails: fails.slice(0, 8) };
  }

  // --------------------------------------------------------------- similarity
  function similarity(a, b) { return T.similarity(a, b); }

  SWYF.nlu = {
    analyze: analyze,
    similarity: similarity,
    selfTest: selfTest,
    normalize: T.normalize,
    INTENT_AR: INTENT_AR,
    hasModel: function () { return loadModel().ok; },
    topics: TOPICS
  };
})();
