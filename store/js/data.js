/* ATLAS INK — catalogue data
   Every product is a digital download: no shipping, no inventory. */

export const TEE_COLORS = {
  ink:  { hex: '#171714', name: { en: 'Ink',  ar: 'أسود' } },
  bone: { hex: '#E9E1D0', name: { en: 'Bone', ar: 'عاجي' } },
  sand: { hex: '#C8B392', name: { en: 'Sand', ar: 'رملي' } },
  navy: { hex: '#26394B', name: { en: 'Navy', ar: 'كحلي' } },
  sage: { hex: '#9AA88F', name: { en: 'Sage', ar: 'زيتي' } },
  clay: { hex: '#C58B72', name: { en: 'Clay', ar: 'طيني' } },
  rose: { hex: '#D8B4AC', name: { en: 'Rose', ar: 'وردي' } }
};

export const COLLECTIONS = [
  { id: 'all',    label: { en: 'All designs', ar: 'كل التصاميم' } },
  { id: 'best',   label: { en: 'Best sellers', ar: 'الأكثر مبيعاً' } },
  { id: 'retro',  label: { en: 'Retro', ar: 'ريترو' } },
  { id: 'arabic', label: { en: 'Arabic type', ar: 'خط عربي' } },
  { id: 'street', label: { en: 'Streetwear', ar: 'ستريت وير' } },
  { id: 'minimal',label: { en: 'Minimal', ar: 'مينيمال' } },
  { id: 'y2k',    label: { en: 'Y2K', ar: 'واي 2 كاي' } },
  { id: 'tattoo', label: { en: 'Tattoo flash', ar: 'تاتو فلاش' } }
];

export const PRODUCTS = [
  {
    id: 'sahara',
    art: 'sahara',
    name: { en: 'Sahara Club', ar: 'نادي الصحراء' },
    collection: 'retro',
    price: 14,
    compareAt: 22,
    badge: 'best',
    rating: 4.9,
    reviews: 218,
    sales: 1840,
    date: '2026-08-12',
    tee: 'ink',
    colors: ['ink', 'bone', 'sand', 'navy'],
    bg: '#DACDB7',
    printWidth: 50,
    tags: ['sahara', 'desert', 'sunset', 'retro', 'morocco', 'صحراء', 'شمس', 'غروب', 'ريترو'],
    tagline: {
      en: 'Desert sunsets, 1974 tour posters and a tee that already looks vintage.',
      ar: 'غروب الصحراء، ملصقات جولات 1974، وتيشيرت يبدو عتيقاً من أول لبسة.'
    },
    desc: {
      en: 'A sun-bleached tribute to long roads and Moroccan tour posters of the seventies. Distressed halftone details, retro display type and a palette that sings on black or bone.',
      ar: 'تحية مشمسة للطرق الطويلة وملصقات الجولات المغربية في السبعينات. تفاصيل مطبوعة بروح الريترو وخطوط عريضة وألوان تليق بالتيشيرت الأسود أو العاجي.'
    }
  },
  {
    id: 'atlas',
    art: 'atlas',
    name: { en: 'Atlas', ar: 'أطلس' },
    collection: 'arabic',
    price: 16,
    compareAt: 24,
    badge: 'new',
    rating: 4.8,
    reviews: 96,
    sales: 610,
    date: '2026-10-02',
    tee: 'ink',
    colors: ['ink', 'bone', 'sand', 'sage'],
    bg: '#D6D2C6',
    printWidth: 51,
    tags: ['atlas', 'mountain', 'arabic', 'calligraphy', 'morocco', 'أطلس', 'جبال', 'خط عربي', 'المغرب'],
    tagline: {
      en: 'Bold Arabic lettering set against the Atlas range.',
      ar: 'خط عربي عريض أمام جبال الأطلس.'
    },
    desc: {
      en: 'Bold Arabic lettering set against the Atlas range — a print that feels local and looks global. The mountain linework is drawn to sit perfectly behind the wordmark on any garment.',
      ar: 'خط عربي عريض أمام جبال الأطلس — تصميم محلي الروح وعالمي المظهر. خطوط الجبال مرسومة لتتناسب تماماً خلف الشعار على أي قطعة.'
    }
  },
  {
    id: 'atay',
    art: 'atay',
    name: { en: 'Atay', ar: 'أتاي' },
    collection: 'arabic',
    price: 15,
    compareAt: 0,
    badge: '',
    rating: 4.9,
    reviews: 143,
    sales: 1290,
    date: '2026-07-18',
    tee: 'ink',
    colors: ['ink', 'bone', 'sage', 'sand'],
    bg: '#CCDACC',
    printWidth: 51,
    tags: ['tea', 'atay', 'mint', 'morocco', 'casablanca', 'أتاي', 'نعناع', 'شاي', 'المغرب'],
    tagline: {
      en: 'The 3pm ritual, drawn by hand: mint tea, steam and bilingual type.',
      ar: 'طقس الرابعة عصراً مرسوم يدوياً: أتاي، بخار وخطوط ثنائية اللغة.'
    },
    desc: {
      en: 'Mint tea, but make it a graphic. A hand-drawn glass, curling steam and mint leaves with bilingual type — a love letter to the Moroccan 3pm ritual.',
      ar: 'أتاي بالنعناع على شكل جرافيك. كأس مرسوم يدوياً مع البخار والنعناع وخطوط ثنائية اللغة — تحية لطقس الرابعة عصراً المغربي.'
    }
  },
  {
    id: 'no-days-off',
    art: 'nodays',
    name: { en: 'No Days Off', ar: 'بلا أيام راحة' },
    collection: 'street',
    price: 12,
    compareAt: 18,
    badge: 'best',
    rating: 4.8,
    reviews: 321,
    sales: 2760,
    date: '2026-05-30',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'sand'],
    bg: '#D7D7D0',
    printWidth: 53,
    tags: ['work', 'hustle', 'streetwear', 'type', 'lime', 'بلا راحة', 'شغل', 'ستريت وير'],
    tagline: {
      en: 'Stacked type for the ones who never clock out.',
      ar: 'خطوط مكدسة لمن لا يعرف التوقف.'
    },
    desc: {
      en: 'Loud, stacked type for the ones who never clock out. Acid lime with a checkerboard base — built to pop on black tees and sell on sight.',
      ar: 'خطوط عريضة ومكدسة لمن لا يعرف التوقف. أخضر لايم مع شريط مربعات — مصمم ليظهر بقوة على التيشيرت الأسود ويبيع من النظرة الأولى.'
    }
  },
  {
    id: 'inner-peace',
    art: 'innerpeace',
    name: { en: 'Inner Peace', ar: 'سلام داخلي' },
    collection: 'street',
    price: 13,
    compareAt: 0,
    badge: '',
    rating: 4.7,
    reviews: 85,
    sales: 740,
    date: '2026-09-08',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'sand'],
    bg: '#E4DDBF',
    printWidth: 53,
    tags: ['smiley', 'peace', 'chaos', 'sword', 'streetwear', 'سلام', 'سيف', 'فوضى'],
    tagline: {
      en: 'Inner peace, outer chaos — a wavy smiley with a sword.',
      ar: 'سلام داخلي وفوضى خارجية — وجه مبتسم بسيف.'
    },
    desc: {
      en: 'Inner peace, outer chaos. A wavy smiley, a sword and a halo — the kind of beautiful contradiction that sells tees.',
      ar: 'سلام داخلي وفوضى خارجية. وجه مبتسم متعرج، سيف وهالة — نوع التناقض الجميل الذي يبيع التيشيرتات.'
    }
  },
  {
    id: 'casablanca',
    art: 'casablanca',
    name: { en: 'Casablanca Athletic', ar: 'كازابلانكا أثلتيك' },
    collection: 'retro',
    price: 18,
    compareAt: 26,
    badge: 'best',
    rating: 4.9,
    reviews: 402,
    sales: 3180,
    date: '2026-04-11',
    tee: 'navy',
    colors: ['navy', 'bone', 'ink', 'sand'],
    bg: '#C7D2D5',
    printWidth: 51,
    tags: ['varsity', 'college', 'casablanca', 'athletic', 'retro', 'كازا', 'جامعة', 'ريترو'],
    tagline: {
      en: 'Varsity energy straight from the Atlantic coast.',
      ar: 'طاقة الجامعات مباشرة من ساحل الأطلسي.'
    },
    desc: {
      en: 'Varsity energy from the Atlantic coast. Arch type, a crest-like layout and butter-cream tones — your instant college-for-people-who-didn\'t-go-to-college tee.',
      ar: 'روح الجامعات من ساحل الأطلسي. خطوط مقوسة وتكوين يشبه الشعار بألوان كريمية — تيشيرت الجامعة لمن لم يذهب إلى الجامعة.'
    }
  },
  {
    id: 'after-hours',
    art: 'afterhours',
    name: { en: 'After Hours', ar: 'بعد الدوام' },
    collection: 'y2k',
    price: 15,
    compareAt: 0,
    badge: 'new',
    rating: 4.8,
    reviews: 174,
    sales: 980,
    date: '2026-10-08',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'sand'],
    bg: '#CFCBDB',
    printWidth: 53,
    tags: ['y2k', 'chrome', 'butterfly', 'night', '2000s', 'فراشة', 'كروم', 'ليل'],
    tagline: {
      en: 'Y2K chrome butterfly with a night-shift attitude.',
      ar: 'فراشة كروم من الألفينات بطاقة السهر.'
    },
    desc: {
      en: 'Y2K chrome, butterfly wings and a night-shift attitude. The metallic-look greys read like liquid silver on dark fabric.',
      ar: 'كروم الألفينات، أجنحة فراشة وطاقة السهر. التدرجات الرمادية المعدنية تبدو كالفضة السائلة على القماش الداكن.'
    }
  },
  {
    id: 'grow-slow',
    art: 'growslow',
    name: { en: 'Grow Slow', ar: 'انمُ بهدوء' },
    collection: 'minimal',
    price: 11,
    compareAt: 0,
    badge: '',
    rating: 4.9,
    reviews: 267,
    sales: 2040,
    date: '2026-06-21',
    tee: 'bone',
    colors: ['bone', 'sand', 'sage', 'rose'],
    bg: '#BFC7AE',
    printWidth: 50,
    tags: ['flower', 'daisy', 'minimal', 'slow', 'calm', 'زهرة', 'هدوء', 'مينيمال'],
    tagline: {
      en: 'A hand-drawn daisy and two words to slow down.',
      ar: 'زهرة مرسومة يدوياً وكلمتان للتمهل.'
    },
    desc: {
      en: 'A quiet one. A hand-drawn daisy and two words to slow down — for the minimalists who still want a little warmth.',
      ar: 'تصميم هادئ. زهرة مرسومة يدوياً وكلمتان للتمهل — للمينيماليين الذين يريدون لمسة دافئة.'
    }
  },
  {
    id: 'form-03',
    art: 'form',
    name: { en: 'Form 03', ar: 'فورم 03' },
    collection: 'minimal',
    price: 12,
    compareAt: 16,
    badge: 'new',
    rating: 4.7,
    reviews: 64,
    sales: 430,
    date: '2026-09-27',
    tee: 'bone',
    colors: ['bone', 'sand', 'clay', 'sage'],
    bg: '#C6B196',
    printWidth: 51,
    tags: ['bauhaus', 'geometry', 'minimal', 'gallery', 'arch', 'هندسة', 'مينيمال', 'قوس'],
    tagline: {
      en: 'A terracotta arch and Swiss type. Gallery energy, zero noise.',
      ar: 'قوس طيني وخطوط سويسرية. طاقة المعارض وبلا ضجيج.'
    },
    desc: {
      en: 'Part of the Object series: a terracotta arch, a sand circle and Swiss type. Gallery energy, zero noise — the tee for people who frame their posters.',
      ar: 'من سلسلة Object: قوس طيني، دائرة رملية وخطوط سويسرية. طاقة المعارض بلا ضجيج — للذين يعلّقون ملصقاتهم في إطارات.'
    }
  },
  {
    id: 'desert-rave',
    art: 'desertrave',
    name: { en: 'Desert Rave', ar: 'ديزرت ريف' },
    collection: 'y2k',
    price: 16,
    compareAt: 0,
    badge: '',
    rating: 4.8,
    reviews: 112,
    sales: 870,
    date: '2026-08-30',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'sand'],
    bg: '#E8CDBA',
    printWidth: 53,
    tags: ['rave', 'psychedelic', 'desert', 'sun', 'marrakech', 'سايكدلي', 'شمس', 'حفلة'],
    tagline: {
      en: 'A psychedelic sun for sunset-to-sunrise people.',
      ar: 'شمس سايكدلية لعشاق الغروب حتى الشروق.'
    },
    desc: {
      en: 'A psychedelic sun for sunset-to-sunrise people. Wavy bands, warm gradients and type that moves even when you\'re standing still.',
      ar: 'شمس سايكدلية لعشاق الغروب حتى الشروق. أشرطة متموجة وتدرجات دافئة وخطوط تتحرك حتى وأنت واقف.'
    }
  },
  {
    id: 'good-luck',
    art: 'goodluck',
    name: { en: 'Good Luck Club', ar: 'نادي الحظ' },
    collection: 'tattoo',
    price: 14,
    compareAt: 20,
    badge: 'best',
    rating: 4.8,
    reviews: 198,
    sales: 1510,
    date: '2026-07-04',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'sage'],
    bg: '#C5CDD1',
    printWidth: 53,
    tags: ['evil eye', 'talisman', 'tattoo', 'good luck', 'eye', 'عين', 'حظ', 'تاتو'],
    tagline: {
      en: 'An evil-eye talisman with tattoo-flash energy.',
      ar: 'تميمة عين الحسد بروح تاتو الفلاش.'
    },
    desc: {
      en: 'An evil-eye talisman with tattoo-flash energy. Cobalt, cream and a little red — wear it and keep the bad energy outside.',
      ar: 'تميمة عين الحسد بروح تاتو الفلاش. أزرق كوبالت، كريمي وقليل من الأحمر — البسها وأبقِ الطاقة السلبية بالخارج.'
    }
  },
  {
    id: 'love-bites',
    art: 'lovebites',
    name: { en: 'Love Bites', ar: 'حب يعض' },
    collection: 'tattoo',
    price: 15,
    compareAt: 0,
    badge: '',
    rating: 4.9,
    reviews: 231,
    sales: 1720,
    date: '2026-06-06',
    tee: 'ink',
    colors: ['ink', 'bone', 'navy', 'rose'],
    bg: '#DCC3BB',
    printWidth: 52,
    tags: ['snake', 'dagger', 'tattoo', 'love', 'flash', 'أفعى', 'خنجر', 'تاتو', 'حب'],
    tagline: {
      en: 'A dagger, a snake and zero regrets.',
      ar: 'خنجر، أفعى وبلا ندم.'
    },
    desc: {
      en: 'A dagger, a snake and zero regrets. Traditional tattoo-flash styling with a clean, modern layout made for black tees.',
      ar: 'خنجر، أفعى وبلا ندم. أسلوب تاتو الفلاش التقليدي بتكوين عصري ونظيف مصمم للتيشيرتات السوداء.'
    }
  }
];

export const FREE_PRODUCT = {
  id: 'welcome',
  art: 'welcome',
  name: { en: 'Welcome Card', ar: 'بطاقة الترحيب' },
  collection: 'sample',
  price: 0,
  compareAt: 0,
  badge: 'free',
  rating: 4.9,
  reviews: 1240,
  sales: 12400,
  date: '2026-01-01',
  tee: 'bone',
  colors: ['bone', 'sand', 'ink', 'sage'],
  bg: '#AEBE8E',
  printWidth: 53,
  tags: ['free', 'sample', 'welcome', 'مجاني', 'عينة'],
  tagline: {
    en: 'A free sample straight from the studio.',
    ar: 'عينة مجانية مباشرة من الاستوديو.'
  },
  desc: {
    en: 'A free sample from the studio: a bold asterisk and our welcome type. Download it, print it, and see how the files feel in your hands.',
    ar: 'عينة مجانية من الاستوديو: نجمة عريضة وخطوط الترحيب. حمّلها، اطبعها، واكتشف جودة الملفات بنفسك.'
  }
};

export const BUNDLE = {
  id: 'vault',
  art: 'bundle',
  name: { en: 'The Full Vault', ar: 'الخزنة الكاملة' },
  collection: 'bundle',
  price: 69,
  compareAt: 171,
  badge: 'bundle',
  rating: 5,
  reviews: 388,
  sales: 620,
  tags: ['bundle', 'vault', 'all'],
  tagline: {
    en: 'Every design in the current drop. One download.',
    ar: 'كل تصاميم المجموعة الحالية. تحميل واحد.'
  },
  desc: {
    en: 'Every design in the current drop, one download. Twelve graphics across six moods — enough to build a whole season of tees.',
    ar: 'كل تصاميم المجموعة الحالية في تحميل واحد. اثنا عشر جرافيك عبر ستة أنماط — كافية لبناء موسم كامل من التيشيرتات.'
  }
};

export const ALL_ITEMS = [...PRODUCTS, FREE_PRODUCT, BUNDLE];
export const getItem = id => ALL_ITEMS.find(item => item.id === id);
export const getCollection = id => COLLECTIONS.find(c => c.id === id);
