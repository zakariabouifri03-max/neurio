// TournamentManager: a four-team knockout (two semi-finals, then the final).
// Draws in a knockout tie are settled by a penalty decider weighted by team strength (documented
// in the README; a full penalty shootout mode is separate). Pure logic, no DOM, fully testable.
import { TEAM_DEFS } from './data/teams.js';

export class TournamentManager {
  constructor(state) {
    this.state = state;
  }

  // userTeamId: id from TEAM_DEFS. Field = user team + the next three teams in the list.
  static create(userTeamId) {
    const user = TEAM_DEFS.find((t) => t.id === userTeamId) || TEAM_DEFS[0];
    const others = TEAM_DEFS.filter((t) => t.id !== user.id).slice(0, 3);
    const field = [user, ...others].map((t) => t.id);
    // seeds: user is seed 1, others follow list order (2, 3, 4)
    const s = field;
    const semi = [
      { id: 'sf1', round: 'semi', home: s[0], away: s[3], score: null, penalties: null, winner: null, user: true },
      { id: 'sf2', round: 'semi', home: s[1], away: s[2], score: null, penalties: null, winner: null, user: false },
    ];
    return new TournamentManager({ userTeamId: user.id, field, matches: semi, champion: null, stage: 'semi' });
  }

  static fromState(state) {
    return state ? new TournamentManager(state) : null;
  }

  toJSON() { return this.state; }

  get userTeamId() { return this.state.userTeamId; }

  // next unplayed match, or null when the tournament is complete
  nextMatch() {
    return this.state.matches.find((m) => m.score === null) || null;
  }

  isComplete() {
    return !!this.state.champion;
  }

  // record a played match. score: [homeGoals, awayGoals]; rng: () => [0,1)
  record(matchId, score, strength = {}, rng = Math.random) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m || m.score !== null) return null;
    m.score = [score[0], score[1]];
    if (score[0] !== score[1]) {
      m.winner = score[0] > score[1] ? m.home : m.away;
    } else {
      // knockout draw: the decider is weighted by team strength
      const sh = strength[m.home] || 7, sa = strength[m.away] || 7;
      const pHome = sh / (sh + sa);
      m.penalties = rng() < pHome ? 'home' : 'away';
      m.winner = m.penalties === 'home' ? m.home : m.away;
    }
    if (this.state.stage === 'semi' && this.state.matches.every((x) => x.round !== 'semi' || x.score !== null)) {
      const semis = this.state.matches.filter((x) => x.round === 'semi');
      this.state.matches.push({
        id: 'final', round: 'final',
        home: semis[0].winner, away: semis[1].winner,
        score: null, penalties: null, winner: null,
        user: [semis[0].winner, semis[1].winner].includes(this.state.userTeamId),
      });
      this.state.stage = 'final';
    } else if (this.state.stage === 'final') {
      this.state.champion = m.winner;
    }
    return m;
  }

  // the bracket as a list of rounds for the UI
  bracket() {
    return {
      semi: this.state.matches.filter((x) => x.round === 'semi'),
      final: this.state.matches.find((x) => x.round === 'final') || null,
      champion: this.state.champion,
    };
  }
}
