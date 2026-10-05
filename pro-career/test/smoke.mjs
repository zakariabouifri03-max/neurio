// Headless smoke test: run several full seasons of a career and print a report.
// Usage: node pro-career/test/smoke.mjs
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};
const { Career } = await import('../src/career.js');
const { overall } = await import('../src/worldgen.js');

const t0 = Date.now();
const c = Career.new({ seed: 20261006, first: 'Anas', last: 'Bennani', nation: 'MAR', country: 'Morocco', pos: 'ST', level: 62, difficulty: 'normal' });
console.log('world built in', Date.now() - t0, 'ms —', c.world.players.length, 'players,', c.world.clubs.length, 'clubs,', c.world.leagues.length, 'leagues');
console.log('start club:', c.myClub.name, '|', c.myLeague.name, '| ovr', overall(c.s.player), '| value', Math.round(c.s.player.value || 0));

const seasons = Number(process.argv[2] || 4);
let goalsTotal = 0, appsTotal = 0, lastTable = null;
for (let s = 0; s < seasons; s++) {
  let week = 1;
  while (c.s.phase === 'season') {
    const fixtures = c.weekFixture() || [];
    for (const fx of fixtures) {
      const out = c.instantMatch();
      if (out) { goalsTotal += out.res.stats?.goals || 0; appsTotal += out.res.stats?.minutes ? 1 : 0; }
    }
    c.simWorldWeek();
    c.advanceWeek();
    week++;
    if (week > 40) break;
  }
  const st = c.s.seasonStats;
  const hist = c.s.history[c.s.history.length - 1];
  // snapshot the finished league table (it is wiped when the new season starts)
  { const t = c.tableSorted();
    lastTable = { pts: t.reduce((x, r) => x + r.pts, 0), pld: t.reduce((x, r) => x + r.p, 0),
                  gf: t.reduce((x, r) => x + r.gf, 0), ga: t.reduce((x, r) => x + r.ga, 0),
                  scorers: c.topScorersList(5) }; }
  console.log(`S${hist.season} (${hist.year}) ${hist.clubName}: pos ${hist.leaguePos}/16, ${hist.apps} apps, ${hist.goals}G ${hist.assists}A, avg ${hist.avg} (${hist.motm} MOTM), ovr ${hist.overall} -> ${hist.afterOverall}, age ${hist.age}, trust ${Math.round(c.s.trust)}, money ${Math.round(c.s.money/1000)}k`);
  if (c.s.history[c.s.history.length - 1].awards.length) console.log('   awards:', c.s.history[c.s.history.length - 1].awards.join(' | '));
  if (c.s.history[c.s.history.length - 1].trophies.length) console.log('   trophies:', c.s.history[c.s.history.length - 1].trophies.join(' | '));
  // offseason
  while (c.s.postStep) {
    if (c.s.postStep === 'transfers') {
      const best = c.s.offers.slice().sort((a, b) => b.wage - a.wage)[0];
      if (best && best.wage > c.s.contract.wage * 1.35) { c.acceptOffer(best.id); console.log('   transfer ->', best.clubName, best.wage + '/wk'); }
    }
    if (c.s.postStep === 'nations') {
      const fx = c.nationFixture();
      if (fx) {
        const out = c.finishNationMatch({});
        if (out) console.log('   ', c.s.natTournament.name, 'r' + (fx.round + 1), c.world.clubById[fx.opponentId].short, `${out.res.gh}-${out.res.ga}`, out.res.stats ? `you ${out.res.stats.rating}` : '');
      }
    }
    c.advanceOffseason();
  }
  console.log('   week1 of next season ->', c.s.phase, c.s.week, 'club:', c.myClub.name, 'league:', c.myLeague.name);
}

// ── integrity checks (on the last *finished* season table) ──
const T = lastTable || { pts: 0, pld: 0, gf: 0, ga: 0, scorers: [] };
const okPts = T.pts === T.pld * 3 - (T.pld * 3 - T.pts) && T.pld === 16 * 30;
console.log('\nfinished-season table: pts', T.pts, 'played', T.pld, 'gf', T.gf, 'ga', T.ga,
  T.gf === T.ga ? '✅ balanced' : '❌ gf≠ga',
  okPts ? '✅ 16×30 played' : '⚠️ played=' + T.pld);
console.log('top scorers:', T.scorers.map((s) => `${s.name} ${s.goals}G/${s.assists}A`).join(', ') || '(none)');
console.log('career totals: apps', c.s.careerStats.apps, 'goals', c.s.careerStats.goals, 'assists', c.s.careerStats.assists, 'avg', c.s.careerStats.avg);
console.log('money', Math.round(c.s.money).toLocaleString('en-US'), '€ | caps', c.s.capStats.apps, '| nat goals', c.s.capStats.goals);
console.log('trophies:', c.s.trophies.map((t) => t.t).join(' | ') || 'none');
console.log('awards:', c.s.awards.map((a) => `${a.season}:${a.name}`).join(' | ') || 'none');
console.log('news (last 6):'); c.s.news.slice(0, 6).forEach((n) => console.log('   -', n.t));
const save = JSON.stringify(c.s);
console.log('save size', (save.length / 1024).toFixed(1), 'KB');
const t1 = Date.now();
const c2 = Career.load === undefined ? null : (() => { c.save(1); return true; })();
console.log('save+total time', Date.now() - t1, 'ms (whole run', Date.now() - t0, 'ms)');
