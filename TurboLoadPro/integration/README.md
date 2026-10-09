# Browser handoff

TurboLoad Pro intentionally has no page scraper, cookie store, credential access, history permission, or streaming-platform adapter. Browser capture is an explicit handoff of a **direct HTTP/HTTPS file URL** only.

## Built-in handoff routes

The installer registers the per-user `turbload:` protocol. A helper can hand off a user-selected link as:

```text
turbload://add?url=https%3A%2F%2Fdownloads.example.org%2Farchive.zip
```

The app accepts this validated protocol route or a command-line launch:

```powershell
& "$env:LOCALAPPDATA\Programs\TurboLoad Pro\TurboLoadPro.exe" --url "https://downloads.example.org/archive.zip"
```

The application validates the URL again on receipt, rejects embedded credentials and non-HTTP(S) schemes, and revalidates each redirect. If an installer is not used during development, pass `--url` directly.

## Optional Chromium context-menu helper

`chromium/` contains a minimal Manifest V3 example. It creates one context-menu item for a link the user explicitly right-clicks. It requests only the `contextMenus` permission, has no content script, no host permissions, and stores no URL. Chrome may show its normal external-protocol confirmation when opening TurboLoad Pro.

Install locally through `chrome://extensions` → **Developer mode** → **Load unpacked** → select the `chromium` folder. Remove the extension at any time in the same page.

This integration does not extract media manifests, parse protected pages, obtain authentication, or turn a streaming URL into a direct file link. It forwards exactly the link URL chosen by the user.
