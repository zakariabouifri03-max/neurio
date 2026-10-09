# Taskly — Google Play listing kit

All copy below matches the **implemented** feature set only.

## Short description (≤80 chars)

> Plan your day, organize your tasks, and celebrate every little win.

## Full description

> Meet Taskly, your cute and cozy everyday planner.
>
> Make your busy days feel simpler with a beautiful space to organize tasks,
> plan upcoming activities, and keep track of your progress.
>
> ✨ PLAN YOUR DAY
> Create tasks with due dates, optional times, priorities and categories.
>
> 🌸 STAY ORGANIZED
> Keep personal, work, study, health and shopping tasks in one place, with
> search, filters and sorting that keep everything findable.
>
> 📅 SEE WHAT'S AHEAD
> A soft pastel calendar shows what each day holds, with gentle dots on
> days that have plans.
>
> 🔔 REMEMBER WHAT MATTERS
> Set a reminder per task. Taskly uses local notifications only — your data
> never leaves your phone.
>
> 💜 CELEBRATE YOUR PROGRESS
> A daily progress ring, weekly chart and category breakdown are computed
> from your real completed tasks.
>
> 🎨 MAKE IT YOURS
> Light and dark themes, your preferred name in the greeting, week-start and
> date-format preferences.
>
> 🔒 PRIVATE BY DESIGN
> No account, no ads, no tracking. Tasks live in a local database on your
> device.
>
> Small steps can make a big difference. Open Taskly, make a plan, and take
> your day one task at a time.

## Feature bullets (for marketing / screenshots captions)

- Offline-first: everything works without internet or an account
- Cute pastel design with light & dark themes
- Due dates, times, priorities (Low/Medium/High) and 6 categories
- Reminders with permission-aware, battery-friendly scheduling
- Month calendar with per-day task dots and day list
- Search, 6 status filters, category/priority filters, 4 sort orders
- Honest statistics: daily ring, weekly bars, category mix, week trend
- Confirmation dialogs before anything destructive
- Respects Android reduced-motion settings

## Store assets checklist

| Asset | Spec | Source in repo |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | `assets/branding/play_store_icon_512.png` |
| Adaptive icon | background `#C4B2FE` + foreground layers | `android/app/src/main/res/mipmap-*`, `drawable-*` |
| Feature graphic | 1024×500 PNG/JPG | create: lavender `#C9B8FF` background, app motif centered, wordmark “Taskly” in Nunito ExtraBold; keep text inside central 80% safe zone |
| Screenshots | phone: 2–8, min 320px, max 3840px; use 1080×2400 or device shots | capture: Home (empty), Home (with progress), New task, My Tasks filtered, Calendar month, Stats, Dark-mode Home, Notification settings |
| Hi-res icon alt | same 512 PNG | as above |
| Promo video | optional | — |

Screenshot capture tip: `flutter drive` or manual device screenshots with
demo data, then crop status bar consistently. Show real (sample) tasks you
created, and label the shot set as illustrative.

## Data safety form (answers matching the implementation)

- **Data collected:** None. (No analytics, no ads SDK, no backend.)
- **Data shared:** None.
- **Data types stored locally:** task title/notes/dates, reminder settings,
  app preferences (theme, display name, formats). Mark as *not collected*
  because nothing is transmitted; if the form forces a category for local
  storage, choose “App functionality” → “Not collected / stored on device only”.
- **Encryption in transit:** N/A (no network calls).
- **Deletion:** users can delete tasks in-app; uninstall removes all data.

## Content rating

Questionnaire answers: no violence, no sexual content, no user-generated
content, no in-app purchases, no ads → expected rating **Everyone / PEGI 3**.

## Target audience

General audience; safe for 13+. No features directed solely at children;
no social interaction or UGC. If you later add anything child-directed,
revisit the Families policy.

## Ads declaration

**Contains ads: No.** (This build includes no ad SDK. See `ADMOB_SETUP.md`
before ever changing that — the declaration must be updated the moment ads
ship.)

## In-app products / subscriptions

None. Do not add a “premium” toggle without a real billing implementation
(`google_mobile_ads` removal flow or Play Billing); the current build
intentionally ships no paid features.

## Category & tags

Productivity (primary), Lifestyle (secondary). Tags: planner, to-do,
reminder, calendar, habits.
