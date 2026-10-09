# Taskly 💜

A cute, cozy, offline-first task planner for Android, built with Flutter.

Taskly helps students, professionals and busy humans organize their day:
create tasks with due dates, times, priorities, categories and gentle
reminders; explore them on a pastel calendar; and watch real progress grow —
all stored privately on the device. No account. No ads. No tracking.

## Feature summary

| Area | What's implemented |
| --- | --- |
| Onboarding | 3 skippable pages, persisted "seen" flag |
| Home dashboard | Time-aware greeting (+preferred name), real daily progress ring, today's tasks, quick actions, empty & all-done celebration states |
| Tasks | Full CRUD, complete/reopen, search (title + description), status filters, category & priority filters, 4 sort modes |
| Categories | Personal, Work, Study, Health, Shopping, Other (pastel colors + icons) |
| Priorities | Low / Medium / High with icon + label (never color alone) |
| Calendar | Month grid (leap-year safe, week-start aware), per-day task dots, day list, add-for-day |
| Reminders | Real local notifications via `flutter_local_notifications`, permission flow, exact-alarm fallback, reschedule/cancel on edit/delete, reboot-safe via plugin boot receiver |
| Statistics | Completed today/week/all-time, weekly bar chart, category breakdown, honest week-over-week trend |
| Settings | Light / Dark / System theme, preferred name, week start, date format, notification preferences, version, licenses, in-app privacy policy |
| Persistence | SQLite (`sqflite`) for tasks, `shared_preferences` for settings |
| Design system | Nunito (bundled, OFL), pastel palette, rounded cards, soft shadows, sparkle micro-interactions, reduced-motion aware |

## Project layout

```
taskly/
├── lib/
│   ├── main.dart                  # bootstrap: db, prefs, notifications, providers
│   ├── app.dart                   # MaterialApp, themes, splash→onboarding→shell gate
│   ├── core/
│   │   ├── theme/                 # palette + light/dark ThemeData + typography
│   │   └── utils/                 # date helpers, validators, motion tokens
│   ├── data/
│   │   ├── local/                 # DatabaseHelper (schema+migrations), TaskDao, PreferencesStore
│   │   └── models/                # Task, TaskCategory, TaskPriority
│   ├── domain/                    # TaskQuery (search/filter/sort), DailyProgress, TaskStatistics
│   ├── services/                  # ReminderScheduler (real + no-op implementations)
│   ├── state/                     # TasksStore, SettingsStore (ChangeNotifier)
│   ├── widgets/                   # reusable UI kit + vector illustrations + charts
│   └── screens/                   # splash, onboarding, shell, home, tasks, editor,
│                                  # details, calendar, stats, profile, notifications, info
├── test/                          # unit, repository (SQLite FFI) and widget tests
├── integration_test/              # on-device critical journey
├── android/                       # Android host project (API 36, adaptive icon)
├── assets/
│   ├── fonts/                     # Nunito static instances + OFL license
│   └── branding/                  # icon source, Play Store icon
└── docs/                          # release, Play Store, privacy, testing docs
```

## Run it

Requirements: Flutter **3.27+** (stable), Android SDK with **API 36**, JDK 17.

```bash
cd taskly
flutter pub get
flutter run                 # debug on a connected device/emulator
```

The Gradle wrapper is committed, so no extra setup is needed. If you ever
need to regenerate it: `flutter create --platforms=android --project-name taskly .`
(existing files are never overwritten).

## Test it

```bash
flutter test                                  # unit + widget + repository tests
flutter test test/unit                        # fast logic tests only
flutter drive --target=integration_test/app_journey_test.dart \
              --driver=integration_test/driver.dart   # optional on-device journey
```

`tools/check_project.py` runs SDK-free structural checks (brace balance,
broken imports, undeclared packages, placeholder markers, asset existence).

## Release it

See [`docs/RELEASE.md`](docs/RELEASE.md) for signing + `.aab` build steps and
[`docs/PLAY_STORE_LISTING.md`](docs/PLAY_STORE_LISTING.md) for the store
listing, data-safety and content-rating guidance.

## Privacy stance

Everything stays on device. The only permissions requested are
`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED`,
all for user-created reminders. Details in
[`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md).

## Monetization

Ships **without ads**. If you later want an AdMob banner, follow
[`docs/ADMOB_SETUP.md`](docs/ADMOB_SETUP.md) — it explains the safe placement
rules and keeps ads off until real ad-unit IDs are configured.
