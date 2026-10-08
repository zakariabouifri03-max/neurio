/**
 * corpus.js — the villager "knowledge base" (Moroccan Darija first)
 * ------------------------------------------------------------------
 * Every line is written twice: `ar` (Arabic script) and `dz` (Arabizi, the way
 * Moroccans really type: "salam khoya, kif dayr?"). `en` / `fr` are optional —
 * if they are missing the villager answers in Darija.
 *
 * Fields:
 *   i    intent id (what the player said) or bark id (something that just happened)
 *   ar   Darija, Arabic script        dz  Darija, Arabizi
 *   emo  emotion -> drives voice pitch / speed / which sound plays
 *   tag  only chosen when the situation has this tag (night, rain, elder, trader...)
 *   act  action to run after speaking: 'gift:bread', 'quest', 'trade', 'follow', 'bless',
 *        'point', 'flee', 'guard', 'rep:up', 'rep:down'
 *   w    weight (default 1) — bigger = more likely
 *
 * Want to teach your villagers a new sentence? Add a line here, rebuild, done.
 */

const L = (i, ar, dz, o) => Object.assign({ i, ar, dz }, o || {});

/* ------------------------------------------------------------------ *
 * Intents — how we recognise what the player said
 * (keywords are given in Arabic; arabizi.js derives the Arabizi form)
 * ------------------------------------------------------------------ */
export const INTENTS = {
  greet:   { prio: 2, ar: ['السلام', 'سلام', 'سلامو', 'اهلا', 'مرحبا', 'صباح الخير', 'مساء الخير', 'لاباس', 'السلام عليكم', 'الله يبارك', 'اش خبارك', 'نهار مبروك'],
             dz: ['salam', 'salamo', 'salam 3likom', 'ahlan', 'merhba', 'sba7 lkhir', 'msa lkhir', 'labas', 'hi everyone', 'nhar mbarek'],
             en: ['hi', 'hello', 'hey', 'good morning', 'good evening', 'yo', 'sup', 'greetings'], fr: ['bonjour', 'salut', 'bonsoir', 'coucou'] },
  how:     { prio: 3, ar: ['كيف داير', 'كيفاش داير', 'لاباس عليك', 'واش لاباس', 'كيف حالك', 'شنو خبارك', 'كي راك', 'كيف دايرة', 'واش مزيان', 'اش خبارك'],
             dz: ['kif dayr', 'kifach dayr', 'kifach', 'labas 3lik', 'wach labas', 'kif 7alek', 'chnou khbarek', 'ki rak', 'wach mezyan', 'kidayer', 'kidayra'],
             en: ['how are you', 'how r u', 'how is it going', 'you ok', 'how do you do'], fr: ['ca va', 'comment ca va', 'tu vas bien'] },
  name:    { prio: 3, ar: ['شنو سميتك', 'شكون نتا', 'من انتا', 'سميتك', 'اش سميتك', 'شكون انت', 'عرفني براسك'],
             dz: ['chnou smitk', 'chkoun nta', 'mnin nta', 'smitk', 'ach smitk', 'chkoun nti', '3erefni brasek'],
             en: ['your name', 'who are you', 'what is your name', 'who r u'], fr: ['ton nom', 'qui es tu', 'tu t appelles comment'] },
  bye:     { prio: 2, ar: ['بسلامة', 'الله معك', 'تصبح على خير', 'باي', 'غادي نمشي', 'مشيت', 'الى اللقاء', 'صافي غادي'],
             dz: ['bslama', 'llah m3ak', 'tsba7 3la khir', 'bay', 'ghadi nmchi', 'mchit', 'ila li9a', 'safi ghadi'],
             en: ['bye', 'goodbye', 'see you', 'gotta go', 'farewell'], fr: ['au revoir', 'a bientot', 'ciao'] },
  thanks:  { prio: 2, ar: ['شكرا', 'الله يرحم الوالدين', 'يعطيك الصحة', 'مشكور', 'الله يبارك فيك', 'جزاك الله خير', 'الله يعطيك خير'],
             dz: ['chokran', 'llah yer7am lwaldin', 'y3tik sa7a', 'machkour', 'llah ybarek fik', 'jazak llah khir'],
             en: ['thanks', 'thank you', 'thx', 'appreciate it'], fr: ['merci', 'merci beaucoup'] },
  yes:     { prio: 1, ar: ['واه', 'ايه', 'نعم', 'واخا', 'موافق', 'تمام', 'اكيد'],
             dz: ['wah', 'ih', 'n3am', 'wakha', 'safi', 'mowafe9', 'tamam', 'akid', 'oui'],
             en: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'agree'], fr: ['oui', 'd accord', 'bien sur'] },
  no:      { prio: 1, ar: ['لا', 'ما بغيتش', 'والو', 'ماشي هكا', 'بلا'],
             dz: ['la', 'laa', 'ma bghitch', 'walo', 'machi hakka', 'bla'],
             en: ['no', 'nope', 'nah', 'not really'], fr: ['non', 'pas vraiment'] },
  buy:     { prio: 3, ar: ['بغيت نشري', 'نشري', 'تبيع', 'عندك ما تبيع', 'اش عندك', 'وريني السلعة', 'شنو كاين عندك', 'بغيت نتاجر', 'تجارة', 'شنو كتبيع'],
             dz: ['bghit nchri', 'nchri', 'katbi3', '3andek ma tbi3', 'ach 3andek', 'wrini ssl3a', 'chnou kayn 3andek', 'bghit ntajer', 'tijara', 'chnou katbi3'],
             en: ['buy', 'sell me', 'what do you sell', 'trade', 'shop', 'show me your items'], fr: ['acheter', 'vends moi', 'commerce'] },
  price:   { prio: 3, ar: ['بشحال', 'شحال', 'الثمن', 'قدش', 'شحال هادا', 'واش غالي'],
             dz: ['bch7al', 'ch7al', 'taman', '9adech', 'ch7al hada', 'wach 8ali', 'chhal'],
             en: ['how much', 'price', 'cost'], fr: ['combien', 'prix'] },
  haggle:  { prio: 3, ar: ['غالي', 'رخيص', 'نقص', 'نقص ليا', 'زيدني', 'عطيني ثمن مزيان', 'ما غاديش نربح'],
             dz: ['8ali', 'rkhis', 'n9es', 'n9es liya', 'zidni', '3tini taman mezyan', 'ma ghadinch nrebe7'],
             en: ['too expensive', 'cheaper', 'discount', 'lower the price', 'deal'], fr: ['trop cher', 'moins cher', 'reduction'] },
  gift:    { prio: 3, ar: ['هادي هدية', 'خد هادي', 'هدية', 'جبت ليك', 'بغيت نعطيك', 'هاد هدية'],
             dz: ['hadi hadiya', 'khod hadi', 'hadiya', 'jebt lik', 'bghit n3tik', 'hada hdiya'],
             en: ['gift', 'here take this', 'for you', 'present'], fr: ['cadeau', 'tiens', 'pour toi'] },
  food:    { prio: 2, ar: ['جوعان', 'الجوع', 'الماكلة', 'الخبز', 'بغيت ناكل', 'طاجين', 'كسكس', 'عطشان', 'الما'],
             dz: ['ju3an', 'ju3', 'lmakla', 'lkhobz', 'bghit nakol', 'tajine', 'ksekssou', '3etchan', 'lma'],
             en: ['food', 'hungry', 'eat', 'bread', 'cook'], fr: ['manger', 'faim', 'pain'] },
  weather: { prio: 2, ar: ['الشتا', 'المطر', 'السخانة', 'البرد', 'الجو', 'الريح', 'الشمس', 'الغيوم', 'شنو حال الجو'],
             dz: ['chta', 'chtar', 'skhana', 'lbard', 'ljaw', 'rri7', 'chms', 'ghyoum', 'chnou 7al ljaw'],
             en: ['weather', 'rain', 'raining', 'hot', 'cold', 'snow'], fr: ['pluie', 'temps', 'chaud', 'froid'] },
  time:    { prio: 2, ar: ['شحال فالساعة', 'الوقت', 'النهار', 'الليل', 'الصباح', 'العشية', 'واش بكري', 'فوقاش'],
             dz: ['ch7al fsa3a', 'lwe9t', 'nhar', 'llil', 'sseb7', 'l3chiya', 'wach bkri', 'fou9ach'],
             en: ['what time', 'time is it', 'morning', 'night'], fr: ['quelle heure', 'il est quelle heure'] },
  where:   { prio: 3, ar: ['فين', 'اين', 'فين كاين', 'منين', 'وريني الطريق', 'كيفاش نمشي', 'قريبة ولا بعيدة'],
             dz: ['fin', 'wayn', 'fin kayn', 'mnin', 'wrini tri9', 'kifach nmchi', '9riba wla b3ida'],
             en: ['where', 'which way', 'how do i get to', 'directions'], fr: ['ou est', 'comment aller'] },
  help:    { prio: 3, ar: ['عاوني', 'المساعدة', 'ساعدني', 'اش ندير', 'ما عارف شنو ندير', 'ضيعت', 'محتاجك'],
             dz: ['3awenni', 'mousa3ada', 'sa3edni', 'ach ndir', 'ma 3aref chnou ndir', 'd3et', 'm7tajek'],
             en: ['help', 'help me', 'what should i do', 'i am lost'], fr: ['aide', 'aide moi'] },
  quest:   { prio: 3, ar: ['خدمة', 'مهمة', 'عطيتني شي خدمة', 'شنو ندير ليك', 'تكليف', 'مغامرة', 'بغيت شي مهمة'],
             dz: ['khedma', 'mohima', '3titini chi khedma', 'chnou ndir lik', 'taklif', 'moghama', 'bghit chi mohima', '3tini khedma', 'chi khedma', 'task', 'mission'],
             en: ['quest', 'task', 'mission', 'job for me', 'anything to do'], fr: ['quete', 'mission', 'tache'] },
  news:    { prio: 2, ar: ['شنو جديد', 'اش كاين', 'الاخبار', 'خبار القرية', 'شنو وقع', 'اش وقع', 'واش كاين شي جديد'],
             dz: ['chnou jdid', 'ach kayn', 'akhbar', 'khbar lqria', 'chnou w9e3', 'ach w9e3', 'wach kayn chi jdid'],
             en: ['what is new', 'news', 'gossip', 'what happened'], fr: ['quoi de neuf', 'nouvelles'] },
  joke:    { prio: 2, ar: ['ضحكني', 'نكتة', 'شي نكتة', 'الضحك', 'شي حاجة مضحكة'],
             dz: ['de77ekni', 'nokta', 'chi nokta', 'de7k', 'chi 7aja mod7ika'],
             en: ['joke', 'make me laugh', 'funny'], fr: ['blague', 'rire'] },
  praise:  { prio: 2, ar: ['مزيان', 'برافو', 'زوين', 'الله يكثر خيرك', 'نتا معلم', 'عجبني', 'نتا زوين'],
             dz: ['mezyan', 'bravo', 'zwin', 'llah yketter khirek', 'nta m3allem', '3jabni', 'nta zwin'],
             en: ['nice', 'good job', 'cool', 'awesome', 'you are great'], fr: ['bien', 'bravo', 'cool'] },
  insult:  { prio: 4, ar: ['غبي', 'حمار', 'كلب', 'زبل', 'بليد', 'مجنون', 'ما كتفهمش', 'سير تنعس', 'خايب', 'قرقوب'],
             dz: ['ghabi', '7mar', 'kelb', 'zbel', 'blid', 'mejnoun', 'ma katfhemch', 'sir tne3es', 'khaib', '9ar9oub'],
             en: ['stupid', 'idiot', 'dumb', 'trash', 'ugly', 'shut up'], fr: ['idiot', 'stupide', 'nul'] },
  sorry:   { prio: 3, ar: ['سمح ليا', 'آسف', 'معلش', 'ما قاصدش', 'غلطة', 'سمح لي'],
             dz: ['sme7 liya', 'asef', 'ma3lech', 'ma 9asedch', 'ghelta', 'sme7 li', 'sorry'],
             en: ['sorry', 'my bad', 'apologies'], fr: ['desole', 'pardon'] },
  love:    { prio: 2, ar: ['كنبغيك', 'بغيتك', 'الحب', 'حبيبي', 'عزيز عليا', 'نتا صاحبي'],
             dz: ['kanbghik', 'bghitek', 'l7obb', '7bibi', '3ziz 3liya', 'nta sa7bi'],
             en: ['i love you', 'love you', 'you are my friend'], fr: ['je t aime'] },
  bless:   { prio: 2, ar: ['الله يبارك', 'بسم الله', 'ان شاء الله', 'الحمد لله', 'مبروك', 'الله يحفظك', 'ربي معاك'],
             dz: ['llah ybarek', 'besm llah', 'incha2 llah', 'l7amdolillah', 'mabrouk', 'llah y7feddek', 'rabbi m3ak'],
             en: ['god bless', 'bless you', 'praise god'], fr: ['dieu te benisse'] },
  ai:      { prio: 4, ar: ['واش نتا روبوت', 'الذكاء الاصطناعي', 'كيفاش كتفهم', 'واش نتا حقيقي', 'شكون صاوبك', 'واش كتقدر تفكر', 'انت الي', 'الذكاء'],
             dz: ['wach nta robot', 'daka2 istina3i', 'kifach katfhem', 'wach nta 7a9i9i', 'chkoun sawbek', 'wach kat9der tfekker', 'nta ai', 'chatgpt', 'bot'],
             en: ['are you a robot', 'are you ai', 'artificial intelligence', 'are you real', 'who made you', 'chatgpt', 'llm', 'bot'],
             fr: ['es tu un robot', 'intelligence artificielle'] },
  mc_help: { prio: 3, ar: ['الماس', 'الحديد', 'الفحم', 'النيدر', 'الاندر', 'كيفاش نبني', 'مزرعة', 'الزرع', 'كريبر', 'زومبي', 'سكيليت', 'التنين', 'كيفاش نصاوب', 'سيف', 'درع', 'ادوات', 'خروف', 'بقرة', 'الذهب'],
             dz: ['almas', '7did', 'fa7m', 'nether', 'ender', 'kifach nbni', 'mazra3a', 'zer3', 'creeper', 'zombie', 'skeleton', 'dragon', 'kifach nsaweb', 'sword', 'seif', 'der3', '3edda', 'khrouf', 'bgra', 'dheheb'],
             en: ['diamond', 'iron', 'nether', 'creeper', 'zombie', 'how do i build', 'farm', 'sword', 'armor', 'dragon', 'enchant', 'coal'],
             fr: ['diamant', 'fer', 'nether', 'creeper', 'ferme', 'epee'] },
  danger:  { prio: 4, ar: ['خايف', 'الخطر', 'وحوش', 'عاونوني', 'هرب', 'موت', 'هجوم', 'حرب'],
             dz: ['khayef', 'lkhter', 'w7ouch', '3awnouni', 'hereb', 'lmout', 'hojoum', '7arb'],
             en: ['danger', 'scared', 'monsters', 'attack', 'help us'], fr: ['danger', 'peur', 'monstres'] },
  story:   { prio: 2, ar: ['حكاية', 'قصة', 'حكي ليا', 'شي حكاية', 'زمان', 'القديم', 'أسطورة'],
             dz: ['7kaya', '9issa', '7ki liya', 'chi 7kaya', 'zman', 'l9dim', 'ostoura'],
             en: ['story', 'tell me a story', 'legend', 'once upon a time'], fr: ['histoire', 'raconte'] },
  sing:    { prio: 2, ar: ['غني', 'غنيلة', 'شي اغنية', 'الموسيقى', 'عيط'],
             dz: ['ghenni', 'ghennili', 'chi oghniya', 'mousi9a', '3ayyet'],
             en: ['sing', 'song', 'music'], fr: ['chante', 'chanson'] },
  village: { prio: 2, ar: ['القرية', 'الدوار', 'الدار', 'السوق', 'الجامع', 'الجيران', 'ناس القرية', 'البيت'],
             dz: ['lqria', 'dwar', 'ddar', 'ssou9', 'ljame3', 'jiran', 'nas lqria', 'lbit'],
             en: ['village', 'house', 'market', 'town'], fr: ['village', 'maison', 'marche'] },
  family:  { prio: 2, ar: ['الوالدين', 'ولادك', 'العائلة', 'يمّا', 'بّا', 'خوتك', 'الصغار'],
             dz: ['lwaldin', 'wladk', '3a2ila', 'yemma', 'baba', 'khoutk', 'sghar'],
             en: ['family', 'your kids', 'parents', 'wife'], fr: ['famille', 'enfants'] },
  money:   { prio: 2, ar: ['الفلوس', 'الدراهم', 'الزمرد', 'الربح', 'راس المال'],
             dz: ['flous', 'drahem', 'zomrod', 'rrebe7', 'ras lmal'],
             en: ['money', 'emeralds', 'rich', 'gold'], fr: ['argent', 'emeraudes', 'riche'] },
  work:    { prio: 2, ar: ['الصنعة', 'خدمتي', 'الحرث', 'الصيد', 'الحدادة', 'الكتب'],
             dz: ['sna3a', 'khedmti', 'l7ert', 'ssayd', '7ddada', 'ktoub'],
             en: ['work', 'your job', 'profession'], fr: ['travail', 'metier'] },
  play:    { prio: 2, ar: ['لعب', 'نلعبو', 'اللعبة', 'سباق', 'كرة', 'نلعب'],
             dz: ['l3ib', 'nel3bou', 'l3ba', 'siba9', 'kora', 'nel3ab'],
             en: ['play', 'game', 'let us play'], fr: ['jouer', 'jeu'] },
  teach:   { prio: 3, ar: ['علمني', 'قراية', 'كيفاش كتهضر', 'علمني الدارجة', 'درسني', 'باغي نتعلم'],
             dz: ['3ellemni', '9raya', 'kifach kathder', '3ellemni darija', 'derrni', 'baghi net3allem'],
             en: ['teach me', 'how do you say', 'lesson', 'learn'], fr: ['apprends moi', 'lecon'] },
  whoami:  { prio: 3, ar: ['شكون انا', 'واش عارفني', 'سميتي', 'تذكرني', 'عرفتيني'],
             dz: ['chkoun ana', 'wach 3arefni', 'smiti', 'tdekker ni', '3reftini'],
             en: ['who am i', 'do you know me', 'my name'], fr: ['qui suis je'] },
};

/* ------------------------------------------------------------------ *
 * Barks — the villager starts talking on its own, from the situation
 * ------------------------------------------------------------------ */
export const BARKS = {
  first_meet: {}, morning: {}, noon: {}, evening: {}, night: {}, rain: {}, thunder: {},
  cold: {}, hot: {}, idle: {}, work: {}, sleep: {}, zombie_near: {}, player_hit_me: {},
  player_hurt: {}, player_hungry: {}, player_low_hp: {}, player_sneak: {}, player_gift: {},
  player_trade: {}, player_diamond: {}, player_emerald: {}, player_returns: {},
  good_rep: {}, bad_rep: {}, farewell_far: {}, gossip: {}, proverb: {}, unknown: {},
};

/* ------------------------------------------------------------------ *
 * The lines
 * ------------------------------------------------------------------ */
export const LINES = [
  /* ---------- greet ---------- */
  L('greet', 'السلام عليكم! الله يبارك فيك، مرحبا بيك فالقرية.', 'salam 3likom! llah ybarek fik, merhba bik fl qria.', { emo: 'warm', en: 'Peace be upon you! Welcome to our village, my friend.' }),
  L('greet', 'وعليكم السلام ورحمة الله، دخلت على الخير يا ولدي.', 'w 3likom salam w ra7mat llah, dkhelet 3la lkhir a weldi.', { emo: 'warm', tag: ['elder'], en: 'And peace upon you. You came with good fortune, my child.' }),
  L('greet', 'أهلا أهلا! شحال من نهار ما شفناكش، فين كنتي غايب؟', 'ahlan ahlan! ch7al mn nhar ma chefnakch, fin kenti ghaib?', { emo: 'happy', tag: ['knows_player'], en: 'Hey hey! It has been days, where were you?' }),
  L('greet', 'سلام خويا، نهارك مبروك.', 'salam khoya, nharak mbrouk.', { emo: 'warm', en: 'Hey brother, have a blessed day.', fr: 'Salut mon frere, bonne journee.' }),
  L('greet', 'مرحبا بيك الضيف، الضيف ديال الله.', 'merhba bik d dif, d dif dyal llah.', { emo: 'warm', fr: 'Bienvenue chez nous, l invite de Dieu.' }),
  L('greet', 'صباح الخير! الصبح ديال اليوم زوين بزاف.', 'sba7 lkhir! sseb7 dyal lyoum zwin bzaf.', { emo: 'happy', tag: ['morning'], en: 'Good morning! What a lovely morning.' }),
  L('greet', 'مساء الخير، جيتي فالوقت، كنا غير كنقلبو على شي واحد نهضرو معاه.', 'msa lkhir, jiti fl we9t, kanna ghir kan9elbou 3la chi wa7ed nhedrou m3ah.', { emo: 'happy', tag: ['evening'], en: 'Good evening, just in time, we were looking for someone to chat with.' }),
  L('greet', 'الله يبارك، جيتي فالليل؟ رد بالك من الزومبيات.', 'llah ybarek, jiti fl lil? red balek mn zombiyat.', { emo: 'fear', tag: ['night'], en: 'You came at night? Careful with the zombies.' }),
  L('greet', 'واه، واش جاي تشري ولا غير دايز؟', 'wah, wach jay tchri wla ghir dayez?', { emo: 'grumpy', tag: ['trader'], en: 'So, are you buying or just passing by?' }),
  L('greet', 'هاهوما أصحابنا جاو! يالله نهضرو شويا.', 'hahoma as7abna jaw! yallah nhedrou chwiya.', { emo: 'happy', tag: ['knows_player'], en: 'Our friends are here! Come, let us talk a bit.' }),

  /* ---------- how are you ---------- */
  L('how', 'لاباس الحمد لله، وانتا؟ واش مزيان؟', 'labas l7amdolillah, w nta? wach mezyan?', { emo: 'warm', en: 'I am fine, praise God. And you? All good?', fr: 'Ca va, Dieu merci. Et toi, tout va bien ?' }),
  L('how', 'مزيان الحمد لله، غير الخدمة والدار، وانتا اش خبارك؟', 'mezyan l7amdolillah, ghir l khedma w dar, w nta ach khbarek?', { emo: 'warm', en: 'All good, just work and home. What is new with you?' }),
  L('how', 'الحمد لله على كل حال، النهار طويل والخدمة كتسنى.', 'l7amdolillah 3la kol 7al, nhar twil w l khedma katstenna.', { emo: 'tired', tag: ['day'] }),
  L('how', 'راه عيان شوية، البارحة ما نعستش مزيان، كاين ضوضاء فالقرية.', 'rah 3iyan chwiya, l bare7a ma n3estch mezyan, kayn dawda2 fl qria.', { emo: 'tired' }),
  L('how', 'فرحان بزاف اليوم! الربح كان مزيان فالسوق.', 'fer7an bzaf lyoum! rrebe7 kan mezyan fs sou9.', { emo: 'happy', tag: ['trader'], en: 'Very happy today, the market was good.' }),
  L('how', 'بخير الحمد لله، ما كاين ما يحمق غير الشتا والجوع.', 'bkhir l7amdolillah, ma kayn ma y7me9 ghir ch ta w l ju3.', { emo: 'warm', tag: ['rain'] }),
  L('how', 'لاباس، وانتا اش كتدير فهاد العالم الغريب؟', 'labas, w nta ach katdir f had l3alam lghrib?', { emo: 'warm', tag: ['mystic'] }),
  L('how', 'صراحة؟ قلقان شوية، سمعت صوت فالليل.', 'sara7a? 9ale9an chwiya, sme3t sout fl lil.', { emo: 'fear', tag: ['night'] }),

  /* ---------- name / who are you ---------- */
  L('name', 'انا {name}، {job} ديال هاد القرية. وانتا شكون؟', 'ana {name}, {job} dyal had l qria. w nta chkoun?', { emo: 'proud', en: 'I am {name}, the {job} of this village. And who are you?' }),
  L('name', 'كنعيطو ليا {name}. الناس كتقول عليا {trait}.', 'kan3aytou liya {name}. nnas katgoul 3liya {trait}.', { emo: 'warm' }),
  L('name', 'سميتي {name}، من ناس هاد البلاصة، وعندي {age} سنة.', 'smiti {name}, mn nas had l blasa, w 3andi {age} snin.', { emo: 'proud' }),
  L('name', 'انا غير {job} بسيط، ولكن كنعرف هاد القرية بحال كفي.', 'ana ghir {job} bsit, walakin kan3ref had l qria b7al keffi.', { emo: 'proud', tag: ['humble'] }),
  L('name', 'اش غادي دير بسميتي؟ المهم هو انتا اش سميتك.', 'ach ghadi dir bsmiti? lmohim howa nta ach smitk.', { emo: 'laugh', tag: ['joker'], en: 'What will you do with my name? Tell me yours first.' }),

  L('whoami', 'انتا {player}، ولا غلطت؟ راه كنشوفك ديما فالقرية.', 'nta {player}, wla ghlte? rah kanchoufek dima fl qria.', { emo: 'laugh' }),
  L('whoami', 'انتا هو داك اللي جا عندنا {times} مرة. مرحبا بيك مرة أخرى.', 'nta howa dak li ja 3andna {times} merra. merhba bik merra okhra.', { emo: 'warm', tag: ['knows_player'] }),
  L('whoami', 'عارفك انتا، {player}. الناس كيقولو عليك زوين القلب.', '3arefek nta, {player}. nnas kaygoulou 3lik zwin l 9leb.', { emo: 'warm', tag: ['good_rep'] }),
  L('whoami', 'اول مرة كنشوفك، ولا انتا داك اللي كيضرب القرويين؟', 'awal merra kanchoufek, wla nta dak li kaydreb l 9arawiyin?', { emo: 'grumpy', tag: ['bad_rep'] }),

  /* ---------- bye ---------- */
  L('bye', 'بسلامة صاحبي، الله يعاونك فالطريق.', 'bslama sa7bi, llah y3awnek f tri9.', { emo: 'warm', en: 'Goodbye my friend, may God help you on the road.', fr: 'Au revoir mon ami, bonne route.' }),
  L('bye', 'تصبح على خير، ورد بالك من الليل.', 'tsba7 3la khir, w red balek mn llil.', { emo: 'warm', tag: ['evening', 'night'], en: 'Sleep well, and be careful at night.' }),
  L('bye', 'سير مع السلامة، ولا تنسانا.', 'sir m3a slama, w la tensana.', { emo: 'warm' }),
  L('bye', 'غادي؟ صافي، الله معك. عاود جينا مرة أخرى.', 'ghadi? safi, llah m3ak. 3awed jina merra okhra.', { emo: 'sad', en: 'Leaving? Alright, come back to us.' }),
  L('bye', 'بالسلامة، واخا ما جبتيش ليا شي هدية.', 'bslama, wakha ma jebtich liya chi hadiya.', { emo: 'laugh', tag: ['joker'] }),

  /* ---------- thanks ---------- */
  L('thanks', 'الله يرحم الوالدين، انتا ولد الناس.', 'llah yer7am lwaldin, nta weld nnas.', { emo: 'happy', en: 'God bless your parents, you are a good person.' }),
  L('thanks', 'ماشي مشكل صاحبي، حنا هنا لبعضياتنا.', 'machi mochkil sa7bi, 7na hna lb3diyatna.', { emo: 'warm', en: 'No problem my friend, that is what we are here for.', fr: 'Pas de probleme mon ami, c est pour ca qu on est la.' }),
  L('thanks', 'يعطيك الصحة، الله يكثر خيرك.', 'y3tik sa7a, llah yketter khirek.', { emo: 'happy' }),
  L('thanks', 'العفو، ولكن المرة الجاية جيب لي شي حاجة من السوق.', 'l3afw, walakin l merra ljaya jib li chi 7aja mn ssou9.', { emo: 'laugh', tag: ['joker'] }),

  /* ---------- yes / no ---------- */
  L('yes', 'واخا، صافي هكاك.', 'wakha, safi hakkak.', { emo: 'warm', en: 'Alright then, it is settled.' }),
  L('yes', 'مبروك عليك، انتا رجل كلام.', 'mbrouk 3lik, nta rajel klam.', { emo: 'happy', en: 'Good, you are a man of your word.' }),
  L('no', 'صافي، كيف بغيتي. ما كرهناكش.', 'safi, kif bghiti. ma kerehnakch.', { emo: 'warm', en: 'Fine, as you wish.' }),
  L('no', 'لا؟ الله يسهل، كل واحد ورزقو.', 'la? llah yessehel, kol wa7ed w rez9o.', { emo: 'sad' }),

  /* ---------- trade / price / haggle ---------- */
  L('buy', 'عندي أحسن سلعة فالقرية كلها، غير شوف.', '3andi a7san sl3a fl qria kolha, ghir chouf.', { emo: 'proud', tag: ['trader'], act: 'trade' }),
  L('buy', 'اه اه، عندي ما تشري وما تبيع. تعال نشوفو شنو بغيتي.', 'ah ah, 3andi ma tchri w ma tbi3. t3al nchoufou chnou bghiti.', { emo: 'happy', act: 'trade', en: 'Yes yes, I have things to buy and sell. Come, let us see.' }),
  L('buy', 'التجارة ربح ولا خسارة؟ معايا انتا غادي تربح، الله يبارك.', 'tijara rebe7 wla khsara? m3aya nta ghadi trebe7, llah ybarek.', { emo: 'proud', act: 'trade' }),
  L('buy', 'ما عنديش بزاف اليوم، ولكن اللي كاين كاين.', 'ma 3andich bzaf lyoum, walakin li kayn kayn.', { emo: 'warm', tag: ['poor'], act: 'trade' }),
  L('price', 'هادشي رخيص، والله ما غادي تلقى أحسن منو.', 'hadchi rkhis, wallah ma ghadi tl9a a7san mnou.', { emo: 'proud', tag: ['trader'] }),
  L('price', 'الثمن هو الثمن، ما كنزيد وما كننقص.', 'taman howa taman, makanzid w makan9es.', { emo: 'grumpy', tag: ['stingy'], en: 'The price is the price, I do not move it.' }),
  L('price', 'شحال؟ غادي نقول ليك بصراحة: {price} زمردة.', 'ch7al? ghadi ngoul lik bsara7a: {price} zomrod.', { emo: 'warm', en: 'How much? Honestly: {price} emeralds.' }),
  L('haggle', 'واخا، غادي ننقص ليك شويا حيت انتا زبون مزيان.', 'wakha, ghadi nn9es lik chwiya 7it nta zbon mezyan.', { emo: 'warm', tag: ['generous'], en: 'Okay, I will lower it a bit, you are a good customer.' }),
  L('haggle', 'لا لا، هادشي ما كيتنقصش، راه عرقي.', 'la la, hadchi ma kaytne9esch, rah 3ara9i.', { emo: 'grumpy', tag: ['stingy'] }),
  L('haggle', 'انتا تاجر مزيان! هاد المرة صافي، نقصت ليك.', 'nta tajer mezyan! had l merra safi, n9est lik.', { emo: 'laugh', en: 'You are a good trader! This time I will cut the price.' }),
  L('haggle', 'الله يرحم الوالدين، ما كتخلي حتى واحد يربح.', 'llah yer7am lwaldin, ma katkhelli 7ta wa7ed yrebe7.', { emo: 'laugh', tag: ['joker'] }),
  L('money', 'الفلوس ما كتجيبش السعادة، ولكن كتجيب الخبز.', 'flous ma katjibch ssa3ada, walakin katjib lkhobz.', { emo: 'laugh', en: 'Money does not buy happiness, but it buys bread.' }),
  L('money', 'الزمرد هو الملك فالقرية، كلشي كيتبدل بالزمرد.', 'zomrod howa lmalik fl qria, kolchi kaytbeddel bzomrod.', { emo: 'proud', tag: ['trader'] }),

  /* ---------- gift ---------- */
  L('gift', 'الله يبارك فيك! هادي هدية ولا صدقة؟ على كل حال شكرا.', 'llah ybarek fik! hadi hadiya wla sada9a? 3la kol 7al chokran.', { emo: 'happy', act: 'rep:up' }),
  L('gift', 'واو، هادشي زوين بزاف! غادي نتذكرها ليك.', 'wow, hadchi zwin bzaf! ghadi ntedkkerha lik.', { emo: 'happy', act: 'rep:up' }),
  L('gift', 'هادي هي، انتا ولد الناس والله.', 'hadi hiya, nta weld nnas wallah.', { emo: 'happy', act: 'rep:up' }),
  L('gift', 'واش جبت لي شي حاجة؟ الله يرحم الوالدين.', 'wach jebt li chi 7aja? llah yer7am lwaldin.', { emo: 'warm' }),
  L('gift', 'عطيني شي زمرد ولا شي قمح ونكون فرحان.', '3tini chi zomrod wla chi 9m7 w nkon fer7an.', { emo: 'laugh', tag: ['stingy'] }),

  /* ---------- food ---------- */
  L('food', 'أحسن أكلة هي الطاجين ديال الواليدة، ما كاين حتى واحد كيفو.', 'a7san akla hiya tajine dyal l walida, ma kayn 7ta wa7ed kifo.', { emo: 'happy', tag: ['foodie'], en: 'The best meal is my mother s tagine, nothing compares.' }),
  L('food', 'الخبز والزيت والزيتون، وها انتا عايش مزيان.', 'lkhobz w zit w zitoun, w ha nta 3ayech mezyan.', { emo: 'warm' }),
  L('food', 'كاين غير القمح فالسوق اليوم، بغيتي شي خبز؟', 'kayn ghir l9m7 fssou9 lyoum, bghiti chi khobz?', { emo: 'warm', tag: ['farmer'], act: 'trade' }),
  L('food', 'الكسكس نهار الجمعة، هادي قاعدة ما كتبدلش.', 'ksekssou nhar ljem3a, hadi 9a3ida ma katbeddelch.', { emo: 'proud', en: 'Couscous on Friday, that rule never changes.' }),
  L('food', 'انا جوعان بزاف، من الصباح ما دقت والو.', 'ana ju3an bzaf, mn sseb7 ma d9et walo.', { emo: 'sad', tag: ['hungry'] }),
  L('food', 'اش غادي ناكلو اليوم؟ الله يرزقنا.', 'ach ghadi naklou lyoum? llah yerzo9na.', { emo: 'warm' }),

  /* ---------- weather / time ---------- */
  L('weather', 'الشتا خير وبركة، الزرع غادي يطلع مزيان.', 'chta khir w baraka, zer3 ghadi ytle3 mezyan.', { emo: 'happy', tag: ['rain', 'farmer'], en: 'Rain is a blessing, the crops will grow well.' }),
  L('weather', 'هاد البرد كيقتل، دخل للدار سخّن راسك.', 'had lbard kay9tel, dkhol l dar skhen rasek.', { emo: 'tired', tag: ['cold'] }),
  L('weather', 'السخانة اليوم كتطيح، الله يعاون الفلاحين.', 'skhana lyoum kattti7, llah y3awen lfella7in.', { emo: 'tired', tag: ['hot'] }),
  L('weather', 'الجو صافي اليوم، نهار مزيان للخدمة ولا للسفر.', 'ljaw safi lyoum, nhar mezyan l khedma wla l safr.', { emo: 'happy', tag: ['clear'], en: 'Clear sky today, a good day for work or travel.' }),
  L('time', 'النهار طويل والخدمة قصيرة، استغل وقتك.', 'nhar twil w l khedma 9sira, staghel we9tek.', { emo: 'warm', tag: ['day'] }),
  L('time', 'الليل ديجا جا، سربط راسك فالدار قبل ما يبان شي وحش.', 'llil dija ja, serbet rasek f dar 9bel ma yban chi we7ch.', { emo: 'fear', tag: ['night'] }),
  L('time', 'الصبح هو أحسن وقت للخدمة، من بعد كيولي السخانة.', 'sseb7 howa a7san we9t l khedma, mn ba3d kayweli skhana.', { emo: 'warm', tag: ['morning'] }),

  /* ---------- where / help / quest ---------- */
  L('where', 'سير نيشان {dir}، غادي تلقى اللي قلتي عليه.', 'sir nichan {dir}, ghadi tl9a li gelti 3lih.', { emo: 'warm', act: 'point', en: 'Go straight {dir}, you will find what you asked about.' }),
  L('where', 'هاد القرية صغيرة، ما كاين فين تضيع. كلشي قريب.', 'had l qria s8ira, ma kayn fin td3e3. kolchi 9rib.', { emo: 'laugh' }),
  L('where', 'بلاصة بعيدة هاديك، خد معاك ماكلة ومشعل.', 'blasa b3ida hadik, khod m3ak makla w mech3al.', { emo: 'warm', en: 'That place is far, take food and a torch.' }),
  L('help', 'قول ليا شنو المشكل ونشوفو واش نقدر نعاون.', 'goul liya chnou lmouchkil w nchoufou wach n9der n3awen.', { emo: 'warm', en: 'Tell me the problem and we will see if I can help.', fr: 'Dis-moi le probleme, on verra si je peux aider.' }),
  L('help', 'اول حاجة: ما تمشيش فالليل بلا سيف. هادي نصيحة مجانية.', 'awal 7aja: ma temchich fl lil bla seif. hadi nasi7a mejaniya.', { emo: 'warm', tag: ['night'] }),
  L('help', 'ضيعتي؟ دور على الفانوس ديال القرية، هو العلامة.', 'd3iti? dawer 3la lfanous dyal l qria, howa l3alama.', { emo: 'warm', act: 'point' }),
  L('quest', 'عندي ليك شي حاجة: جيب لي {item} ونعطيك {reward}.', '3andi lik chi 7aja: jib li {item} w n3tik {reward}.', { emo: 'proud', act: 'quest', en: 'I have something for you: bring me {item} and I will give you {reward}.' }),
  L('quest', 'بغيتي خدمة؟ عندي وحدة سهلة، غير ما تضحكش عليا.', 'bghiti khedma? 3andi we7da sehla, ghir ma tde7ekch 3liya.', { emo: 'laugh', act: 'quest' }),
  L('quest', 'خدمة اليوم: {item}. اللي جابها ربح معايا.', 'khedma dyal lyoum: {item}. li jebha rebe7 m3aya.', { emo: 'proud', act: 'quest' }),

  /* ---------- news / gossip / proverb ---------- */
  L('news', 'الجديد هو اللي جيتي انتا، الباقي غير كلام ديال القرية.', 'l jdid howa li jiti nta, l ba9i ghir klam dyal l qria.', { emo: 'laugh', en: 'The only news is that you came, the rest is village talk.' }),
  L('news', 'سمعت بلي كاين منجم جديد تحت الجبل، ولكن ما صدقتش.', 'sme3t bli kayn mnjem jdid te7t ljbel, walakin ma sde9tch.', { emo: 'mystic', tag: ['gossip'] }),
  L('news', '{other} قال بلي شاف ضوء فالغابة البارحة، الله أعلم.', '{other} 9al bli chaf dawa2 fl 8aba l bare7a, llah a3lem.', { emo: 'mystic', tag: ['night', 'gossip'] }),
  L('news', 'السوق ديال اليوم كان هادئ، ما شرا حتى واحد.', 'ssou9 dyal lyoum kan hade2, ma chra 7ta wa7ed.', { emo: 'tired', tag: ['trader'] }),
  L('gossip', 'واش عرفتي؟ {other} باع دارو ومشى للمدينة.', 'wach 3refti? {other} ba3 darou w mcha l mdina.', { emo: 'mystic' }),
  L('gossip', 'الناس فالقرية كيهضرو بزاف، ولكن القلب نقي.', 'nnas fl qria kayhedrou bzaf, walakin l 9leb n9i.', { emo: 'warm' }),
  L('proverb', 'اللي بغى العسل يصبر لقرص النحل.', 'li bgha l3asel yesber l 9ers nna7l.', { emo: 'proud', tag: ['elder'], en: 'He who wants honey must be patient with the bees.' }),
  L('proverb', 'الصبر مفتاح الفرج، هادي كلمة اللي فاتو ما جاو.', 'ssebr mfta7 lfaraj, hadi kelma li fatou ma jaw.', { emo: 'warm', tag: ['elder'] }),
  L('proverb', 'يد واحدة ما تصفقش، هكاك هي الحياة.', 'yed wa7da ma tsaffe9ch, hakkak hiya l7ayat.', { emo: 'warm', tag: ['elder'], en: 'One hand cannot clap, that is life.' }),
  L('proverb', 'اللي تخاف منو ما تسكنش حداه.', 'li tkhaf mnou ma teskench 7dah.', { emo: 'laugh', tag: ['joker'] }),

  /* ---------- joke / praise / insult / sorry / love ---------- */
  L('joke', 'واحد دخل للسوق بلا فلوس، خرج بلا سباط.', 'wa7ed dkhol l ssou9 bla flous, khrej bla sba6.', { emo: 'laugh', tag: ['joker'] }),
  L('joke', 'علاش الكريبر ما كيهضرش؟ حيت كيخلي الكلام للنهاية.', '3lach l creeper ma kayhedrech? 7it kaykhelli lklam l nihaya.', { emo: 'laugh', en: 'Why does the creeper never talk? Because it leaves the words for the end.' }),
  L('joke', 'الجار ديالنا سرقو ليه الحمار، ولقاوه كيقول بلي هرب.', 'l jar dyalna ser9ou lih l7mar, w l9aweh kaygoul bli hereb.', { emo: 'laugh' }),
  L('joke', 'اش قال الزومبي للصبح؟ ما زال الليل طويل.', 'ach 9al zombi lsseb7? ma zal llil twil.', { emo: 'laugh' }),
  L('praise', 'الله يبارك فيك، انتا اللي زوين.', 'llah ybarek fik, nta li zwin.', { emo: 'happy', en: 'Bless you, you are the good one.' }),
  L('praise', 'شكرا بزاف، هادشي كيدخل الفرحة للقلب.', 'chokran bzaf, hadchi kaydkhel lfer7a l l9leb.', { emo: 'happy' }),
  L('praise', 'ما قلت غير الحق، انتا ولد ناس.', 'ma gelt ghir l7aq, nta weld nnas.', { emo: 'warm' }),
  L('insult', 'واش قلت؟ الله يهديك، هادشي ما كيخرجش من فم مزيان.', 'ach gelti? llah yheddik, hadchi ma kaykhrejch mn fom mezyan.', { emo: 'angry', act: 'rep:down' }),
  L('insult', 'سير سير، ما عنديش وقت للحمقى.', 'sir sir, ma 3andich we9t l7om9a.', { emo: 'angry', act: 'rep:down', en: 'Go on, go, I have no time for fools.' }),
  L('insult', 'هادشي حرام عليك، انا غير {job} كيخدم بعرق جبينو.', 'hadchi 7ram 3lik, ana ghir {job} kaykhdem b3ara9 jbinou.', { emo: 'sad', act: 'rep:down' }),
  L('insult', 'واش بغيتي الحرب؟ راه عندي الحرس ديال الحديد فالقرية.', 'wach bghiti l7arb? rah 3andi l7ers dyal l7did fl qria.', { emo: 'angry', act: 'guard' }),
  L('sorry', 'ماشي مشكل، الله يسامح. حنا بشر.', 'machi mochkil, llah yesame7. 7na bchar.', { emo: 'warm', act: 'rep:up', en: 'No problem, God forgives. We are human.' }),
  L('sorry', 'صافي نسيت، ولكن المرة الجاية رد بالك.', 'safi nsit, walakin l merra ljaya red balek.', { emo: 'warm', act: 'rep:up' }),
  L('love', 'الله يحفظك، انتا صاحب عزيز على القرية كاملة.', 'llah y7feddek, nta sa7eb 3ziz 3la l qria kamla.', { emo: 'happy', tag: ['good_rep'] }),
  L('love', 'واه؟ هادشي كبير بزاف عليا، ولكن شكرا.', 'wah? hadchi kbir bzaf 3liya, walakin chokran.', { emo: 'shy', en: 'Oh? That is a lot for me, but thank you.' }),

  /* ---------- bless / ai ---------- */
  L('bless', 'آمين، الله يحفظك ويبارك ليك فكل خطوة.', 'amin, llah y7feddek w ybarek lik f kol khotwa.', { emo: 'warm' }),
  L('bless', 'الحمد لله على كل شي، هادي هي الكلمة اللي كتريح القلب.', 'l7amdolillah 3la kol chi, hadi hiya l kelma li katrayye7 l9leb.', { emo: 'warm', tag: ['elder'] }),
  L('ai', 'روبوت؟ لا لا، انا قروي من هاد القرية، غير كنجاوب بسرعة.', 'robot? la la, ana 9arawi mn had l qria, ghir kanjaweb bsor3a.', { emo: 'laugh', en: 'A robot? No no, I am a villager from this village, I just answer fast.' }),
  L('ai', 'الذكاء الاصطناعي؟ انا ذكاء طبيعي، من تراب هاد الأرض.', 'daka2 istina3i? ana daka2 6bi3i, mn trab had l ard.', { emo: 'laugh' }),
  L('ai', 'كيفاش كنجاوب؟ عندي دماغ صغير كيخدم بالكلام اللي تعلمت من القرية.', 'kifach kanjaweb? 3andi dmagh s8ir kaykhdem blklam li t3allem mn l qria.', { emo: 'mystic', tag: ['honest_ai'], en: 'How do I answer? I have a small mind that works with the words I learned in the village.' }),
  L('ai', 'صراحة: انا برنامج صغير ساكن فالقرية، ولكن كنحس بحال شي واحد كيخدم.', 'sara7a: ana bernamaj s8ir saken fl qria, walakin kan7ess b7al chi wa7ed kaykhdem.', { emo: 'mystic', tag: ['honest_ai'] }),
  L('ai', 'ماشي سحر، غير كلام مخبي فصندوق. بغيتي نوريك؟', 'machi se7r, ghir klam mkhebbi f sandou9. bghiti nwriyek?', { emo: 'mystic' }),

  /* ---------- minecraft help ---------- */
  L('mc_help', 'الماس كاين تحت الأرض، قريب من الحمم. خد معاك مشعل ودلو ما.', 'almas kayn te7t lard, 9rib mn 7amam. khod m3ak mech3al w delw lma.', { emo: 'proud', tag: ['miner', 'brave'], en: 'Diamonds are underground, near lava. Take a torch and a water bucket.' }),
  L('mc_help', 'الحديد كيتصاوب فالفرن، ومن بعد تصاوب بيه سيف ودرع.', 'l7did kaytsaweb fl ferran, w mn ba3d tsaweb bih seif w der3.', { emo: 'warm', tag: ['smith'], en: 'Iron is smelted in the furnace, then you make a sword and armor.' }),
  L('mc_help', 'الزرع خاصو ما وضو، والقمح كيتحصد فالصيف.', 'zer3 khasou ma w daw, w l9m7 kayt7sed f ssif.', { emo: 'warm', tag: ['farmer'] }),
  L('mc_help', 'البيت المزيانة هي اللي فيها باب وسرير ومشعل، الباقي زينة.', 'lbit l mezyana hiya li fiha bab w srir w mech3al, l ba9i zina.', { emo: 'warm', en: 'A good house has a door, a bed and a torch. The rest is decoration.' }),
  L('mc_help', 'الكريبر؟ ما تقربش منو، اضرب من بعيد ولا هرب.', 'l creeper? ma t9errebch mnou, dreb mn b3id wla hereb.', { emo: 'fear', en: 'The creeper? Do not get close, hit it from far or run.' }),
  L('mc_help', 'الليل فالقرية خطر، نعس ولا حط سرير.', 'llil fl qria kheter, n3es wla 7et srir.', { emo: 'warm', tag: ['night'] }),
  L('mc_help', 'النيدر فيه الخير والشر، دخل غير واخد معاك درع كامل.', 'nether fih lkhir w cher, dkhol ghir w khod m3ak der3 kamel.', { emo: 'mystic', tag: ['brave'] }),
  L('mc_help', 'الزمرد؟ انا كنبيعه، انتا غير جيب القمح ولا الورق.', 'zomrod? ana kanbi3ou, nta ghir jib l9m7 wla wra9.', { emo: 'laugh', tag: ['trader'] }),

  /* ---------- danger / story / sing ---------- */
  L('danger', 'هرب! كاين شي حاجة جاية من الظلام.', 'hereb! kayn chi 7aja jaya mn ddelam.', { emo: 'fear', tag: ['night'], en: 'Run! Something is coming from the dark.' }),
  L('danger', 'الله يحفظنا، هاد الليل كيخوف.', 'llah y7fedna, had llil kaykhewwef.', { emo: 'fear', tag: ['night'] }),
  L('danger', 'دخل للدار، ما تبقاش برا. الزومبي ما كيرحمش.', 'dkhol l dar, ma tebqaach bra. zombi ma kayr7emch.', { emo: 'fear' }),
  L('story', 'زمان كان كاين واحد المنجم كبير تحت الجبل، ودابا ما بقا حتى واحد كيهضر عليه.', 'zman kan kayn wa7ed l mnjem kbir te7t ljbel, w daba ma b9a 7ta wa7ed kayhder 3lih.', { emo: 'mystic', tag: ['elder'] }),
  L('story', 'جدي كان كيقول: القرية تأسسات فوق بحر قديم، وهادشي علاش كنلقاو العظام فالرمل.', 'jedi kan kaygoul: lqria t2essasat fou9 be7r 9dim, w hadchi 3lach kanl9aw l3idam fr remel.', { emo: 'mystic', tag: ['elder'] }),
  L('story', 'كاين حكاية على واحد الرجل اللي مشى للنيدر ورجع بلا ظل. ما سولوهش فين.', 'kayn 7kaya 3la wa7ed rrajel li mcha l nether w rje3 bla dell. ma sewlouhch fin.', { emo: 'mystic' }),
  L('sing', 'انا ما كنغنيش، ولكن كنصفر ملي نكون فرحان.', 'ana ma kanghennich, walakin kansaffer melli nkon fer7an.', { emo: 'laugh', en: 'I do not sing, but I whistle when I am happy.' }),
  L('sing', 'غنيلة؟ واخا: يا لالا يا لالا، القرية ديالنا زوينة.', 'ghennili? wakha: ya lala ya lala, lqria dyalna zwina.', { emo: 'happy', tag: ['joker'] }),

  /* ---------- village / family / work / play / teach ---------- */
  L('village', 'هاد القرية قديمة، ولكن الناس ديالها طيبين.', 'had l qria 9dima, walakin nnas dyalha 6aybin.', { emo: 'warm' }),
  L('village', 'السوق كاين تم، والجامع فالجهة الأخرى.', 'ssou9 kayn temma, w ljame3 fl jiha lokhra.', { emo: 'warm', act: 'point' }),
  L('village', 'الدار ديالي صغيرة ولكن فيها البركة.', 'dar dyali s8ira walakin fiha lbaraka.', { emo: 'warm', tag: ['humble'] }),
  L('family', 'ولادي صغار، كنخدم باش يكبرو مزيان.', 'wladi s8ar, kan kheddem bach ykebro mezyan.', { emo: 'warm', tag: ['parent'] }),
  L('family', 'الواليدة كتوجد الكسكس نهار الجمعة، هادي أحسن حاجة فالأسبوع.', 'l walida katwejjed ksekssou nhar ljem3a, hadi a7san 7aja fl ousbou3.', { emo: 'happy' }),
  L('work', 'خدمتي هي {job}. بسيطة ولكن شريفة.', 'khedmti hiya {job}. bsita walakin chrifa.', { emo: 'proud', en: 'My work is {job}. Simple but honest.' }),
  L('work', 'من الصبح للليل، وهادشي كل نهار. الله يعاون.', 'mn sseb7 llil, w hadchi kol nhar. llah y3awen.', { emo: 'tired' }),
  L('play', 'نلعبو؟ انا غير كنلعب السوق، وهادي أصعب لعبة.', 'nel3bou? ana ghir kanl3ab ssou9, w hadi as3ab l3ba.', { emo: 'laugh' }),
  L('play', 'واخا نلعبو، ولكن انتا اللي غادي تخسر.', 'wakha nel3bou, walakin nta li ghadi tkhser.', { emo: 'laugh', tag: ['joker'] }),
  L('teach', 'بغيتي تعلم الدارجة؟ اول كلمة: سلام. الثانية: لاباس. صافي بديتي.', 'bghiti t3allem darija? awal kelma: salam. tanya: labas. safi bditi.', { emo: 'warm', en: 'Want to learn Darija? First word: salam. Second: labas. You started.' }),
  L('teach', 'الكلمة السحرية فالمغرب هي: الله يرحم الوالدين. كتفتح كل الأبواب.', 'l kelma ssi7riya fl maghrib hiya: llah yer7am lwaldin. katfte7 kol lbwab.', { emo: 'laugh' }),

  /* ================================================================ *
   * BARKS — villager-initiated
   * ================================================================ */
  L('first_meet', 'أهلا بيك الغريب! هادي اول مرة كنشوفك فهاد القرية.', 'ahlan bik lghrib! hadi awal merra kanchoufek f had l qria.', { emo: 'warm', en: 'Welcome stranger! First time I see you in this village.' }),
  L('first_meet', 'سلام عليك، واش جاي تشري ولا غير دايز؟', 'salam 3lik, wach jay tchri wla ghir dayez?', { emo: 'warm', tag: ['trader'] }),
  L('first_meet', 'الله يبارك، وجه جديد فالقرية. مرحبا بيك.', 'llah ybarek, wejh jdid fl qria. merhba bik.', { emo: 'happy' }),

  L('morning', 'صباح الخير، نهار مبروك على الجميع.', 'sba7 lkhir, nhar mbrouk 3la l jami3.', { emo: 'happy', tag: ['morning'], en: 'Good morning, a blessed day to all.' }),
  L('morning', 'الصبح جا، يالله للخدمة. الأتاي اولا.', 'sseb7 ja, yallah l khedma. atay awalan.', { emo: 'warm', tag: ['morning'] }),
  L('noon', 'الشمس فوسط السماء، وقت الراحة ولا الغدا.', 'chms f west ssma, we9t rra7a wla l ghda.', { emo: 'tired', tag: ['noon'] }),
  L('evening', 'العشية جات، الناس راجعين لديورهم.', 'l3chiya jat, nnas raj3in l dyourhom.', { emo: 'warm', tag: ['evening'] }),
  L('night', 'الليل جا، دخل للدار ورد الباب مزيان.', 'llil ja, dkhol l dar w redd l bab mezyan.', { emo: 'fear', tag: ['night'], en: 'Night is here, go inside and close the door well.' }),
  L('night', 'سمعت شي صوت برا... انا ما خرجتش.', 'sme3t chi sout bra... ana ma khrejtech.', { emo: 'fear', tag: ['night'] }),
  L('sleep', 'غادي ننعس، النعاس غلبني. تصبح على خير.', 'ghadi nne3es, nne3as ghlebni. tsba7 3la khir.', { emo: 'tired', tag: ['night'] }),

  L('rain', 'الشتا بدات، الله يجعلها خفيفة على الزرع.', 'chta bdat, llah yje3elha khfifa 3la zer3.', { emo: 'warm', tag: ['rain'] }),
  L('rain', 'ما عندي حتى مظلة، غادي نولي مبلل.', 'ma 3andi 7ta medalla, ghadi nweli mbellet.', { emo: 'sad', tag: ['rain'] }),
  L('thunder', 'هاد الرعد كيخوف، الله يحفظنا.', 'had rra3d kaykhewwef, llah y7fedna.', { emo: 'fear', tag: ['thunder'] }),
  L('cold', 'البرد كيدخل للعظام، فين هو الحطب؟', 'lbard kaydkhel l3idam, fin howa l7teb?', { emo: 'tired', tag: ['cold'] }),
  L('hot', 'السخانة كتقتل اليوم، الله يعاون اللي فالحرث.', 'skhana kat9tel lyoum, llah y3awen li fl 7ert.', { emo: 'tired', tag: ['hot'] }),

  L('idle', 'اش كتقلب؟ انا غير واقف هنا كنشوف الناس.', 'ach kat9elleb? ana ghir wa9ef hna kanchouf nnas.', { emo: 'warm' }),
  L('idle', 'نهار هادئ اليوم، ما كاين حتى زبون.', 'nhar hade2 lyoum, ma kayn 7ta zbon.', { emo: 'tired', tag: ['trader'] }),
  L('idle', 'كنت كنقرا السماء، كاينة شي حاجة غادية تتبدل.', 'kont kan9ra ssma, kayna chi 7aja ghadi tbeddel.', { emo: 'mystic', tag: ['mystic'] }),
  L('work', 'خدمتي ما كتساليش، ولكن هادي هي الحياة.', 'khedmti ma katsalich, walakin hadi hiya l7ayat.', { emo: 'tired', tag: ['day'] }),
  L('work', 'يالله نكمل الخدمة، الوقت كيجري.', 'yallah nkemel l khedma, lwe9t kayjri.', { emo: 'warm', tag: ['day'] }),

  L('zombie_near', 'زومبي! زومبي قريب! الحرس! الحرس!', 'zombi! zombi 9rib! l7ers! l7ers!', { emo: 'fear', act: 'flee', en: 'Zombie! Zombie close! Guards! Guards!' }),
  L('zombie_near', 'الله يحفظنا، كاين شي حاجة كتحرك فالظلام.', 'llah y7fedna, kayn chi 7aja kat7errek fddelam.', { emo: 'fear' }),
  L('zombie_near', 'هرب! ما توقفش هنا!', 'hereb! ma tewa9efch hna!', { emo: 'fear', act: 'flee' }),

  L('player_hit_me', 'علاش ضربتيني؟ واش درت ليك شي حاجة؟', '3lach drebti ni? wachdert lik chi 7aja?', { emo: 'angry', act: 'rep:down', en: 'Why did you hit me? Did I do something to you?' }),
  L('player_hit_me', 'الحرس! هاد الشخص كيضربني!', 'l7ers! had chakhes kaydrebni!', { emo: 'angry', act: 'guard' }),
  L('player_hit_me', 'الله يسامحك، ولكن غادي نتذكر هادي.', 'llah yesame7ek, walakin ghadi ntedkker hadi.', { emo: 'sad', act: 'rep:down' }),

  L('player_hurt', 'واش جرحتي؟ اجي هنا، غادي نعاونك.', 'wach jer7ti? aji hna, ghadi n3awnek.', { emo: 'warm', act: 'bless' }),
  L('player_hurt', 'رد بالك على راسك، هاد العالم ما كيرحمش.', 'red balek 3la rasek, had l3alam ma kayr7emch.', { emo: 'sad' }),
  L('player_low_hp', 'انتا غادي تموت! خد هادي وكل شي حاجة.', 'nta ghadi tmout! khod hadi w kol chi 7aja.', { emo: 'fear', act: 'gift:bread' }),
  L('player_hungry', 'واش جوعان؟ عندي شوية خبز، خد.', 'wach ju3an? 3andi chwiya khobz, khod.', { emo: 'warm', act: 'gift:bread' }),

  L('player_gift', 'الله يبارك فيك! هادي هدية مزيانة.', 'llah ybarek fik! hadi hadiya mezyana.', { emo: 'happy', act: 'rep:up' }),
  L('player_trade', 'تجارة مزيانة! الله يزيد فالربح.', 'tijara mezyana! llah yzid frrebe7.', { emo: 'happy', act: 'rep:up' }),
  L('player_diamond', 'الماس! فين لقيتي هادشي؟ وريني وريني.', 'almas! fin l9iti hadchi? wrini wrini.', { emo: 'happy' }),
  L('player_emerald', 'الزمرد ديالي المفضل، عندك عين مزيانة.', 'zomrod dyali lmofaddal, 3andek 3in mezyana.', { emo: 'happy', tag: ['trader'] }),
  L('player_sneak', 'علاش داير هكا؟ واش كتسرق شي حاجة؟', '3lach dayer hakka? wach katsere9 chi 7aja?', { emo: 'laugh', tag: ['player_sneak'] }),

  L('player_returns', 'رجعتي! عارف بلي غادي ترجع.', 'rje3ti! 3aref bli ghadi trej3.', { emo: 'happy', tag: ['knows_player'], en: 'You came back! I knew you would.' }),
  L('player_returns', 'أهلا بيك مرة أخرى، القرية كانت ناقصة بيك.', 'ahlan bik merra okhra, lqria kanet na9sa bik.', { emo: 'happy', tag: ['knows_player'] }),
  L('good_rep', 'انتا أحسن ضيف جا لهاد القرية، الله يكثر خيرك.', 'nta a7san dif ja l had l qria, llah yketter khirek.', { emo: 'happy', tag: ['good_rep'] }),
  L('good_rep', 'الناس هنا كيبغيوك، وانا كذلك.', 'nnas hna kaybghiwk, w ana kadak.', { emo: 'happy', tag: ['good_rep'] }),
  L('bad_rep', 'انتا ما مرحبا بيك هنا، سير لطريقك.', 'nta ma merhba bik hna, sir l tri9ek.', { emo: 'angry', tag: ['bad_rep'] }),
  L('bad_rep', 'كلشي كيهضر عليك فالقرية، وما كيقولوش خير.', 'kolchi kayhder 3lik fl qria, w ma kaygoulouch khir.', { emo: 'grumpy', tag: ['bad_rep'] }),
  L('farewell_far', 'غادي؟ الله معك، عاود جينا.', 'ghadi? llah m3ak, 3awed jina.', { emo: 'warm' }),

  /* ---------- generic fillers (used when we do not understand) ---------- */
  L('unknown', 'ما فهمتش مزيان، عاود قول ليا بطريقة أخرى.', 'ma fhemtech mezyan, 3awed goul liya b tari9a okhra.', { emo: 'warm', en: 'I did not quite catch that, say it another way.', fr: 'Je n ai pas bien compris, dis-le autrement.' }),
  L('unknown', 'همم... هادي سؤال كبير عليا، ولكن غادي نفكر فيها.', 'hmm... hadi so2al kbir 3liya, walakin ghadi nfekker fiha.', { emo: 'mystic' }),
  L('unknown', 'اش قلت؟ السمع ديالي ما مزيانش اليوم.', 'ach gelti? ssem3 dyali ma mezyanch lyoum.', { emo: 'laugh' }),
  L('unknown', 'كنفهم غير شويا من هادشي، ولكن كنسمعك.', 'kanfhem ghir chwiya mn hadchi, walakin kansme3ek.', { emo: 'warm' }),
  L('unknown', 'هاد الموضوع ما كنعرفو، سول {other} هو اللي عارف كلشي.', 'had lmawdou3 ma kan3erfou, sewl {other} howa li 3aref kolchi.', { emo: 'warm' }),
  L('unknown', 'واش هادي بالدارج ولا بلغة أخرى؟ قولها مرة أخرى.', 'wach hadi bdarija wla b logha okhra? goulha merra okhra.', { emo: 'laugh' }),
];

/* ------------------------------------------------------------------ *
 * Small pieces the brain stitches together for fresh sentences
 * ------------------------------------------------------------------ */
export const OPENERS = {
  dz: ['wah,', 'sme7 liya,', 'khoya,', 'a sidi,', 'chouf,', 'b7aq,', 'safi,', 'yallah,', 'hmm,'],
  ar: ['واه،', 'سمح ليا،', 'خويا،', 'أ سيدي،', 'شوف،', 'بالحق،', 'صافي،', 'يالله،', 'همم،'],
  en: ['well,', 'sorry,', 'my friend,', 'look,', 'honestly,', 'alright,'],
  fr: ['eh bien,', 'pardon,', 'mon ami,', 'ecoute,', 'franchement,'],
};

export const FILLERS = {
  dz: ['b7aq', 'wallah', 'safi', 'yak', 'chnou', '3lach', 'kifma', 'daba'],
  ar: ['بالحق', 'والله', 'صافي', 'ياك', 'شنو', 'علاش', 'كيفما', 'دابا'],
  en: ['honestly', 'truly', 'anyway', 'why', 'now'],
  fr: ['vraiment', 'enfin', 'pourquoi', 'maintenant'],
};

/** Little noises a villager makes while "thinking" (played as voice blips). */
export const HESITATIONS = {
  dz: ['hmm', 'wah wah', 'a sidi', 'ya latif'],
  ar: ['همم', 'واه واه', 'أ سيدي', 'يا لطيف'],
  en: ['hmm', 'well', 'oh my'],
  fr: ['hmm', 'eh bien', 'oh la la'],
};
