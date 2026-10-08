// MatchStats: team and player statistics for the post-match screen and player ratings.
export class MatchStats {
  constructor(match) {
    this.match = match;
    this.team = match.teams.map(() => ({
      shots: 0, shotsOn: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0, kickIns: 0,
      freeKicks: 0, saves: 0, possession: 0, yellow: 0, red: 0, tackles: 0, interceptions: 0,
      goals: 0, touches: 0,
    }));
    this.player = new Map();
    this.pendingPass = null;   // { by, t }
    this.receivedFrom = new Map();  // receiver id -> { by, t } (for assists)
    this.goalLog = [];
  }

  p(f) {
    let s = this.player.get(f.id);
    if (!s) {
      s = { goals: 0, assists: 0, shots: 0, shotsOn: 0, passes: 0, passesOk: 0, tackles: 0, fouls: 0, saves: 0, yellow: 0, red: 0, touches: 0, conceded: 0 };
      this.player.set(f.id, s);
    }
    return s;
  }

  kick(by, meta) {
    const t = this.team[by.teamIndex];
    const s = this.p(by);
    if (meta.kind === 'shot') {
      t.shots++; s.shots++;
      if (meta.target && this.onTarget(by, meta.target)) { t.shotsOn++; s.shotsOn++; }
    } else if (meta.kind === 'pass' || meta.kind === 'through' || meta.kind === 'lob') {
      t.passes++; s.passes++;
      this.pendingPass = { by, t: this.match.time };
    }
    if (meta.kind === 'corner' || meta.kind === 'cross') t.corners++;
  }

  // Did this shot reach the goal mouth (aimed at it)?
  onTarget(by, target) {
    return Math.abs(target.z) < 1.5 && target.y < 2.0;
  }

  capture(by) {
    const t = this.team[by.teamIndex];
    t.touches++;
    this.p(by).touches++;
    const pp = this.pendingPass;
    if (pp) {
      if (pp.by.teamIndex === by.teamIndex && pp.by !== by) {
        this.team[by.teamIndex].passesOk++;
        this.p(pp.by).passesOk++;
        this.receivedFrom.set(by.id, { by: pp.by, t: this.match.time });
      } else if (pp.by.teamIndex !== by.teamIndex) {
        this.team[by.teamIndex].interceptions++;
      }
      this.pendingPass = null;
    }
  }

  tackle(by, won) {
    if (won) { this.team[by.teamIndex].tackles++; this.p(by).tackles++; }
  }

  foul(by) {
    this.team[by.teamIndex].fouls++;
    this.p(by).fouls++;
  }

  card(f, type) {
    this.p(f)[type]++;
    this.team[f.teamIndex][type]++;
  }

  save(gk) {
    this.team[gk.teamIndex].saves++;
    this.p(gk).saves++;
  }

  goal(scorer, assister, teamIndex, minute) {
    this.team[teamIndex].goals++;
    if (scorer) this.p(scorer).goals++;
    if (assister && assister !== scorer) this.p(assister).assists++;
    this.goalLog.push({ teamIndex, scorer: scorer ? scorer.name : 'Own goal', minute, assister: assister ? assister.name : null });
  }

  // Credits an assist if the scorer received a completed pass shortly before.
  assisterFor(scorer, now) {
    const rf = this.receivedFrom.get(scorer.id);
    if (rf && now - rf.t < 12) return rf.by;
    return null;
  }

  possession(teamIndex, dt) {
    this.team[teamIndex].possession += dt;
  }

  possessionPct(teamIndex) {
    const a = this.team[0].possession, b = this.team[1].possession;
    const tot = a + b;
    if (tot < 1e-6) return 50;
    return Math.round((teamIndex === 0 ? a : b) / tot * 100);
  }

  passAccuracy(teamIndex) {
    const t = this.team[teamIndex];
    return t.passes ? Math.round(t.passesOk / t.passes * 100) : 0;
  }

  rating(f) {
    const s = this.p(f);
    let r = 6.0;
    r += s.goals * 0.9 + s.assists * 0.5;
    if (s.passes > 0) r += (s.passesOk / s.passes - 0.7) * 1.2;
    r += s.tackles * 0.12 + s.shotsOn * 0.1;
    r -= s.fouls * 0.2 + s.yellow * 0.6 + s.red * 2.5;
    r += s.saves * 0.3;
    if (f.role === 'GK') r -= this.match.teams[1 - f.teamIndex].score * 0.25;
    r += Math.min(0.6, s.touches / 120);
    if (f.sentOff) r -= 0.3;
    return Math.round(Math.max(3.5, Math.min(9.9, r)) * 10) / 10;
  }
}
