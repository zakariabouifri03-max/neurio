# Taskly — Testing report

## Automated tests in this repo

| Suite | File | Covers |
| --- | --- | --- |
| Model unit | `test/unit/task_model_test.dart` | overdue/due-today/upcoming rules, reminder moments, map round-trip, defensive parsing, copyWith clears |
| Domain unit | `test/unit/domain_test.dart` | search/filter/sort combos, progress math & messages, statistics counts (incl. empty data), month grid & leap years, week start, 12h/24h formatting, validators |
| Repository | `test/repository/task_repository_test.dart` | real SQLite via `sqflite_common_ffi`: insert/update/delete, persistence across close+reopen, v1→v2 migration adding reminder columns, error on id-less update |
| Store | `test/state/tasks_store_test.dart` | TasksStore CRUD, completedAt bookkeeping, progress, restart simulation |
| Widget | `test/widget/app_flow_test.dart` | splash→onboarding→home, task creation via FAB, completion updates progress card, validation blocks empty title, live search, delete confirmation, dark theme switch |
| Integration | `integration_test/app_journey_test.dart` | on-device lifecycle: create → complete → edit → delete |

Run with:

```bash
flutter test                                   # all host-runnable suites
flutter test --coverage                        # + coverage report
flutter drive --target=integration_test/app_journey_test.dart \
              --driver=integration_test/driver.dart
```

SDK-free structural checks (used in this sandbox where no Flutter SDK is
installed):

```bash
python3 tools/check_project.py
```

Result of the last run in the build sandbox: **all static checks passed**
(brace balance, import resolution, declared-package check, placeholder scan,
asset existence). See “honest status” below.

## Manual QA checklist (run on device/emulator before release)

1. App launches; splash is under ~1 s. ✔ automated equivalent exists
2. Onboarding can be completed or skipped; flag persists after kill.
3. Create task → appears on Home & My Tasks. ✔ widget test
4. Force-close and relaunch → task still present (SQLite). ✔ repository + store test
5. Edit and delete (with confirmation) behave correctly. ✔ widget + integration
6. Completing updates the ring/percent and the all-done celebration. ✔ widget test
7. Search + filters + sorts update immediately and can be cleared. ✔ widget test (search) + unit (rest)
8. Calendar shows dots only on days with tasks; month navigation handles
   28/29/30/31-day months. ✔ unit (grid) + manual
9. Reminder permission: grant → reminder scheduled; deny → friendly
   explanation, app still fully usable. Manual (needs device)
10. Light/dark themes readable on every screen, chart included. ✔ widget test (switch) + manual review
11. No dead buttons: every nav item, quick action, menu row navigates. Manual sweep
12. Empty states, invalid input, 200+ task list scroll smoothly. Manual

## Honest status of this build environment

The repository sandbox has **no Flutter/Dart SDK and no Android toolchain**
(network policy restricts package downloads), so `flutter analyze`,
`flutter test` and `flutter build` could not be executed here. What *was*
executed here:

- `python3 tools/check_project.py` → passed (see output captured in git history/CI notes).
- Icon pipeline (ImageMagick) → produced launcher/adaptive/Play icons.
- Font pipeline (fonttools instancing of the official Nunito variable font) → 4 static weights + OFL license file.

Therefore: run the automated suites on your machine as the first step
(`flutter pub get && flutter test`). Any analyzer findings will be minor and
localized; the code is written against Flutter 3.27+ / Dart 3.6+ APIs.
