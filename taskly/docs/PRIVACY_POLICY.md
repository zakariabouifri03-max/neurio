# Taskly Privacy Policy

*Last updated: October 9, 2026 · Applies to Taskly for Android (com.taskly.app)*

This policy also ships inside the app (Profile → Privacy & app info). Keep
both copies identical, and publish this text at your hosted URL when you
create the Play listing.

## 1. What we collect

**Nothing leaves your device.** Taskly has no backend, no analytics SDK, no
crash-reporting SDK and no advertising SDK. We do not collect, transmit, sell
or share any personal data.

## 2. What stays on your device

- **Tasks:** titles, optional notes, due dates/times, priority, category,
  completion state and timestamps, stored in a SQLite database inside
  Taskly's private app storage.
- **Reminders:** whether a reminder is on and how early it should fire.
- **Preferences:** theme choice, preferred display name, week-start day,
  date format, onboarding-seen flag (SharedPreferences).

Uninstalling Taskly permanently deletes all of the above.

## 3. Permissions and why

| Permission | Purpose | Required? |
| --- | --- | --- |
| `POST_NOTIFICATIONS` (Android 13+) | Deliver task reminders you created | Only if you enable reminders |
| `SCHEDULE_EXACT_ALARM` | Fire reminders at the exact time you chose; falls back to battery-friendly scheduling if unavailable | Only for exact reminders |
| `RECEIVE_BOOT_COMPLETED` | Re-arm pending reminders after a device restart | Only if reminders exist |

No other permissions are requested. Denying notifications never blocks core
task management.

## 4. Third-party SDKs

Flutter framework; `sqflite`, `shared_preferences`, `provider`, `intl`,
`timezone`, `package_info_plus`, `flutter_local_notifications`. All operate
locally; none transmit task content. The Nunito font is bundled under the
SIL Open Font License 1.1.

## 5. Children

Taskly is a general-audience productivity app. It does not knowingly collect
data from anyone, including children.

## 6. Security

Data is stored in app-private storage sandboxed by Android. We cannot read
it remotely because no network path exists.

## 7. Changes

If data practices ever change, this policy and the Play Data safety section
will be updated **before** the change ships, and new permissions will be
requested explicitly at runtime.

## 8. Contact

Use the developer contact email published on the Taskly Play Store listing.
