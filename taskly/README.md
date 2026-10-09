# Taskly 🌸

**Taskly** is a cute, cozy, offline-first to-do and daily-planning app for
Android, built with Flutter. Organize tasks, set real reminders, plan with a
calendar, and celebrate every little win — no account required, and your data
never leaves your device.

![Platform](https://img.shields.io/badge/platform-Android-3DDC84)
![Flutter](https://img.shields.io/badge/Flutter-stable-02569B)
![Tests](https://img.shields.io/badge/tests-flutter__test-7C6BC8)

---

## ✨ Features

- **Home dashboard** — friendly greeting, honest daily progress ring computed
  from real data, quick actions, today's up-next list, and an all-done
  celebration (once per day, when you actually finish everything).
- **Full task management** — create, edit, delete (with confirmation),
  complete/reopen; title, notes, date, optional time, priority
  (Low/Medium/High, always labeled + iconed), and six cute categories.
- **Search, filters & sorting** — instant search across titles and notes,
  filters (All/Today/Upcoming/Overdue/Completed, category, priority), and
  sorting (due date, created, priority, A→Z).
- **Calendar** — pastel month grid with per-day task dots, a real task list
  for the selected day, add-for-this-day, and correct handling of month
  lengths, leap years and week-start preferences.
- **Genuine local reminders** — scheduled with
  [flutter_local_notifications](https://pub.dev/packages/flutter_local_notifications),
  requested at the right moment, rescheduled after reboot by the plugin,
  cancelled on delete/complete, and gracefully degraded (inexact alarms,
  diagnostics + deep link to system settings) when Android restricts timing.
- **Statistics** — completed today / this week / all-time, a weekly bar
  chart, category breakdown and an honest week-over-week trend. Empty data
  is handled gently; no fake numbers ever.
- **Settings** — light/dark/system theme, preferred name, week start,
  date format, reminder master switch + live diagnostics, app version,
  privacy policy, open-source licenses, and a double-confirmed
  "delete all tasks".
- **Cute micro-interactions** — sparkle bursts on completion, animated
  progress rings, gentle press feedback and soft screen transitions — all
  short, and all disabled automatically when the system requests reduced
  motion.

## 🎨 Design system

| Token | Light | Dark |
| --- | --- | --- |
| Background | `#FFF9F2` cream | `#211E2E` deep plum |
| Cards | `#FFFFFF` | `#2B2740` |
| Primary | `#C9B8FF` lavender / `#7C6BC8` deep | muted lavender `#B7A6F2` |
| Text | `#353347` | `#F2EFF7` |
| Accent pastels | pink `#FFD6E7`, blue `#CDEBFF`, mint `#CFF5DF` | tinted at low alpha |

Typography is **Nunito** (SIL OFL, bundled static instances 400/600/700/800).
Corner radii 14/18/26, soft shadows, generous spacing. Text contrast is
covered by a dedicated theme test.

## 🚀 Build & run

Requirements: **Flutter (stable)** and the Android toolchain (`Java 17`,
Android SDK 37). The project also runs on any other Flutter-supported
platform for development, but ships Android-first.

```bash
cd taskly
flutter pub get
flutter run                # debug on a device/emulator
flutter analyze            # static analysis (must be clean)
flutter test               # unit + widget tests
```

### Tests

The suite runs real SQLite (via `sqflite_common_ffi`) and mock
SharedPreferences, so persistence and controller logic are exercised for
real on the host. See `docs/TESTING.md` for the QA matrix that maps the
manual checklist to automated tests.

### Release builds

```bash
flutter build appbundle --release   # Google Play: app-release.aab
flutter build apk --release         # side-loading: app-release.apk
```

Output lives under `build/app/outputs/`. By default the release build is
signed with the debug key so it runs out of the box — **create and configure
a real upload keystore before publishing** (step-by-step in
`docs/PLAYBOOK_GOOGLE_PLAY.md`).

## 🗂 Project structure

```
taskly/
├── android/                 # Android host project (Gradle KTS, AGP 9.1)
├── assets/fonts/            # Nunito static instances + OFL license
├── docs/                    # Google Play playbook, privacy policy, testing
├── lib/
│   ├── app/                 # Root widget, shell, routes
│   ├── controllers/         # ChangeNotifier state (tasks, settings)
│   ├── core/
│   │   ├── theme/           # Colors + light/dark ThemeData
│   │   ├── utils/           # Date helpers, week math, formats
│   │   └── widgets/         # Rings, sparkles, empty states, pressables
│   ├── data/                # SQLite repository + SharedPreferences
│   ├── logic/               # Pure query/sort/filter + statistics engines
│   ├── models/              # Task, category, priority, query (pure Dart)
│   ├── notifications/       # Plugin wrapper + ReminderScheduler abstraction
│   ├── pages/               # Splash, onboarding, home, tasks, editor,
│   │                        # detail, calendar, stats, profile, privacy
│   └── widgets/             # Shared task tile
└── test/                    # Unit, repository, controller & widget tests
```

**Architecture in one line:** UI (pages/widgets) → controllers
(ChangeNotifier) → pure logic/models → repositories (SQLite/SharedPreferences);
notifications live behind a `ReminderScheduler` interface so task logic is
testable without platform channels.

## 🔒 Privacy

No account. No analytics. No ads. No network calls at runtime — tasks stay
in an app-private SQLite database. The in-app privacy policy
(`docs/PRIVACY_POLICY.md`) documents permissions (notifications, optional
exact alarms) and matches the actual implementation.

## 📦 Monetization status

Deliberately **disabled**. AdMob is not wired in because it cannot be done
honestly without real ad-unit IDs, consent handling and store review. The
Google Play playbook documents the exact steps to add a compliant banner later
without touching task flows.

## 🧾 License

Code: MIT (see `LICENSE`). Bundled font: Nunito under the SIL Open Font
License (`assets/fonts/OFL.txt`).
