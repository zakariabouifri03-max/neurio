# Browser integration

The extension uses the browser's Native Messaging API. It only sends a link when the user chooses **Download link with AI Download Manager Pro** from a link/media context menu or submits a URL in the extension popup. There is no history permission, page-content script, or background browsing-history collection.

## Chrome and Edge

1. Install AI Download Manager Pro.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Choose **Load unpacked** and select this folder. Copy the extension ID shown by the browser.
4. In PowerShell, register the native host for your Windows user:

```powershell
$app = "$env:LOCALAPPDATA\Programs\AI Download Manager Pro\AI-Download-Manager-Pro.exe"
$register = Join-Path (Split-Path $app) 'resources\register-native-host.ps1'
& $register -ChromeExtensionId YOUR_32_CHARACTER_EXTENSION_ID -AppExePath $app
```

Load the unpacked extension from `resources\browser-extension` in the installed app folder, or use the `browser-extension` folder in a source checkout. If you run from a source checkout, use `scripts\register-native-host.ps1` instead of the packaged `resources\register-native-host.ps1` path.

Use the actual path selected during installation if it differs. The script writes a browser Native Messaging host manifest and HKCU registrations; it does not require administrator rights.

## Firefox

The extension declares the stable ID `aidmp@neurio.local`; the same script registers its Native Messaging manifest for Firefox. Load this folder as a temporary or signed extension.

The native host accepts only explicitly sent HTTP/HTTPS URLs and places them in the desktop app's per-user inbox. It does not open a listening localhost port. The inbox is processed by the application when it is running (or on the next launch).
