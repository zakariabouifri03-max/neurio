package com.neurio.studio;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private final Map<String, PendingDownload> pendingDownloads = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(11, 13, 25));
        getWindow().setNavigationBarColor(Color.rgb(11, 13, 25));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 13, 25));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new DownloadBridge(), "NeurioAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Keep the editor on its local app page; ordinary HTTPS font requests are allowed.
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent picker = params.createIntent();
                    startActivityForResult(picker, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    showToast("ما قدرناش نفتحوا اختيار الصور أو الفيديوهات.");
                    return false;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileChooserCallback != null) {
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileChooserCallback.onReceiveValue(results);
                fileChooserCallback = null;
            }
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        for (String key : pendingDownloads.keySet()) cancelDownload(key);
        if (webView != null) {
            webView.removeJavascriptInterface("NeurioAndroid");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void showToast(String message) {
        runOnUiThread(() -> Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show());
    }

    private static String safeFileName(String name) {
        String value = name == null ? "neurio-file" : name.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (value.isEmpty() || value.equals(".")) value = "neurio-file";
        return value;
    }

    private static final class PendingDownload {
        final Uri uri;
        final OutputStream stream;
        final String name;

        PendingDownload(Uri uri, OutputStream stream, String name) {
            this.uri = uri;
            this.stream = stream;
            this.name = name;
        }
    }

    public final class DownloadBridge {
        @JavascriptInterface
        public String beginDownload(String filename, String mimeType) {
            String safeName = safeFileName(filename);
            String safeMime = (mimeType == null || mimeType.trim().isEmpty()) ? "application/octet-stream" : mimeType;
            Uri uri = null;
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Neurio Studio");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                uri = getContentResolver().insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (uri == null) return "";
                OutputStream output = getContentResolver().openOutputStream(uri, "w");
                if (output == null) {
                    getContentResolver().delete(uri, null, null);
                    return "";
                }
                String id = UUID.randomUUID().toString();
                pendingDownloads.put(id, new PendingDownload(uri, output, safeName));
                return id;
            } catch (Exception error) {
                if (uri != null) getContentResolver().delete(uri, null, null);
                showToast("ما قدرناش نوجدّو الملف فالتنزيلات.");
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendDownload(String id, String base64Chunk) {
            PendingDownload pending = pendingDownloads.get(id);
            if (pending == null || base64Chunk == null) return false;
            try {
                byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                synchronized (pending) {
                    pending.stream.write(bytes);
                }
                return true;
            } catch (Exception error) {
                cancelDownload(id);
                showToast("وقع مشكل أثناء حفظ الملف.");
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishDownload(String id) {
            PendingDownload pending = pendingDownloads.remove(id);
            if (pending == null) return false;
            try {
                pending.stream.flush();
                pending.stream.close();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(pending.uri, values, null, null);
                showToast("تحفّظ الملف فـ Downloads / Neurio Studio.");
                return true;
            } catch (Exception error) {
                getContentResolver().delete(pending.uri, null, null);
                showToast("ما قدرناش نكمّلو حفظ الملف.");
                return false;
            }
        }

        @JavascriptInterface
        public void cancelDownload(String id) {
            MainActivity.this.cancelDownload(id);
        }
    }

    private void cancelDownload(String id) {
        PendingDownload pending = pendingDownloads.remove(id);
        if (pending == null) return;
        try {
            pending.stream.close();
        } catch (Exception ignored) {
        }
        try {
            getContentResolver().delete(pending.uri, null, null);
        } catch (Exception ignored) {
        }
    }
}
