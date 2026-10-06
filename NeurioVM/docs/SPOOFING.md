# What is spoofed, and what cannot be

A reference for the identity layers. "Web" means the isolated browser
(Tier 4). "Native" means a separately installed app, which requires the LSPosed
module (root) — a browser process cannot rewrite another app's heap.

## Layer 1 — `android.os.Build` (native, LSPosed only)

Rewritten statically in the target process, before its `Application` runs:

`MODEL BRAND DEVICE PRODUCT MANUFACTURER BOARD HARDWARE BOOTLOADER DISPLAY ID
FINGERPRINT TAGS TYPE HOST SERIAL` and `VERSION.{RELEASE, SDK_INT,
SECURITY_PATCH, INCREMENTAL, CODENAME, SDK}`, plus `Build.getSerial()` and
`getRadioVersion()`.

Consistency is generated, not faked per field: brand/product/device/hardware
always come from one catalog preset, so a "Samsung SM-S928B" never claims
`ro.hardware=ranchu`.

## Layer 2 — identifiers

| Surface | Web | Native |
|---|:--:|:--:|
| `Settings.Secure.ANDROID_ID` | n/a (web has no access) | ✔ |
| GSF id (`content://com.google.android.gsf`/`gsf_id`) | — | *not rewritten* (see below) |
| IMEI / MEID / IMSI / ICCID | — | ✔ |
| operator name / MCC-MNC / country ISO | — | ✔ |
| `line1Number`, voicemail | — | ✔ (emptied) |
| Wi-Fi MAC, BSSID, SSID | — | ✔ |
| `NetworkInterface.getHardwareAddress()` | — | ✔ |
| Bluetooth address | — | ✔ |
| advertising id (Play Services) | — | ✔ when the target bundles the ads SDK |
| `TimeZone.getDefault()` | — | ✔ |

**Deliberately not rewritten:** `Locale.getDefault()`. Forcing a locale from a
hook breaks number/date formatting and crashes enough apps that the trade is
not worth it; the virtual locale is applied inside the browser, where it is
safe. **GSF id** is read from Google Play Services' own database; intercepting
it reliably means hooking Play Services itself, which is its own arms race and
is out of scope.

## Layer 3 — the web fingerprint (`assets/spoof.js`)

Injected on every main-frame commit. All values derive from one identity and
from one 32-bit seed (a hash of the ANDROID_ID), so they agree with each other
and are stable across reloads — exactly like a real handset.

| Layer | What is overwritten |
|---|---|
| navigator | `userAgent appVersion platform vendor product productSub vendorSub language languages hardwareConcurrency deviceMemory maxTouchPoints doNotTrack webdriver pdfViewerEnabled` + `window.chrome` |
| Client Hints | `navigator.userAgentData` incl. `getHighEntropyValues()` for architecture, bitness, model, platformVersion, uaFullVersion, fullVersionList, formFactors |
| screen / window | `screen.{width,height,availWidth,availHeight,left,top,colorDepth,pixelDepth}` + `orientation` + `devicePixelRatio outerWidth outerHeight screenX screenY screenLeft screenTop` + a `matchMedia()` rewriter for width/height queries |
| timezone | `Intl.DateTimeFormat.prototype.resolvedOptions().timeZone`; `Date.toString/toTimeString/toDateString` rebuilt through `Intl` in the device zone (so the *hour* is right, not just the suffix); `getTimezoneOffset`; `toLocale{String,DateString,TimeString}` default the zone unless the page passes one explicitly |
| WebGL | `UNMASKED_VENDOR/RENDERER`, `VENDOR/RENDERER/VERSION/SHADING_LANGUAGE_VERSION`, and the numeric limits (max texture size, cube map, attribs, varying vectors, uniforms, texture units, max viewport); `WEBGL_debug_renderer_info` is kept advertised |
| canvas | `getImageData` perturbed ±N LSB deterministically; `toDataURL/toBlob/OffscreenCanvas.convertToBlob` get an invisible per-device stamp (α≈0.004) before the page reads the bitmap |
| audio | `AnalyserNode.getFloat/ByteFrequencyData` and `AudioBuffer.getChannelData` get deterministic sub-audible noise |
| battery | `navigator.getBattery()` → configured level/charging |
| network | `navigator.connection` (`effectiveType`, `downlink`, `rtt`, `saveData`) |
| media devices | `mediaDevices.enumerateDevices()` → four stable pseudo-devices |
| storage | `navigator.storage.estimate()` quota/usage |
| WebRTC | host ICE candidates dropped from `createOffer/createAnswer` SDP; `c=IN IP4/IP6` lines masked |

### Geometry is in CSS pixels

Chrome reports `screen.width` in **CSS** pixels, not physical ones. The config
therefore sends `round(physicalPx / (densityDpi/160))` and the matching
`devicePixelRatio` — a Pixel 8 preset reports 411×914 @ 2.63, not 1080×2400.
Getting this wrong is the most common tell in amateur spoofers.

### Chrome version consistency

`UserAgents` pairs every Chrome major with a real shipped build number
(`128 → 128.0.6613.127`), and the same triple appears in the UA string, the
`brands` list and `fullVersionList`, so a Client-Hints cross-check cannot catch
a mismatch.

## What a determined adversary can still see

Stated plainly, because pretending otherwise would be worse than useless:

- **Cross-origin iframes.** Injection is main-frame only (no AndroidX
  `addDocumentStartJavaScript`). The browser detects iframes and shows a
  warning banner.
- **TLS / network layer.** JA3/JA4 fingerprints, TCP behaviour and the real IP
  are outside a WebView's reach. WebRTC host candidates are redacted, but that
  is not a proxy.
- **Hardware-backed attestation.** `keymaster`/StrongBox attestation and
  Play Integrity will still describe the *real* device.
- **Timing side channels.** TCG-emulated guests (Tier 2 without KVM) are
  detectably slow; that is physics, not a bug.
- **The emulator presets.** They exist so you can *choose* to look like an
  emulator. A service that blocks emulators will block them — correctly.
- **Behavioural signals.** Nothing here changes how you type, scroll or click.

## Verification

The browser's **Verify** button asks the page to report itself back:
`window.__NEURIO_REPORT__()` returns the UA, platform, languages, cores,
memory, screen box, DPR, timezone + offset, a formatted date, the WebGL
vendor/renderer as read through a real GL context, and the list of layers that
installed successfully (`+` = active, `-` = blocked, e.g. by a frozen
`navigator`). If a layer silently fails, this is where you find out.
