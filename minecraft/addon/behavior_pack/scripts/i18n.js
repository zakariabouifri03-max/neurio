/**
 * i18n.js — everything the pack prints on screen (menus, buttons, system messages)
 * 4 languages: dz (Darija in Latin letters — the default, it renders on every device),
 * ar (Darija in Arabic letters), en, fr.
 */

export const STRINGS = {
  'pack.welcome': {
    dz: '§a§l⌬ Neurio AI Villagers§r §7v{v}§r\n§eCrouyin daba kayhdro, kayfssro w kaysewto b sout. Chouf l amulette f yeddek.\n§7Hder m3a ay crouyi: §fSneak + Dreb 3lih§7, wla §f/scriptevent neurio:say salam§r',
    ar: '§a§l⌬ قرويون بالذكاء الاصطناعي§r §7v{v}§r\n§eالقرويون دابا كيهضرو، كيفسرو وكيصوتو. شوف الأمولة فيدك.\n§7هضر مع أي قروي: §fSneak + ضرب عليه§7، ولا §f/scriptevent neurio:say سلام§r',
    en: '§a§l⌬ Neurio AI Villagers§r §7v{v}§r\n§eVillagers now talk, answer and speak with a voice. Check the amulet in your hand.\n§7Talk to any villager: §fSneak + Use§7, or §f/scriptevent neurio:say hello§r',
    fr: '§a§l⌬ Neurio AI Villagers§r §7v{v}§r\n§eLes villageois parlent, repondent et ont une voix. Regarde l amulette dans ta main.\n§7Parle a un villageois : §fSneak + Utiliser§7, ou §f/scriptevent neurio:say bonjour§r',
  },
  'menu.title': { dz: '{name} — {job}', ar: '{name} — {job}', en: '{name} — {job}', fr: '{name} — {job}' },
  'menu.body': {
    dz: '§7{age} 3am · {biome} · {traits}\n§eMood: §f{mood} §8| §eRep m3ak: §f{rep}\n§8{hint}',
    ar: '§7{age} عام · {biome} · {traits}\n§eالمزاج: §f{mood} §8| §eالسمعة معك: §f{rep}\n§8{hint}',
    en: '§7{age} y.o · {biome} · {traits}\n§eMood: §f{mood} §8| §eRep with you: §f{rep}\n§8{hint}',
    fr: '§7{age} ans · {biome} · {traits}\n§eHumeur : §f{mood} §8| §eReputation : §f{rep}\n§8{hint}',
  },
  'menu.talk':   { dz: '§b💬 Hder m3ah', ar: '§b💬 هضر معاه', en: '§b💬 Talk', fr: '§b💬 Parler' },
  'menu.gift':   { dz: '§6🎁 3tih hadiya', ar: '§6🎁 عطيه هدية', en: '§6🎁 Give a gift', fr: '§6🎁 Offrir' },
  'menu.shop':   { dz: '§a🛒 Sou9 dyalo', ar: '§a🛒 السوق ديالو', en: '§a🛒 His shop', fr: '§a🛒 Sa boutique' },
  'menu.quest':  { dz: '§d📜 Khedma / mohima', ar: '§d📜 خدمة / مهمة', en: '§d📜 Ask for a quest', fr: '§d📜 Demander une quete' },
  'menu.follow': { dz: '§e🚶 Tba3ni', ar: '§e🚶 تبعني', en: '§e🚶 Follow me', fr: '§e🚶 Suis-moi' },
  'menu.info':   { dz: '§9👤 Chkoun howa', ar: '§9👤 شكون هو', en: '§9👤 Who is he', fr: '§9👤 Qui est-il' },
  'menu.settings': { dz: '§7⚙ Settings', ar: '§7⚙ الإعدادات', en: '§7⚙ Settings', fr: '§7⚙ Reglages' },
  'menu.close':  { dz: '§c✖ Sed', ar: '§c✖ سد', en: '§c✖ Close', fr: '§c✖ Fermer' },

  'talk.label': {
    dz: '§eGoul chi haja l {name} §7(darija, 3arabiya, francais wla anglais).\n§8Android/iOS: dreb 3la l micro fl clavier bach thder b sout.\n§8Windows: Win + H bach tktb b sout.',
    ar: '§eقول شي حاجة ل {name} §7(بالدارجة، العربية، الفرنسية ولا الإنجليزية).\n§8أندرويد/آيفون: ضرب على الميكرو فالكلافيي باش تهضر بالصوت.\n§8ويندوز: Win + H باش تكتب بالصوت.',
    en: '§eSay something to {name} §7(Darija, Arabic, French or English).\n§8Android/iOS: tap the mic on the keyboard to speak.\n§8Windows: press Win + H to dictate.',
    fr: '§eDis quelque chose a {name} §7(darija, arabe, francais ou anglais).\n§8Android/iOS : touche le micro du clavier pour parler.\n§8Windows : Win + H pour dicter.',
  },
  'talk.placeholder': { dz: 'salam khoya...', ar: 'سلام خويا...', en: 'hello there...', fr: 'bonjour...' },
  'talk.send': { dz: '§a➤ Sifet', ar: '§a➤ صيفط', en: '§a➤ Send', fr: '§a➤ Envoyer' },
  'talk.again': { dz: '§b↻ 3awed goul chi haja', ar: '§b↻ عاود قول شي حاجة', en: '§b↻ Say something else', fr: '§b↻ Dire autre chose' },
  'talk.done': { dz: '§7✔ Sali', ar: '§7✔ صالي', en: '§7✔ Done', fr: '§7✔ Fini' },
  'talk.empty': { dz: '§7Ma ktebti walo... 3awed.', ar: '§7ما كتيتي والو... عاود.', en: '§7You wrote nothing... try again.', fr: '§7Tu n as rien ecrit...' },

  'gift.title': { dz: '§6🎁 Chno bghiti t3tih?', ar: '§6🎁 شنو بغيتي عطيه؟', en: '§6🎁 What do you give him?', fr: '§6🎁 Que lui offres-tu ?' },
  'gift.none': { dz: '§cMa 3andekch {item} f l inventaire.', ar: '§cما عندكش {item} فالأنفنتور.', en: '§cYou have no {item} in your inventory.', fr: '§cTu n as pas de {item}.' },
  'gift.given': { dz: '§a3titih {n}x {item}.', ar: '§aعطيتيه {n}x {item}.', en: '§aYou gave {n}x {item}.', fr: '§aTu as offert {n}x {item}.' },

  'shop.title': { dz: '§a🛒 Sou9 dyal {name}', ar: '§a🛒 السوق ديال {name}', en: '§a🛒 {name} s shop', fr: '§a🛒 Boutique de {name}' },
  'shop.buy': { dz: '§aChri {n}x {item} §7({price} zomrod)', ar: '§aشري {n}x {item} §7({price} زمرد)', en: '§aBuy {n}x {item} §7({price} em)', fr: '§aAcheter {n}x {item} §7({price} em)' },
  'shop.sell': { dz: '§6Bi3 {n}x {item} §7(+{price} zomrod)', ar: '§6بيع {n}x {item} §7(+{price} زمرد)', en: '§6Sell {n}x {item} §7(+{price} em)', fr: '§6Vendre {n}x {item} §7(+{price} em)' },
  'shop.noem': { dz: '§cMa 3andekch zmrod.', ar: '§cما عندكش زمرود.', en: '§cYou have no emeralds.', fr: '§cTu n as pas d emeraudes.' },
  'shop.nostock': { dz: '§cMa 3andech hadchi lyoum.', ar: '§cما عنديش هادشي اليوم.', en: '§cI do not have that today.', fr: '§cJe n ai pas ca aujourd hui.' },

  'set.title': { dz: '§7⚙ Settings — AI Villagers', ar: '§7⚙ الإعدادات — القرويون', en: '§7⚙ Settings — AI Villagers', fr: '§7⚙ Reglages — AI Villagers' },
  'set.lang': { dz: 'Logha / اللغة / Language', ar: 'اللغة', en: 'Language', fr: 'Langue' },
  'set.voice': { dz: 'Sout dyal l crouyin (voice)', ar: 'صوت القرويين', en: 'Villager voice', fr: 'Voix des villageois' },
  'set.barks': { dz: 'Kayhdro bou7dhom (barks)', ar: 'كيهضرو بوحد هم', en: 'They talk on their own', fr: 'Ils parlent seuls' },
  'set.channel': { dz: 'Fin yban lkلام', ar: 'فين يبان الكلام', en: 'Where the text shows', fr: 'Ou s affiche le texte' },
  'set.bubbles': { dz: 'Speech bubble fou9 rassehom', ar: 'فقاعة الكلام فوق راسهم', en: 'Speech bubble above head', fr: 'Bulle au-dessus de la tete' },
  'set.saved': { dz: '§aTsajlat l settings.', ar: '§aتسجلات الإعدادات.', en: '§aSettings saved.', fr: '§aReglages sauvegardes.' },

  'sys.noneNear': { dz: '§7Ma kayn 7ta crouyi 9rib lik.', ar: '§7ما كاين حتى قروي قريب ليك.', en: '§7No villager near you.', fr: '§7Aucun villageois pres de toi.' },
  'sys.amulet': { dz: '§e⌬ Amulette dyal l crouyin §7— dreb biha 3la chi crouyi bach t3tih smiya w chakhsiya.', ar: '§e⌬ أمولة القرويين §7— ضرب بيها على شي قروي باش تعطيهسمية وشخصية.', en: '§e⌬ Villager Amulet §7— use it on a villager to give him a name and a personality.', fr: '§e⌬ Amulette §7— utilise-la sur un villageois pour lui donner un nom.' },
  'sys.bound': { dz: '§a{name} wla crouyi dyal AI! §7({job})', ar: '§a{name} ولا قروي بالذكاء الاصطناعي! §7({job})', en: '§a{name} is now an AI villager! §7({job})', fr: '§a{name} est maintenant un villageois IA ! §7({job})' },
  'sys.follow': { dz: '§e{name} ghadi ytb3ek daba.', ar: '§e{name} غادي يتبعك دابا.', en: '§e{name} will follow you now.', fr: '§e{name} va te suivre.' },
  'sys.stopfollow': { dz: '§7{name} we9ef.', ar: '§7{name} وقف.', en: '§7{name} stopped.', fr: '§7{name} s est arrete.' },
  'sys.questGot': { dz: '§a✔ Jebti {item}! {name} 3tak {reward}.', ar: '§a✔ جيبتي {item}! {name} عطاتك {reward}.', en: '§a✔ You brought {item}! {name} gave you {reward}.', fr: '§a✔ Tu as apporte {item} ! {name} t a donne {reward}.' },
  'sys.voiceOff': { dz: '§7Sout tseda.', ar: '§7الصوت تسد.', en: '§7Voice off.', fr: '§7Voix coupee.' },
  'sys.voiceOn': { dz: '§aSout khdam.', ar: '§aالصوت خدام.', en: '§aVoice on.', fr: '§aVoix activee.' },
  'sys.nameSet': { dz: '§aSmiya tbedlat l {name}.', ar: '§aالسمية تبدلات ل {name}.', en: '§aName set to {name}.', fr: '§aNom change en {name}.' },
  'sys.noVoice': { dz: '§8Voice bank ma kaynach — kaydir ghir "hrmm". Dir §7python3 tools/build_voicebank.py --engine edge§8 bach tji sout 7a9i9i b darija.', ar: '§8ما كاينش بنك الصوت — كيدير غير "هرم". دير §7python3 tools/build_voicebank.py --engine edge§8 باش يجي صوت حقيقي بالدارجة.', en: '§8No voice bank yet — villagers only mumble. Run §7python3 tools/build_voicebank.py --engine edge§8 for real Darija speech.', fr: '§8Pas de banque vocale — ils marmonnent. Lance §7python3 tools/build_voicebank.py --engine edge§8.' },
  'sys.help': {
    dz: '§e⌬ Neurio AI Villagers — commands:\n§f/scriptevent neurio:say <klam>§7 hder m3a a9reb crouyi\n§f/scriptevent neurio:all <klam>§7 kolchi kism3ek\n§f/scriptevent neurio:lang dz|ar|en|fr\n§f/scriptevent neurio:voice on|off\n§f/scriptevent neurio:menu§7 y7el l menu\n§f/scriptevent neurio:help',
    ar: '§e⌬ القرويون — الأوامر:\n§f/scriptevent neurio:say <كلام>§7 هضر مع أقرب قروي\n§f/scriptevent neurio:all <كلام>§7 كلشي كيسمعك\n§f/scriptevent neurio:lang dz|ar|en|fr\n§f/scriptevent neurio:voice on|off\n§f/scriptevent neurio:menu\n§f/scriptevent neurio:help',
    en: '§e⌬ Neurio AI Villagers — commands:\n§f/scriptevent neurio:say <text>§7 talk to the closest villager\n§f/scriptevent neurio:all <text>§7 everybody hears you\n§f/scriptevent neurio:lang dz|ar|en|fr\n§f/scriptevent neurio:voice on|off\n§f/scriptevent neurio:menu\n§f/scriptevent neurio:help',
    fr: '§e⌬ Neurio AI Villagers — commandes :\n§f/scriptevent neurio:say <texte>§7 parler au villageois le plus proche\n§f/scriptevent neurio:all <texte>\n§f/scriptevent neurio:lang dz|ar|en|fr\n§f/scriptevent neurio:voice on|off\n§f/scriptevent neurio:menu\n§f/scriptevent neurio:help',
  },
};

export const LANG_NAMES = { dz: 'Darija (Arabizi)', ar: 'الدارجة (عربي)', en: 'English', fr: 'Francais' };

/** Translate + fill {vars}. Falls back dz -> en -> ar -> fr -> key. */
export function t(key, lang = 'dz', vars = {}) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let s = entry[lang] || entry.dz || entry.en || entry.ar || entry.fr || key;
  for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Mood / rep as words. */
export function moodWord(m, lang) {
  if (m > 0.8) return { dz: 'fer7an bzaf', ar: 'فرحان بزاف', en: 'great', fr: 'super' }[lang] || 'great';
  if (m > 0.55) return { dz: 'mezyan', ar: 'مزيان', en: 'good', fr: 'bien' }[lang] || 'good';
  if (m > 0.35) return { dz: '3adi', ar: 'عادي', en: 'ok', fr: 'ok' }[lang] || 'ok';
  if (m > 0.18) return { dz: 'mkelef', ar: 'مكالف', en: 'grumpy', fr: 'grognon' }[lang] || 'grumpy';
  return { dz: 'mgheddeb', ar: 'مغضب', en: 'angry', fr: 'fache' }[lang] || 'angry';
}

export function repWord(r, lang) {
  if (r >= 6) return { dz: 'sa7eb 9dim', ar: 'صاحب قديم', en: 'close friend', fr: 'ami proche' }[lang];
  if (r >= 2) return { dz: 'mezyana', ar: 'مزيانة', en: 'friendly', fr: 'sympa' }[lang];
  if (r > -2) return { dz: '3adiya', ar: 'عادية', en: 'neutral', fr: 'neutre' }[lang];
  if (r > -5) return { dz: 'ma mezyanach', ar: 'ما مزياناش', en: 'cold', fr: 'froid' }[lang];
  return { dz: '3edou', ar: 'عدو', en: 'enemy', fr: 'ennemi' }[lang];
}
