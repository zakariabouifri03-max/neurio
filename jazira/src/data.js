// كل البيانات: العناصر، الوصفات، المراحل — data.js

export const ITEMS = {
  wood:    { name: 'خشب',      icon: '🪵', desc: 'من الشجر — أساس كل حاجة' },
  stone:   { name: 'حجر',      icon: '🪨', desc: 'من الصخر — للبناء' },
  fiber:   { name: 'ألياف',    icon: '🌾', desc: 'من العشب — للحبال والقش' },
  seed:    { name: 'بزر',      icon: '🌱', desc: 'علف الدجاج 😋' },
  coconut: { name: 'جوز الهند', icon: '🥥', desc: 'كلي/شرب — يعمر الجوع والعطش', food: { hunger: 22, thirst: 30 } },
  egg:     { name: 'بيض',      icon: '🥚', desc: 'من الدجاج — تقدر تحضنو', food: { hunger: 12, thirst: 2 } },
  meat:    { name: 'لحم',      icon: '🥩', desc: 'لحم ني — طيّبو فوق النار', food: { hunger: 10, health: -6 } },
  cooked:  { name: 'لحم مطهّي', icon: '🍖', desc: 'بنيييين! 😍', food: { hunger: 42, health: 12 } },
  omelette:{ name: 'أومليت',   icon: '🍳', desc: 'بيض مطهّي بالسخون', food: { hunger: 32, health: 8 } },
  resin:   { name: 'راتنج',    icon: '🫧', desc: 'لعصا من الشجرة — كيسدّ القارب' },
  rope:    { name: 'حبل',      icon: '🪢', desc: 'من الألياف — للشراع والقارب' },
  sail:    { name: 'شراع',     icon: '🪧', desc: 'ريشة قماش كبيرة للقارب' },
  axe:     { name: 'فأس',      icon: '🪓', desc: 'يقطّع الشجر بزربة', tool: true, unique: true },
  pick:    { name: 'معول',     icon: '⛏️', desc: 'يبقّي الحجر', tool: true, unique: true },
};

export const STRUCTURES = {
  campfire: { name: 'نار المخيم', icon: '🔥' },
  hut:      { name: 'كوخ',        icon: '🏠' },
  coop:     { name: 'قفص الدجاج', icon: '🐔' },
  bench:    { name: 'طابلة الخدمة', icon: '🛠️' },
  boat:     { name: 'القارب',     icon: '⛵' },
};

// الوصفات: tool / build / item
export const RECIPES = [
  { id: 'axe',  cat: 'tool',  out: { axe: 1 },  cost: { wood: 3, stone: 2 }, stage: 1, name: 'فأس', icon: '🪓', once: true },
  { id: 'pick', cat: 'tool',  out: { pick: 1 }, cost: { wood: 3, stone: 3 }, stage: 1, name: 'معول', icon: '⛏️', once: true },

  { id: 'campfire', cat: 'build', build: 'campfire', cost: { wood: 5, stone: 3 }, stage: 2, name: 'نار المخيم', icon: '🔥', desc: 'الدفا + الطياب' },
  { id: 'hut',      cat: 'build', build: 'hut',      cost: { wood: 15, fiber: 10, stone: 5 }, stage: 2, name: 'كوخ', icon: '🏠', desc: 'نعاس بالليل' },

  { id: 'coop', cat: 'build', build: 'coop', cost: { wood: 20, fiber: 12, stone: 6 }, stage: 3, name: 'قفص الدجاج', icon: '🐔', desc: 'الدجاج يبيض فيه' },

  { id: 'rope', cat: 'item', out: { rope: 1 }, cost: { fiber: 3 }, stage: 4, name: 'حبل', icon: '🪢' },
  { id: 'bench', cat: 'build', build: 'bench', cost: { wood: 10, stone: 6, fiber: 4 }, stage: 4, name: 'طابلة الخدمة', icon: '🛠️', desc: 'للحوايج الصعبة' },
  { id: 'cooked',   cat: 'item', out: { cooked: 1 },   cost: { meat: 2, wood: 1 }, stage: 4, needFire: true, name: 'لحم مطهّي', icon: '🍖' },
  { id: 'omelette', cat: 'item', out: { omelette: 1 }, cost: { egg: 2, wood: 1 },  stage: 4, needFire: true, name: 'أومليت', icon: '🍳' },

  { id: 'sail', cat: 'item', out: { sail: 1 }, cost: { fiber: 8, rope: 4, wood: 2 }, stage: 5, needBench: true, name: 'شراع', icon: '🪧' },

  { id: 'boat', cat: 'build', build: 'boat', cost: { wood: 30, fiber: 14, stone: 8, resin: 5 }, stage: 6, needBench: true, name: 'هيكل القارب', icon: '⛵', desc: 'من بعد سلّم باقي المواد حدا القارب' },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// المراحل — كل مرحلة فيها أهداف
// t: inv (فالشنطة دابا) | stat (مجموع نهائي) | built | crafted | flag
export const STAGES = [
  {
    n: 1, name: 'أول نهار', sub: 'النجاة الأساسية',
    tip: 'قطّع الشجر 🌴 • الحجر الصغير 🪨 بلا معول • وقطع العشب 🌾 — كلشي بالـ⚡ SPACE',
    unlock: ['axe', 'pick'],
    goals: [
      { t: 'stat', k: 'wood', need: 10, label: 'خشب', icon: '🪵' },
      { t: 'stat', k: 'stone', need: 6, label: 'حجر', icon: '🪨' },
      { t: 'stat', k: 'fiber', need: 8, label: 'ألياف', icon: '🌾' },
    ],
  },
  {
    n: 2, name: 'المخيم', sub: 'صنع الأدوات ودار',
    tip: 'حلّ الوصفات 🛠️ (C) — صنع الفأس، ومن بعد بني النار والكوخ',
    unlock: ['campfire', 'hut', 'coop', 'bench'],
    goals: [
      { t: 'crafted', k: 'axe', need: 1, label: 'صنع فأس', icon: '🪓' },
      { t: 'built', k: 'campfire', need: 1, label: 'بني نار', icon: '🔥' },
      { t: 'built', k: 'hut', need: 1, label: 'بني كوخ', icon: '🏠' },
    ],
  },
  {
    n: 3, name: 'الدجاج 🐔', sub: 'الفلاحة',
    tip: 'بني القفص، عطي البزر للدجاج البري حتى يولّف، ودوّزو للقفص',
    unlock: ['rope'],
    goals: [
      { t: 'built', k: 'coop', need: 1, label: 'بني قفص', icon: '🐔' },
      { t: 'flag', k: 'tamed', need: 2, label: 'دوّز 2 دجاجات', icon: '🌱' },
      { t: 'stat', k: 'eggs', need: 6, label: 'جمع بيض', icon: '🥚' },
    ],
  },
  {
    n: 4, name: 'الطياب والماء', sub: 'المؤونة',
    tip: 'طيّب فوق النار 🔥 — باللحم 🥩 ولا بالبيض 🥚 (2 + خشب 1) • شرب من العين 💧',
    unlock: ['sail'],
    goals: [
      { t: 'built', k: 'bench', need: 1, label: 'بني الطابلة', icon: '🛠️' },
      { t: 'stat', k: 'meals', need: 4, label: 'طيّب 4 ماكلات', icon: '🍖' },
      { t: 'stat', k: 'resin', need: 6, label: 'جمع راتنج', icon: '🫧' },
      { t: 'flag', k: 'drink', need: 1, label: 'شرب من العين', icon: '💧' },
    ],
  },
  {
    n: 5, name: 'الحبال والشراع', sub: 'تجهيز البحر',
    tip: 'كل شراع محتاج 4 حبال + 8 ألياف — دير مخزون وافر',
    unlock: [],
    goals: [
      { t: 'stat', k: 'ropeMade', need: 6, label: 'صنع 6 حبال', icon: '🪢' },
      { t: 'crafted', k: 'sail', need: 1, label: 'صنع شراع', icon: '🪧' },
    ],
  },
  {
    n: 6, name: 'القارب ⛵', sub: 'البناء الكبير',
    tip: 'القارب محتاج خشب بزّاف — قطّع الغابة كلها وانتظر الشجر يخرج من جديد',
    unlock: [],
    goals: [
      { t: 'built', k: 'boat', need: 1, label: 'بني القارب', icon: '⛵' },
    ],
  },
  {
    n: 7, name: 'البحّار 🧭', sub: 'الخروج',
    tip: 'سير للقارب على الشاطئ واطلع فيه — وداعاً الجزيرة!',
    unlock: [],
    goals: [
      { t: 'flag', k: 'escaped', need: 1, label: 'اطلع فالقارب وسير', icon: '🧭' },
    ],
  },
];

export const ACHIEVEMENTS = [
  { id: 'chickens10', label: '🐣 ديّاكة بزاف', needs: (g) => g.chickens >= 10 },
];
