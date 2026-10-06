# Architecture

## Processes

```
┌─────────────────────────── com.neurio.vm (main) ───────────────────────────┐
│  MainActivity · DeviceActivity · EditorActivity · ConsoleActivity          │
│  TerminalActivity · HookAppsActivity · VmService                           │
│  ProfileStore ── Vault(AES-GCM) ── filesDir/vault/profiles.nvm             │
│  VmManager ── VmSession(s) ── {Sandbox, Qemu, Redroid, Avf}Backend         │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │  filesDir/vm/slot<N>.txt      (a bare UUID: who owns the slot)
               │  filesDir/vm/<id>/identity.nvm (the encrypted identity)
   ┌───────────┼───────────────┬───────────────┐
   ▼           ▼               ▼               ▼
 :vm0        :vm1            :vm2            :vm3        ← BrowserActivity ×4
 WebView     WebView         WebView         WebView
 suffix      suffix          suffix          suffix
 "nvm0"      "nvm1"          "nvm2"          "nvm3"
```

Each `:vmN` process is a separate Chromium world. That is not a stylistic
choice; it follows from a platform constraint:

- `WebView.setDataDirectorySuffix(String)` may be called **once per process**,
  and only before the WebView provider is first loaded.
- Therefore the suffix for a process must be decided in
  `Application.onCreate()`, i.e. before any activity in that process exists.
- Therefore the device a slot serves is communicated through a **file**
  (`vm/slotN.txt`) written by the main process before it starts the activity —
  an Intent extra would not survive the system restarting the process.

`ProcessBridge.onProcessStart()` is the single place this is decided. In each
browser process it:

1. parses its own process name to learn the slot number;
2. reads `vm/slotN.txt` for the device it should serve;
3. compares with `vm/slotN.owner`; **if the slot changed hands it deletes the
   previous tenant's Chromium trees** (`<dataDir>/app_webview_*`,
   `<cacheDir>/*_webview`) *before* claiming the suffix, so the new device boots
   with genuinely empty cookies / localStorage / IndexedDB;
4. claims the suffix.

On API < 28 the suffix API does not exist. The app then reports the browser
tier as **DEGRADED**: file, preference and identity isolation still apply, but
cookies are shared between devices. This is stated in the UI, not hidden.

## The slot model

`SlotTable` maps device UUID → slot 0..3 with LRU eviction. Four slots because
four concurrently isolated Chromium profiles is already a lot of RAM, and
because the manifest must declare the processes statically.

Reassigning a slot is the *only* moment device data is destroyed automatically,
and it destroys only the WebView profile — the sandbox (files, prefs,
downloads) is untouched and survives forever until the device is deleted.

## Storage

```
filesDir/
├── vault/
│   ├── profiles.nvm        ← the whole fleet, one AES-GCM blob
│   └── salt                ← PBKDF2 salt for the DERIVED fallback
└── vm/
    ├── active.txt          ← UUID of the active device (bare, non-sensitive)
    ├── slots.json          ← deviceId → slot
    ├── slot<N>.txt         ← pointer read by the :vmN process
    ├── slot<N>.owner       ← last device that claimed the slot (handover wipe)
    └── <device-uuid>/
        ├── identity.nvm    ← AES-GCM DeviceIdentity
        ├── files/ cache/ prefs/ databases/ downloads/ uploads/
        └── logs/
            ├── <backend>-<ts>.log
            ├── qemu-launch.sh        ← reproducible Tier-2 launch
            ├── redroid-boot.sh       ← reproducible Tier-1 boot
            └── avf/ config.json boot.sh   ← Tier-3 artefacts
```

### Vault format

`profiles.nvm`:

```
magic "NVM1" | version u8 | mode u8 (1=KEYSTORE, 2=DERIVED) | iv[12] | ciphertext | GCM tag
```

- **KEYSTORE**: a 256-bit AES-GCM key in `AndroidKeyStore` under alias
  `neurio_vm_master`. Key material never leaves the secure element where the
  OEM provides one.
- **DERIVED**: PBKDF2-HMAC-SHA1, 120 000 rounds, from a per-install salt mixed
  with the package name and `ANDROID_ID`. Obfuscation only; the UI labels it.

Per-device `identity.nvm` uses the same envelope, so a browser process can boot
a device on its own after being killed, with no plaintext identifiers on disk.

## Backends

`VmBackend` is a four-method interface (`isAvailable`, `verdict`, `start`,
`stop`). `Backends.preferred()` picks the best *available* one; the sandbox
backend is always available so the selection never fails.

A backend's `verdict(Capability)` is part of the contract: when a backend
cannot run it must produce a sentence the user can act on ("no binder device on
the host kernel", "Android 10 blocks exec() from app storage — root required",
"no guest image configured"). The console prints every verdict.

`VmSession` owns state, uptime, the child `Process` and a log that is mirrored
to disk on every line, because a `su`/`qemu` failure that dies before the UI
draws is otherwise invisible.

## The hook path

```
main process                       target app's process (LSPosed)
────────────                       ────────────────────────────
HookConfig.publish()  ──writes──▶  shared_prefs/neurio_hook.xml
        │                                     │  XSharedPreferences (root daemon)
        │                                     │  or, when unavailable:
        ▼                                     ▼
HookProvider (exported)  ◀──queries──  NeurioHook.handleLoadPackage()
content://com.neurio.vm.hook/active            │
                                               ├─ Build.* fields        (setStaticObjectField)
                                               ├─ Settings$Secure.getString
                                               ├─ TelephonyManager.*    (hookAllMethods)
                                               ├─ WifiInfo / BluetoothAdapter / NetworkInterface
                                               ├─ TimeZone.getDefault
                                               └─ gms AdvertisingIdClient$Info
```

Two read paths exist because `XSharedPreferences` needs LSPosed's privileged
daemon and silently returns defaults when it is not there; the provider path is
the reliable one and only needs a `Context`, which the module obtains by
hooking `Application.attach(Context)` — early enough for `Build` to be
rewritten before most code reads it.

Nothing in `hook/HookConfig` references a Xposed class. All framework
references live in `NeurioHook`, which is only ever loaded by LSPosed, so the
main app can never hit a `NoClassDefFoundError` for a framework that is absent.

## Why there is no AndroidX

`androidx.webkit.WebViewCompat.addDocumentStartJavaScript` would let the
identity be injected into *every* frame, including cross-origin iframes — the
single biggest functional gap in the spoofing layer. It is not used because the
project's build contract is "Gradle downloads nothing but AGP", which has kept
every CI run in this repository green. The iframe gap is detected at runtime
and surfaced as a warning banner instead of being silently ignored.
