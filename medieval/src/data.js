// ── IRONVOW — content database (all original) ────────────────────────────────
// Houses, weapons, harnesses, champions, arenas, drill schedules, economy.

export const HOUSES = {
  ashcombe: { name: 'House Ashcombe', motto: 'Iron keeps the vow', field: '#3a1a18', accent: '#d8cdb4' },
  vare: { name: 'House Vare', motto: 'Cold steel, cold truth', field: '#1a2234', accent: '#e6ddc6' },
  thornwald: { name: 'Thornwald Company', motto: 'We sell the peace we break', field: '#1e281c', accent: '#d5c9a6' },
  emberfall: { name: 'Emberfall Freeblades', motto: 'Ash remembers', field: '#40220f', accent: '#f0e0bc' },
  rookmoor: { name: 'Rookmoor Watch', motto: 'Nothing passes', field: '#161618', accent: '#cfc4a6' },
};

// ════════════════════════════════════════════════════════════════════════════
//  WEAPONS — archetype drives the moveset, model drives the geometry
// ════════════════════════════════════════════════════════════════════════════
// damage channels are 0..1 weights; they are multiplied by swing energy.
export const WEAPONS = [
  {
    id: 'arming', name: 'Ashcombe Arming Sword', short: 'Arming Sword', house: 'ashcombe',
    archetype: 'sword', hands: 1, model: 'sword1',
    mass: 1.12, length: 0.87, reach: 1.53, balance: 0.15,
    phys: { cut: 1.00, blunt: 0.22, pierce: 0.55, shearing: 0.62, penetration: 0.30 },
    swing: { speed: 1.00, windup: 1.00 }, stamina: { swing: 9, hold: 4 },
    cost: 0, renown: 0,
    lore: 'Plain, honest, and quick enough to answer a lie before it lands.',
  },
  {
    id: 'longsword', name: 'Vare Ferroline Longsword', short: 'Longsword', house: 'vare',
    archetype: 'sword', hands: 2, model: 'sword2',
    mass: 1.52, length: 1.10, reach: 1.80, balance: 0.20,
    phys: { cut: 1.05, blunt: 0.26, pierce: 0.72, shearing: 0.70, penetration: 0.40 },
    swing: { speed: 0.86, windup: 0.88 }, stamina: { swing: 14, hold: 6 },
    cost: 0, renown: 250,
    lore: 'Two hands, two edges, one argument. The blade of House Vare.',
  },
  {
    id: 'messer', name: 'Thornwald Hook-Messer', short: 'Messer', house: 'thornwald',
    archetype: 'sword', hands: 1, model: 'messer',
    mass: 0.92, length: 0.84, reach: 1.51, balance: 0.13,
    phys: { cut: 1.15, blunt: 0.18, pierce: 0.40, shearing: 0.85, penetration: 0.26 },
    swing: { speed: 1.16, windup: 1.12 }, stamina: { swing: 6, hold: 3 },
    cost: 900, renown: 0,
    lore: 'A butcher\'s answer to a knight. Cuts rope, canvas, and mail fringe.',
  },
  {
    id: 'greatsword', name: 'Emberfall Pyrewrought Greatsword', short: 'Greatsword', house: 'emberfall',
    archetype: 'greatsword', hands: 2, model: 'sword3',
    mass: 2.62, length: 1.42, reach: 2.13, balance: 0.34,
    phys: { cut: 1.25, blunt: 0.40, pierce: 0.62, shearing: 1.05, penetration: 0.42 },
    swing: { speed: 0.66, windup: 0.70 }, stamina: { swing: 22, hold: 9 },
    cost: 2400, renown: 900,
    lore: 'Forged from a cracked bell. It does not cut so much as convince.',
  },
  {
    id: 'poleaxe', name: 'Rookmoor Watch-Poleaxe', short: 'Poleaxe', house: 'rookmoor',
    archetype: 'polearm', hands: 2, model: 'poleaxe',
    mass: 2.30, length: 0.36, reach: 2.14, balance: 0.62,
    phys: { cut: 0.72, blunt: 1.05, pierce: 0.85, shearing: 0.55, penetration: 0.78 },
    swing: { speed: 0.62, windup: 0.72 }, stamina: { swing: 19, hold: 8 },
    cost: 1900, renown: 300,
    lore: 'Open a knight like a ledger. Spike, beak, and blade in one shaft.',
  },
  {
    id: 'mace', name: 'Fenwick Bell-Mace', short: 'Mace', house: 'thornwald',
    archetype: 'mace', hands: 1, model: 'mace',
    mass: 1.68, length: 0.24, reach: 1.31, balance: 0.10,
    phys: { cut: 0.10, blunt: 1.35, pierce: 0.30, shearing: 0.05, penetration: 0.92 },
    swing: { speed: 0.90, windup: 1.05 }, stamina: { swing: 12, hold: 5 },
    cost: 1400, renown: 0,
    lore: 'Plate does not care about edges. It cares about this.',
  },
  {
    id: 'spear', name: 'Bramblewatch Piketooth', short: 'Spear', house: 'vare',
    archetype: 'spear', hands: 2, model: 'spear',
    mass: 1.90, length: 0.34, reach: 2.72, balance: 0.92,
    phys: { cut: 0.55, blunt: 0.30, pierce: 0.95, shearing: 0.35, penetration: 0.66 },
    swing: { speed: 0.70, windup: 0.80 }, stamina: { swing: 13, hold: 7 },
    cost: 1500, renown: 0,
    lore: 'The first lesson and the last: keep the point between you.',
  },
  {
    id: 'falcon', name: 'Gilded Falcon-Talon', short: 'Falcon-Talon', house: 'emberfall',
    archetype: 'sword', hands: 1, model: 'falcon',
    mass: 1.20, length: 0.95, reach: 1.61, balance: 0.14,
    phys: { cut: 1.20, blunt: 0.24, pierce: 0.86, shearing: 0.92, penetration: 0.62 },
    swing: { speed: 1.08, windup: 1.06 }, stamina: { swing: 10, hold: 4 },
    cost: 4200, renown: 1600,
    lore: 'A duelling blade of folded bloom-iron. It sings on the parry.',
  },
];

// ── offhand shields ─────────────────────────────────────────────────────────
export const SHIELDS = [
  {
    id: 'none', name: 'Bare Hand', house: 'ashcombe', model: null,
    mass: 0, coverage: 0, phys: { cut: 0.15, blunt: 0.35, pierce: 0.1 }, stamina: 0,
    bash: 0, cost: 0, renown: 0, lore: 'Catch a blade with a gauntlet. Once.',
  },
  {
    id: 'buckler', name: 'Vare Buckler', house: 'vare', model: 'buckler',
    mass: 1.5, coverage: 0.20, phys: { cut: 0.35, blunt: 0.75, pierce: 0.30 }, stamina: 5,
    bash: 1.0, cost: 700, renown: 0,
    lore: 'A fistful of steel. Deflect, then answer inside the beat.',
  },
  {
    id: 'kite', name: 'Ashcombe Kite Shield', house: 'ashcombe', model: 'kite',
    mass: 3.4, coverage: 0.42, phys: { cut: 0.85, blunt: 0.55, pierce: 0.72 }, stamina: 7,
    bash: 0.7, cost: 1200, renown: 200,
    lore: 'Boiled linden, linen, and limewash. The wall that walks.',
  },
  {
    id: 'tower', name: 'Thornwald Pavise', house: 'thornwald', model: 'tower',
    mass: 6.2, coverage: 0.58, phys: { cut: 0.92, blunt: 0.62, pierce: 0.86 }, stamina: 11,
    bash: 0.45, cost: 2100, renown: 500,
    lore: 'A door carried into a fight. Heavy enough to become your second problem.',
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  HARNESS — layered armour, region by region
// ════════════════════════════════════════════════════════════════════════════
// layers: how much of each material covers the body (0..1), plus explicit gaps
// (weak points) that a skilled blade can find.
export const HARNESS = [
  {
    id: 'gambeson', name: 'Padded Gambeson', tier: 0, mass: 5.2,
    layers: { gambeson: 1.0, leather: 0.15, mail: 0, plate: 0 },
    color: [96, 74, 44],
    gaps: { throat: 0.55, head: 0.9, hand: 0.4, shin: 0.3, foreArm: 0.35 },
    cost: 0, renown: 0,
    lore: 'Twenty layers of linen. Stops a cut; stops nothing else.',
  },
  {
    id: 'bouilli', name: 'Boiled Leather Harness', tier: 1, mass: 9.4,
    layers: { gambeson: 0.7, leather: 0.95, mail: 0, plate: 0 },
    color: [78, 52, 30],
    gaps: { throat: 0.45, head: 0.85, hand: 0.2, shin: 0.2, foreArm: 0.15 },
    cost: 800, renown: 0,
    lore: 'Moulded cuir bouilli over wool. Light enough to keep your feet.',
  },
  {
    id: 'hauberk', name: 'Riveted Hauberk', tier: 2, mass: 16.8,
    layers: { gambeson: 1.0, leather: 0.4, mail: 0.92, plate: 0.10 },
    color: [96, 98, 104],
    gaps: { throat: 0.35, head: 0.5, hand: 0.15, forearm: 0.2, shin: 0.25 },
    cost: 1800, renown: 150,
    lore: 'Ten thousand riveted rings. Do not bring a knife to it.',
  },
  {
    id: 'halfplate', name: 'Half-Harness', tier: 3, mass: 22.5,
    layers: { gambeson: 1.0, leather: 0.4, mail: 0.75, plate: 0.62 },
    color: [128, 132, 138],
    gaps: { throat: 0.30, head: 0.12, hand: 0.05, forearm: 0.12, thighInner: 0.5, armpit: 0.6, knee: 0.35, shin: 0.08 },
    cost: 3400, renown: 600,
    lore: 'Plate where it matters, mail where it must bend. The soldier\'s bargain.',
  },
  {
    id: 'whiteharness', name: 'Full White Harness', tier: 4, mass: 31.0,
    layers: { gambeson: 1.0, leather: 0.5, mail: 0.85, plate: 0.92 },
    color: [156, 160, 166],
    gaps: { throat: 0.22, visor: 0.5, armpit: 0.45, elbow: 0.3, knee: 0.22, hand: 0.02, groin: 0.3 },
    cost: 6200, renown: 1400,
    lore: 'A shut house of steel. Only the seams and the shadows are yours.',
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  CHAMPIONS — original characters with their own temperament in the ring
// ════════════════════════════════════════════════════════════════════════════
export const CHAMPIONS = [
  {
    id: 'hale', name: 'Hale Ashcombe', title: 'the Unblooded', house: 'ashcombe', skill: 'novice',
    weapon: 'arming', shield: 'none', harness: 'gambeson',
    body: { height: 1.74, build: 0.98, skin: 0xd8b48c, hair: 0x4a3520, hairStyle: 'crop', beard: 0 },
    cloth: [92, 68, 44], accent: [140, 40, 34],
    ai: { aggression: 0.55, patience: 0.30, parrySkill: 0.15, feintChance: 0.06, footwork: 0.35, spacing: 0.95, combos: 0.2 },
    lines: {
      taunt: ['Come on then. Come on!', 'I have drilled for this.', 'For Ashcombe!'],
      hurt: ['Ah — damn you!', 'That stung.', 'Keep back!'],
      win: ['I did it. I did it!'],
      lose: ['I yield… I yield.'],
    },
    bounty: 120, renown: 0,
  },
  {
    id: 'orvin', name: 'Orvin the Grey', title: 'free-sword', house: 'thornwald', skill: 'trained',
    weapon: 'messer', shield: 'buckler', harness: 'bouilli',
    body: { height: 1.80, build: 1.04, skin: 0xc9a071, hair: 0x6e6e6e, hairStyle: 'mane', beard: 2 },
    cloth: [58, 58, 62], accent: [120, 96, 48],
    ai: { aggression: 0.7, patience: 0.45, parrySkill: 0.42, feintChance: 0.22, footwork: 0.6, spacing: 0.85, combos: 0.5 },
    lines: {
      taunt: ['Coin first. Then the argument.', 'You hold that like a farm tool.', 'Grey kills quick.'],
      hurt: ['Cheap shot.', 'Hnh. Not bad.', 'You will pay for that one.'],
      win: ['Same time tomorrow? Bring coin.'],
      lose: ['Paid enough for today…'],
    },
    bounty: 260, renown: 120,
  },
  {
    id: 'caelwyn', name: 'Sister Caelwyn', title: 'of the Quiet Order', house: 'vare', skill: 'veteran',
    weapon: 'spear', shield: 'none', harness: 'gambeson',
    body: { height: 1.70, build: 0.9, skin: 0xe0c0a0, hair: 0x2a2a2e, hairStyle: 'braid', beard: 0, female: true },
    cloth: [232, 228, 216], accent: [70, 84, 120],
    ai: { aggression: 0.6, patience: 0.75, parrySkill: 0.6, feintChance: 0.3, footwork: 0.85, spacing: 1.35, combos: 0.55 },
    lines: {
      taunt: ['The point is the lesson.', 'Distance is mercy.', 'Breathe, then begin.'],
      hurt: ['Hah. Good.', 'Closer than I allowed.', 'You are learning.'],
      win: ['Again, when you are ready.'],
      lose: ['The lesson is yours today.'],
    },
    bounty: 420, renown: 350,
  },
  {
    id: 'brannoc', name: 'Brannoc Ironvein', title: 'breaker of shields', house: 'emberfall', skill: 'trained',
    weapon: 'mace', shield: 'kite', harness: 'hauberk',
    body: { height: 1.88, build: 1.16, skin: 0xbe9058, hair: 0x8c2f1c, hairStyle: 'shaved', beard: 3 },
    cloth: [56, 40, 30], accent: [150, 60, 30],
    ai: { aggression: 0.88, patience: 0.2, parrySkill: 0.3, feintChance: 0.1, footwork: 0.4, spacing: 0.7, combos: 0.7 },
    lines: {
      taunt: ['Bones first. Armour after.', 'Stand still, you rat.', 'I break shields for sport.'],
      hurt: ['That all?', 'Rrgh — good!', 'You woke me up.'],
      win: ['Another one cracked.'],
      lose: ['Bah… my arm.'],
    },
    bounty: 520, renown: 600,
  },
  {
    id: 'torvald', name: 'Ser Torvald Kyn', title: 'knight of the Vigil', house: 'rookmoor', skill: 'veteran',
    weapon: 'longsword', shield: 'none', harness: 'halfplate',
    body: { height: 1.82, build: 1.08, skin: 0xd2ab84, hair: 0x3a2e22, hairStyle: 'crop', beard: 1 },
    cloth: [40, 44, 56], accent: [190, 176, 140],
    ai: { aggression: 0.68, patience: 0.6, parrySkill: 0.72, feintChance: 0.35, footwork: 0.7, spacing: 1.0, combos: 0.65 },
    lines: {
      taunt: ['Show me your guard.', 'Steel remembers every mistake.', 'I keep the vigil. You keep your distance.'],
      hurt: ['Well struck.', 'Hn. Through the seam.', 'You have a blade, at least.'],
      win: ['The vigil holds.'],
      lose: ['My guard… failed me.'],
    },
    bounty: 700, renown: 900,
  },
  {
    id: 'wend', name: 'Wend the Quick', title: 'thief of the lists', house: 'thornwald', skill: 'master',
    weapon: 'falcon', shield: 'buckler', harness: 'bouilli',
    body: { height: 1.66, build: 0.86, skin: 0xcf9f74, hair: 0x1d1b1a, hairStyle: 'ponytail', beard: 0, female: true },
    cloth: [70, 30, 44], accent: [220, 190, 90],
    ai: { aggression: 0.95, patience: 0.25, parrySkill: 0.8, feintChance: 0.62, footwork: 1.0, spacing: 0.8, combos: 0.9 },
    lines: {
      taunt: ['Too slow. Always too slow.', 'Catch me, clatter-man.', 'I have already won twice.'],
      hurt: ['Lucky!', 'Tsk. Faster next time.', 'Oh, that one counted.'],
      win: ['Count your coin on the way out.'],
      lose: ['Fastest does not always win…'],
    },
    bounty: 880, renown: 1300,
  },
  {
    id: 'dourhand', name: 'Marshal Dourhand', title: 'the Anvil', house: 'rookmoor', skill: 'veteran',
    weapon: 'poleaxe', shield: 'none', harness: 'halfplate',
    body: { height: 1.92, build: 1.2, skin: 0xb98f6a, hair: 0x9a9a96, hairStyle: 'shaved', beard: 4 },
    cloth: [34, 36, 40], accent: [140, 130, 110],
    ai: { aggression: 0.8, patience: 0.5, parrySkill: 0.58, feintChance: 0.22, footwork: 0.45, spacing: 1.5, combos: 0.6 },
    lines: {
      taunt: ['Hold the line. Break the man.', 'I have ended sieges with this.', 'Come to the anvil.'],
      hurt: ['Hn. Iron remembers.', 'You dented it. You die.', 'Good. A real fight.'],
      win: ['The anvil stands.'],
      lose: ['…Polish it. Keep it.'],
    },
    bounty: 1050, renown: 1800,
  },
  {
    id: 'knyght', name: 'The Hollow Knyght', title: 'no house, no name', house: 'rookmoor', skill: 'master',
    weapon: 'greatsword', shield: 'none', harness: 'whiteharness',
    body: { height: 1.86, build: 1.1, skin: 0x8a8a8a, hair: 0x111111, hairStyle: 'helm', beard: 0, hollow: true },
    cloth: [18, 18, 20], accent: [110, 104, 96],
    ai: { aggression: 0.86, patience: 0.62, parrySkill: 0.9, feintChance: 0.5, footwork: 0.8, spacing: 1.25, combos: 0.8 },
    lines: {
      taunt: ['There is no name left in me. Only the edge.', 'Fill the vow.', 'I was the first to swear it.'],
      hurt: ['Hollow things do not bleed. But they remember pain.', 'Again.', 'Nearly. Nearly.'],
      win: ['The vow stands. It always stands.'],
      lose: ['Then the vow is yours now.'],
    },
    bounty: 2000, renown: 2600,
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  ARENAS
// ════════════════════════════════════════════════════════════════════════════
export const ARENAS = [
  {
    id: 'hall', name: 'Ashcombe Great Hall', house: 'ashcombe',
    subtitle: 'Torchlight, banners, and forty generations of flagstones.',
    timeOfDay: 'day', sunAzimuth: 2.05, sunElev: 0.52, sunColor: 0xffe6bd, sunIntensity: 2.6,
    ambient: 0x4a5364, ambientIntensity: 0.5, fog: 0x2c2a26, fogNear: 9, fogFar: 46,
    bounds: { x: 13.5, z: 11.5 }, floorY: 0,
    cost: 0, renown: 0,
  },
  {
    id: 'oubliette', name: 'The Oubliette', house: 'thornwald',
    subtitle: 'A cellar the Company forgot to tell anyone about.',
    timeOfDay: 'night', sunAzimuth: 0, sunElev: 0.2, sunColor: 0x6a7a92, sunIntensity: 0.35,
    ambient: 0x2a3040, ambientIntensity: 0.32, fog: 0x11161c, fogNear: 4, fogFar: 24,
    bounds: { x: 8.5, z: 8.5 }, floorY: 0,
    cost: 0, renown: 300,
  },
  {
    id: 'courtyard', name: 'Sunblade Yard', house: 'vare',
    subtitle: 'Sand, awning shade, and a fence to bleed behind.',
    timeOfDay: 'day', sunAzimuth: 0.6, sunElev: 0.85, sunColor: 0xfff2d4, sunIntensity: 3.4,
    ambient: 0x8898b4, ambientIntensity: 0.7, fog: 0xc9b892, fogNear: 18, fogFar: 78,
    bounds: { x: 16.5, z: 14.5 }, floorY: 0,
    cost: 600, renown: 0,
  },
  {
    id: 'ramparts', name: 'Rookmoor Ramparts', house: 'rookmoor',
    subtitle: 'Wind, dusk, and a long way down.',
    timeOfDay: 'dusk', sunAzimuth: -1.1, sunElev: 0.16, sunColor: 0xff9a58, sunIntensity: 1.7,
    ambient: 0x35405a, ambientIntensity: 0.45, fog: 0x3b3a44, fogNear: 12, fogFar: 62,
    bounds: { x: 12.0, z: 6.5 }, floorY: 0,
    cost: 1500, renown: 700,
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  DRILLS — the single-player ladder
// ════════════════════════════════════════════════════════════════════════════
export const DRILLS = [
  {
    id: 'd1', name: 'First Blood', arena: 'hall', opponents: ['hale'], mode: 'duel',
    rounds: 3, reward: { coin: 90, renown: 60 }, desc: 'Face the Unblooded in the hall. Learn the edge.',
  },
  {
    id: 'd2', name: 'The Grey Ledger', arena: 'hall', opponents: ['orvin'], mode: 'duel',
    rounds: 3, reward: { coin: 150, renown: 110 }, desc: 'Orvin fights for coin. Do not let him collect twice.',
  },
  {
    id: 'd3', name: 'Oubliette Work', arena: 'oubliette', opponents: ['orvin', 'hale'], mode: 'gauntlet',
    rounds: 1, reward: { coin: 240, renown: 180 }, desc: 'Two of them, one torch, and nowhere to walk back to.',
  },
  {
    id: 'd4', name: 'The Anvil', arena: 'courtyard', opponents: ['brannoc'], mode: 'duel',
    rounds: 3, reward: { coin: 320, renown: 260 }, desc: 'Brannoc cracks shields. Bring something blunt, or be beaten with one.',
  },
  {
    id: 'd5', name: 'Quiet Order', arena: 'courtyard', opponents: ['caelwyn'], mode: 'duel',
    rounds: 3, reward: { coin: 420, renown: 340 }, desc: 'A spear keeps distance like a nun keeps silence.',
  },
  {
    id: 'd6', name: 'Knight of the Vigil', arena: 'ramparts', opponents: ['torvald'], mode: 'duel',
    rounds: 3, reward: { coin: 560, renown: 460 }, desc: 'Ser Torvald parries for a living. Break the rhythm.',
  },
  {
    id: 'd7', name: 'Three at the Rampart', arena: 'ramparts', opponents: ['hale', 'orvin', 'brannoc'], mode: 'gauntlet',
    rounds: 1, reward: { coin: 780, renown: 620 }, desc: 'The Watch sends whoever is awake.',
  },
  {
    id: 'd8', name: 'Fastest Hands', arena: 'hall', opponents: ['wend'], mode: 'duel',
    rounds: 3, reward: { coin: 900, renown: 780 }, desc: 'Wend has already won twice in her head. Steal it back.',
  },
  {
    id: 'd9', name: 'The Marshal', arena: 'oubliette', opponents: ['dourhand'], mode: 'duel',
    rounds: 3, reward: { coin: 1200, renown: 1000 }, desc: 'Dourhand has ended sieges. Do not be one.',
  },
  {
    id: 'd10', name: 'The Hollow Vow', arena: 'oubliette', opponents: ['knyght'], mode: 'duel',
    rounds: 3, reward: { coin: 2200, renown: 2000 }, desc: 'Something in white plate that should have stayed buried.',
  },
];

export const MODES = {
  duel: { label: 'Duel', desc: 'Best of three passes. Nothing between you but the sand.' },
  gauntlet: { label: 'Gauntlet', desc: 'Waves of challengers. Survive them all in one breath.' },
  training: { label: 'Training Yard', desc: 'The drillmaster does not die. He corrects.' },
};

export const RANKS = [
  [0, 'Oathless'], [300, 'Sworn Blade'], [900, 'House Sergeant'], [1800, 'Blade of the Vow'],
  [3200, 'Iron Marshal'], [5200, 'Warden of the Lists'], [8000, 'The Vow Itself'],
];

export function rankFor(renown) {
  let r = RANKS[0][1];
  for (const [n, name] of RANKS) if (renown >= n) r = name;
  return r;
}

export const weaponById = (id) => WEAPONS.find((w) => w.id === id);
export const shieldById = (id) => SHIELDS.find((s) => s.id === id);
export const harnessById = (id) => HARNESS.find((h) => h.id === id);
export const champById = (id) => CHAMPIONS.find((c) => c.id === id);
export const arenaById = (id) => ARENAS.find((a) => a.id === id);
