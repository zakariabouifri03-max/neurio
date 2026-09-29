// ═════════════════════════════════════════════════════════════════════════════
// Bots — table-mates for when the friend count is short.
// They are *not* omniscient: they only read what a player at their seat could
// read (their own secret card, the public board, their legal action list).
// Bots are what make solo / 2-player sessions feel alive, and they also let the
// server keep a round solvable when someone drops out.
// ═════════════════════════════════════════════════════════════════════════════

import { pick, rint, clamp } from './util.js';
import { CHAT_LINES, GOODS, GOOD_BY_ID } from './content.js';

const TRAITS = [
  { id: 'shark', greed: 0.9, bluff: 0.85, caution: 0.25, chaos: 0.7, chat: 0.5 },
  { id: 'vault', greed: 0.4, bluff: 0.2, caution: 0.9, chaos: 0.1, chat: 0.25 },
  { id: 'gossip', greed: 0.55, bluff: 0.6, caution: 0.4, chaos: 0.85, chat: 0.95 },
  { id: 'auditor', greed: 0.35, bluff: 0.15, caution: 0.75, chaos: 0.2, chat: 0.4 },
  { id: 'gambler', greed: 0.85, bluff: 0.7, caution: 0.1, chaos: 0.95, chat: 0.6 },
  { id: 'sweetheart', greed: 0.3, bluff: 0.3, caution: 0.6, chaos: 0.3, chat: 0.8 },
];

function traitOf(pid) {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) | 0;
  return TRAITS[Math.abs(h) % TRAITS.length];
}

const nameOf = (room, pid) => room.players.get(pid)?.name || 'someone';

function estimateSide(R, room, side, pid) {
  if (!side) return 0;
  let v = 0;
  if (side.kind === 'chips') return side.v || 0;
  if (side.kind === 'item' || side.kind === 'both') {
    if (side.chips) v += side.chips;
    const gid = side.gid || side.uid;
    const g = GOOD_BY_ID[gid];
    if (g) v += g.v * 0.82; // discount: could be a forgery, we do not know
  }
  void R; void pid;
  return v;
}

export function botThink(room, R, pid, state) {
  const p = room.players.get(pid);
  if (!p) return null;
  const T = traitOf(pid);
  const s = R.sec[pid];
  if (!s) return null;
  const others = room.activePids().filter((x) => x !== pid);
  const r = room.rng;

  // ── reply to pending deals aimed at me (highest priority) ─────────────────
  const open = R.offers.filter((o) => o.to === pid && o.status === 'open');
  if (open.length && r() < 0.75) {
    const o = open[0];
    const got = estimateSide(R, room, o.give, pid);
    const ask = estimateSide(R, room, o.want, pid);
    const honest = R.sec[o.from]?.role !== 'trickster'; // they *can* see nobody's role; guard only
    void honest;
    const accept = got >= ask * (0.52 + T.caution * 0.55);
    return { t: 'offerResp', id: o.id, accept };
  }

  // ── use my live abilities ──────────────────────────────────────────────────
  const legal = room.actionsFor(pid);
  const wantAct = legal.find((a) => a.id === 'grab');
  if (wantAct && R.def.id === 'mg_vanish') {
    const pot = R.currentPot ?? R.pot;
    if (pot < R.pot * (0.45 + T.caution * 0.4) || r() < 0.18) return { t: 'act', id: 'grab', p: {} };
    return null;
  }
  if (R.def.id === 'parcel' && R.holder === pid && r() < 0.85) {
    // hot potato: pass to whoever seems calmest
    const t = pick(r, others);
    if (t) return { t: 'act', id: 'pass', p: { target: t } };
  }
  for (const a of legal) {
    if (!a.targets && r() < 0.35) return { t: 'act', id: a.id, p: {} };
    if (a.targets === 'others' || a.targets === 'one') {
      const t = pick(r, others);
      if (!t) continue;
      const chance = a.id === 'flag' ? 0.45 + T.caution * 0.3 : a.id === 'insure' ? 0.55 : a.id === 'salt' ? 0.75 * T.bluff + 0.2 : a.id === 'swap' ? 0.8 : 0.4;
      if (r() < chance) return { t: 'act', id: a.id, p: { target: t } };
    } else if (a.targets === 'cases' || a.targets === 'lots') {
      const n = a.targets === 'cases' ? (R.pub.cases?.length || 3) : (R.pub.lots?.length || 3);
      const cases = [rint(r, 0, n - 1), rint(r, 0, n - 1)];
      const chance = a.id === 'swap' ? 0.8 : a.id === 'relabel' ? 0.7 : 0.5;
      if (r() < chance) return { t: 'act', id: a.id, p: { cases, lots: cases, target: pick(r, others) } };
    } else if (a.targets === 'none' && r() < 0.5) return { t: 'act', id: a.id, p: {} };
  }

  // ── make a trade proposal (rounds that allow deals) ────────────────────────
  if (R.def.offers && state === 'TALK' && (s.offerCount || 0) < 2 && others.length && r() < 0.3 + T.chaos * 0.3) {
    const to = pick(r, others);
    const mine = (R.inv[pid] || []);
    const theirs = (R.inv[to] || []);
    // prefer to offload a counterfeit — that is what a bot with a mouth would do
    const fakeIdx = mine.findIndex((it) => it.fake);
    const giveItem = fakeIdx >= 0 && r() < 0.75 ? mine[fakeIdx].uid : (mine.length ? pick(r, mine).uid : null);
    const wantItem = theirs.length && r() < 0.6 ? pick(r, theirs).uid : null;
    const chips = wantItem ? rint(r, 40, 260) : 0;
    if (!giveItem && !chips) return null;
    return {
      t: 'offer', to,
      o: {
        to,
        giveItem: giveItem || undefined, wantItem: wantItem || undefined,
        giveChips: giveItem ? 0 : chips, wantChips: wantItem ? 0 : chips,
        note: pick(r, [
          'one-time thing, be quick',
          'I checked twice, it is good',
          'you win more here than me, look',
          'take it before I think',
          'no pressure, huge value',
          'my granny wanted this one',
        ]),
      },
    };
  }

  // ── table talk ─────────────────────────────────────────────────────────────
  if (state === 'TALK' && room.settings.chat && r() < 0.12 + T.chat * 0.12 && room.now - p.chatAt > 2500) {
    const pool = CHAT_LINES.filter((l) => l.g === (T.chat > 0.8 ? 'heat' : r() < 0.4 ? 'doubt' : 'deal'));
    const line = (pool.length ? pick(r, pool) : pick(r, CHAT_LINES)).l;
    return { t: 'chat', text: line };
  }
  if (state === 'TALK' && r() < 0.06) return { t: 'emote', id: rint(r, 0, 11) };

  // ── the reckoning: commit, accuse, push, void ─────────────────────────────
  if (state === 'SUBMIT' || state === 'TALK') {
    if (s.commit == null && state === 'SUBMIT') {
      const opts = R.def.optionsFor?.(room.roundCtx, pid) || [];
      if (opts.length) {
        let chosen;
        if (R.def.id === 'cases' || R.def.id === 'mg_suitcase' || R.def.id === 'mg_cards' || R.def.id === 'mg_button') {
          chosen = opts[Math.abs(rint(r, 0, opts.length - 1))];
          if (s.peeked != null && R.pub.cases) {
            // detective who peeked: take the best case it knows about
            const best = R.pub.cases.slice().sort((a, b) => (b.id === R.sec[pid].peekedId ? 1 : 0) - (a.id === R.sec[pid].peekedId ? 1 : 0))[0];
            if (best) chosen = opts.find((o) => o.id === 'c' + best.id) || chosen;
          }
        } else if (R.def.id === 'backstab') {
          const greedy = r() < T.greed * 0.7 + 0.2;
          const want = greedy ? (opts.some((o2) => o2.id === 'frame') ? 'frame' : 'grab') : 'split';
          chosen = opts.find((o) => o.id === want);
        } else if (R.def.id === 'vouch') {
          chosen = opts.find((o) => o.id === (r() < T.greed * 0.65 + T.bluff * 0.25 ? 'bolt' : 'repay'));
        } else if (R.def.id === 'auction') {
          const cap = clamp(p.chips * (0.25 + T.greed * 0.4), 0, 460);
          chosen = opts.slice().reverse().find((o) => {
            const m = /Bid ([\d,]+)/.exec(o.label);
            return m && Number(m[1].replace(/,/g, '')) <= cap;
          }) || opts[0];
        } else if (R.def.id === 'mg_vault') {
          const spin = s.spin || 1;
          const n = clamp(3 + rint(r, 0, 2) + (spin > 1 ? 2 : 0) + Math.round(T.greed * 3), 1, 9);
          chosen = opts.find((o) => o.id === 'd' + n) || pick(r, opts);
        } else if (R.def.id === 'mg_fall') {
          const want2 = R.leaper === pid
            ? (r() < 0.55 + T.greed * 0.3 ? 'leap' : 'chicken')
            : (r() < 0.62 + (1 - T.caution) * 0.2 ? 'catch' : 'look');
          chosen = opts.find((o) => o.id === want2) || pick(r, opts);
        } else {
          const safe = opts.find((o) => o.style === 'safe');
          const danger = opts.find((o) => o.style === 'danger');
          chosen = (r() < T.caution * 0.6 && safe) ? safe : (danger && r() < T.greed ? danger : pick(r, opts));
        }
        if (chosen) return { t: 'commit', choice: chosen.id };
      }
    }
    // accuse someone who looks busy
    if (R.def.accuse && state === 'SUBMIT' && s.accuse == null && !room.round.accuses[pid] && r() < 0.5 + T.chaos * 0.25) {
      const tells = room.round.pub?.tells || {};
      const sus = others.find((o) => (tells[o] || []).some((t) => /busy|fidget|many/.test(t)));
      const target = sus && r() < 0.6 + (1 - T.caution) * 0.3 ? sus : pick(r, others);
      return { t: 'accuse', target };
    }
    // push your luck
    if (R.def.push && !s.push && r() < 0.25 + T.greed * 0.5) return { t: 'push', on: true };
    // loophole an accepted deal
    if (R.def.loophole && state === 'SUBMIT') {
      const mine = R.offers.filter((o) => o.from === pid && o.status === 'accepted');
      const good = mine.find((o) => estimateSide(R, room, o.want, pid) > estimateSide(R, room, o.give, pid) * 1.2);
      if (good && r() < (s.role === 'trickster' ? 0.8 : 0.35 + T.bluff * 0.4)) return { t: 'act', id: 'voidOffer', p: { id: good.id } };
    }
  }
  return null;
}
