// Match-engine sanity statistics.
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const { Career } = await import('../src/career.js');
const { planMatch, resolveMatch, MOMENT_TYPES, defaultDecision } = await import('../src/match.js');
const { quickResult, buildLineup } = await import('../src/engine.js');
const { overall, teamRatings } = await import('../src/worldgen.js');
const { Rng } = await import('../src/rng.js');

const c = Career.new({ seed: 424242, first: 'Test', last: 'Player', nation: 'MAR', country: 'Morocco', pos: 'ST' });
const N = Number(process.argv[2] || 300);
const rng = new Rng(99);
// compare against clubs of a similar strength so the sample is fair
const lo = c.myClub.strength - 4, hi = c.myClub.strength + 4;
let opps = c.world.clubs.filter((x) => x.leagueId === c.myLeague.id && x.id !== c.myClub.id && x.strength >= lo && x.strength <= hi);
if (opps.length < 5) opps = c.world.clubs.filter((x) => x.leagueId === c.myLeague.id && x.id !== c.myClub.id);
console.log('my club', c.myClub.name, c.myClub.strength, '| opponents', opps.map((o) => o.strength).join(','));

let gf = 0, ga = 0, shotsMe = 0, shotsOpp = 0, sotMe = 0, sotOpp = 0, started = 0, moments = 0, momentTypes = {};
const ratings = []; let goalsMine = 0, assistsMine = 0, shootsMine = 0, minMine = 0, saves = 0, yellow = 0;
const scoreDist = {};

for (let i = 0; i < N; i++) {
  const opp = rng.pick(opps);
  const plan = planMatch(c.world, {
    player: c.s.player, clubId: c.myClub.id, opponentId: opp.id, home: i % 2 === 0,
    competition: 'League', formation: c.myClub.formation, trust: 90, forceStart: true, seed: 1000 + i,
  });
  const res = resolveMatch(c.world, plan, {}, 5000 + i);
  gf += res.gh; ga += res.ga;
  shotsMe += res.shots.mine; shotsOpp += res.shots.opp;
  sotMe += res.sot.mine; sotOpp += res.sot.opp;
  moments += plan.moments.length;
  plan.moments.forEach((m) => { momentTypes[m.type] = (momentTypes[m.type] || 0) + 1; });
  if (res.stats) {
    ratings.push(res.stats.rating); goalsMine += res.stats.goals; assistsMine += res.stats.assists;
    shootsMine += res.stats.shots; minMine += res.stats.minutes; saves += res.stats.saves; yellow += res.stats.yellow;
    if (res.starting) started++;
  }
  const k = `${res.gh}-${res.ga}`;
  scoreDist[k] = (scoreDist[k] || 0) + 1;
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`── interactive engine, ${N} matches ──`);
console.log('goals/match', ((gf + ga) / N).toFixed(2), `(mine ${(gf / N).toFixed(2)} vs opp ${(ga / N).toFixed(2)})`);
console.log('shots/match', ((shotsMe + shotsOpp) / N).toFixed(1), `(mine ${(shotsMe / N).toFixed(1)} opp ${(shotsOpp / N).toFixed(1)}) | on target %`, (((sotMe + sotOpp) / (shotsMe + shotsOpp)) * 100).toFixed(0));
console.log('moments/match', (moments / N).toFixed(1), momentTypes);
console.log('started', ((started / N) * 100).toFixed(0) + '%', '| minutes/match', (minMine / N).toFixed(0));
console.log('me: shots/90', (shootsMine / Math.max(1, minMine / 90)).toFixed(2), '| goals/90', (goalsMine / Math.max(1, minMine / 90)).toFixed(2), '| assists/90', (assistsMine / Math.max(1, minMine / 90)).toFixed(2), '| yellow/match', (yellow / N).toFixed(2));
console.log('avg rating', avg(ratings).toFixed(2), '| rating spread', Math.min(...ratings).toFixed(1), '-', Math.max(...ratings).toFixed(1));
console.log('top scores:', Object.entries(scoreDist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(' '));

// quick-sim comparison
let qgf = 0, qga = 0;
for (let i = 0; i < N * 4; i++) {
  const a = rng.pick(c.world.clubs.filter((x) => x.leagueId === c.myLeague.id));
  const b = rng.pick(c.world.clubs.filter((x) => x.leagueId === c.myLeague.id && x.id !== a.id));
  const r = quickResult(c.world, a.id, b.id, rng);
  qgf += r.gh; qga += r.ga;
}
console.log(`── quick sim, ${N * 4} matches ── goals/match`, ((qgf + qga) / (N * 4)).toFixed(2));

// league-wide season totals
const t = c.s.table.reduce((a, r) => ({ p: a.p + r.p, gf: a.gf + r.gf }), { p: 0, gf: 0 });
console.log('table integrity (fresh season):', JSON.stringify(t));
const strengths = c.world.clubs.slice(0, 5).map((x) => `${x.short}:${x.strength}`);
console.log('sample club strengths', strengths.join(' '), '| player ovr', overall(c.s.player));
