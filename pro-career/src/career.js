// ── Career mode: the whole player-career state machine ───────────────────────
// Season structure (34 steps):
//   week 1..30  → league matchday every week (+ domestic cup & continental cup
//                 on the midweek weeks), training, news, injuries
//   offseason   → awards gala → transfer window / contracts / camps →
//                 national-team tournament (Continental Cup or World Cup)

import { Rng, clamp, ri, round, fmtMoney } from './rng.js';
import {
  buildWorld, overall, fitScore, bestEleven, makeLeagueRounds, newTable, sortTable,
  makePlayer, SQUAD_SHAPE, growPlayer,
} from './worldgen.js';
import { FORMATIONS } from './data.js';
import { quickResult, applyResult, pushForm, teamStrengthFrom, playTie } from './engine.js';
import { planMatch, resolveMatch, MOMENT_TYPES } from './match.js';
import { LEAGUES, NATIONS, TUNE, CONTINENTAL, CUP_NAME, KIT_PALETTE } from './data.js';

const CUP_WEEKS = [3, 8, 13, 18];
const CONT_WEEKS = [5, 10, 15, 20, 25];
export const SAVE_PREFIX = 'proc27_career_';
export const FORM_KEYS = Object.keys(FORMATIONS);

export function hashSeed(...parts) {
  let h = 0x811c9dc5 >>> 0;
  for (const p of parts) {
    const str = String(p);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

// ── world decoration: managers, formations, national "clubs" ─────────────────
function decorateWorld(world) {
  world.clubs.forEach((c) => {
    c.formation = FORM_KEYS[hashSeed(world.seed, c.id, 'form') % FORM_KEYS.length];
    c.style = c.manager.style;
  });
  // national teams as pseudo-clubs, so the match engine can use them directly
  world.nations.forEach((n) => {
    world.clubById['n_' + n.code] = {
      id: 'n_' + n.code, name: n.name, short: n.code, city: n.name, isNation: true,
      leagueId: 'NAT', colors: ['#0f766e', '#ffffff'], playerIds: n.squadIds.slice(),
      formation: FORM_KEYS[hashSeed(world.seed, n.code, 'form') % FORM_KEYS.length],
      strength: n.rating, prestige: 5, form: [], manager: { name: n.manager, style: 'National' },
    };
  });
}

// ── career ───────────────────────────────────────────────────────────────────
export class Career {
  constructor(state) {
    this.s = state;
    this.world = buildWorld(state.seed);
    decorateWorld(this.world);
    this._applyEvolution();
    this._installPlayer();
    this.schedule = this._buildSchedule(this.s.seasonNum);
    this._scorers = {};
    (this.s.topScorers || []).forEach((r) => { this._scorers[r.id] = { id: r.id, goals: r.goals, assists: r.assists, name: r.name, clubId: r.clubId }; });
    this.pending = null;
  }

  // ── creation ───────────────────────────────────────────────────────────────
  static new(opts) {
    const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
    const world0 = buildWorld(seed);
    decorateWorld(world0);
    const rng = new Rng(hashSeed(seed, 'player'));
    const base = clamp(opts.level ?? 62, 48, 74);
    const pos = opts.pos || 'ST';
    const league = LEAGUES.find((l) => l.country === opts.country) || LEAGUES.find((l) => l.id === opts.leagueId) || LEAGUES[8];
    const allClubs = world0.clubs.filter((c) => c.leagueId === league.id);
    // a youth player signs where he is NOT the finished article: a club a few
    // points above his level, so he starts on the bench and has to earn it
    // a mid-table club a few points above your level: you have to earn minutes
    const ranked = allClubs.slice().sort((a, b) => b.strength - a.strength);
    const notGiants = ranked.slice(2); // never start at the two biggest clubs
    const above = notGiants.filter((c) => c.strength >= base + 2 && c.strength <= base + 12);
    const pick3 = (above.length ? above : notGiants).slice().sort((a, b) => Math.abs(a.strength - (base + 5)) - Math.abs(b.strength - (base + 5))).slice(0, 4);
    const club = rng.pick(pick3);
    const attrs = {};
    for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) attrs[k] = clamp(Math.round(base + rng.gauss() * 5 - (k === 'def' ? 8 : 0)), 30, 78);
    const p = {
      id: 'me', first: opts.first || 'Youssef', last: opts.last || 'Amrani',
      full: `${opts.first || 'Youssef'} ${opts.last || 'Amrani'}`,
      name: `${opts.first || 'Youssef'} ${(opts.last || 'A')[0]}.`,
      age: 17, pos, pos2: opts.pos2 || null, nation: opts.nation || 'MAR',
      attrs: pos === 'GK' ? null : attrs, gk: pos === 'GK' ? clamp(base + 2, 40, 75) : 40,
      pot: clamp(base + (opts.potential ?? 22), 60, 95), growthBias: 1.25,
      clubId: club.id, value: 400000, wage: 900, contract: 3, form: 0, morale: opts.morale ?? 78, fitness: 100,
      injuryWeeks: 0, seasonGoals: 0, seasonAssists: 0, seasonApps: 0, careerGoals: 0, careerApps: 0, careerAssists: 0,
      notable: false, history: [],
    };
    const state = {
      v: 1, seed, seasonNum: 1, year: 2026, phase: 'season', week: 1,
      player: p, clubId: club.id, leagueId: club.leagueId,
      contract: { wage: 900, seasons: 3, goalBonus: 200, appBonus: 100 },
      trust: 22, money: 8000, sponsorsWeekly: 0, sponsors: [],
      seasonStats: newStats(), careerStats: newStats(), capStats: { apps: 0, goals: 0, assists: 0, tournaments: [] },
      history: [], trophies: [], awards: [], news: [], offers: [], interest: [], objectives: [],
      training: { focus: pos === 'GK' ? ['gk', 'phy'] : ['sho', 'dri'], intensity: 2, camps: 0, xp: {} },
      lifestyle: { chef: 0, gym: 0, physio: 0, pr: 0, car: 0, house: 0 }, skills: { weakFoot: 2, skillMoves: 3 },
      form: [], settings: { difficulty: opts.difficulty || 'normal', lang: opts.lang || 'ar', autoSim: false },
      scorersPersist: [], natSquad: false, seedClub: club.id,
      topScorers: [], forms: {}, cup: null, cont: null, table: null, weekPlan: null,
      momentHistory: {}, retired: false, notes: [],
    };
    const c = new Career(state);
    c.news(`🎉 ${p.full} وقّع أول عقد احترافي مع ${club.name}!`);
    c.news(`👋 المدرب ${club.manager.name} (${club.manager.style}) هو اللي غادي يشكّل مسيرتك.`);
    c.schedule = c._buildSchedule(1);
    c._resetSeasonCups();
    c.generateObjectives();
    c.generateOffers(true);
    return c;
  }

  static load(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      const state = JSON.parse(raw);
      const c = new Career(state);
      c.news(['welcome-back']);
      return c;
    } catch (e) { return null; }
  }

  static listSaves() {
    const out = [];
    for (let i = 0; i < 3; i++) {
      try {
        const raw = localStorage.getItem(SAVE_PREFIX + i);
        if (!raw) continue;
        const s = JSON.parse(raw);
        out.push({ slot: i, name: s.player.full, club: s.clubId, season: s.seasonNum, year: s.year, age: s.player.age, saved: s.savedAt || 0 });
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  save(slot = 0) {
    const snap = {
      table: this.s.table, cup: this.s.cup, cont: this.s.cont, topScorers: this.topScorersList(20),
      scorersPersist: this.s.topScorers, forms: this.s.forms, weekPlan: this.s.weekPlan,
    };
    Object.assign(this.s, snap, { savedAt: Date.now() });
    try { localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(this.s)); return true; } catch (e) { return false; }
  }

  // ── world evolution across seasons (ages, growth, AI transfers) ────────────
  _applyEvolution() {
    const seasons = this.s.seasonNum - 1;
    if (seasons <= 0) return;
    const rng = new Rng(hashSeed(this.s.seed, 'evolve', seasons));
    for (let k = 0; k < seasons; k++) {
      const year = this.s.year - seasons + k;
      const r = new Rng(hashSeed(this.s.seed, 'evo', k));
      for (const p of this.world.players) {
        if (p.id === 'me') continue;
        p.age += 1;
        const head = Math.max(0, p.pot - overall(p));
        const elite = overall(p) > 80;
        let g = 0;
        if (p.age <= 21) g = clamp(head * r.range(0.10, 0.22), 0, 3.2);
        else if (p.age <= 24) g = clamp(head * r.range(0.06, 0.16), 0, 2.2);
        else if (p.age <= 28) g = head > 2 ? r.range(0, 0.7) : r.range(-0.6, 0.3);
        else if (p.age <= 31) g = -r.range(0.4, 1.5);
        else g = -r.range(1.2, 3.0);
        if (elite) g -= 0.35;
        growPlayer(p, g);
        p.contract -= 1;
        if (p.contract <= 0) p.contract = ri(r, 1, 4);
      }
      // light AI transfer activity: a few players per league change clubs
      for (const L of this.world.leagues) {
        const clubs = this.world.clubs.filter((c) => c.leagueId === L.id);
        const moves = ri(r, 2, 5);
        for (let m = 0; m < moves; m++) {
          const from = r.pick(clubs), to = r.pick(clubs);
          if (from === to || !from.playerIds.length) continue;
          const pid = r.pick(from.playerIds);
          const pl = this.world.byId[pid];
          if (!pl || pl.pos === 'GK' && r.chance(0.7)) continue;
          from.playerIds = from.playerIds.filter((x) => x !== pid);
          to.playerIds.push(pid); pl.clubId = to.id;
        }
        for (const c of clubs) {
          const xi = bestEleven(c.playerIds.map((id) => this.world.byId[id]).filter(Boolean));
          c.strength = Math.round(xi.reduce((s, p) => s + overall(p), 0) / Math.max(1, xi.length));
        }
      }
      // national squads refresh
      for (const n of this.world.nations) {
        const pool = this.world.players.filter((p) => p.nation === n.code).sort((a, b) => overall(b) - overall(a));
        n.squadIds = pool.slice(0, 26).map((p) => p.id);
        const top = pool.slice(0, 11);
        n.rating = top.length ? Math.round(top.reduce((s, p) => s + overall(p), 0) / top.length) : n.power;
        const nc = this.world.clubById['n_' + n.code];
        if (nc) { nc.playerIds = n.squadIds.slice(); nc.strength = n.rating; }
      }
      // retired elder players get replaced by youth (keeps squads full)
      for (const c of this.world.clubs) {
        const roster = c.playerIds.map((id) => this.world.byId[id]).filter(Boolean);
        const old = roster.filter((p) => p.age > 34);
        for (const op of old) {
          if (!r.chance(0.5)) continue;
          c.playerIds = c.playerIds.filter((id) => id !== op.id);
          const rookie = makePlayer(r, { pos: r.pick(SQUAD_SHAPE), target: clamp(overall(op) - r.range(4, 12), 40, 80), league: LEAGUES.find((l) => l.id === c.leagueId) || LEAGUES[0], clubId: c.id, age: ri(r, 17, 19) });
          this.world.players.push(rookie); this.world.byId[rookie.id] = rookie; c.playerIds.push(rookie.id);
        }
      }
    }
  }

  _installPlayer() {
    const p = this.s.player;
    const club = this.world.clubById[this.s.clubId] || this.world.clubs[0];
    if (!club.playerIds.includes('me')) club.playerIds.push('me');
    // remove from other clubs
    for (const c of this.world.clubs) if (c.id !== club.id) c.playerIds = c.playerIds.filter((id) => id !== 'me');
    this.world.byId['me'] = p;
    p.clubId = club.id;
    // restore per-club form from the save (keeps mid-season sims consistent)
    if (this.s.forms) for (const [cid, f] of Object.entries(this.s.forms)) {
      const c = this.world.clubById[cid];
      if (c) c.form = String(f).split('').slice(-5);
    }
    {const xi = bestEleven(club.playerIds.map((id) => this.world.byId[id]).filter(Boolean));
     club.strength = Math.round(xi.reduce((a, b) => a + overall(b), 0) / Math.max(1, xi.length));}
    this.s.clubId = club.id;
    this.s.leagueId = club.leagueId;
    this.myClub = club;
    this.myLeague = this.world.leagues.find((l) => l.id === club.leagueId) || this.world.leagues[0];
    // national team squad: is the user in it?
    const nat = this.world.nations.find((n) => n.code === p.nation);
    this.nation = nat;
    if (nat && nat.squadIds && !nat.squadIds.includes('me')) {
      const nc = this.world.clubById['n_' + nat.code];
      const meOvr = overall(p);
      const weakest = (nat.squadIds || []).map((id) => this.world.byId[id]).filter(Boolean).sort((a, b) => overall(a) - overall(b))[0];
      if (!weakest || meOvr > overall(weakest) + 1) {
        nat.squadIds = nat.squadIds || [];
        if (weakest) nat.squadIds = nat.squadIds.filter((id) => id !== weakest.id);
        nat.squadIds.push('me');
        if (nc) nc.playerIds = nat.squadIds.slice();
        this.s.natSquad = true;
      }
    }
  }

  // ── season schedule ────────────────────────────────────────────────────────
  _buildSchedule(seasonNum) {
    const rng = new Rng(hashSeed(this.s.seed, 'sched', seasonNum));
    const clubIds = this.myLeague.clubIds.slice();
    const rounds = makeLeagueRounds(rng.shuffle(clubIds));
    // cup fields
    const domClubs = rng.shuffle(clubIds);
    const conf = nationConf(this.s.player.nation) || 'UEFA';
    const cont = CONTINENTAL.find((c) => c.conf === conf) || CONTINENTAL[0];
    const confLeagues = this.world.leagues.filter((l) => {
      const L = LEAGUES.find((x) => x.id === l.id);
      return L && (L.region.startsWith('eu') ? 'UEFA' : L.region === 'afr' ? 'CAF' : L.region === 'latam' ? 'CONMEBOL' : L.region === 'northam' ? 'CONCACAF' : 'AFC') === cont.conf;
    }).map((l) => l.id);
    const pool = this.world.clubs.filter((c) => confLeagues.includes(c.leagueId))
      .sort((a, b) => (b.strength + hashSeed(this.s.seed, 'cont', b.id, seasonNum) % 9) - (a.strength + hashSeed(this.s.seed, 'cont', a.id, seasonNum) % 9));
    const field = pool.slice(0, 32).map((c) => c.id);
    const qual = pool.findIndex((c) => c.id === this.myClub.id) < 32;
    return {
      seasonNum, leagueId: this.myLeague.id, rounds,
      cup: { name: CUP_NAME(this.myLeague), field: domClubs, weeks: CUP_WEEKS, bracket: {}, round: -1, alive: true, results: {} },
      cont: qual && cont.field >= 20 ? { name: cont.name, field, weeks: CONT_WEEKS, bracket: {}, round: -1, alive: true, results: {} } : null,
    };
  }

  _resetSeasonCups() {
    const sch = this.schedule;
    if (this.s.table == null || this.s.tableSeason !== this.s.seasonNum) {
      this.s.table = newTable(this.myLeague.clubIds);
      this.s.tableSeason = this.s.seasonNum;
      this.s.forms = {};
      this.s.weekPlan = null;
      this.s.cup = { round: -1, alive: true, results: {}, bracket: {}, field: sch.cup.field.slice() };
      this.s.cont = sch.cont ? { round: -1, alive: true, results: {}, bracket: {}, field: sch.cont.field.slice() } : null;
      this._scorers = {};
    }
    // cup fields are deterministic per season; restore small caches
    if (this.s.cup) sch.cup.field = this.s.cup.field || sch.cup.field;
  }

  generateObjectives() {
    const club = this.myClub;
    const pos = club.strength > 78 ? 'title' : club.strength > 68 ? 'top4' : club.strength > 60 ? 'top8' : 'survive';
    const target = { title: 1, top4: 4, top8: 8, survive: 14 }[pos];
    this.s.objectives = [
      { id: 'league', text: `الدوري: نهيو فـ المركز ${target} ولا أحسن`, textEn: `League: finish ${target}${target === 1 ? 'st' : 'th'} or better`, target, done: false, reward: 60000 },
      { id: 'goals', text: this.s.player.pos === 'GK' ? 'حافظ على 8 شباك نظيفة' : 'سجل 10 أهداف', textEn: this.s.player.pos === 'GK' ? 'Keep 8 clean sheets' : 'Score 10 goals', target: this.s.player.pos === 'GK' ? 8 : 10, done: false, reward: 35000 },
      { id: 'trust', text: 'ربح ثقة المدرب (70+)', textEn: 'Win the manager’s trust (70+)', target: 70, done: false, reward: 25000 },
    ];
  }

  // ── weekly flow ────────────────────────────────────────────────────────────
  weekFixture() {
    if (this.s.phase !== 'season' || this.s.week > 30) return null;
    const w = this.s.week;
    const out = [];
    const round = this.schedule.rounds[w - 1] || [];
    const league = round.find(([h, a]) => h === this.myClub.id || a === this.myClub.id);
    if (league) out.push({ comp: 'league', home: league[0] === this.myClub.id, opponentId: league[0] === this.myClub.id ? league[1] : league[0], label: this.myLeague.name, round: w });
    if (CUP_WEEKS.includes(w) && this.s.cup && this.s.cup.alive) {
      const opp = this._cupOpponent('cup', w);
      if (opp) out.push({ comp: 'cup', home: opp.home, opponentId: opp.opponentId, label: `${this.schedule.cup.name} · ${['دور 16', 'ربع النهاية', 'نصف النهاية', 'النهائي'][this.s.cup.round] || ''}`, round: this.s.cup.round, neutral: this.s.cup.round === 3 });
    }
    if (CONT_WEEKS.includes(w) && this.s.cont && this.s.cont.alive) {
      const opp = this._cupOpponent('cont', w);
      if (opp) out.push({ comp: 'cont', home: opp.home, opponentId: opp.opponentId, label: `${this.schedule.cont.name} · ${['دور الـ32', 'دور الـ16', 'ربع النهاية', 'نصف النهاية', 'النهائي'][this.s.cont.round] || ''}`, round: this.s.cont.round, neutral: this.s.cont.round === 4 });
    }
    return out.length ? out : null;
  }

  _cupOpponent(which, week) {
    const st = this.s[which], sch = which === 'cup' ? this.schedule.cup : this.schedule.cont;
    if (!st || !sch) return null;
    const idx = sch.weeks.indexOf(week);
    if (idx < 0) return null;
    if (st.round !== idx - 1) {
      // opponent not drawn yet → draw it now (the player's club is still in it)
      const field = (st.bracket[idx - 1] || sch.field).filter(Boolean);
      if (!field.includes(this.myClub.id)) return null;
      st.round = idx;
    }
    const field = (idx === 0 ? sch.field : st.bracket[idx - 1] || []).filter(Boolean);
    if (!field.includes(this.myClub.id)) { st.alive = false; return null; }
    const rng = new Rng(hashSeed(this.s.seed, which, this.s.seasonNum, idx));
    const others = field.filter((id) => id !== this.myClub.id);
    const opp = rng.pick(others);
    st._pending = { opponentId: opp, home: rng.chance(0.5), week };
    return st._pending;
  }

  startMatch(fixture) {
    const p = this.s.player;
    const fx = fixture || (this.weekFixture() || [])[0];
    if (!fx) return null;
    const plan = planMatch(this.world, {
      player: p, clubId: this.myClub.id, opponentId: fx.opponentId,
      home: fx.home, neutral: !!fx.neutral, competition: fx.label,
      formation: this.myClub.formation, trust: this.s.trust,
      seed: hashSeed(this.s.seed, 'match', this.s.seasonNum, this.s.week, fx.comp),
      forceStart: this.s.forceStart,
    });
    plan.fixture = fx;
    this.pending = plan;
    return plan;
  }

  finishMatch(decisions = {}) {
    const plan = this.pending;
    if (!plan) return null;
    const res = resolveMatch(this.world, plan, decisions, hashSeed(this.s.seed, 'res', this.s.seasonNum, this.s.week, plan.competition));
    this.pending = null;
    return this._recordMyMatch(plan, res);
  }

  submitMatch(res) {
    const plan = this.pending;
    if (!plan) return null;
    this.pending = null;
    return this._recordMyMatch(plan, res);
  }

  instantMatch() {
    const plan = this.startMatch();
    if (!plan) return null;
    return this.finishMatch({});
  }

  _recordMyMatch(plan, res) {
    const p = this.s.player, club = this.myClub;
    const st = this.s.seasonStats;
    const played = !!res.stats && res.stats.minutes > 0;
    if (played) {
      st.apps++; p.seasonApps++;
      st.minutes += res.stats.minutes;
      st.goals += res.stats.goals; st.assists += res.stats.assists;
      st.ratings.push(res.stats.rating);
      st.yellow += res.stats.yellow; st.red += res.stats.red;
      if (res.motm === 'me') st.motm++;
      st.saves += res.stats.saves;
      if (res.stats.rating >= 7.5) st.good++;
      if (res.stats.rating < 6) st.bad++;
      st.cleanSheets += (['GK', 'DF'].includes(plan.group) && res.ga === 0) ? 1 : 0;
      p.seasonGoals += res.stats.goals; p.seasonAssists += res.stats.assists;
      p.careerGoals += res.stats.goals; p.careerAssists += res.stats.assists;
      // wage & bonus
      const bonus = res.stats.goals * this.s.contract.goalBonus + this.s.contract.appBonus;
      this.s.money += this.s.contract.wage + bonus;
      // form: rolling last 5 ratings
      this.s.form.push(res.stats.rating);
      if (this.s.form.length > 5) this.s.form.shift();
      p.form = this.s.form.reduce((a, b) => a + b, 0) / this.s.form.length - 6.5;
      // fitness & morale
      p.fitness = clamp(p.fitness - ri(new Rng(hashSeed(this.s.seed, 'fit', this.s.week)), 12, 22), 30, 100);
      this.s.trust = clamp(this.s.trust + (res.stats.rating - 6.9) * 2.2 + (res.stats.goals ? 1.2 : 0) + (res.stats.assists ? 0.7 : 0) + (res.starting ? 0.45 : -0.8), 5, 100);
      p.morale = clamp(p.morale + (res.gh > res.ga ? 4 : res.gh === res.ga ? 0 : -3) + (res.stats.rating > 7 ? 4 : res.stats.rating < 5.5 ? -3 : 0), 20, 100);
      if (plan.injuries) { p.injuryWeeks = plan.injuries; this.news(`🚑 ${p.full} غادي يغيب ${plan.injuries} أسبوع (${['كدمة', 'عضلة الفخذ', 'التواء الكاحل', 'الركبة', 'الفخذ'][ri(new Rng(hashSeed(p.full, this.s.week)), 0, 4)]}).`); }
    } else {
      this.s.trust = clamp(this.s.trust - 0.7, 5, 100);
      p.morale = clamp(p.morale - 2, 20, 100);
    }

    // league table + scorers
    if (plan.fixture.comp === 'league') {
      const isHome = plan.home;
      const gh = isHome ? res.gh : res.ga, ga = isHome ? res.ga : res.gh;
      applyResult(this.s.table, plan.myClubId, plan.oppClubId, gh, ga);
      this._addScorers(plan, res);
      pushForm(this.world, plan.myClubId, gh > ga ? 'W' : gh === ga ? 'D' : 'L');
      this.s.forms[plan.myClubId] = this.world.clubById[plan.myClubId].form.join('');
      this._saveForms();
    } else {
      // knockout: advance or go out
      const key = plan.fixture.comp;
      const st = key === 'cup' ? this.s.cup : this.s.cont;
      const sch = key === 'cup' ? this.schedule.cup : this.schedule.cont;
      const won = res.gh > res.ga;
      const drawn = res.gh === res.ga;
      let advanced = won;
      let pens = null;
      if (drawn) {
        const rng = new Rng(hashSeed(this.s.seed, 'pens', this.s.seasonNum, key, this.s.week));
        const a = ri(rng, 3, 5), b = ri(rng, 3, 5);
        pens = a === b ? [a + 1, b] : [a, b];
        advanced = pens[0] > pens[1];
      }
      st.results[this.s.week] = { opponent: plan.oppClubId, gh: res.gh, ga: res.ga, pens, advanced };
      if (advanced) {
        this.news(`✅ ${this.myClub.name} تأهّل فـ${sch.name}!`);
        this._advanceCup(key);
      } else {
        st.alive = false;
        this.news(`❌ ${this.myClub.name} خرج من ${sch.name}.`);
      }
      if (key === 'cont' && advanced) this.s.trust = clamp(this.s.trust + 1.5, 5, 100);
    }

    // post-match news
    if (res.stats && res.stats.minutes) {
      const r = res.stats.rating;
      const nm = this.world.byId[res.motm];
      if (res.motm === 'me') this.news(`🏅 رجل المباراة! ${p.full} — تقييم ${r} (${res.gh}-${res.ga})`);
      else this.news(`⭐ تقييمك ${r} فـ ${res.gh}-${res.ga}${nm ? ` — رجل المباراة: ${nm.full}` : ''}`);
    } else {
      this.news(`😔 ${p.full} ما لعبش (${res.gh}-${res.ga}) — المدرب ما اعطاكش دقائق.`);
    }
    return { res, plan };
  }

  _addScorers(plan, res) {
    const mine = plan.myClubId;
    if (res.stats) {
      this._bumpScorer('me', res.stats.goals * (plan.home ? 1 : 1), res.stats.assists);
    }
    this._saveForms();
  }

  _bumpScorer(id, goals, assists) {
    if (!this._scorers[id]) {
      const pl = this.world.byId[id];
      this._scorers[id] = { id, goals: 0, assists: 0, name: pl ? pl.full : id, clubId: pl ? pl.clubId : null };
    }
    this._scorers[id].goals += goals || 0;
    this._scorers[id].assists += assists || 0;
    this.s.topScorers = this.topScorersList(20);
  }

  topScorersList(n = 20) {
    return Object.values(this._scorers).sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, n);
  }

  _saveForms() {
    for (const c of this.world.clubs.filter((c) => c.leagueId === this.myLeague.id)) {
      if (!this.s.forms[c.id]) this.s.forms[c.id] = c.form.join('');
    }
  }

  // simulate everything else that happens in the world this week
  simWorldWeek() {
    const w = this.s.week;
    const rng = new Rng(hashSeed(this.s.seed, 'week', this.s.seasonNum, w));
    // the player's own league, all other matches
    const round = this.schedule.rounds[w - 1] || [];
    for (const [h, a] of round) {
      if (h === this.myClub.id || a === this.myClub.id) continue;
      const r = quickResult(this.world, h, a, rng);
      applyResult(this.s.table, h, a, r.gh, r.ga);
      pushForm(this.world, h, r.gh > r.ga ? 'W' : r.gh === r.ga ? 'D' : 'L');
      pushForm(this.world, a, r.ga > r.gh ? 'W' : r.gh === r.ga ? 'D' : 'L');
      for (const sc of r.scorersH) this._bumpScorer(sc.scorer, 1, sc.assist ? 1 : 0);
      for (const sc of r.scorersA) this._bumpScorer(sc.scorer, 1, sc.assist ? 1 : 0);
    }
    // other leagues: results only (cheap, keeps the world alive)
    for (const L of this.world.leagues) {
      if (L.id === this.myLeague.id) continue;
      const clubs = this.world.clubs.filter((c) => c.leagueId === L.id);
      const shuffled = rng.shuffle(clubs);
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        const r = quickResult(this.world, shuffled[i].id, shuffled[i + 1].id, rng);
        pushForm(this.world, shuffled[i].id, r.gh > r.ga ? 'W' : r.gh === r.ga ? 'D' : 'L');
        pushForm(this.world, shuffled[i + 1].id, r.ga > r.gh ? 'W' : r.gh === r.ga ? 'D' : 'L');
      }
    }
    this._simCupsWeek();
    this._saveForms();
  }

  _simCupsWeek() {
    const w = this.s.week;
    for (const key of ['cup', 'cont']) {
      const st = this.s[key], sch = key === 'cup' ? this.schedule.cup : this.schedule.cont;
      if (!st || !st.alive || !sch) continue;
      const idx = sch.weeks.indexOf(w);
      if (idx < 0) continue;
      const field = (idx === 0 ? sch.field : st.bracket[idx - 1] || []).filter(Boolean);
      const rng = new Rng(hashSeed(this.s.seed, 'simcup', key, this.s.seasonNum, idx));
      const pendingOpp = st._pending?.week === w ? st._pending.opponentId : null;
      const list = field.filter((id) => id !== this.myClub.id && id !== pendingOpp);
      const pairs = rng.shuffle(list);
      const winners = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const t = playTie(this.world, pairs[i], pairs[i + 1], rng);
        winners.push(t.winner);
      }
      if (pendingOpp) winners.push(st.results[w]?.advanced ? this.myClub.id : pendingOpp);
      else if (field.includes(this.myClub.id)) winners.push(this.myClub.id);
      st.bracket[idx] = winners;
      st.round = idx;
    }
  }

  _advanceCup(key) {
    const st = this.s[key];
    if (!st) return;
    const idx = st.round;
    const winners = (st.bracket[idx] || []).slice();
    if (!winners.includes(this.myClub.id)) winners.push(this.myClub.id);
    st.bracket[idx] = winners;
  }

  // ── week advance ───────────────────────────────────────────────────────────
  advanceWeek() {
    if (this.s.phase !== 'season') return null;
    const p = this.s.player;
    const weekNews = [];
    // training, recovery, injuries
    this.trainWeek(weekNews);
    if (p.injuryWeeks > 0) { p.injuryWeeks--; if (p.injuryWeeks === 0) weekNews.push({ t: `💪 ${p.full} رجع للتدريب كامل.`, k: 'good' }); }
    const upkeep = Object.entries(this.s.lifestyle).reduce((a, [k, v]) => a + UPKEEP[k] * v, 0);
    const tax = Math.round(this.s.contract.wage * 0.42);
    this.s.money += this.s.contract.wage - tax - upkeep + this.s.sponsorsWeekly;

    this.s.week++;
    if (this.s.week > 30) { this.s.phase = 'postseason'; this.s.postStep = 'awards'; this.endSeason(); }
    else {
      this.s.weekPlan = null;
      weekNews.push(...this.weeklyEvents());
    }
    this.save(0);
    return weekNews;
  }

  trainWeek(out) {
    const p = this.s.player;
    const t = this.s.training;
    const head = Math.max(0, p.pot - overall(p));
    const rng = new Rng(hashSeed(this.s.seed, 'train', this.s.seasonNum, this.s.week));
    const ageFactor = p.age <= 20 ? 1.35 : p.age <= 24 ? 1.15 : p.age <= 28 ? 0.85 : p.age <= 31 ? 0.55 : 0.3;
    const gym = 1 + this.s.lifestyle.gym * 0.08 + (t.camps ? 0.05 : 0) + t.intensity * 0.06;
    t.focus.forEach((k) => {
      if (k === 'gk') { if (p.pos !== 'GK') return; p.gk = clamp(p.gk + 0.05 * ageFactor * gym * clamp(head / 30 + 0.2, 0.1, 1.3), 30, TUNE.attrMax); return; }
      if (!p.attrs) return;
      const cur = p.attrs[k];
      const gain = 0.052 * ageFactor * gym * clamp((p.pot - cur) / 30 + 0.22, 0.08, 1.35) * (1 - (cur / 110));
      p.attrs[k] = clamp(cur + gain, TUNE.attrMin, TUNE.attrMax);
    });
    // fitness recovery
    const rec = 26 + this.s.lifestyle.chef * 3 + this.s.lifestyle.physio * 4;
    p.fitness = clamp(p.fitness + rec, 30, 100);
    if (rng.chance(0.02 - this.s.lifestyle.physio * 0.002) && p.injuryWeeks === 0) {
      p.injuryWeeks = ri(rng, 1, 3);
      out.push({ t: `🚑 إصابة فالتدريب: ${p.full} غادي يغيب ${p.injuryWeeks} أسبوع.`, k: 'bad' });
    }
    // skills develop with age/experience
    if (rng.chance(0.25)) this.s.skills.skillMoves = clamp(this.s.skills.skillMoves + (rng.chance(0.25) ? 1 : 0), 1, 5);
  }

  weeklyEvents() {
    const out = [];
    const p = this.s.player;
    const rng = new Rng(hashSeed(this.s.seed, 'events', this.s.seasonNum, this.s.week));
    // board vs manager note
    if (this.s.week === 10) out.push({ t: `📋 مراقبة الإدارة للهدف: ${this.s.objectives[0]?.text ?? ''}`, k: 'info' });
    if (this.s.week === 20) {
      const sorted = sortTable(this.s.table);
      const pos = sorted.findIndex((r) => r.clubId === this.myClub.id) + 1;
      out.push({ t: `📊 ${this.myClub.name} فـ المركز ${pos}${th(pos)} فـ${this.myLeague.name}. معدلك: ${this.avgRating().toFixed(2)}`, k: 'info' });
    }
    if (rng.chance(0.25)) {
      const others = this.world.clubs.filter((c) => c.leagueId === this.myLeague.id && c.id !== this.myClub.id);
      const them = rng.pick(others);
      out.push({ t: `📰 الإعلام: "${p.full} مطلوب من ${them.name}" — الوكيل كيقول ليك ركّز فالماتش الجاي.`, k: 'info' });
    }
    if (rng.chance(0.14)) {
      const inc = Math.round((ri(rng, 2, 9) * 1000 + this.s.trust * 90) * (1 + this.s.lifestyle.pr * 0.25));
      this.s.money += inc;
      out.push({ t: `🤝 دخل الرعاة: ${fmtMoney(inc)} (اتفاق مع ماركة محلية).`, k: 'good' });
    }
    if (rng.chance(0.08)) {
      this.s.sponsorsWeekly += Math.round((this.s.trust + this.avgRating() * 6) * 4 * (1 + this.s.lifestyle.pr * 0.3));
      out.push({ t: `💼 راعي جديد: +${fmtMoney(this.s.sponsorsWeekly)} فالأسبوع`, k: 'good' });
    }
    // teammate/manager interactions that move trust
    if (rng.chance(0.2)) {
      const d = this.s.trust < 40 ? 'نتقدك فالصحافة' : 'مَدح فيك الخُلق ديالك';
      this.s.trust = clamp(this.s.trust + (this.s.trust < 40 ? -1.5 : 1.5), 5, 100);
      out.push({ t: `🎙️ ${this.myClub.manager.name} ${d}.`, k: this.s.trust < 40 ? 'bad' : 'good' });
    }
    // league position pressure
    if (this.s.week === 26) {
      out.push({ t: `🔥 وقت الحسم: باقي ${6 - Math.min(5, Math.round(this.s.trust / 20))} ماتشات باش تثبت راسك.`, k: 'info' });
    }
    return out;
  }

  news(text, kind = 'info') {
    const item = typeof text === 'string' ? { t: text, k: kind, w: this.s.week, s: this.s.seasonNum, y: this.s.year } : text;
    if (item.t === 'welcome-back') return;
    this.s.news.unshift({ ...item, id: hashSeed(this.s.news.length, item.t, Date.now() % 100000) });
    if (this.s.news.length > 60) this.s.news.pop();
  }

  avgRating() {
    const r = this.s.seasonStats.ratings;
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 6.5;
  }

  // ── end of season: awards, growth, offers, new season ──────────────────────
  endSeason() {
    const p = this.s.player, st = this.s.seasonStats;
    const sorted = sortTable(this.s.table);
    const position = sorted.findIndex((r) => r.clubId === this.myClub.id) + 1;
    const champ = sorted[0]?.clubId === this.myClub.id;
    const sum = {
      season: this.s.seasonNum, year: this.s.year, clubId: this.myClub.id, clubName: this.myClub.name,
      leaguePos: position, apps: st.apps, goals: st.goals, assists: st.assists, avg: round(this.avgRating(), 2),
      motm: st.motm, trophies: [], awards: [], overall: overall(p), age: p.age, wage: this.s.contract.wage,
    };
    // trophies
    if (champ) { sum.trophies.push(`🏆 ${this.myLeague.name}`); this.myClub.trophies.league++; }
    if (this.s.cup?.alive && this.s.cup.round === 3) { sum.trophies.push(`🏆 ${this.schedule.cup.name}`); this.myClub.trophies.cup++; }
    if (this.s.cont?.alive && this.s.cont.round === 4) { sum.trophies.push(`🏆 ${this.schedule.cont.name}`); this.myClub.trophies.continental++; }
    sum.trophies.forEach((t) => this.s.trophies.push({ t, season: this.s.seasonNum }));

    // objectives
    for (const o of this.s.objectives) {
      if (o.id === 'league') o.done = position <= o.target;
      if (o.id === 'goals') o.done = (p.pos === 'GK' ? st.cleanSheets : st.goals) >= o.target;
      if (o.id === 'trust') o.done = this.s.trust >= o.target;
      if (o.done) { this.s.money += o.reward; this.s.trust = clamp(this.s.trust + 4, 5, 100); }

      else this.s.trust = clamp(this.s.trust - 3, 5, 100);
    }

    // awards
    const awards = [];
    const topScorerGoals = (this.topScorersList(1)[0]?.goals) || 0;
    if ((p.pos === 'GK' ? st.cleanSheets >= 12 : st.goals >= Math.max(12, topScorerGoals)) && st.apps >= 18) awards.push({ id: 'goldenboot', name: p.pos === 'GK' ? '🧤 حارس الموسم' : '👟 الحذاء الذهبي', nameEn: p.pos === 'GK' ? 'Goalkeeper of the Season' : 'Golden Boot', detail: p.pos === 'GK' ? `${st.cleanSheets} شباك نظيفة` : `${st.goals} هدف` });
    if (this.avgRating() >= 7.45 && st.apps >= 20 && position <= 8) awards.push({ id: 'mvp', name: '⭐ أفضل لاعب فالدوري', nameEn: 'League MVP', detail: `معدل ${round(this.avgRating(), 2)}` });
    if (p.age <= 21 && st.goals + st.assists >= 14 && st.apps >= 18) awards.push({ id: 'poty', name: '🥇 أحسن لاعب شاب', nameEn: 'Young Player of the Season', detail: `${st.goals} هدف ${st.assists} أسيست` });
    if (position <= 4 && this.avgRating() >= 7.25 && st.apps >= 20) awards.push({ id: 'tos', name: '📋 فريق الموسم', nameEn: 'Team of the Season', detail: 'Best XI' });
    const globalRank = this.globalBallonDOrRank();
    if (globalRank <= 3) awards.push({ id: 'ballon', name: '🏅 الكرة الذهبية', nameEn: 'World Golden Ball', detail: `#${globalRank} فالعالم` });
    else if (globalRank <= 10) awards.push({ id: 'ballon10', name: '🌍 ضمن أحسن 10 فالعالم', nameEn: 'World Top 10', detail: `#${globalRank}` });
    awards.forEach((a) => this.s.awards.push({ ...a, season: this.s.seasonNum }));
    sum.awards = awards.map((a) => a.name);

    // national team
    this._nationalUpdate(sum);

    // growth
    const growShare = clamp(st.minutes / (30 * 90), 0, 1.2);
    const ageF = p.age <= 20 ? 1.25 : p.age <= 23 ? 1.0 : p.age <= 27 ? 0.6 : p.age <= 30 ? 0.25 : 0;
    const head = Math.max(0, p.pot - overall(p));
    const perfF = clamp(0.55 + (this.avgRating() - 6.4) * 0.55, 0.25, 1.6);
    const growth = clamp(head * 0.19 * ageF * perfF * growShare, 0, 4.4);
    growPlayer(p, growth);
    if (p.age >= TUNE.declineAge) {
      const decl = clamp((p.age - TUNE.declineAge + 1) * 0.7, 0, 3);
      if (p.attrs) { p.attrs.pac = clamp(p.attrs.pac - decl, 30, TUNE.attrMax); p.attrs.phy = clamp(p.attrs.phy - decl * 0.7, 30, TUNE.attrMax); }
      else p.gk = clamp(p.gk - decl * 0.5, 30, TUNE.attrMax);
    }
    sum.afterOverall = overall(p);

    this.s.history.push(sum);
    this.s.player.age += 1;
    this.s.player.seasonGoals = 0; this.s.player.seasonAssists = 0; this.s.player.seasonApps = 0;
    this.s.careerStats = mergeStats(this.s.careerStats, st);
    this.s.seasonStats = newStats();
    this.s.contract.seasons -= 1;

    // transfer market
    this.generateOffers(false);
    this.s.phase = 'postseason';
    this.s.postStep = 'awards';
    this.s.trophiesThisSeason = sum.trophies;
    this.save(0);
  }

  globalBallonDOrRank() {
    const p = this.s.player, st = this.s.seasonStats;
    const leagueRep = (this.myLeague.rep || 0.8) - 0.85;
    const myScore = (overall(p) - 55) / 6.4 + (this.avgRating() - 6.8) * 1.15 + st.goals * 0.045 + st.assists * 0.03
      + leagueRep * 3.2 + (this.s.natSquad ? 0.7 : 0) + (this.s.cont?.alive && this.s.cont.round >= 3 ? 0.5 : 0);
    const others = this.world.players
      .filter((pl) => pl.id !== 'me' && pl.age < 33)
      .map((pl) => ({
        name: pl.full,
        score: (overall(pl) - 55) / 6.4 + (hashSeed(this.s.seed, 'ballon', pl.id, this.s.seasonNum) % 100) / 16
          + (this.world.clubs.find((c) => c.id === pl.clubId && c.prestige >= 4) ? 1.4 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    let rank = 1;
    for (const o of others) if (o.score > myScore) rank++;
    return rank;
  }

  _nationalUpdate(sum) {
    const nat = this.nation, p = this.s.player;
    if (!nat) return;
    const meOvr = overall(p);
    const squadOvrs = (nat.squadIds || []).filter((id) => id !== 'me').map((id) => overall(this.world.byId[id])).sort((a, b) => b - a);
    const cut = squadOvrs.length > 10 ? squadOvrs[10] : 70;
    const inSquad = meOvr >= cut - 3 || (this.avgRating() >= 7 && this.s.seasonStats.apps > 10);
    this.s.natSquad = inSquad;
    if (inSquad) {
      const rng = new Rng(hashSeed(this.s.seed, 'nat', this.s.seasonNum));
      const caps = ri(rng, 3, 10), goals = p.pos === 'GK' ? 0 : ri(rng, 0, Math.max(1, Math.round(caps / 3)));
      this.s.capStats.apps += caps; this.s.capStats.goals += goals;
      sum.caps = caps; sum.natGoals = goals;
      this.s.money += caps * 6000;
      this.news(`🇲🇦 ${nat.name}: ${caps} ماتش دولي هاد العام${goals ? `، ${goals} هدف` : ''}.`, 'good');
    }
  }

  // ── transfer market ────────────────────────────────────────────────────────
  generateOffers(isStart) {
    const p = this.s.player;
    const ovr = overall(p);
    const perf = this.avgRating();
    const rng = new Rng(hashSeed(this.s.seed, 'offers', this.s.seasonNum, this.s.week));
    const all = this.world.clubs.filter((c) => c.id !== this.myClub.id && !c.isNation);
    const ceiling = clamp(ovr + (perf - 6.7) * 8 + (this.s.history.length ? 6 : 2), 40, 92);
    const cands = all.filter((c) => Math.abs(c.strength - ceiling) < 9 && c.strength > this.myClub.strength - 3);
    const pool = cands.length ? cands : all.filter((c) => c.strength < ceiling + 6);
    const n = isStart ? 3 : ri(rng, 1, 4);
    const offers = [];
    for (let i = 0; i < n; i++) {
      const club = rng.weighted(pool, (c) => Math.exp(-Math.abs(c.strength - ceiling) / 6) + 0.05);
      if (!club || offers.some((o) => o.clubId === club.id)) continue;
      const value = playerValue(p);
      const fee = Math.round(value * rng.range(0.8, 1.5));
      const wage = Math.max(this.s.contract.wage * 1.1, Math.round(((ovr - 40) ** 1.55) * 1.4 * rng.range(0.85, 1.35)));
      const squadRole = club.strength > ovr + 6 ? 'squad' : club.strength > ovr + 2 ? 'rotation' : club.strength < ovr - 4 ? 'star' : 'first';
      offers.push({
        id: 'o' + i + '_' + this.s.seasonNum, clubId: club.id, clubName: club.name, leagueId: club.leagueId,
        fee, wage, seasons: ri(rng, 2, 5), role: squadRole,
        shirt: ri(rng, 2, 45), signOn: Math.round((ovr - 40) ** 1.4 * 900 * rng.range(0.7, 1.6)),
        interest: Math.round(clamp(perf * 12 + ovr - 55, 20, 100)),
      });
    }
    this.s.offers = offers;
    this.s.interest = offers.slice(0, 3);
    return offers;
  }

  acceptOffer(offerId) {
    const o = this.s.offers.find((x) => x.id === offerId);
    if (!o) return null;
    const club = this.world.clubById[o.clubId];
    const p = this.s.player;
    // remove from old club, add to new
    this.myClub.playerIds = this.myClub.playerIds.filter((id) => id !== 'me');
    if (!club.playerIds.includes('me')) club.playerIds.push('me');
    this.s.clubId = club.id; this.s.leagueId = club.leagueId;
    this.s.contract = { wage: o.wage, seasons: o.seasons, goalBonus: Math.round(o.wage * 0.2), appBonus: Math.round(o.wage * 0.1) };
    this.s.money += o.signOn + o.fee * 0.06;
    this.s.trust = o.role === 'star' ? 72 : o.role === 'first' ? 55 : 38;
    this.s.forceStart = o.role === 'star';
    this.s.offers = []; this.s.interest = [];
    this.s.shirt = o.shirt;
    this.news(`✍️ انتقال! ${p.full} مشى لـ${club.name} بـ${fmtMoney(o.fee)} (${fmtMoney(o.wage)} فالأسبوع، ${o.seasons} مواسم).`, 'good');
    return { club, offer: o };
  }

  // ── offseason steps: awards → transfers → national team → new season ───────
  advanceOffseason(action = {}) {
    const step = this.s.postStep;
    if (step === 'awards') {
      this.s.postStep = 'transfers';
      const last = this.s.history[this.s.history.length - 1];
      this.news(`🏆 حفل الجوائز تسالى. مراجعة موسم ${last.season}: ${last.apps} ماتش، ${last.goals} هدف، ${last.assists} أسيست، معدل ${last.avg}.`);
      return { step: 'awards', done: true };
    }
    if (step === 'transfers') {
      this.s.postStep = 'nations';
      return { step: 'transfers', done: true };
    }
    if (step === 'nations') {
      // national team tournament (World Cup every 4 seasons, continental otherwise)
      const isWC = this.s.year % 4 === 2;
      if (this.s.natSquad || isWC) {
        this.s.natTournament = this._setupNationTournament(isWC);
      }
      this.s.postStep = 'newseason';
      return { step: 'nations', done: true, tournament: this.s.natTournament };
    }
    // new season
    this.startNewSeason();
    return { step: 'newseason', done: true };
  }

  _setupNationTournament(isWC) {
    const conf = this.nation?.conf || 'UEFA';
    const rng = new Rng(hashSeed(this.s.seed, 'nattour', this.s.seasonNum));
    let ids;
    if (isWC) ids = this.world.nations.slice().sort((a, b) => b.rating + (hashSeed('wc', a.code, this.s.seasonNum) % 5) - (a.rating + (hashSeed('wc', b.code, this.s.seasonNum) % 5))).slice(0, 32).map((n) => 'n_' + n.code);
    else {
      ids = this.world.nations.filter((n) => n.conf === conf).map((n) => 'n_' + n.code);
      if (ids.length < 16) {
        const extra = this.world.nations.filter((n) => n.conf !== conf).sort((a, b) => b.rating - a.rating).map((n) => 'n_' + n.code);
        ids = ids.concat(extra).slice(0, 16);
      } else ids = ids.slice(0, 16);
    }
    const myCode = this.s.player.nation;
    const mine = 'n_' + myCode;
    if (!ids.includes(mine)) ids[ids.length - 1] = mine;
    return {
      isWC, name: isWC ? '🏆 كأس العالم' : `🌍 كأس ${conf}`, round: 0, ids, bracket: { 0: ids },
      results: {}, alive: true, done: false, champion: null,
    };
  }

  nationFixture() {
    const T = this.s.natTournament;
    if (!T || !T.alive || T.done) return null;
    const idx = T.round;
    const field = (T.bracket[idx] || []).filter(Boolean);
    const mine = 'n_' + this.s.player.nation;
    if (!field.includes(mine)) return null;
    const rng = new Rng(hashSeed(this.s.seed, 'natfix', this.s.seasonNum, idx));
    const opp = rng.pick(field.filter((id) => id !== mine));
    return { comp: 'nation', home: rng.chance(0.5), opponentId: opp, label: T.name, round: idx, neutral: idx >= 2 };
  }

  startNationMatch() {
    const fx = this.nationFixture();
    if (!fx) return null;
    const plan = planMatch(this.world, {
      player: this.s.player, clubId: 'n_' + this.s.player.nation, opponentId: fx.opponentId,
      home: fx.home, neutral: fx.neutral, competition: fx.label,
      formation: this.world.clubById['n_' + this.s.player.nation].formation, trust: 80, forceStart: true,
      seed: hashSeed(this.s.seed, 'natmatch', this.s.seasonNum, fx.round),
    });
    plan.fixture = { comp: 'nation', ...fx };
    this.pendingNation = plan;
    return plan;
  }

  submitNationMatch(res) {
    const plan = this.pendingNation;
    if (!plan) return null;
    this.pendingNation = null;
    return this._recordNationMatch(plan, res);
  }

  finishNationMatch(decisions = {}) {
    const fx = this.nationFixture();
    if (!fx) return null;
    const plan = this.startNationMatch();
    const res = resolveMatch(this.world, plan, decisions, hashSeed(this.s.seed, 'natres', this.s.seasonNum, fx.round));
    return this.submitNationMatch(res);
  }

  _recordNationMatch(plan, res) {
    const T = this.s.natTournament;
    const fx = plan.fixture;
    if (!T || !fx) return null;
    const st = this.s.capStats;
    if (res.stats && res.stats.minutes) {
      st.apps++; st.goals += res.stats.goals; st.assists += res.stats.assists;
      this.s.money += 9000 + res.stats.goals * 12000;
    }
    const idx = fx.round;
    const field = (T.bracket[idx] || []).filter(Boolean);
    const rng = new Rng(hashSeed(this.s.seed, 'natsim', idx, this.s.seasonNum));
    const others = field.filter((id) => id !== 'n_' + this.s.player.nation && id !== fx.opponentId);
    const winners = [];
    const shuffled = rng.shuffle(others);
    for (let i = 0; i + 1 < shuffled.length; i += 2) winners.push(playTie(this.world, shuffled[i], shuffled[i + 1], rng).winner);
    const won = res.gh > res.ga || (res.gh === res.ga && rng.chance(0.5));
    if (won) winners.push('n_' + this.s.player.nation); else winners.push(fx.opponentId);
    T.bracket[idx + 1] = winners;
    T.results[idx] = { opponent: fx.opponentId, gh: res.gh, ga: res.ga, advanced: won };
    T.round++;
    const lastRound = T.isWC ? 4 : 3;
    if (T.round > lastRound) { T.done = true; T.champion = winners[0] || 'n_' + this.s.player.nation; T.alive = false; }
    else if (!won) { T.done = true; T.alive = false; }
    if (won && T.round > lastRound) this.news(`🏆 ${this.nation?.name} ربح${T.isWC ? ' كأس العالم' : ' ${T.name}'}!`, 'good');
    this.save(0);
    return { res, plan, tournament: T };
  }

  startNewSeason(relegation = null) {
    this.s.seasonNum++;
    this.s.year++;
    this.s.week = 1;
    this.s.phase = 'season';
    this.s.postStep = null;
    this.s.table = newTable(this.myLeague.clubIds);
    this.s.tableSeason = this.s.seasonNum;
    this.s.cup = null; this.s.cont = null;
    this.s.natTournament = null;
    this.s.topScorers = []; this._scorers = {};
    this.s.forms = {};
    this.s.weekPlan = null;
    this.s.offers = [];
    this.s.form = [];
    this.s.player.fitness = 100;
    this.s.player.injuryWeeks = 0;
    this.s.trust = clamp(this.s.trust * 0.85 + 22, 20, 85);
    this.schedule = this._buildSchedule(this.s.seasonNum);
    this._resetSeasonCups();
    this.generateObjectives();
    // retirement check
    if (this.s.player.age >= 38) this.s.canRetire = true;
    if (this.s.player.age >= 41) this.s.forcedRetire = true;
    this.news(`📅 الموسم ${this.s.seasonNum} (${this.s.year}) كيبدا — ${this.myClub.name}, ${this.myLeague.name}.`);
    this.save(0);
  }

  retire() {
    this.s.retired = true;
    this.s.retiredAt = this.s.seasonNum;
    this.save(0);
  }

  // ── misc helpers for the UI ────────────────────────────────────────────────
  tableSorted() { return sortTable(this.s.table || []); }
  myPosition() { return this.tableSorted().findIndex((r) => r.clubId === this.myClub.id) + 1; }
  squad() {
    return this.myClub.playerIds.map((id) => this.world.byId[id]).filter(Boolean)
      .sort((a, b) => (a.id === 'me' ? -1 : b.id === 'me' ? 1 : overall(b) - overall(a)));
  }
  starPlayers(n = 5) {
    return this.world.players.filter((p) => p.id !== 'me').sort((a, b) => overall(b) - overall(a)).slice(0, n);
  }
  playerValueOf(p = this.s.player) { return playerValue(p); }
  overallOf(p = this.s.player) { return overall(p); }
  canBuy(item) { return this.s.money >= LIFESTYLE[item].cost; }
  buy(item) {
    const L = LIFESTYLE[item];
    if (!L || this.s.money < L.cost || this.s.lifestyle[item] >= L.max) return false;
    this.s.money -= L.cost;
    this.s.lifestyle[item]++;
    this.news(`${L.icon} ${L.ar} — المستوى ${this.s.lifestyle[item]} (${fmtMoney(L.cost)})`, 'good');
    this.save(0);
    return true;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
export const UPKEEP = { chef: 320, gym: 380, physio: 520, pr: 700, car: 900, house: 1800 };

export const LIFESTYLE = {
  chef: { ar: 'طاهي خاص', en: 'Personal chef', cost: 45000, max: 3, icon: '👨‍🍳', effect: 'استرجاع أسرع لللياقة' },
  gym: { ar: 'قاعة رياضية خاصة', en: 'Home gym', cost: 60000, max: 3, icon: '🏋️', effect: 'تدريب أسرع' },
  physio: { ar: 'مختص فيزيو', en: 'Physio team', cost: 90000, max: 3, icon: '🩺', effect: 'إصابات أقل' },
  pr: { ar: 'وكالة PR', en: 'PR agency', cost: 75000, max: 3, icon: '📣', effect: 'رعاة أكثر' },
  car: { ar: 'سيارة فخمة', en: 'Supercar', cost: 120000, max: 3, icon: '🏎️', effect: 'معنويات أعلى' },
  house: { ar: 'فيلا', en: 'Villa', cost: 400000, max: 2, icon: '🏝️', effect: 'معنويات + ثقة' },
};

export function playerValue(p) {
  const ovr = overall(p);
  const base = Math.max(0, ovr - 42) ** 2.35 * 4200;
  const ageF = p.age <= 20 ? 1.55 : p.age <= 23 ? 1.4 : p.age <= 27 ? 1.15 : p.age <= 30 ? 0.8 : p.age <= 33 ? 0.45 : 0.2;
  const formF = 1 + clamp((p.form || 0) * 0.12, -0.2, 0.3);
  return Math.round(base * ageF * formF);
}

function nationConf(code) { const n = NATIONS.find((x) => x[1] === code); return n ? n[3] : 'UEFA'; }
function th(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

function newStats() {
  return { apps: 0, minutes: 0, goals: 0, assists: 0, ratings: [], yellow: 0, red: 0, motm: 0, cleanSheets: 0, saves: 0, good: 0, bad: 0 };
}
function mergeStats(a, b) {
  const out = { ...a, ratings: [] };
  for (const k of ['apps', 'minutes', 'goals', 'assists', 'yellow', 'red', 'motm', 'cleanSheets', 'saves', 'good', 'bad']) {
    out[k] = (a[k] || 0) + (b[k] || 0);
  }
  out.ratingSum = (a.ratingSum || 0) + b.ratings.reduce((x, y) => x + y, 0);
  out.ratingCount = (a.ratingCount || 0) + b.ratings.length;
  out.avg = round(out.ratingSum / Math.max(1, out.ratingCount), 2);
  return out;
}
