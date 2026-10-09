# Taskly — Testing & QA

## Automated tests

Run everything with:

```bash
flutter test
```

| Area | File | Covers |
| --- | --- | --- |
| Task model | `test/models/task_model_test.dart` | Map round-trip, copyWith sentinels, overdue logic, safe enum parsing |
| Query engine | `test/models/task_query_test.dart` | All filters, search (title + notes), attribute filters, all four sorts, deterministic tie-breaks |
| Date engine | `test/logic/date_helper_test.dart` | Formats per preference, 12-hour times, leap years (incl. 1900/2000 rules), month clamping, week starts Sat/Sun/Mon, calendar grid alignment |
| Statistics | `test/logic/stats_calculator_test.dart` | Honest daily progress, weekly buckets per week start, category counts, week-over-week trend, motivational lines (incl. blank-canvas case) |
| Persistence | `test/data/task_repository_test.dart` | Real SQLite: CRUD, restart survival, completion timestamps, v1→v2 schema migration with backfill |
| Controller | `test/controllers/task_controller_test.dart` | Add/edit/delete/complete against a real DB, reminder sync calls, up-next ordering, friendly storage-error state |
| Settings | `test/controllers/settings_controller_test.dart` | Defaults, theme/name/week/date persistence across restarts, greeting clock, celebration dedup |
| Home | `test/widgets/home_page_test.dart` | Blank-canvas state, named greeting, real progress numbers, checkbox → stats update, editor navigation, all-done card, error + retry |
| Editor | `test/widgets/task_editor_test.dart` | Required-title validation, save-and-pop, double-tap guard, edit prefill/save, priority & category selection |
| Tasks | `test/widgets/tasks_page_test.dart` | Empty state, live search, filter chips with counts, completed filter, clear-filters escape hatch |
| Calendar | `test/widgets/calendar_page_test.dart` | Month rendering, leap February, tasks under correct dates, month nav, jump-to-today, add-for-day prefill |
| Shell | `test/widgets/main_shell_test.dart` | Four destinations switch correctly |
| Theme | `test/theme/app_theme_test.dart` | Light/dark palette tokens, non-black dark surfaces, Nunito wiring, WCAG AA+ text contrast |

CI runs `dart format` check, `flutter analyze --fatal-infos`, `flutter test`,
then builds the release App Bundle and APK — see
`.github/workflows/ci.yml`.

## Manual QA checklist (per release)

1. **Cold start** — splash → onboarding (first run) or Home (afterwards);
   relaunch after onboarding skips straight to Home.
2. **Onboarding** — Skip works; three pages; Get Started on the last page.
3. **Create** — Home → Add task; empty title blocked with friendly message;
   save appears instantly on Home with correct counts.
4. **Persistence** — create, force-kill the app, reopen: task still there
   (SQLite). Reboot the device with a reminder set: reminder still fires.
5. **Edit/delete** — edit pre-fills; delete asks; cancelling keeps the task.
6. **Completion** — checking updates Home ring/stat cards truthfully; the
   all-done celebration shows once per day only when *everything* due today
   is finished.
7. **Search & filters** — chip counts update as data changes; clearing works
   from both the ✕ and the sheet.
8. **Calendar** — dots match tasks; switching months keeps the selection
   sane; leap February 2028 renders 29 days.
9. **Reminders** — first enable requests POST_NOTIFICATIONS with an
   explanation; denial shows an honest notice + system-settings deep link;
   exact-alarm fallback text appears when the OS restricts timing.
10. **Themes** — toggle light/dark/system; every screen, dialog, sheet and
    chart stays readable (automated contrast test guards body text).
11. **Accessibility** — TalkBack reads task rows fully (title, state,
    priority, category, due); "Remove animations" disables sparkles;
    all targets ≥ 48dp.
12. **Edge cases** — empty database, 500+ tasks scroll smoothly, airplane
    mode (fully offline), permission denial, timezone change (dates stay
    put), invalid input (200/2000 char caps).
