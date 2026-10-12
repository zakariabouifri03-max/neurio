package dev.neurio.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Neurio for Android — a thin, honest shell around the very same renderer that runs in the
 * desktop app.
 *
 * The UI is bundled inside the APK (`file:///android_asset/www/index.html`), which makes the
 * WebView origin a *secure context*, so microphone and camera capture work even though the
 * user's own Neurio server is usually plain HTTP on the local network. All chat data lives on
 * that server; the app only stores which server to talk to.
 *
 * Long-press anywhere to change the server address.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Neurio";
    private static final String PREFS = "neurio";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_SEEN_HINT = "seen_hint";
    private static final String DEFAULT_SERVER = "http://192.168.1.20:8790";
    private static final int REQUEST_MEDIA_PERMISSIONS = 4711;
    private static final int REQUEST_FILE_CHOOSER = 4712;

    private WebView webView;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMediaRequest;
    private long lastBackPressedAt = 0L;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // The bundled UI talks to the user's own server (often http:// on the LAN), so the
        // file:// page must be allowed to make those cross-origin requests.
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new NeurioChromeClient());
        webView.setOnLongClickListener(v -> {
            showServerDialog();
            return true;
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (prefs.getString(KEY_SERVER, null) == null) {
            // First launch: ask which server to use, then start.
            showServerDialog();
        } else {
            loadApp();
        }
    }

    /* ------------------------------------------------------------------ app */

    private void loadApp() {
        String server = prefs.getString(KEY_SERVER, DEFAULT_SERVER);
        if (server == null || server.trim().isEmpty()) server = DEFAULT_SERVER;
        String url = "file:///android_asset/www/index.html?server=" + Uri.encode(server.trim());
        Log.i(TAG, "loading " + url);
        webView.loadUrl(url);

        if (!prefs.getBoolean(KEY_SEEN_HINT, false)) {
            prefs.edit().putBoolean(KEY_SEEN_HINT, true).apply();
            Toast.makeText(this, R.string.first_run_hint, Toast.LENGTH_LONG).show();
        }
    }

    private void showServerDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint(R.string.server_dialog_hint);
        String current = prefs.getString(KEY_SERVER, null);
        input.setText(current != null ? current : DEFAULT_SERVER);
        input.setSelection(input.getText().length());

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle(R.string.server_dialog_title)
                .setMessage(R.string.server_dialog_message)
                .setView(input)
                .setPositiveButton(R.string.connect, (dialog, which) -> {
                    String value = input.getText().toString().trim();
                    if (value.isEmpty()) value = DEFAULT_SERVER;
                    if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
                    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
                    prefs.edit().putString(KEY_SERVER, value).apply();
                    loadApp();
                });

        boolean firstRun = prefs.getString(KEY_SERVER, null) == null;
        if (!firstRun) {
            builder.setNegativeButton(R.string.cancel, null);
            builder.setNeutralButton(R.string.clear_data, (dialog, which) -> {
                webView.clearCache(true);
                webView.clearHistory();
                prefs.edit().clear().apply();
                Toast.makeText(this, R.string.clear_data_done, Toast.LENGTH_SHORT).show();
                showServerDialog();
            });
        }
        builder.show();
    }

    /* ------------------------------------------------------------- webview */

    private class NeurioChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> {
                List<String> needed = new ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needed.add(android.Manifest.permission.RECORD_AUDIO);
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needed.add(android.Manifest.permission.CAMERA);
                }
                List<String> missing = new ArrayList<>();
                for (String permission : needed) {
                    if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
                }
                if (!missing.isEmpty()) {
                    // Ask the user, then answer WebRTC once Android has replied.
                    pendingMediaRequest = request;
                    requestPermissions(missing.toArray(new String[0]), REQUEST_MEDIA_PERMISSIONS);
                    return;
                }
                boolean onlyMedia = true;
                for (String resource : request.getResources()) {
                    boolean known = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource);
                    if (!known) onlyMedia = false;
                }
                if (onlyMedia) {
                    request.grant(request.getResources());
                } else {
                    request.deny();
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                if (params != null && params.getAcceptTypes() != null && params.getAcceptTypes().length > 0) {
                    String accepted = params.getAcceptTypes()[0];
                    if (accepted != null && !accepted.isEmpty() && !accepted.contains(",")) intent.setType(accepted);
                }
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(intent, "Select files"), REQUEST_FILE_CHOOSER);
                return true;
            } catch (Exception error) {
                Log.w(TAG, "file chooser failed", error);
                fileCallback = null;
                return false;
            }
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false); // Neurio has no use for location
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, "console: " + message.message() + " @" + message.lineNumber());
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int index = 0; index < count; index++) {
                        results[index] = data.getClipData().getItemAt(index).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQUEST_MEDIA_PERMISSIONS) {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
            return;
        }
        boolean granted = grantResults.length > 0;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) granted = false;
        }
        if (pendingMediaRequest != null) {
            if (granted) {
                pendingMediaRequest.grant(pendingMediaRequest.getResources());
            } else {
                Toast.makeText(this, R.string.permissions_needed, Toast.LENGTH_LONG).show();
                pendingMediaRequest.deny();
            }
            pendingMediaRequest = null;
        }
    }

    /* -------------------------------------------------------- back handling */

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < 2000) {
            super.onBackPressed();
            return;
        }
        lastBackPressedAt = now;
        Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
