// FormationManager: converts formation slots into live anchor points that shift with
// the ball, possession and the team's tactical settings (press / line / risk).
import { PITCH } from '../config.js';
import { clamp } from '../core/math.js';

export class FormationManager {
  constructor(match) {
    this.match = match;
  }

  // Recompute tactical settings for a team from score, time and style.
  updateTactics(team) {
    const m = this.match;
    const diff = m.difficultySettings;
    const other = m.teams[1 - team.index];
    const scoreDiff = team.score - other.score;
    const remain = m.timeRemainingFraction();
    let press = 0.5, line = 0, risk = 0.5;

    if (team.style === 'press') { press = 0.8; line = 2.0; }
    if (team.style === 'counter') { press = 0.35; line = -1.4; risk = 0.45; }
    if (team.style === 'possession') { press = 0.55; line = 0.8; risk = 0.35; }
    if (team.style === 'balanced') { press = 0.55; line = 0.5; risk = 0.5; }

    // chasing the game late: push up, press, take risks
    if (scoreDiff < 0 && remain < 0.35) { press += 0.25; line += 2.2; risk += 0.25; }
    // protecting a lead: sit deeper, pass safely
    if (scoreDiff > 0 && remain < 0.3) { press -= 0.1; line -= 1.6; risk -= 0.2; }
    // losing heavily: panic-press a little less, go for shots
    if (scoreDiff <= -2) { risk += 0.15; }

    team.tactic.press = clamp(press * diff.pressMul, 0.1, 1);
    team.tactic.line = line;
    team.tactic.risk = clamp(risk, 0.1, 0.95);
  }

  // Anchor (home) position for a player given the current mode:
  // 'attack' (we have the ball), 'defend' (opponent has it), 'loose'.
  anchorFor(team, f, mode) {
    const ball = this.match.ball.pos;
    const dir = team.attackDir;
    if (f.role === 'GK') {
      return this.keeperAnchor(team);
    }
    const slot = team.formationSlots[f.slot] || team.formationSlots[0];
    let line = team.tactic.line;
    if (mode === 'attack') line += 2.0;
    if (mode === 'defend') line -= 1.2;
    const sx = dir * (slot.a * 15.5) + clamp(ball.x * 0.32, -4.5, 4.5) + dir * line;
    const sz = slot.z * 7.4 + clamp(ball.z * 0.36, -3.2, 3.2);
    return {
      x: clamp(sx, -PITCH.halfLength + 2.5, PITCH.halfLength - 2.5),
      z: clamp(sz, -PITCH.halfWidth + 1.5, PITCH.halfWidth - 1.5),
    };
  }

  keeperAnchor(team) {
    const ball = this.match.ball.pos;
    const goalX = -team.attackDir * PITCH.halfLength; // own goal line
    const s = Math.sign(goalX);
    const distBall = Math.hypot(ball.x - goalX, ball.z);
    // stand further off the line when the ball is far, closer when it is near
    const depth = clamp(0.9 + (16 - distBall) / 16 * 0.9, 0.8, 1.8);
    const z = clamp(ball.z * 0.34, -1.0, 1.0);
    return { x: goalX - s * depth, z };
  }
}
