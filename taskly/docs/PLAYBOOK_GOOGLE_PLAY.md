# Taskly — Google Play Publishing Playbook

Everything below reflects the app **as implemented** in this repository.
Nothing here claims the app is published — these are the remaining steps
*you* run, in order, with the real account only you can hold.

---

## 1. Developer account

- Enroll at [play.google.com/console](https://play.google.com/console)
  (one-time $25 fee, identity verification required).
- Individual accounts must complete 12 testers / 14 days of closed testing
  before applying for production access (current policy — re-verify at
  release time).

## 2. App identity (already configured)

| Item | Value |
| --- | --- |
| App name | Taskly |
| Application ID | `com.taskly.app` |
| Version name / code | from `pubspec.yaml` → `1.0.0` / `1` |
| Min SDK | Flutter default (24, Android 7.0) |
| Target SDK | Flutter default (36) — **re-check Play's current target-API policy before each submission**; Flutter stable tracks it |
| Compile SDK | 37 (required by flutter_local_notifications 22.x) |

## 3. Signing (REQUIRED before release)

The checked-in Gradle config signs releases with the **debug key** so the
build works out of the box. For Play, use a real upload key:

```bash
keytool -genkey -v -keystore ~/taskly-upload.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias taskly-upload
```

Create `android/key.properties` (git-ignored) and wire it into
`android/app/build.gradle.kts`:

```properties
storePassword=***
keyPassword=***
keyAlias=taskly-upload
storeFile=/absolute/path/to/taskly-upload.jks
```

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties().apply {
    load(FileInputStream(rootProject.file("key.properties")))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

Never commit keystores or `key.properties`. Consider Play App Signing
(recommended): keep the upload key safe, Google manages the release key.

## 4. Build the App Bundle

```bash
flutter build appbundle --release
# → build/app/outputs/bundle/release/app-release.aab
```

The GitHub Actions workflow (`.github/workflows/ci.yml`) already produces
this artifact on every push.

## 5. Store listing (draft — matches implemented features)

- **App name:** Taskly
- **Short description (≤80 chars):**
  Plan your day, organize your tasks, and celebrate every little win.
- **Full description:**

> Meet Taskly, your cute and cozy everyday planner.
>
> Make your busy days feel simpler with a beautiful space to organize tasks,
> plan upcoming activities, and keep track of your progress.
>
> ✨ PLAN YOUR DAY — Create tasks, set due dates, and organize your priorities.
> 🌸 STAY ORGANIZED — Keep personal, work, study, and everyday tasks in one place.
> 📅 SEE WHAT'S AHEAD — Use the calendar to explore upcoming plans and scheduled tasks.
> 🔔 REMEMBER WHAT MATTERS — Set reminders for important tasks when notifications are enabled.
> 💜 CELEBRATE YOUR PROGRESS — Track completed tasks and enjoy seeing your daily achievements grow.
> 🎨 MAKE IT YOURS — Choose a soft, cute interface and switch between light and dark themes.
>
> Small steps can make a big difference. Open Taskly, make a plan, and take
> your day one task at a time.

- **Feature bullets for the "What's new" section (v1.0.0):**
  Tasks with dates, times, priorities and categories · smart search, filters
  and sorting · monthly calendar · daily/weekly statistics · gentle local
  reminders · light & dark themes · fully offline, no account.

## 6. Graphic assets

| Asset | Spec | Status |
| --- | --- | --- |
| App icon | 512×512 PNG | use `docs/branding/app_icon_1024.png` (resize) |
| Feature graphic | 1024×500 | **to make** — lavender background, icon centered, tagline "Little plans, big smiles", no device frames needed |
| Screenshots | ≥2, up to 8 per device type | **to capture** — Home (with a few tasks), Calendar, Task editor, Stats, Profile/dark mode; use a clean 9:16 emulator image |
| Adaptive icon | in repo | foreground/background/monochrome layers under `android/app/src/main/res/mipmap-*` |

## 7. Data safety questionnaire ( truthful answers )

- **Does your app collect or share any of the required user data types?** No.
  (Everything is stored on-device only; there is no collection, no sharing,
  no transmission.)
- **Is all of the user data collected by your app encrypted in transit?**
  Not applicable — no data leaves the device.
- **Do you provide a way for users to request that their data is deleted?**
  Yes — uninstalling the app deletes all data, plus an in-app
  "Delete all tasks" control.
- Attach/host the privacy policy from `docs/PRIVACY_POLICY.md` on a public
  URL (GitHub Pages or the Play-hosted option) — it matches the in-app copy.

## 8. Content rating & audience

- Complete IARC: no violence, no user-generated content sharing, no ads →
  expected rating **Everyone**.
- Target audience: everyone; **do not** mark "designed for children" under 13
  unless you intend to follow the Families policy (not required here).
- **Advertising declaration:** "No, my app does not contain
  advertisements" (AdMob is intentionally not integrated in v1.0.0 — see §11).

## 9. Permissions declaration

- `POST_NOTIFICATIONS` — core feature (reminders), user-granted at runtime.
- `SCHEDULE_EXACT_ALARM` — optional convenience; disclose in the listing
  ("reminders may be delayed without exact-alarm permission"). If Play asks
  for justification: alarm-clock-style user-requested reminders, fallback
  exists.
- `RECEIVE_BOOT_COMPLETED`, `VIBRATE` — support the reminder feature.
- No location, contacts, camera, microphone, storage, or background services.

## 10. Release checklist

- [ ] `flutter analyze` clean, `flutter test` green (CI enforces)
- [ ] Version bumped in `pubspec.yaml` (code **and** name)
- [ ] Real signing config wired; `flutter build appbundle --release` succeeds
- [ ] Manual QA checklist in `docs/TESTING.md` completed on a real device
- [ ] Internal testing track first, then closed testing, then production
- [ ] Store listing + data safety + rating completed
- [ ] Privacy policy URL live and identical to the in-app policy

## 11. Optional later: ads (not integrated in v1.0.0)

Monetization is intentionally disabled. If you add AdMob later:

1. Create a real AdMob account, app entry, and **banner** ad unit.
2. Add `google_mobile_ads`, initialize in `main()`, and load only **test
   units** during development.
3. Acceptable placement: bottom of the **Statistics** screen only — never on
   Home, editor, or inside task flows; no interstitials around task actions.
4. Update the store listing's advertising declaration and the privacy policy
   (SDK discloses device identifiers) **before** shipping the ad-enabled
   build; add a consent flow (UMP) for EEA/UK users.
5. Alternatively/additionally, a one-time "Tip jar" purchase can remove ads —
   only with real Play Billing integration and a working purchase flow.

## 12. Post-launch

- Monitor Android Vitals (crash rate, ANRs) in Play Console.
- Watch reminder-related reviews for OEM battery-optimizer complaints and
  point users to "unrestricted battery" settings if needed.
- Ship updates by bumping `version:` in `pubspec.yaml` and re-running §4.
