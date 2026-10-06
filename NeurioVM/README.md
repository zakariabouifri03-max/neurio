# 🧬 NeurioVM — مختبر الأجهزة الوهمية داخل تيليفونك

**NeurioVM** is a standalone Android app that turns your phone into a *virtual
device lab*: you create synthetic handsets, each with its own identity, its own
isolated storage and browser profile, and you put them to work. Think of it as
"LDPlayer, but the parts that are actually possible on a phone" — and with a
console that tells you, honestly, which parts those are on *your* phone.

> **بوحدو.** This project lives in its own folder and shares no code, no build,
> and no workflow with the racing game at the repo root. It builds to its own
> APK: `NeurioVM.apk`.

---

## 📱 Get the APK (no PC needed)

The repo builds it in GitHub Actions and publishes it to a fixed release tag,
so this link always serves the newest build:

```
https://github.com/zakariabouifri03-max/neurio/releases/download/neuriovm-v1.0.0/NeurioVM.apk
```

To rebuild: repo → **Actions** → **NeurioVM APK** → **Run workflow**.
Or push a change under `NeurioVM/android/` — the workflow triggers automatically.

Install on the phone: download → tap → *"Install anyway"* → allow unknown apps
for your browser. Minimum Android 7.0 (API 24). Signed with the debug keystore,
so it is not a Play-Store release.

---

##  What you asked for, and what actually exists

> *"بغيت تطبيق بحال LDPlayer كيدخلني لهاتف آخر داخل تيليفوني."*

Here is the whole truth, in four tiers. The app implements **all four**, picks
the best one your phone supports automatically, and shows you the verdict for
each in the hypervisor console.

| Tier | Backend | What you get | Needs |
|:--:|---|---|---|
| 1 | **Redroid container** | A complete second Android userspace (init, zygote, surfaceflinger) sharing the host kernel | root **+** binder/ashmem in the *host kernel* |
| 2 | **QEMU virtual machine** | A full guest Android with its own kernel; hardware-accelerated if `/dev/kvm` is usable | root **+** a qemu-system binary **+** a guest image |
| 3 | **AVF / pKVM** | Android's own protected virtual machines (the sanctioned way) | the framework present **+** `MANAGE_VIRTUAL_MACHINE`, a `signature\|privileged` permission — an installed app **cannot** hold it |
| 4 | **In-app sandbox** | An isolated runtime with its own storage *and* its own Chromium profile, plus a rewritten web fingerprint (UA, Client Hints, screen, timezone, WebGL, canvas/audio noise, battery, WebRTC) | **nothing** — works on any stock phone |

Why tiers 1–3 are gated is not a limitation of this app, it is a limitation of
Android:

- **Tier 1** needs binder in the kernel. Retail phone kernels almost never have
  it, and no userspace app can add it. The console checks `/dev/binder`,
  `/dev/binderfs`, `/dev/ashmem` and says exactly what is missing.
- **Tier 2** needs to execute a qemu binary. Android 10 removed execute
  permission on app-writable storage for unprivileged apps, so even a
  Termux-installed QEMU only runs through `su`. Without KVM it also emulates in
  software (TCG), which on a phone means minutes to boot.
- **Tier 3** is blocked by a permission only system apps get. So this backend
  does the part that *is* possible: it probes the framework and writes a valid
  AVF `VirtualMachineConfig` plus the exact `adb shell` commands that boot it.

**Tier 4 is the product.** It is what genuinely works everywhere, and it is
where most of the engineering in this app lives.

---

## 🧰 What the in-app sandbox actually does

For each virtual device:

- **Encrypted identity.** Model, brand, board, hardware, build fingerprint,
  ANDROID_ID, GSF id, advertising id, IMEI (with a *valid Luhn digit*), MEID,
  IMSI, ICCID, operator, MACs — generated per device, stored AES-256-GCM with a
  hardware-backed AndroidKeystore key (PBKDF2 fallback).
- **Real storage isolation.** `filesDir/vm/<uuid>/{files,cache,prefs,databases,downloads}`.
  `VirtualContext` redirects every storage call, including a file-backed
  `SharedPreferences`, so two devices cannot see each other's data.
- **Real browser isolation.** `WebView.setDataDirectorySuffix()` per process,
  with four processes (`:vm0`…`:vm3`) so **four devices run concurrently**, each
  with its own cookies, localStorage, IndexedDB, service workers and HTTP cache.
  When a slot changes owner the previous tenant's Chromium profile is deleted
  *before* the new one claims the suffix — otherwise the new "phone" would
  inherit the old one's cookies.
- **Web fingerprint rewriting** (`assets/spoof.js`, ~700 lines): `navigator`,
  Client Hints with `getHighEntropyValues()`, screen geometry in CSS pixels,
  `Intl`/`Date` timezone *and* matching UTC offset, WebGL
  `UNMASKED_VENDOR/RENDERER` plus the numeric limits, deterministic per-device
  canvas and audio noise, battery, `NetworkInformation`, `enumerateDevices`,
  storage quota, and WebRTC host-candidate redaction. Deterministic, so one
  virtual handset always hashes the same — like a real one.
- **Native app rewriting (optional).** `hook/NeurioHook` is an LSPosed module
  inside the same APK. On a rooted phone with LSPosed it rewrites
  `android.os.Build.*`, `Settings.Secure.android_id`, `TelephonyManager`,
  `WifiInfo`, `BluetoothAdapter`, `NetworkInterface` and the Google Ads id
  inside the apps *you* select. Without LSPosed it is simply never loaded.
- **Backends that launch real processes.** QEMU and redroid builds are run
  through `ProcessBuilder` (via `su -c` when needed) with streaming logs, and
  the exact launch script is written to the device's log directory so it can be
  reproduced by hand from the built-in terminal.
- **A capability probe** that reads `/dev/kvm`, the AVF apex and binder service,
  `su`, SELinux state, Termux, proot/chroot/qemu paths and reports it all.
- **Import / export / clone / reissue** of device profiles, and a factory reset
  that wipes every sandbox and the encryption key.

---

## 🗂 Project layout

```
NeurioVM/
├── README.md                     ← you are here
├── docs/
│   ├── ARCHITECTURE.md           ← processes, isolation, the slot model, vault format
│   └── SPOOFING.md               ← every layer, what it defeats, what it cannot
├── tools/
│   ├── make-icons.py             ← regenerates the launcher bitmaps (Pillow)
│   └── store-icon-512.png
└── android/
    ├── settings.gradle           ← :app + :xposed-stubs (compile-only Xposed API)
    ├── build.gradle              ← AGP 8.5.2, nothing else
    ├── gradle/wrapper/…
    ├── xposed-stubs/             ← stub declarations; NEVER packaged into the APK
    └── app/src/main/
        ├── AndroidManifest.xml
        ├── assets/spoof.js       ← the guest-side identity layer
        ├── assets/xposed_init
        ├── res/                  ← dark console theme, ar + fr translations, generated icons
        └── java/com/neurio/vm/
            ├── core/             DeviceIdentity · DeviceCatalog · IdentityFactory · Vault · ProfileStore
            ├── runtime/          Sandbox · VirtualContext · SandboxPreferences · ProcessBridge · SlotTable · Bridge
            ├── spoof/            SpoofScript · UserAgents
            ├── vm/               Capability(Probe) · VmBackend · Backends · VmSession · VmManager · VmService
            │                     SandboxBackend · QemuBackend · RedroidBackend · AvfBackend · ProcessRunner · VmSettings
            ├── hook/             NeurioHook · HookConfig · HookProvider
            ├── util/             Io · Log · Hex · Ui
            └── *.java            the seven screens
```

No third-party library anywhere. The only thing Gradle downloads is the Android
Gradle Plugin itself — that is why the CI build is reliable and why this builds
in an offline-ish environment.

---

## 🔨 Build it yourself

```bash
cd NeurioVM/android
gradle :app:assembleDebug        # Gradle 8.7+ with JDK 17 and the SDK installed
# → app/build/outputs/apk/debug/app-debug.apk
```

Or in Android Studio: open `NeurioVM/android` as a project.

Regenerate the launcher bitmaps after touching the icon design:

```bash
pip3 install --break-system-packages pillow
python3 NeurioVM/tools/make-icons.py
```

---

## ⚖️ Honest limits (read this before trusting it against a determined adversary)

- `spoof.js` is injected into the **main frame only**. Cross-origin iframes keep
  the host's real `navigator`; the browser shows a warning banner when a page
  contains iframes. (Fixing it needs AndroidX's
  `addDocumentStartJavaScript`; this project deliberately has zero AndroidX.)
- Tier 4 changes what *web* content sees. A natively installed app still reads
  the real `Build` in its own process — that is exactly what the LSPosed module
  exists to fix, and it needs root + LSPosed.
- The derived-key vault mode is obfuscation, not hardware-backed secrecy. The
  UI says which mode you are in.
- `HookProvider` is exported without a permission, because a hooked app must be
  able to read it. It serves synthetic data only, and serves nothing at all
  while hooking is switched off.
- Emulator presets exist on purpose: sometimes you *want* to look like an
  emulator (testing), and sometimes a service wants to detect one. Both are
  one tap away.

This is a tool for testing, multi-accounting your own accounts, and privacy.
Using it to break somebody else's terms of service is on you.
