package com.neurio.vm;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.Bridge;
import com.neurio.vm.runtime.ProcessBridge;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.spoof.SpoofScript;
import com.neurio.vm.spoof.UserAgents;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;
import com.neurio.vm.util.Ui;
import com.neurio.vm.vm.VmSettings;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The isolated browser: a virtual handset's window onto the internet.
 *
 * <p>Everything that makes this a <em>different device</em> lives here:
 * <ul>
 *   <li>the process it runs in was given a Chromium profile suffix at startup by
 *       {@link ProcessBridge}, so cookies / localStorage / IndexedDB / service
 *       workers / HTTP cache are this device's alone;</li>
 *   <li>the User-Agent is rebuilt from the identity, down to a Chrome build
 *       number that actually shipped for that major version;</li>
 *   <li>{@code assets/spoof.js} rewrites the DOM fingerprinting surface on every
 *       main-frame commit;</li>
 *   <li>downloads land in the device's own sandbox directory.</li>
 * </ul>
 *
 * <p>Subclasses {@code BrowserSlot2/3/4} only differ in the manifest's
 * {@code android:process} value — one class, four processes, four devices.
 */
public class BrowserActivity extends Activity {

    private static final String TAG = "Browser";

    /** Slot → activity class; index matches {@code SlotTable} slots 0..3. */
    public static Class<?> slotClass(int slot) {
        switch (slot) {
            case 1: return BrowserSlot2.class;
            case 2: return BrowserSlot3.class;
            case 3: return BrowserSlot4.class;
            default: return BrowserActivity.class;
        }
    }

    private DeviceIdentity device;
    private WebView web;
    private EditText urlBar;
    private ProgressBar progress;
    private TextView status;
    private TextView badge;
    private TextView iframeWarn;
    private VmSettings settings;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_browser);

        settings = new VmSettings(this);
        device = ProcessBridge.device(this);
        if (device == null) {
            Ui.toast(this, getString(R.string.browser_no_device));
            finish();
            return;
        }

        urlBar = findViewById(R.id.b_url);
        progress = findViewById(R.id.b_progress);
        status = findViewById(R.id.b_status);
        badge = findViewById(R.id.b_badge);
        iframeWarn = findViewById(R.id.b_iframe_warn);
        web = findViewById(R.id.webview);

        badge.setText(device.displayName());
        status.setText(ProcessBridge.banner(this)
                + "\n" + (device.spoofWebView ? UserAgents.chrome(device) : "(UA not spoofed)"));

        configure();
        wire();

        web.loadUrl(settings.browserHome());
    }

    // ── WebView configuration ──────────────────────────────────────────────

    private void configure() {
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        ws.setGeolocationEnabled(false);               // never leak the real position
        ws.setAllowFileAccess(false);                  // a page must not read our files
        ws.setAllowFileAccessFromFileURLs(false);
        ws.setAllowUniversalAccessFromFileURLs(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        // Safe Browsing posts every navigated URL to Google's service, which
        // would tie this device's traffic to the real installation. Off.
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                ws.setSafeBrowsingEnabled(false);
            } catch (Throwable ignored) { }
        }

        if (device.spoofWebView) {
            ws.setUserAgentString(UserAgents.chrome(device));
        }

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        try {
            cm.setAcceptThirdPartyCookies(web, true);
        } catch (Throwable ignored) { }

        web.addJavascriptInterface(new Bridge(device), "NeurioVM");
        web.setWebViewClient(new GuestClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
                progress.setProgress(newProgress);
            }

            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                Log.d(TAG, "[console:" + message.messageLevel() + "] " + message.message());
                return true;
            }
        });

        web.setDownloadListener(new GuestDownloads());
        web.setWebContentsDebuggingEnabled(false);

        if (!ProcessBridge.isolationSupported()) {
            Ui.toast(this, getString(R.string.browser_isolation_off, Build.VERSION.SDK_INT));
        }
    }

    private void wire() {
        urlBar.setOnEditorActionListener((TextView v, int actionId, KeyEvent event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                navigate(v.getText().toString());
                return true;
            }
            return false;
        });
        findViewById(R.id.b_go).setOnClickListener(v -> navigate(urlBar.getText().toString()));
        findViewById(R.id.b_back).setOnClickListener(v -> { if (web.canGoBack()) web.goBack(); });
        findViewById(R.id.b_forward).setOnClickListener(v -> { if (web.canForward()) web.goForward(); });
        findViewById(R.id.b_reload).setOnClickListener(v -> web.reload());
        findViewById(R.id.b_home).setOnClickListener(v -> web.loadUrl(settings.browserHome()));
        findViewById(R.id.b_verify).setOnClickListener(v -> verify());
        findViewById(R.id.b_ext).setOnClickListener(v -> {
            String u = web.getUrl();
            if (u == null) return;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
            } catch (Exception e) {
                Ui.toast(this, getString(R.string.error) + ": " + e.getMessage());
            }
        });
        findViewById(R.id.b_clear).setOnClickListener(v -> Ui.confirm(this,
                getString(R.string.browser_clear), getString(R.string.browser_clear_confirm),
                this::clearData));
    }

    /** Accepts bare words, hosts and full URLs the way a real omnibox does. */
    private void navigate(String raw) {
        String input = raw == null ? "" : raw.trim();
        if (input.isEmpty()) return;
        String target;
        if (input.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*")) {
            target = input;
        } else if (input.matches("^[^\\s]+\\.[a-zA-Z]{2,}([/?#].*)?$")) {
            target = "https://" + input;
        } else {
            target = "https://duckduckgo.com/?q=" + Uri.encode(input);
        }
        web.loadUrl(target);
    }

    // ── the fingerprinting surface ────────────────────────────────────────

    /** What the page itself reports back — the honest self-check. */
    private void verify() {
        SpoofScript.report(web, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                Ui.ui(() -> {
                    String shown = value == null ? "(no report)" : pretty(value);
                    new AlertDialog.Builder(BrowserActivity.this)
                            .setTitle(R.string.browser_verify_title)
                            .setMessage(shown)
                            .setPositiveButton(android.R.string.ok, null)
                            .setNeutralButton(R.string.console_copy, (d, w) ->
                                    Ui.copy(BrowserActivity.this, "report", value))
                            .show();
                });
            }
        });
    }

    private static String pretty(String json) {
        try {
            return new org.json.JSONObject(json).toString(2);
        } catch (org.json.JSONException e) {
            return json;
        }
    }

    /**
     * Wipes what can be wiped from inside a live process: cookies, DOM storage
     * and the HTTP cache. The on-disk Chromium tree is deleted by
     * {@link ProcessBridge} the next time this slot changes owner, because a
     * running WebView keeps those files open.
     */
    private void clearData() {
        try {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) { }
        try {
            WebStorage.getInstance().deleteAllData();
        } catch (Throwable ignored) { }
        try {
            web.clearCache(true);
            web.clearHistory();
            web.clearFormData();
        } catch (Throwable ignored) { }
        Ui.toast(this, getString(R.string.browser_cleared, device.displayName()));
        web.loadUrl(settings.browserHome());
    }

    // ── clients ───────────────────────────────────────────────────────────

    /**
     * Injects the identity into every main-frame commit. Cross-origin iframes
     * are detected after load so the user is told exactly what the injection
     * could not reach.
     */
    private final class GuestClient extends WebViewClient {

        private boolean injectedThisLoad;

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            injectedThisLoad = false;
            iframeWarn.setVisibility(View.GONE);
            SpoofScript.inject(view, BrowserActivity.this, device);
            if (!urlBar.hasFocus()) urlBar.setText(url);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            super.onPageCommitVisible(view, url);
            // The earliest point at which the document's own scripts can have
            // run; re-injecting here closes the gap for pages that start late.
            SpoofScript.inject(view, BrowserActivity.this, device);
            injectedThisLoad = true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            SpoofScript.inject(view, BrowserActivity.this, device);
            if (!urlBar.hasFocus()) urlBar.setText(url);
            countIframes(view);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u.getScheme();
            if (scheme == null) return false;
            if (scheme.equals("http") || scheme.equals("https") || scheme.equals("about")
                    || scheme.equals("data")) {
                return false; // stay inside the isolated profile
            }
            // anything else (mailto:, tel:, market:, intent:) leaves the sandbox
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception e) {
                Log.w(TAG, "no handler for " + u);
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            Log.w(TAG, "load error " + errorCode + " " + description + " for " + failingUrl);
        }

        private void countIframes(final WebView view) {
            view.evaluateJavascript(
                    "(function(){try{return String(document.querySelectorAll('iframe,frame').length)}"
                            + "catch(e){return '0'}})()",
                    value -> {
                        int n = 0;
                        try { n = Integer.parseInt(value == null ? "0" : value.replace("\"", "")); }
                        catch (NumberFormatException ignored) { }
                        final int count = n;
                        Ui.ui(() -> iframeWarn.setVisibility(count > 0 ? View.VISIBLE : View.GONE));
                    });
        }
    }

    /**
     * Downloads go to {@code vm/<device>/downloads} with this device's cookies,
     * so a download never touches the shared Downloads folder — and never
     * reveals which device fetched it.
     */
    private final class GuestDownloads implements DownloadListener {

        @Override
        public void onDownloadStart(final String url, final String userAgent,
                                    final String contentDisposition, final String mimeType,
                                    final long contentLength) {
            final String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            Ui.toast(BrowserActivity.this, "↓ " + fileName);
            Ui.bg(() -> {
                File dir = Sandbox.downloads(BrowserActivity.this, device);
                Io.mkdirs(dir);
                File out = new File(dir, sanitize(fileName));
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent",
                            device.spoofWebView ? UserAgents.chrome(device) : userAgent);
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
                    conn.connect();
                    try (InputStream in = conn.getInputStream();
                         OutputStream os = new java.io.FileOutputStream(out)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    Log.i(TAG, "downloaded " + out + " (" + Io.humanBytes(out.length()) + ")");
                    Ui.ui(() -> Ui.toast(BrowserActivity.this,
                            "✓ " + out.getName() + " → " + dir.getName() + "/"));
                } catch (Exception e) {
                    Log.e(TAG, "download failed for " + url, e);
                    Ui.ui(() -> Ui.toast(BrowserActivity.this,
                            getString(R.string.error) + ": " + e.getMessage()));
                } finally {
                    if (conn != null) conn.disconnect();
                }
            });
        }

        private String sanitize(String name) {
            String n = name == null ? "download.bin" : name.replace('/', '_').replace('\\', '_');
            while (n.startsWith(".")) n = n.substring(1);
            return n.isEmpty() ? "download.bin" : n;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            try {
                web.stopLoading();
                web.destroy();
            } catch (Throwable ignored) { }
        }
        super.onDestroy();
    }
}
