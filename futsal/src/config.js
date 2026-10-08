// Neurio Futsal — central tuning constants.
// All sizes are in metres, time in seconds, speeds in m/s.
// Coordinate system (matches three.js): x = pitch length, y = height (up), z = pitch width.

export const PITCH = {
  halfLength: 20,        // goal lines at x = ±20
  halfWidth: 10,         // touch lines at z = ±10
  boardHeight: 0.6,      // ball rebounds off boards below this height, otherwise it leaves play
  ceiling: 8.5,
  goalHalfWidth: 1.5,    // goal mouth is 3 m wide
  goalHeight: 2.0,
  goalDepth: 0.9,        // how far the net extends behind the line (visual + ball stop)
  boxDepth: 6,           // penalty area: 6 m deep
  boxHalfWidth: 6,
  penaltySpot: 14,       // |x| of the penalty mark (6 m from goal line)
  centerCircle: 3,
  restartGap: 5,         // defenders stay this far from free kicks / corners
};

export const BALL = {
  radius: 0.11,
  gravity: 9.81,
  restitution: 0.58,          // bounce off the floor
  wallRestitution: 0.72,      // bounce off boards
  postRestitution: 0.55,      // bounce off posts / bar
  rollDecel: 1.35,            // constant rolling deceleration (m/s²)
  rollDrag: 0.05,             // speed-proportional rolling drag (1/s)
  airDrag: 0.035,             // speed-proportional air drag (1/s)
  magnus: 0.0011,             // lift coefficient from spin (per m/s per rad/s)
  spinDecay: 0.9,             // 1/s
  maxSpeed: 34,
  maxStepDistance: 0.07,      // sub-step limit so the ball can never tunnel through posts or players
  controlRadius: 0.62,        // distance from player centre at which a loose ball can be trapped
};

export const PLAYER = {
  radius: 0.36,
  height: 1.8,
  kickReach: 0.82,            // player-centre to ball-centre distance that allows a kick
  controlAssistDist: 0.9,
  baseRun: 5.0,               // m/s before attribute bonus
  speedPerPoint: 0.045,       // added per Speed point (1..99)
  sprintMult: 1.28,
  stamDrainSprint: 0.085,     // stamina per second while sprinting (scaled by attribute)
  stamRecoverWalk: 0.045,
  stamRecoverIdle: 0.09,
  tackleTime: 0.55,
  slideTime: 0.85,
  downTime: 1.1,
  dribbleOffset: 0.55,
};

export const MATCH = {
  halfMinuteOptions: [2, 3, 5, 8],
  defaultHalfMinutes: 3,
  restartDelay: 1.3,          // whistle to restart
  goalCelebrate: 3.6,         // seconds before kick-off after a goal
  halftimeBreak: 3.0,
  advantageWindow: 2.2,       // play-on window after a foul
  fullTimeResults: 3.0,
  stoppagePerFoul: 6,
  stoppagePerGoal: 12,
  stoppagePerCard: 10,
  maxStoppage: 90,
  trainingDrillSeconds: 60,
};

export const DIFFICULTY = {
  easy:   { label: 'Easy',   aiSpeed: 0.93, reactionMul: 1.35, errorMul: 1.5,  pressMul: 0.8,  shotBias: 0.7, assist: 0.35, refStrict: 0.7 },
  normal: { label: 'Normal', aiSpeed: 1.0,  reactionMul: 1.0,  errorMul: 1.0,  pressMul: 1.0,  shotBias: 1.0, assist: 0.15, refStrict: 1.0 },
  hard:   { label: 'Hard',   aiSpeed: 1.04, reactionMul: 0.78, errorMul: 0.75, pressMul: 1.2,  shotBias: 1.2, assist: 0.0,  refStrict: 1.15 },
};

// Graphics presets. Shadows / crowd density / lights / env reflections scale with the preset.
export const QUALITY = {
  LOW:    { label: 'LOW',    pixelRatio: 0.75, shadows: false, shadowMap: 512,  crowd: 500,  spots: 2, envReflections: false, playerShadows: false, anisotropy: 1,  fog: false, ballShadowBlob: true  },
  MEDIUM: { label: 'MEDIUM', pixelRatio: 1.0,  shadows: true,  shadowMap: 1024, crowd: 1100, spots: 4, envReflections: true,  playerShadows: false, anisotropy: 4,  fog: false, ballShadowBlob: true  },
  HIGH:   { label: 'HIGH',   pixelRatio: 1.25, shadows: true,  shadowMap: 2048, crowd: 1900, spots: 4, envReflections: true,  playerShadows: true,  anisotropy: 8,  fog: true,  ballShadowBlob: true  },
  ULTRA:  { label: 'ULTRA',  pixelRatio: 1.5,  shadows: true,  shadowMap: 4096, crowd: 2800, spots: 6, envReflections: true,  playerShadows: true,  anisotropy: 16, fog: true,  ballShadowBlob: true  },
};

export const CAMERA_MODES = ['broadcast', 'player', 'close', 'training'];

export const KEYBINDS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  tackle: ['Space'],
  pass: ['KeyJ'],
  shoot: ['KeyK'],
  through: ['KeyL'],
  lob: ['KeyF'],
  switch: ['KeyQ'],
  press: ['KeyE'],
  skill: ['KeyC'],
  gkRush: ['KeyR'],
  pause: ['Escape'],
  camera: ['KeyV'],
  resetBall: ['KeyT'],
  confirm: ['Enter'],
  back: ['Backspace'],
};

// Standard-mapping gamepad button indices.
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

export const ACTION_LABELS = {
  move: 'Move',
  sprint: 'Sprint',
  tackle: 'Tackle / Intercept',
  pass: 'Pass',
  through: 'Through pass',
  shoot: 'Shoot (hold = power)',
  lob: 'Lob modifier (+ Pass / Shoot)',
  switch: 'Switch player',
  press: 'Teammate pressure',
  skill: 'Skill / feint',
  gkRush: 'Goalkeeper rush',
  pause: 'Pause',
  camera: 'Cycle camera',
  resetBall: 'Reset ball (training)',
};
