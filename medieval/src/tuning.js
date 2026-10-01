// ── IRONVOW — one place for every number that decides how a duel feels ───────
// Units: metres, kilograms, seconds, joules. A human is 1.78 m, a longsword
// swings its tip at 14–22 m/s. Everything below is calibrated against that.

export const PLAYER = {
  height: 1.78,
  eye: 1.66,
  radius: 0.34,
  mass: 82,
  walkSpeed: 2.55,      // m/s — armoured men do not jog in a fight
  retreatSpeed: 1.55,
  sprintSpeed: 4.1,
  accel: 14,
  friction: 11,
  turnAssist: 5.5,
  headBob: 0.028,
};

export const STAMINA = {
  max: 100,
  regen: 9.0,         // per second standing still: wind comes back slowly
  regenMoving: 3.0,
  regenDelay: 0.85,   // seconds after any exertion
  blockHold: 1.7,     // per second while holding guard — a guard is work
  exertionMult: 1.0,
  exhaustedBelow: 12,
  exhaustedRegenMult: 0.55,
  sprintDrain: 11,
};

export const COMBAT = {
  // Attack windows (fractions of the attack's total duration)
  windupFrac: 0.34,
  feintWindow: 0.62,     // may feint until this fraction of windup
  morphWindow: 0.30,
  // Guard
  parryWindow: 0.20,
  guardLockTime: 0.34,   // how long a raised guard keeps the line it chose     // seconds after raising a guard: perfect parry
  parryRecoil: 0.42,     // seconds of attacker stagger on parry
  parryStaminaCost: 26,
  blockImpactStamina: 0.19,   // × incoming joules → stamina
  blockChip: 0.10,            // fraction of damage leaking through a block
  guardBreakStun: 1.15,
  guardBreakJoules: 78,   // energy that folds a guard, after the guard's strength divides it
  clashStamina: 9,
  crossMin: 0.26,       // below this the two blades slide instead of stopping
  grazeStamina: 3.5,    // what a turned-aside blow costs the man who turned it
  // Damage
  jouleToDamage: { cut: 0.52, blunt: 0.46, pierce: 0.60 },
  minImpulse: 7,        // below this joule count a hit is only a touch
  staggerJoules: 26,
  heavyJoules: 52,
  hitStopBase: 0.05,    // seconds of freeze per point of damage, capped
  hitStopMax: 0.13,
  knockback: 0.055,     // m/s per joule
  // Armour depletion
  plateDentPerBlunt: 0.00035,   // per joule
  plateDentPerPierce: 0.00022,
  mailRingBurstPerPierce: 0.00055,
  mailRingBurstPerCut: 0.00016,
  gambesonTearPerCut: 0.00042,
  softTearPerPierce: 0.00025,
  // Body
  maxHealth: 120,
  limbDamageBoost: 1.15,     // arms/legs bleed out slower but disable faster
  bleedPerSecond: 0.55,
  woundsPerLevel: { graze: 3, cut: 11, deep: 22, mortal: 38 },
  // Physics
  weaponSwingSubsteps: 3,
  capsuleRadius: { head: 0.135, throat: 0.085, torso: 0.235, arm: 0.075, hand: 0.07, leg: 0.105, foot: 0.085 },
  maxContactSpeed: 46,
  restitution: 0.24,
};

export const AI = {
  reaction: { novice: 0.46, trained: 0.34, veteran: 0.24, master: 0.17 },
  // how well the AI reads a feint (0 = always fooled, 1 = never)
  feintResist: { novice: 0.05, trained: 0.3, veteran: 0.55, master: 0.8 },
  guardError: { novice: 0.34, trained: 0.22, veteran: 0.13, master: 0.07 },
};

/** Elemental damage channel weights per material — how armour eats a blow. */
export const LAYERS = {
  gambeson: { absorbCut: 0.62, absorbBlunt: 0.20, absorbPierce: 0.30, mass: 0.6, durability: 100, dentMat: 'gambesonTearPerCut' },
  leather: { absorbCut: 0.52, absorbBlunt: 0.24, absorbPierce: 0.38, mass: 1.4, durability: 120, dentMat: 'softTearPerPierce' },
  mail: { absorbCut: 0.86, absorbBlunt: 0.18, absorbPierce: 0.34, mass: 8.4, durability: 150, dentMat: 'mailRingBurstPerPierce' },
  plate: { absorbCut: 0.94, absorbBlunt: 0.42, absorbPierce: 0.80, mass: 12.0, durability: 260, dentMat: 'plateDentPerPierce' },
};

export const REGIONS = ['head', 'throat', 'chest', 'abdomen', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot'];
