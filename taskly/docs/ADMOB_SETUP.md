# Optional monetization (AdMob) — disabled by default

Taskly ships with **no ads and no ad SDK**. This document is the safe path if
you later decide to add a single banner. Until every step below is done, the
app must stay ad-free (and the Play “Contains ads” answer stays **No**).

## Rules baked into this plan

- One small banner, on a secondary screen only (Stats), anchored to the
  bottom above the safe area.
- Never on Home, never in the task editor, never over lists or buttons.
- No interstitials/rewarded ads at all (they would interrupt task flows).
- Test ad units during development; real units only after AdMob account
  approval and a privacy-policy update.
- EEA/UK users: enable the Google UMP consent flow before loading ads.

## Steps (when you're ready)

1. Create an AdMob account and an Android app entry for `com.taskly.app`.
2. Add the dependency: `google_mobile_ads: ^5.0.0` (verify current version).
3. AndroidManifest: add
   `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID"
   android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>` (your real app ID).
4. Create `lib/services/ad_service.dart` exposing a single
   `BannerAd` loader guarded by a compile-time flag
   `const adsEnabled = bool.fromEnvironment('TASKLY_ADS');` so debug builds
   and ad-free releases literally cannot show ads.
5. Show it only at the bottom of `StatsScreen`, inside a `SafeArea`,
   `kBannerHeight` tall, with 12 dp of visual separation from content.
6. Use test unit `ca-app-pub-3940256099942544/6300978111` until release.
7. Update `docs/PRIVACY_POLICY.md` (AdMob SDK, consent, data practices),
   the in-app policy copy, and Play Data safety (advertising SDK present,
   consent flow). Then set “Contains ads: Yes” in Play Console.
8. If you also want a paid “remove ads” option, implement Play Billing
   (`in_app_purchase`) with a real product ID — never a button that only
   looks like it works.

## Why it's off today

Without an AdMob account, consent flow and updated disclosures, shipping ads
would violate Play policy and this project's privacy promises. Leaving the
feature out is the correct, honest default.
