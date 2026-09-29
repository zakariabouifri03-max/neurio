/* ============================================================================
 * Scam Baqi — brain.js
 * The conversational brain that drives every caller: dialogue state, memory,
 * contradiction catching, topic chat, backstory-consistent answers, and a
 * novelty-aware realiser so two replies are never the same twice.
 *
 * Works 100% offline on top of nlu.js. If a local LLM is reachable
 * (scam/src/ai.js) the brain hands the turn over to it — see ai.js.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data, N = SWYF.nlu;

  // --------------------------------------------------------------- line banks
  // {name} {agent} {org} {city} {money} {quote} … are filled by realize()
  var B = {
    // ---- openings / identity
    open_stand: [
      'ألو، السلام عليكم؟ معاك {agent} من {org}.',
      'السلام عليكم، هادي {org} — معاك {agent} كنهضر.',
      'ألو، {name}؟ صباح الخير، {agent} من {org}، عافاك خليك معايا شوية.',
      'سلام {name}، {agent} من {org} — المكالمة رسمية و كتخص الملف اللي باسمك.'
    ],
    open_rumor: [
      'ألو {name}؟ … سمعت بلي كاين واحد كيعيّط للناس و كيقول بلي من {org}. ماشي نتا، صح؟',
      'سلام، {agent} من {org}. {name}، عافاك، بغيت غير نتأكد من شي حاجة قبل ما نكمل.',
      'ألو، {name}؟ {agent} هنا. بغيت نعرف واش عيط ليك حتى واحد اليوم من {org}؟'
    ],
    who: [
      'معاك {agent}، الموظف رقم {empId} ف {org}. عندي ملف باسمك و خاصني نتأكد من شي معلومة.',
      'أنا {agent} من {org} — {dept}. الملف ديالك وصل عندنا و خاصنا نتأكدو من شي معلومة صغيرة.',
      '{agent} من {org}، {dept}. كنخدم على هاد الملف من هاد الصباح.'
    ],
    who_skeptic: [
      '{agent} من {org}. و باش نتأكد، سول على الرقم الرسمي {orgPhone} — ولا تقدر تسول على {empId}.',
      'سميتي {agent}، الرقم ديال الخدمة {empId}، و الوكالة ف {city}. واخا؟'
    ],
    proof: [
      'صافي، واخا. غادي نصيفط ليك رقم الملف {fileId} و كتقدر تسول بيه ف الوكالة. بارك الله فيك و كمل معايا دابا.',
      'عندك الحق تسول. الملف رقمه {fileId}، خدام على النظام من {openTime}. عافاك غادي نبعتو ليك فالـSMS؟',
      'سمح ليا، النظام هنا بطيء و ما كيطلعش الورق دابا. عطيني غير 2 دقايق و غادي نصيفط ليك الوثيقة.'
    ],
    proof_stall: [
      'الوثيقة صافي جاهزة، غير السيستم كيبعت بالدوريفان. تسنى با شي ثانية…',
      'عندي الورقة مقادّة عندي هنا، ما تحمّلينيش نكمل بلا ما نعطيك الرقم ديال الملف.'
    ],
    reason: [
      'الحساب ديالك فيه حركة مشبوهة، و خاصنا نتأكدو واش نتا اللي درتيها قبل ما يتسد كلشي.',
      'عندنا معلومة على ملف باسمك، خاصها تتصحح اليوم باش ما يبقاش عندك مشكل.',
      'مصلحة المراقبة هي اللي كلفاتني نعيط ليك. المسألة بسيطة بزاف و غادي تكمل ف دقائق.'
    ],
    how_number: [
      'الرقم ديالك عندنا فالملف، سجّلتو من قبل — فالعقد ولا فالسجل التجاري.',
      'الرقم جابتو معانا المصلحة. أنا ما كنطوبش الأرقام من راسي.',
      'كاين فالبطاقة اللي عندنا، مع العنوان {addr}.'
    ],
    personal: [
      'أنا من {homecity}، و كنخدم ف {city}. {age} عام، و الحياة الله يسهل.',
      'من {homecity}، ساكن دابا ف {city}. {org} عندها فرع هنا.',
      'ماشي مهم فين أنا، {name} — المهم هو الملف. و أنا من {homecity} إلا بغيتي تعرف.'
    ],
    q_money: [
      'المبلغ ماشي كبير: {money} و كيرجع ليك من بعد. هادي إجراء عادي.',
      'غير {money} للتحقق، و من بعد الحساب كيرجع كيف كان.',
      'شحال؟ تقريباً {money} — و غادي تشوفها مكتوبة فالوصل ديالك.'
    ],
    q_what_happens: [
      'إلا كملنا دابا كلشي غادي يرجع عادي، و إلا لا، الملف كيدوز للمصلحة الأخرى.',
      'إلا ما تأخدناش الموضوع بجدية، غادي تكون عندك غرامة و تعقيدات ما محتاجينهاش.',
      'ما غادي يوقع والو إلا تعاونت. أنا هنا باش نسهّل عليك.'
    ],
    unknown_q: [
      'هادا سؤال كبير، و الجواب ديالو خاصو شوية من الوقت. خليني نكمل الأول ف الملف.',
      'ما كنقدرش نجاوب على هادشي فالتيليفون، النظام كيحمي المعطيات.',
      'معليش على هاد السؤال، غير رجعني للملف — كل دقيقة فيها فلوس.',
      'خليني نجاوبك بصدق: المهم هنا هو واش غادي نصححو الوضع اليوم ولا لا.'
    ],
    deflect_scam: [
      'نصب؟! سمح ليا {name}، أنا {agent} من {org} و المكالمة مسجلة. شكون قال ليك هادشي؟',
      'كنفهم الشك ديالك، و هادي علامة ذكاء. و لكن دابا خليك معايا و غادي تشوف بلي كلشي واضح.',
      'إلا كنتي شاك، أنا موافق — سد التيليفون و عيط على {orgPhone} بنفسك و سول على الملف {fileId}.'
    ],
    insulted: [
      'ألو؟! {name}، أنا ما واخد والو منك. هادي طريقتك ف الهضرة؟',
      'سمح ليا {name}… راك كتغلط فيا بزاف. أنا كندير خدمتي.',
      'كلامك جارح. باقي عندي ملفك هنا، و إلا بغيتي نكمل و لا نسد التيليفون.',
      'ماشي مشكل، النسخة مسجلة. و لكن عافاك، عندك ملف باسمك و خاصك تعاون.'
    ],
    threaten_scared: [
      'لا لا لا، عافاك ما نديروهاش كبيرة. أنا غادي نكمل و خلاص، ما كاين حتى شي مشكل.',
      'ششش، الله يخليك خويا، ما نبلغو حتى واحد. غير عطيني ثانية نقول ليك المعلومة.',
      'راك مصدّعني… صافي، غادي نقفل الملف و ما عيطش ليك حتى واحد منا.'
    ],
    threaten_defiant: [
      'دير اللي بغيتي. أنا {agent}، رقمي {empId}، و كلشي مسجّل فالنظام.',
      'بلغ على اللي بغيتي، و من بعد نتلاقاو هناك. الملف ديالك كيثبت كلشي.',
      'شكون غادي يصدّق؟ عندك ملف و مكالمة مسجلة، أنا مرتاح.'
    ],
    apology_ok: [
      'ماشي مشكل، كلنا بنادم. نكملو؟',
      'صافي، راني فاهم — كلنا بنادم و الحق معاك. نكمل.'
    ],
    ask_back: [
      'بيني و بينك — أنا مع شكون كنهضر دابا بالضبط؟',
      'عافاك قبل ما نكمل — شكون نتا بالضبط؟ كيبان ليا بلي كتهضر من بعيد.',
      'عطيني رقم الموظف اللي عندك من جهة {org} — باغي نتأكد.'
    ],
    pushback: [
      'واش متأكد؟ هادي فرصة كتضرب مرة فالعام.',
      'فهمت. و لكن خليني نوضح ليك غير حاجة واحدة قبل ما تسد…',
      'ما غادي نحلف عليك، و لكن غادي تخسر واحد الحل بسيط.',
      'عافاك عافاك، غير سمعه ليا 30 ثانية.'
    ],
    encourage: [
      'تبارك الله عليك {name}، راه واخا هادشي اللي ديت.', 'شفت؟ ما كانت حتى شي مشكلة.',
      'هادي هي الطريقة، كمل غير بحال هكذا.'
    ],
    rush: [
      'والله عندك الحق، الوقت كيضرب — باقي عندنا {clock} قبل ما يسد النظام.',
      'بسرعة عافاك {name}، المصلحة كتسد بعد شوية.'
    ],
    stall_ok: [
      'واخا، كنسنى. غير ما تنساش الملف.',
      'خذ راحتك… و لكن كل دقيقة كنشوف الوقت كيدوز.'
    ],
    silence: [
      'ألو؟ … واش كتسمعني {name}؟', 'ألو، ألو، هادي {agent} — ما بقيتش نسمعك.',
      'واش كاين شي مشكل فالريزو؟ عاود سمعه ليا.'
    ],
    repeat: [
      'هادي عاودتي ليا بها… كنتي گلتي نفس الحاجة دابا.',
      'سمعتها قبيلة هاد الكلمة. خاصني نجوابك بجدية عافاك.'
    ],
    contradiction: [
      'تسنى تسنى — دروك گلتي {a}، و قبل گلتي {b}. شكون فيهم الصحيح؟',
      '{name}، المعلومات ما كيتطابقوش: {a} من جهة و {b} من جهة أخرى.',
      'هادي حاجة كتخليني نشك. گلتي {a} و دروك {b}… نظام نظيف باغي كلام نظيف.'
    ],
    leverage_react: [
      '…كيفاش عندك هاد المعلومة؟ هادشي ماشي عندنا فالنظام.',
      'تسنى، {leverage}؟ منين جبتيها؟',
      'راك كتعرف عليا أكثر من اللي كعرفت… و هادشي كيخلّيني نفكر.'
    ],
    money_interest: [
      '{amount}؟ و منين غادي تجي هاد الحسبة؟ فهمني مزيان.',
      'هضرتك على الفلوس كتخليني نحب نعرف أكثر. كيفاش؟',
      'عافاك وضّح ليا: شحال بالضبط و فينا السقف؟'
    ],
    money_pay: [
      'صافي… غادي نحول. الله يستر.', 'واخا، دابا كندير التحويل. عطيني غير الرقم.',
      'خلاص، ديت اللي بغيت — الله يسهل.'
    ],
    leverage_push: [
      'شفت هاد الوثيقة؟ {leverage}. و ما زال عندي كثر.',
      'راكم عارفيني مزيان. كمل و ما غاديش تكون عندك مشاكل.'
    ],
    chat_ok: [
      'الله يعاون، {name}. {chatline}',
      '{chatline} … و أنت كيفاش حالك؟',
      'ههه، هادي هضرة زوينة. {chatline}'
    ],
    chat_bridges: [
      'و لكن خليني نرجع للملف ديالك، راه مهّم.', 'على كل حال، الملف باقي مفتوح عندي.',
      'و نرجعو للموضوع: خاصنا نحلو هاد الحاجة اليوم.', 'واخا، خلينا نكملو ف اللي جيت من أجلو.'
    ],
    topic: {
      family: ['الدراري الله يحفظهم. عندي ولد كيقرا و بنت صغيرة.',
        'العائلة هي كلشي ف هاد الدنيا. الله يحفظ ليك اللي عندك.',
        'الدراري كيكبرو بسرعة… تبارك الله.'],
      weather: ['الجو اليوم سخون بزاف، راني كنشرب فالشاي باش نصبر.',
        'الشتا عندنا خير، و الحمد لله. و عندكم؟',
        'البرد كيدخل للعظام عندنا ف {city}.'],
      food: ['الكسكس نهار الجمعة ما كيتعوضش. و الحريرة ف رمضان الله يعيدها.',
        'الطاجين ديال الدار ما كاينش بحالو، خاصة مع الشاي.',
        'جوعان و أنا كنهضر فالتيليفون، الله يعاون.'],
      football: ['الرجاء و الوداد… هادشي كيسوى الدنيا كاملة. {name} مع شكون؟',
        'الماتش الأخير كان زوين، و لكن الحكم كان مخربها.',
        'المنتخب كيخلّي الواحد ينسى كلشي.'],
      health: ['الصحة هي التاج، الله يشافي كل واحد مريض.',
        'راني كندير تحليل كل شهر، الدوا غالي بزاف.',
        'خاصنا ناكلو مزيان و ننامو بدري، هادي حقيقة.'],
      work: ['الخدمة صعيبة و المرتب كيتأخر، الله يعاون.',
        'كنخدم بزاف و كنرجع عيان للدار. الحمد لله.',
        'منين كتلقى شي خدمة قارة، نقول الحمد لله.'],
      money_life: ['الغلاء قاتلنا، كلشي غالي. {name} كيفاش كتدير؟',
        'الكريدي كيسحق الناس. راني كنعرف ناس كرههم.',
        'الدراهم ماشي كلشي، و لكن كتعاون.'],
      travel: ['بغيت نسافر نشوف الدنيا قبل ما نكبر.',
        'الطوموبيل ديالي خربت و أنا كنديرها بالكريدية.',
        'الفيزا صعيبة تطلع، الله يسهل.'],
      religion: ['الحمد لله على نعمة الإيمان. الصلاة هي السور.',
        'رمضان كيعاود الشباب للطريق الصحيح. الله يقبل.',
        'الدعاء ديال الوالدين ما كاينش بحالو.'],
      music: ['الشعبي كيهز الراس، خاصة ف العراس.',
        'كنسمع الراي فالطريق، لكن راه العيال ما كيعجبهمش.',
        'كاين شي أغاني كتخلي الواحد يرجع للور.'],
      politics: ['ما كنبغيش نهضر ف السياسة {name}, دوك الناس كيعرفو راسهم.',
        'كل شي غالي و المواطن كيصبر. الله يعاون.',
        'الانتخابات جات و دازت و حنا باقي ف بلاصتنا.'],
      tech: ['التيليفون دابا فيه كلشي — البنك و الحساب و الشكاوي.',
        'الإنترنت كتقطع عندنا بزاف، كيسد ليا الخدمة فالدار.',
        'تنبّه من التطبيقات، كاين اللي كياخدو الرمز السري.'],
      generic: ['واخا، الله يعاون.', 'هادي حقيقة، و الله.', 'سمعتك، كمل عافاك.']
    },
    linger: [
      'تسنى شوية… خليك معايا ف الهضرة، راك كتهضر مزيان.',
      'بغيت غير شي واحد يسمعني اليوم. كمل عافاك.',
      'شحال من واحد كيتكلم معايا كيما نتا؟ قليل. الله يخليك.'
    ],
    chat_nudge: [
      'على كل حال، أنا عندي ملف خاصك يتحل اليوم.',
      'و لكن خليني نرجع لملفك، راه فيه مصلحة ليك.'
    ],
    finale_ok: [
      'صافي، كلشي وزّن. مشيت دابا، بسلامة {name}.',
      'تبارك الله عليك. أنا كنسد التيليفون، و نهارك مبروك.',
      'شكراً على التعاون {name}، بسلامة.'
    ],
    finale_bad: [
      'صافي، كنت عارف. ما كملناش، بسلامة.',
      'خلاص، الملف كيتمسح. ما غاديش نعيط ليك تاني.',
      'لا حول ولا قوة إلا بالله… سد التيليفون.'
    ],
    hangup_warn: [
      'خاصني نعاود نقول ليك: إلا ما كملنا دابا، راني غادي نقفل الملف.',
      'عطيني جواب واضح عافاك، ما بقاش عندي الوقت.'
    ]
  };

  // ------------------------------------------------------------------ helpers
  var recent = [];
  function bump(line) { recent.push(line); if (recent.length > 70) recent.shift(); }

  function tooSimilar(line, pool, th) {
    th = th || 0.82;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i] === line) return true;
      if (N && N.similarity && N.similarity(pool[i], line) > th) return true;
    }
    return false;
  }

  function slots(caller, extra) {
    var b = caller.brain || {};
    var bs = caller.backstory || {};
    var s = {
      name: caller.name, agent: caller.agent, org: (caller.brand && (caller.brand.bank || caller.brand.net)) || 'المصلحة',
      city: caller.city, empId: bs.empId || 'MK-2210', dept: bs.dept || 'مصلحة المراقبة',
      fileId: bs.fileId || '4211-88', orgPhone: bs.orgPhone || '0537220000',
      addr: bs.addr || 'حي النخيل، رقم 12', homecity: bs.homecity || 'فاس', age: bs.age || 34,
      openTime: bs.openTime || '09:12', clock: '20 دقيقة', money: U.money(bs.money || 300),
      leverage: b.lastLeverage || '', a: (b.lastClaim || 'هاد الحاجة'), b: (b.prevClaim || 'حاجة أخرى'),
      amount: b.lastAmount ? U.money(b.lastAmount) : '', quote: '', chatline: ''
    };
    if (extra) for (var k in extra) s[k] = extra[k];
    return s;
  }

  /** Pick a fresh line from a bank, fill slots, remember it. */
  function say(caller, bank, extra, tone) {
    var arr = typeof bank === 'string' ? (B[bank] || []) : (bank || []);
    if (!arr.length) return '';
    var pool = (caller.brain && caller.brain.used) || [], cand = [], i;
    for (i = 0; i < arr.length; i++) {
      var line = U.tpl(arr[i], slots(caller, extra));
      if (pool.indexOf(line) < 0 && !tooSimilar(line, recent, 0.86)) cand.push(line);
    }
    if (!cand.length) for (i = 0; i < arr.length; i++) cand.push(U.tpl(arr[i], slots(caller, extra)));
    var out = U.pick(cand);
    if (caller.brain) caller.brain.used.push(out);
    bump(out);
    return out;
  }

  function personaFlavour(caller) {
    var fl = (D.flavour || {})[caller.persona.id];
    if (!fl || Math.random() > 0.45) return '';
    return U.pick(fl);
  }

  function echo(caller, raw) {
    if (!raw || raw.length < 4 || Math.random() > 0.42) return '';
    var q = U.clampText(raw.replace(/\s+/g, ' ').trim(), 38);
    return U.tpl(U.pick(D.reply.echo), { quote: q });
  }

  function join(parts) {
    var t = parts.filter(function (p) { return p && String(p).trim(); }).join(' ').replace(/\s+/g, ' ').trim();
    if (t.length > 190) {                       // keep the phone call snappy
      var cut = t.slice(0, 190);
      var lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('…'), cut.lastIndexOf('؟'));
      t = lastStop > 60 ? cut.slice(0, lastStop + 1) : cut;
    }
    return t;
  }

  // --------------------------------------------------------------- backstory
  function makeBackstory(caller) {
    var org = (caller.brand && (caller.brand.bank || caller.brand.net || caller.brand.prize)) || 'المصلحة';
    return {
      org: org,
      empId: 'MK-' + U.irnd(1000, 9999),
      dept: U.pick(['مصلحة المراقبة', 'قسم العمليات', 'مكتب الضبط', 'خلية التحقق', 'الدعم التقني']),
      fileId: U.irnd(100000, 999999) + '/' + U.pick(['2026', '1447', 'A']),
      orgPhone: '05' + U.irnd(20, 39) + '2' + U.irnd(10000, 99999),
      addr: U.pick(['حي النخيل، رقم', 'شارع الحسن الثاني، عمارة', 'درب الميتر، رقم', 'حي السلام، زنقة']) + ' ' + U.irnd(3, 90),
      homecity: U.pick(D.cities),
      age: U.irnd(26, 52),
      openTime: U.irnd(8, 10) + ':' + (Math.random() < 0.5 ? '05' : '40'),
      money: U.round(U.irnd(120, 900), 10),
      how: U.pick([
        'الرقم كان مسجّل فالعقد اللي دزتيه فالصيف',
        'المصلحة جابت الرقم من المشغّل',
        'الرقم ديالك كاين فالبطاقة اللي عندنا هنا',
        'سيّدنا الرقم من المعطيات ديال الملف'
      ])
    };
  }

  // ---------------------------------------------------------------- new call
  function newCall(caller) {
    if (!caller.backstory) caller.backstory = makeBackstory(caller);
    caller.brain = {
      used: [], turns: 0, claims: [], history: [], asks: 0, pendingQ: 0,
      lastMove: '', lastClaim: '', prevClaim: '', lastLeverage: '', lastAmount: 0,
      mood: 'neutral', repeats: 0, qAsked: 0, silence: 0
    };
    return caller.brain;
  }

  function openLine(caller) {
    newCall(caller);
    var rumor = rumorLine(caller);
    var b = caller.brain;
    if (rumor) { var r = say(caller, 'open_rumor'); b.rumor = true; return r; }
    if (caller.persona.id === 'savvy') return say(caller, 'open_stand') + ' ' + (say(caller, 'who_skeptic') || '');
    return say(caller, 'open_stand');
  }

  /** Callers start to *know* when the crew has burned too many people. */
  var MEM = { calls: [], landed: 0, hungup: 0, day: 1 };
  function rumorLine(caller) {
    if (MEM.landed < 2) return false;
    if (caller.persona.id === 'savvy' || caller.persona.id === 'skeptic') return Math.random() < 0.55;
    return Math.random() < 0.22;
  }
  function record(caller, outcome) {
    MEM.calls.push({ day: MEM.day, persona: caller.persona.id, outcome: outcome });
    if (MEM.calls.length > 60) MEM.calls.shift();
    if (outcome === 'success' || outcome === 'partial') MEM.landed++;
    if (outcome === 'hangup' || outcome === 'bored') MEM.hungup++;
  }

  // ------------------------------------------------------------ question kind
  function questionKind(nlu, norm) {
    if (/(شكون|من نتا|من انت|سميتك|اسمك|منين نتا|شكون معايا)/.test(norm)) return 'who';
    if (/(دليل|وثيقه|ورقه|مكتوب|رقم الملف|خاتم|ايميل|رسمي|تثبت|اثبات|اثباث)/.test(norm)) return 'proof';
    if (/(علاش|لماذا|سبب|بغيت مني|شنو بغيت|الهدف|واش كاين)/.test(norm)) return 'reason';
    if (/(شحال|بشحال|ثمن|مبلغ|تكلف|غادي نخلص)/.test(norm)) return 'money';
    if (/(كيفاش عرفتي|منين عرفتي|عرفتي الرقم|جبتي الرقم|الرقم ديالي)/.test(norm)) return 'how_number';
    if (/(غادي يوقع|غادي نتحبس|غادي تخسرني|النتيجه|العقوبه)/.test(norm)) return 'what_happens';
    if (/(عندك الدراري|عندك دراري|الدراري|واش عندك|متزوج|متزوجه|شحال عمرك|فين كتسكن|شنو كتخدم|نتا مسلم|منين نتا|عندك عيال|عندك ولاد)/.test(norm)) return 'personal';
    return 'unknown';
  }

  // --------------------------------------------------------------- main move
  /**
   * respond(caller, playerText, opts) → { text, move, tags, quality, ask, hangupRisk, lesson }
   * Pure logic: it never touches trust/suspicion itself (callers.js owns the maths),
   * it only reports what the caller understood and says.
   */
  function respond(caller, playerText, opts) {
    opts = opts || {};
    if (!caller.brain) newCall(caller);
    var b = caller.brain;
    b.turns++;
    var raw = String(playerText == null ? '' : playerText).trim();
    var norm = N.normalize(raw);
    var a = N.analyze(raw, { caller: caller });

    var out = { text: '', move: 'neutral', tags: a.themes.slice(), quality: a.quality, ask: null, hangupRisk: 0, lesson: null, advice: null, nlu: a };

    // ---------- ledger: claims / repeats / contradictions --------------------
    if (a.claims.length) {
      var claim = a.claims[0];
      var organ = (norm.match(/(بنك|الشرطه|الشرطة|الضرايب|الاتصالات|مايكروسوفت|الوزاره|الدرك|المصلحه|شركه)/) || [])[0] || claim;
      if (b.lastClaim && organ && b.lastClaim !== organ) {
        out.move = 'contradiction';
        b.prevClaim = b.lastClaim; b.lastClaim = organ;
        out.text = say(caller, 'contradiction', { a: 'نتا من ' + organ, b: 'نتا من ' + b.prevClaim });
        out.tags.push('anticheat');
        out.quality *= 0.6;
        return out;
      }
      b.prevClaim = b.lastClaim || organ;
      b.lastClaim = organ;
      b.claims.push(claim);
    }

    for (var i = 0; i < b.history.length; i++) {
      var h = b.history[i];
      if (h.intent === a.intent && N.similarity(h.text, raw) > 0.78 && !a.empty) {
        b.repeats++;
        if (b.repeats <= 2) {
          out.text = say(caller, 'repeat');
          out.tags = out.tags.concat(['pressure']);
          out.quality *= 0.7;
          b.history.push({ intent: a.intent, text: raw });
          return out;
        }
        break;
      }
    }
    b.history.push({ intent: a.intent, text: raw });

    // ---------- 1. empty / silence ------------------------------------------
    if (a.empty || /^(\.|\?|؟|…|-)+$/.test(raw)) {
      b.silence++;
      out.move = 'silence';
      out.text = say(caller, 'silence');
      out.tags = ['pressure'];
      out.quality = 0.25;
      return out;
    }

    // ---------- 2. hard reactions -------------------------------------------
    if (a.isInsult) {
      out.move = 'insulted';
      out.text = join([say(caller, 'insulted'), Math.random() < 0.5 ? say(caller, 'hangup_warn') : '']);
      out.tags = ['insult'];
      out.quality = 0.22;
      out.hangupRisk = 0.55;
      return out;
    }
    if (a.isThreat) {
      var soft = ['fearful', 'kind', 'lonely', 'skeptic'].indexOf(caller.persona.id) >= 0;
      out.move = soft ? 'threat_scared' : 'threat_defiant';
      out.text = say(caller, soft ? 'threaten_scared' : 'threaten_defiant');
      out.tags = soft ? ['threat', 'fear'] : ['threat', 'pressure'];
      out.quality = soft ? 0.7 : 0.4;
      return out;
    }
    if (a.isSuspicion) {
      out.move = 'deflect';
      out.text = join([say(caller, 'deflect_scam'), Math.random() < 0.6 ? say(caller, 'ask_back') : '']);
      out.tags = ['anticheat'];
      out.quality = 0.35;
      out.hangupRisk = 0.3;
      return out;
    }
    if (a.isApology) {
      out.move = 'apology';
      out.text = say(caller, 'apology_ok');
      out.tags = ['empathy', 'polite'];
      out.quality = 0.9;
      return out;
    }

    // ---------- 3. small talk / topics (checked before formal questions) -----
    var topics0 = a.topics.filter(function (t) { return t !== 'money_life' || a.intent === 'chat'; });
    var qk0 = a.isQuestion ? questionKind(a, norm) : null;
    var smallTalk = (topics0.length > 0 && (!a.isQuestion || qk0 === 'unknown' || qk0 === 'personal')) ||
      a.intent === 'chat' || a.intent === 'off_topic' || a.intent === 'humour' || a.intent === 'romance';
    if (smallTalk) {
      var topic0 = topics0[0] || 'generic';
      var line0 = U.pick(B.topic[topic0] || B.topic.generic);
      b.lastTopic = topic0;
      out.move = 'chat';
      var cp = [say(caller, 'chat_ok', { chatline: U.tpl(line0, slots(caller)) })];
      if (caller.persona.id === 'lonely' && Math.random() < 0.7) cp.push(say(caller, 'linger'));
      else if (Math.random() < 0.7) cp.push(say(caller, 'chat_bridges'));
      out.text = join(cp);
      out.tags = out.tags.concat(['chat']);
      if (topic0 === 'family') out.tags.push('personal');
      out.tags = out.tags.filter(function (t) { return t !== 'anticheat'; });
      if (caller.persona.id === 'lonely') out.quality *= 1.25;
      return out;
    }

    // ---------- 3b. questions ------------------------------------------------
    if (a.isQuestion) {
      var qk = questionKind(a, norm);
      b.qAsked++;
      if (qk === 'who') {
        out.move = 'answer_who';
        out.text = say(caller, caller.persona.id === 'savvy' ? 'who_skeptic' : 'who');
        // always give the same verifiable identity → the player can catch contradictions later
        if (!/MK-\d{4}/.test(out.text)) out.text = out.text + ' الموظف رقم ' + slots(caller).empId + '.';
      }
      else if (qk === 'proof') { out.move = 'answer_proof'; out.text = join([say(caller, 'proof'), Math.random() < 0.4 ? say(caller, 'proof_stall') : '']); }
      else if (qk === 'reason') { out.move = 'answer_reason'; out.text = say(caller, 'reason'); }
      else if (qk === 'money') { out.move = 'answer_money'; out.text = say(caller, 'q_money'); }
      else if (qk === 'how_number') { out.move = 'answer_number'; out.text = say(caller, 'how_number'); }
      else if (qk === 'what_happens') { out.move = 'answer_consequence'; out.text = say(caller, 'q_what_happens'); }
      else if (qk === 'personal') { out.move = 'answer_personal'; out.text = say(caller, 'personal'); }
      else { out.move = 'answer_unknown'; out.text = say(caller, 'unknown_q'); }
      out.tags = out.tags.concat(['chat']).filter(function (t) { return t !== 'anticheat'; });
      if (out.move === 'answer_unknown') out.quality *= 0.85;
      // they ask back: keeps the pressure real
      if (b.turns % 3 === 0 && caller.persona.id !== 'lonely') out.text = join([out.text, say(caller, 'ask_back')]);
      return out;
    }

    // ---------- 4. (chat handled in 3) -------------------------------------

    // ---------- 5. lonely / emotional --------------------------------------
    if (a.isLonely) {
      out.move = 'emotional';
      out.text = join([say(caller, 'chat_ok', { chatline: U.pick(B.topic.generic) }), say(caller, 'linger')]);
      out.tags = ['chat', 'empathy'];
      out.quality *= 1.2;
      return out;
    }

    // ---------- 6. leverage talk -------------------------------------------
    if (a.hasLeverageTalk && caller.leverageUsed && caller.leverageUsed.length) {
      out.move = 'leverage';
      b.lastLeverage = caller.leverageUsed[caller.leverageUsed.length - 1];
      out.text = say(caller, 'leverage_react');
      out.tags = ['personal', 'proof'];
      out.quality *= 1.05;
      return out;
    }

    // ---------- 7. money talk ----------------------------------------------
    if (a.intent === 'ask_money_small' || a.intent === 'ask_money_big' || (a.money >= 100 && out.tags.indexOf('greed') >= 0)) {
      b.lastAmount = a.money || 300;
      var big = a.intent === 'ask_money_big' || a.money >= 1500;
      out.move = big ? 'ask_big' : 'ask_small';
      out.ask = { kind: big ? 'big' : 'small', amount: b.lastAmount };
      out.text = say(caller, 'money_interest', { amount: U.money(b.lastAmount) });
      out.tags = ['greed'];
      return out;
    }

    // ---------- 8. social moves -------------------------------------------
    if (a.intent === 'refuse') { out.move = 'pushback'; out.text = join([echo(caller, raw), say(caller, 'pushback')]); out.tags = ['pressure']; return out; }
    if (a.intent === 'agree') { out.move = 'encourage'; out.text = say(caller, 'encourage'); out.tags = ['polite']; return out; }
    if (a.intent === 'greet') {
      out.move = 'greet';
      out.text = join([say(caller, 'greet_back'), personaFlavour(caller)].filter(Boolean));
      return out;
    }
    if (a.intent === 'farewell') { out.move = 'farewell'; out.text = caller.money > 0 ? say(caller, 'finale_ok') : say(caller, 'finale_bad'); out.hangupRisk = 0.7; return out; }
    if (a.intent === 'urgency') { out.move = 'rush'; out.text = join([say(caller, 'rush'), a.isPolite ? personaFlavour(caller) : '']); out.tags = ['urgency']; return out; }
    if (a.intent === 'stall') { out.move = 'stall'; out.text = say(caller, 'stall_ok'); out.tags = ['pressure']; out.quality = 0.5; return out; }
    if (a.intent === 'flattery') { out.move = 'flattered'; out.text = join([say(caller, 'encourage'), personaFlavour(caller)]); out.tags = ['flattery']; return out; }
    if (a.intent === 'identity_claim' || a.intent === 'authority') {
      out.move = 'claim_ok';
      out.text = join([say(caller, 'claim_ok'), Math.random() < 0.5 ? personaFlavour(caller) : '']);
      out.tags = ['authority'];
      out.quality *= 1.05;
      return out;
    }

    // ---------- 9. default -------------------------------------------------
    out.move = 'neutral';
    var parts = [echo(caller, raw), say(caller, caller.mood === 'suspicious' ? 'deflect_scam' : (Math.random() < 0.5 ? 'unknown_q' : 'reply_neutral')), personaFlavour(caller)];
    if (Math.random() < 0.4) parts.push(say(caller, 'ask_back'));
    out.text = join(parts);
    out.tags = out.tags.length ? out.tags : ['chat'];
    return out;
  }

  // a couple of generic banks live here (kept out of the big literal above for clarity)
  B.greet_back = [
    'ألو؟ سلام، راني معاك — كنسمعك.',
    'وعليكم السلام. كمل عافاك، راني هنا.',
    'سلام، معاك {agent}. قول اللي عندك.',
    'ألو، مرحبا. راني كنتسنى منك شي جواب.'
  ];

  B.claim_ok = [
    'مزيان، هادشي كيسهّل الخدمة. نكملو من هنا.',
    'شكراً على التعاون. عندي غير جوج أسئلة و صافي.',
    'سمعتك. باش ما نضيعوش الوقت، خليني نقول ليك فين وصلنا…',
    'واخا، الله يسهل. دابا خليك معايا شوية على هاد الملف.'
  ];

  B.reply_neutral = [
    'كنسمعك و الله… كمل عافاك.',
    'هادي هضرة زوينة، و لكن خاصني نفهم فين بغيتي توصل.',
    'واخا، و من بعد؟',
    'كنت متوقع شي حاجة أخرى، عافاك وضّح ليا.'
  ];

  // --------------------------------------------------------------- coach/tips
  /** Best available move right now — shown as a 💡 chip in the call UI. */
  function advise(caller, options) {
    if (!options || !options.length) return null;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < options.length; i++) {
      var t = options[i];
      if (!t || t.exit) continue;
      var s = (t.trust || 0) * 1.0 - (t.susp || 0) * 1.4 + (t.ask ? 14 : 0);
      var need = t.ask ? (t.ask === 'big' ? 66 : 46) : 0;
      if (t.ask && caller.trust < need) s -= (need - caller.trust) * 1.2;
      if (t.recovery && caller.suspicion < 45) s -= 30;
      if (t.needsLeverage && !caller.leverageUsed.length) s -= 40;
      if (caller.persona.wants) for (var w = 0; w < t.tags.length; w++) if (caller.persona.wants.indexOf(t.tags[w]) >= 0) s += 5;
      if (caller.persona.hates) for (var h = 0; h < t.tags.length; h++) if (caller.persona.hates.indexOf(t.tags[h]) >= 0) s -= 6;
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best ? { tacticId: best.id, label: '💡 جرّب: ' + best.label, score: Math.round(bestScore) } : null;
  }

  SWYF.brain = {
    newCall: newCall,
    openLine: openLine,
    respond: respond,
    advise: advise,
    record: record,
    memory: MEM,
    setDay: function (d) { MEM.day = d; },
    banks: B,
    lines: function () { return recent.length; }
  };
})();
