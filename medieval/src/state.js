// ── IRONVOW — the campaign: what is remembered between bouts ─────────────────
// Money and renown are not decoration: they are the reason a man walks into the
// next hall. Everything the player earns is written to one save, and every
// number the game shows after a fight is computed here, so a replayed drill
// cannot disagree with the file on disk.
import { DRILLS, CHAMPIONS, champById, rankFor, arenaById, RANKS } from './data.js';
import { clamp01, clamp } from './mathx.js';

const KEY = 'ironvow.save.v2';

const DEFAULTS = {
  version: 2,
  coin: 0,
  renown: 0,
  unlocked: ['d1'],
  cleared: {},          // drillId → { wins, losses, bestTime, bestHealth }
  record: { bouts: 0, wins: 0, losses: 0, kills: 0, parries: 0, guardBreaks: 0, blowsLanded: 0, blowsTaken: 0 },
  settings: { sensitivity: 1, invertY: false, volume: 0.8, sound: true, difficulty: 1, showTell: true },
  // what the player carries: chosen in the armoury, kept between bouts
  kit: { weapon: 'arming', harness: 'gambeson', shield: 'none' },
  seed: 20261001,
};

export class Save {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const d = JSON.parse(raw);
      return { ...JSON.parse(JSON.stringify(DEFAULTS)), ...d, settings: { ...DEFAULTS.settings, ...(d.settings || {}) } };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  flush() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* private mode: play on */ }
  }

  reset() { this.data = JSON.parse(JSON.stringify(DEFAULTS)); this.flush(); }

  get rank() { return rankFor(this.data.renown); }
  get nextRank() {
    const out = [];
    for (const [n, name] of RANKS_CACHE) if (n > this.data.renown) out.push([n, name]);
    return out[0] || null;
  }

  unlock(id) {
    if (!this.data.unlocked.includes(id)) { this.data.unlocked.push(id); this.flush(); return true; }
    return false;
  }

  isUnlocked(id) { return this.data.unlocked.includes(id); }

  drillState(id) { return this.data.cleared[id] || null; }

  /** The next drill to suggest: the first one not yet cleared. */
  nextDrill() {
    for (const d of DRILLS) if (!this.data.cleared[d.id]) return d;
    return DRILLS[DRILLS.length - 1];
  }

  /** Book a finished drill: rewards, unlocks, records. Returns a summary. */
  finishDrill(drill, result) {
    const st = this.data.cleared[drill.id] || { wins: 0, losses: 0, bestTime: 0, bestHealth: 0 };
    let reward = { coin: 0, renown: 0, unlocked: null };
    if (result.won) {
      st.wins++;
      // first clear pays the full bounty; repeats pay a third, so grinding works
      // but the ladder is still the best road
      const first = !this.data.cleared[drill.id];
      const mult = first ? 1 : 0.34;
      reward.coin = Math.round(drill.reward.coin * mult);
      reward.renown = Math.round(drill.reward.renown * mult);
      this.data.coin += reward.coin;
      this.data.renown += reward.renown;
      st.bestHealth = Math.max(st.bestHealth || 0, Math.round(result.health * 100));
      const before = this.data.renown - reward.renown;
      if (rankFor(before) !== rankFor(this.data.renown)) reward.rankUp = rankFor(this.data.renown);
      const idx = DRILLS.findIndex((d) => d.id === drill.id);
      const next = DRILLS[idx + 1];
      if (next && !this.data.cleared[next.id]) reward.unlocked = next.id;
      if (reward.unlocked) this.unlock(reward.unlocked);
    } else {
      st.losses++;
      // a loss still teaches: a little renown, no coin
      const c = Math.round(drill.reward.renown * 0.12);
      this.data.renown += c;
      reward.renown = c;
    }
    st.bestTime = Math.max(st.bestTime || 0, result.time);
    this.data.cleared[drill.id] = st;
    this.data.record.bouts++; this.data.record[result.won ? 'wins' : 'losses']++;
    this.data.record.kills += result.kills || 0;
    this.data.record.parries += result.parries || 0;
    this.data.record.guardBreaks += result.guardBreaks || 0;
    this.data.record.blowsLanded += result.blowsLanded || 0;
    this.data.record.blowsTaken += result.blowsTaken || 0;
    this.flush();
    return reward;
  }

  noteBout(partial) {
    for (const k in partial) if (typeof this.data.record[k] === 'number') this.data.record[k] += partial[k];
    this.flush();
  }
}

// the rank table lives in data.js; this is just a local name for it
const RANKS_CACHE = RANKS;

/**
 * One bout, round by round. The rules are the ones the hall would recognise:
 * three passes, the man who cannot stand loses the pass, and a man who is
 * beaten does not fight the next one.
 */
export class Bout {
  /**
   * @param spec { mode, arena, opponents[], rounds, playerKit, drills }
   */
  constructor(spec, save) {
    this.spec = spec;
    this.save = save;
    this.mode = spec.mode || 'duel';
    this.round = 1;
    this.roundsToWin = spec.rounds ?? 2;
    this.won = 0; this.lost = 0;
    this.pending = [...spec.opponents];
    this.current = null;
    this.time = 0;
    this.log = [];
    this.stats = { parries: 0, guardBreaks: 0, blowsLanded: 0, blowsTaken: 0, kills: 0 };
    this.over = false;
  }

  /** Who walks out for this pass — a fresh name each time in a gauntlet. */
  next() {
    if (this.current) return this.current;
    const id = this.pending.length ? this.pending.shift() : (this.spec.opponents[this.spec.opponents.length - 1]);
    this.current = champById(id);
    return this.current;
  }

  note(type) {
    if (type in this.stats) this.stats[type]++;
  }

  /** The pass is over: record it and decide whether the bout is. */
  finishRound(playerWon, info = {}) {
    if (this.over) return { roundOver: true, boutOver: true, playerWon: false };
    this.time += info.time || 0;
    if (playerWon) this.won++; else this.lost++;
    const champ = this.current;
    this.log.push({ round: this.round, playerWon, champ: champ?.name || '?', time: info.time || 0, health: info.health ?? 1 });
    this.round++;
    // a gauntlet only ends when everyone has been faced; the ladder ends at two
    const roundsOver = this.mode === 'gauntlet' ? this.pending.length === 0 : (this.won >= this.roundsToWin || this.lost >= this.roundsToWin);
    this.over = roundsOver;
    return { roundOver: true, boutOver: this.over, playerWon };
  }

  summary(playerWon) {
    return {
      won: playerWon,
      time: this.time,
      health: this.lastHealth ?? 1,
      kills: this.stats.kills,
      parries: this.stats.parries,
      guardBreaks: this.stats.guardBreaks,
      blowsLanded: this.stats.blowsLanded,
      blowsTaken: this.stats.blowsTaken,
      rounds: this.log.slice(),
      renown: this.save?.data.renown ?? 0,
    };
  }
}

/** How hard the man opposite fights, from a champion's own temperament. */
export function brainFor(champ, difficulty = 1) {
  const a = champ.ai || {};
  const skill = clamp01(a.parrySkill ?? 0.3);
  const parry = clamp01((a.parrySkill ?? 0.3) * (a.spacing ?? 1));
  return {
    aggression: clamp01((a.aggression ?? 0.5) * (0.55 + difficulty * 0.45)),
    patience: clamp01(a.patience ?? 0.4),
    footwork: clamp01((a.footwork ?? 0.5) * (0.6 + difficulty * 0.4)),
    // a better fencer reads the wind-up sooner and holds the line under a feint
    reaction: clamp(0.30 - skill * 0.16 - (difficulty - 1) * 0.04, 0.1, 0.34),
    feintResist: clamp01(0.3 + parry * 0.6 + (1 - difficulty) * 0.15),
    // how much of his own blood he is willing to spend before asking for quarter
    yieldAt: clamp(0.34 - skill * 0.26, 0.06, 0.36),
    guardError: clamp01(0.16 - parry * 0.1 - (difficulty - 1) * 0.03),
    combo: 1 + Math.round(clamp01(a.combos ?? 0.3) * 3),
    bash: champ.shield && champ.shield !== 'none' ? 0.65 : 0.2,
    step: 1,
  };
}

export const DRILL_LOOKUP = Object.fromEntries(DRILLS.map((d) => [d.id, d]));
export { DRILLS, CHAMPIONS, arenaById, rankFor };
