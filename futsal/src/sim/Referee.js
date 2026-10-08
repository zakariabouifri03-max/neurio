// Referee: judges tackles, fouls, advantage, cards and restart positions.
// Deliberately probabilistic (difficulty-scaled) so decisions feel human, not scripted.
import { PITCH, MATCH } from '../config.js';
import { dist2, clamp } from '../core/math.js';

export class Referee {
  constructor(match) {
    this.match = match;
    this.pos = { x: 0, y: 0, z: -9 };
    this.target = { x: 0, z: -9 };
    this.advantage = null;     // { teamIndex, until, spot, foulBy }
    this.cards = [];           // history
  }

  // Ball-first contact check. Returns { foul, severity, card, penalty, spot, reason }
  judgeTackle({ tackler, victim, slide, ballFirst, fromBehind }) {
    const m = this.match;
    const strict = m.difficultySettings.refStrict;
    if (ballFirst) return { foul: false };
    let p = 0.12 + (slide ? 0.3 : 0) + (fromBehind ? 0.25 : 0);
    p += (100 - tackler.attrs.defending) / 500 * 0.4;
    p *= strict;
    if (!m.rng.chance(clamp(p, 0, 0.92))) return { foul: false };
    const severe = slide || fromBehind || m.rng.chance(0.2);
    let card = 'none';
    if (severe && m.rng.chance(0.3 * strict)) card = 'yellow';
    else if (m.rng.chance(0.03 * strict)) card = 'yellow';
    return { foul: true, severe, card, spot: { x: victim.pos.x, z: victim.pos.z }, by: tackler, victim };
  }

  // Whether the foul spot is inside the attacking side's box (direct free kick → penalty).
  isInBox(spot, attackingTeamIndex) {
    const m = this.match;
    const team = m.teams[attackingTeamIndex];
    // the goal the attacking team is attacking
    const goalX = team.attackDir * PITCH.halfLength;
    const dx = Math.abs(spot.x - goalX);
    return dx <= PITCH.boxDepth && Math.abs(spot.z) <= PITCH.boxHalfWidth && Math.sign(spot.x) === Math.sign(goalX);
  }

  // Called when a foul is given. Sets advantage window (play on if fouled team keeps ball).
  giveFoul(by, victim, spot, card) {
    const m = this.match;
    const fouledTeam = victim.teamIndex;
    const foulerTeam = by.teamIndex;
    const box = this.isInBox(spot, fouledTeam) && foulerTeam !== fouledTeam;
    m.stats.foul(by);
    m.stoppageAdd(MATCH.stoppagePerFoul);
    if (card === 'yellow') {
      this.yellow(by);
    }
    return { fouledTeam, foulerTeam, box, spot: { x: spot.x, z: spot.z } };
  }

  yellow(f) {
    const m = this.match;
    f.yellow += 1;
    this.cards.push({ type: 'yellow', f, t: m.clock });
    m.stats.card(f, 'yellow');
    m.stoppageAdd(MATCH.stoppagePerCard);
    m.emit('card', { type: 'yellow', f });
    if (f.yellow >= 2) {
      this.red(f);
    }
  }

  red(f) {
    const m = this.match;
    if (f.sentOff) return;
    f.sentOff = true;
    f.walkOff = true;
    this.cards.push({ type: 'red', f, t: m.clock });
    m.stats.card(f, 'red');
    m.emit('card', { type: 'red', f });
    if (m.ball.owner === f) m.ball.release();
    m.onPlayerSentOff(f);
  }
}
