// ── Affiliate / Referral system ──────────────────────────────────────────────
// Each player gets a unique referral code. When someone enters a referral code
// they get a one-time bonus; the referring player also earns rewards.
//
// Because this is a localStorage-only game (no backend), referral tracking is
// local-first: rewards are granted when a code is entered, and "referred by"
// is recorded so the player can see who invited them. Cross-device attribution
// would require a server — this layer is designed to slot in once one exists.

export const AFFILIATE_KEY = 'bashbaqi_affiliate_v1';

// One-time rewards when a NEW player enters a referral code
export const REFERRAL_BONUS = {
  coins: 200,   // bonus coins for the invitee
  gems: 3,      // bonus gems for the invitee
};

// Reward for the REFERRER (the owner of the code) when someone uses it
export const REFERRER_REWARD = {
  coins: 150,
  gems: 2,
};

// How many chars of the code are shown in the share preview (rest masked)
const CODE_MASK_AFTER = 4;

// ── Generate a unique referral code for a fresh save ────────────────────────
export function generateCode(save) {
  // Derive a deterministic-but-unique-ish code from save contents + timestamp.
  // We salt with a random component stored alongside so siblings don't clash.
  const salt = Math.random().toString(36).slice(2, 8);
  const raw = save.coins + ':' + save.gems + ':' + save.trophies + ':' + salt;
  const hash = btoa(raw).replace(/[+/=]/g, '').slice(0, 8).toUpperCase();
  return hash || 'BUGGY' + Math.floor(Math.random() * 9999);
}

// ── Does this save already have an affiliate code? ───────────────────────────
export function hasCode(save) {
  return !!(save.affiliateCode && typeof save.affiliateCode === 'string' && save.affiliateCode.length >= 6);
}

// ── Give the player a referral code (call once, e.g. on first garage open) ───
export function ensureCode(game) {
  const s = game.save;
  if (hasCode(s)) return s.affiliateCode;
  const code = generateCode(s);
  s.affiliateCode = code;
  s.affiliateUsedCode = s.affiliateUsedCode || null;   // keep whoever invited them
  s.affiliateReferrals = s.affiliateReferrals || [];   // codes that credited this player
  s.affiliateEarnings = s.affiliateEarnings || 0;      // gems earned from referrals
  s.affiliateEarnedCoins = s.affiliateEarnedCoins || 0;
  game.persist();
  return code;
}

// ── Try to apply a referral code entered by the current player ───────────────
// Returns { ok, message, referredBy } — call this when the player submits a code.
export function applyCode(game, inputCode) {
  const s = game.save;
  const code = (inputCode || '').trim().toUpperCase();

  if (!code) return { ok: false, message: '🔲 What code? Check the text box.' };
  if (code.length < 6) return { ok: false, message: '🔲 That code looks too short — copy the full one.' };

  // Can't refer yourself
  if (hasCode(s) && code === s.affiliateCode) {
    return { ok: false, message: '😅 That\'s your own code! Grab a friend\'s instead.' };
  }

  // Can't use the same code twice
  if (s.affiliateUsedCode && s.affiliateUsedCode.toUpperCase() === code) {
    return { ok: false, message: '✅ You already used this code — no need to do it again!' };
  }

  // ── Grant the one-time bonus to the invitee ──────────────────────────────
  s.coins += REFERRAL_BONUS.coins;
  s.gems  += REFERRAL_BONUS.gems;
  s.affiliateUsedCode = code;

  // ── Credit the referrer (local tracking) ────────────────────────────────
  // We record that *someone* used this code. In a real backend the owner of
  // `code` would get their reward server-side; here we credit it to the local
  // save so the player can see their "referred" list grow.
  //
  // We also give the referrer's rewards to the local player IF the code matches
  // a code we've seen before (deterministic lookup is impossible without a DB,
  // so we simulate by awarding to whoever enters it — in practice the real
  // referrer's rewards would come from the server).
  //
  // For the local simulation: we track the code in this save's referral list
  // so that if THIS player is the referrer, their list shows the referral.
  s.affiliateReferrals.push({
    code: code,
    at: Date.now(),
  });
  s.affiliateEarnings += REFERRER_REWARD.gems;
  s.affiliateEarnedCoins += REFERRER_REWARD.coins;

  // Also give the referrer reward to THIS player (local simulation — the real
  // referrer would get this server-side; here we award it locally so the UI
  // shows earnings).
  s.coins += REFERRER_REWARD.coins;
  s.gems  += REFERRER_REWARD.gems;

  game.persist();
  game.refreshTopbar();

  return {
    ok: true,
    message: `🎉 Code accepted! +${REFERRAL_BONUS.coins} 🪙 +${REFERRAL_BONUS.gems} 💎 (and referral rewards)`,
    referredBy: code,
  };
}

// ── Format a code for sharing (partially masked) ─────────────────────────────
export function sharePreview(code) {
  if (!code || code.length < 6) return code || '';
  const head = code.slice(0, CODE_MASK_AFTER);
  const tail = code.slice(-2);
  const mask = '•'.repeat(Math.max(code.length - CODE_MASK_AFTER - 2, 1));
  return head + mask + tail;
}

// ── How many referrals has this player credited (local count) ────────────────
export function referralCount(save) {
  return Array.isArray(save.affiliateReferrals) ? save.affiliateReferrals.length : 0;
}

// ── Latest 5 referrals (for display) ──────────────────────────────────────────
export function recentReferrals(save) {
  const arr = Array.isArray(save.affiliateReferrals) ? save.affiliateReferrals : [];
  return arr.slice(-5).reverse();
}
