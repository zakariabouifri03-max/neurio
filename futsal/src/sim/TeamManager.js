// TeamManager: builds runtime team objects and their footballers from TEAM_DEFS.
// Owns attribute generation (player ratings) and kit selection.
import { TEAM_DEFS, FORMATIONS, NAME_FIRST, NAME_LAST, SHIRT_NUMBERS } from '../data/teams.js';
import { Footballer } from './Footballer.js';
import { createRng, clamp } from '../core/math.js';

export const ATTR_KEYS = [
  'speed', 'acceleration', 'shooting', 'passing', 'dribbling', 'strength', 'stamina',
  'ballControl', 'defending', 'reaction', 'goalkeeping',
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function generateAttributes(rng, strength, role, bias) {
  const base = 40 + strength * 3.6;
  const attrs = {};
  for (const k of ATTR_KEYS) {
    attrs[k] = base + rng.gauss() * 7;
  }
  if (role === 'GK') {
    attrs.goalkeeping = 58 + strength * 4 + rng.gauss() * 6;
    attrs.speed -= 12;
    attrs.shooting -= 20;
    attrs.dribbling -= 18;
  } else {
    attrs.goalkeeping = 12 + rng.next() * 12;
    if (role === 'DEF') { attrs.defending += 9; attrs.shooting -= 7; }
    if (role === 'FWD') { attrs.shooting += 9; attrs.defending -= 9; }
    if (role === 'MID') { attrs.passing += 7; attrs.stamina += 4; }
  }
  for (const k in bias) {
    if (attrs[k] !== undefined) attrs[k] += bias[k] * 1.4;
  }
  for (const k of ATTR_KEYS) attrs[k] = Math.round(clamp(attrs[k], 25, 97));
  return attrs;
}

export class TeamManager {
  constructor(seed = 1) {
    this.rng = createRng(seed);
  }

  static listDefs() {
    return TEAM_DEFS;
  }

  static findDef(id) {
    return TEAM_DEFS.find((t) => t.id === id) || TEAM_DEFS[0];
  }

  // Creates a team for side `index` (0 = home, 1 = away). `kitSide` picks home/away kit.
  createTeam(def, index, opts = {}) {
    const rng = this.rng;
    const formationKey = opts.formation || def.formation;
    const slots = FORMATIONS[formationKey];
    const kitSide = opts.kitSide || (index === 0 ? 'home' : 'away');
    let kit = def[kitSide];
    // If the two shirts would clash, the away side uses the alternate colours.
    if (opts.clashWith && colorDistance(kit.shirt, opts.clashWith) < 110) {
      kit = { ...kit, shirt: kit.trim, trim: kit.shirt, shorts: kit.socks, socks: kit.shorts };
    }
    const team = {
      index,
      id: def.id,
      name: def.name,
      short: def.short,
      logo: def.logo,
      style: def.style,
      strength: def.strength,
      formation: formationKey,
      kit,
      score: 0,
      attackDir: index === 0 ? 1 : -1,
      players: [],
      human: !!opts.human,
      tactic: { press: 0.5, line: 0, risk: 0.5 },
      rating: 0,
    };

    const gk = new Footballer({
      id: index * 10,
      teamIndex: index,
      number: 1,
      name: this.makeName(rng),
      role: 'GK',
      slot: -1,
      attrs: generateAttributes(rng, def.strength, 'GK', def.bias),
    });
    team.players.push(gk);

    const numbers = this.pickNumbers(rng, slots.length);
    slots.forEach((slot, i) => {
      const p = new Footballer({
        id: index * 10 + i + 1,
        teamIndex: index,
        number: numbers[i],
        name: this.makeName(rng),
        role: slot.role,
        slot: i,
        attrs: generateAttributes(rng, def.strength, slot.role, def.bias),
      });
      team.players.push(p);
    });
    team.formationSlots = slots;
    const all = team.players;
    team.rating = Math.round(all.reduce((s, p) => s + Footballer.overall(p), 0) / all.length);
    return team;
  }

  makeName(rng) {
    return `${rng.pick(NAME_FIRST)} ${rng.pick(NAME_LAST)}`;
  }

  pickNumbers(rng, n) {
    const pool = SHIRT_NUMBERS.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
      const idx = rng.int(0, pool.length - 1);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }
}
