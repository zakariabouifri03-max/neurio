package com.neurio.browser;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.text.InputType;
import android.view.Gravity;
import android.view.Menu;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebChromeClient.FileChooserParams;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int COLOR_BG = Color.rgb(244, 247, 251);
    private static final int COLOR_PANEL = Color.WHITE;
    private static final int COLOR_INK = Color.rgb(23, 36, 50);
    private static final int COLOR_MUTED = Color.rgb(112, 128, 142);
    private static final int COLOR_LINE = Color.rgb(228, 235, 241);
    private static final int COLOR_ACCENT = Color.rgb(24, 125, 119);
    private static final int FILE_PICKER_REQUEST = 4102;
    private static final int MAX_TABS = 8;
    private static final String HOME_BASE = "https://start.neurio.invalid/";
    private static final String PREFS = "neurio_browser";

    private final ArrayList<BrowserTab> tabs = new ArrayList<>();
    private android.content.SharedPreferences preferences;
    private FrameLayout root;
    private LinearLayout pageColumn;
    private FrameLayout webHost;
    private EditText addressInput;
    private TextView backButton, forwardButton, refreshButton, tabButton, bookmarkButton;
    private TextView saverButton, networkLabel;
    private ProgressBar progressBar;
    private int activeIndex = 0;
    private boolean dataSaver = false;
    private boolean desktopMode = false;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private ValueCallback<Uri[]> fileChooserCallback;
    private String[] pendingDownload;

    private static final class BrowserTab {
        WebView webView;
        String title = "تبويب جديد";
        String url = "";
        boolean home = true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        dataSaver = preferences.getBoolean("data_saver", false);
        desktopMode = preferences.getBoolean("desktop_mode", false);
        configureSystemBars();
        buildBrowserUi();
        restoreTabs();
        updateNetworkStatus();

        Uri incoming = getIntent() == null ? null : getIntent().getData();
        if (incoming != null && isHttpUrl(incoming.toString())) {
            loadInCurrentTab(incoming.toString());
        }
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(COLOR_BG);
        window.setNavigationBarColor(COLOR_BG);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        if (Build.VERSION.SDK_INT >= 26) {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    private void buildBrowserUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);
        pageColumn = new LinearLayout(this);
        pageColumn.setOrientation(LinearLayout.VERTICAL);
        pageColumn.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        pageColumn.setBackgroundColor(COLOR_BG);
        root.addView(pageColumn, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        buildHeader();
        buildAddressBar();
        buildActionBar();

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(COLOR_ACCENT));
        progressBar.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(COLOR_ACCENT));
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        progressBar.setVisibility(View.GONE);
        pageColumn.addView(progressBar, progressParams);

        webHost = new FrameLayout(this);
        webHost.setBackgroundColor(Color.WHITE);
        pageColumn.addView(webHost, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        buildBottomBar();
    }

    private void buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), dp(4), dp(14), dp(4));
        header.setBackgroundColor(COLOR_BG);

        TextView mark = new TextView(this);
        mark.setText("N");
        mark.setTextColor(Color.WHITE);
        mark.setTextSize(17);
        mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(round(COLOR_ACCENT, 13, Color.TRANSPARENT));
        header.addView(mark, new LinearLayout.LayoutParams(dp(36), dp(36)));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        brand.setPadding(dp(9), 0, 0, 0);
        TextView name = new TextView(this);
        name.setText("Neurio");
        name.setTextColor(COLOR_INK);
        name.setTextSize(15);
        name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        TextView subtitle = new TextView(this);
        subtitle.setText("متصفح خفيف");
        subtitle.setTextColor(COLOR_MUTED);
        subtitle.setTextSize(9);
        brand.addView(name);
        brand.addView(subtitle);
        header.addView(brand, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        networkLabel = new TextView(this);
        networkLabel.setText("متصل");
        networkLabel.setTextColor(COLOR_MUTED);
        networkLabel.setTextSize(10);
        networkLabel.setGravity(Gravity.CENTER);
        networkLabel.setPadding(dp(10), dp(7), dp(10), dp(7));
        networkLabel.setBackground(round(COLOR_PANEL, 18, COLOR_LINE));
        header.addView(networkLabel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(32)));

        TextView more = iconButton("⋮", "القائمة", 10);
        more.setOnClickListener(v -> showMenu(more));
        LinearLayout.LayoutParams moreParams = new LinearLayout.LayoutParams(dp(38), dp(38));
        moreParams.setMargins(dp(7), 0, 0, 0);
        header.addView(more, moreParams);
        pageColumn.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
    }

    private void buildAddressBar() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(3), dp(10), dp(5));
        row.setBackgroundColor(COLOR_BG);

        backButton = iconButton("‹", "رجوع", 22);
        backButton.setOnClickListener(v -> {
            WebView web = currentWebView();
            if (web != null && web.canGoBack()) web.goBack(); else loadHome(currentTab());
        });
        row.addView(backButton, new LinearLayout.LayoutParams(dp(36), dp(40)));

        forwardButton = iconButton("›", "تقدم", 22);
        forwardButton.setOnClickListener(v -> { WebView web = currentWebView(); if (web != null && web.canGoForward()) web.goForward(); });
        row.addView(forwardButton, new LinearLayout.LayoutParams(dp(34), dp(40)));

        refreshButton = iconButton("↻", "إعادة تحميل", 19);
        refreshButton.setOnClickListener(v -> {
            WebView web = currentWebView();
            if (web == null) return;
            if (web.getProgress() < 100) web.stopLoading(); else web.reload();
        });
        row.addView(refreshButton, new LinearLayout.LayoutParams(dp(34), dp(40)));

        addressInput = new EditText(this);
        addressInput.setSingleLine(true);
        addressInput.setTextSize(13);
        addressInput.setTextColor(COLOR_INK);
        addressInput.setHintTextColor(Color.rgb(145, 158, 170));
        addressInput.setHint("بحث أو اكتب عنوان موقع");
        addressInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressInput.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG_LTR);
        addressInput.setSelectAllOnFocus(true);
        addressInput.setPadding(dp(12), 0, dp(12), 0);
        addressInput.setBackground(round(COLOR_PANEL, 14, COLOR_LINE));
        addressInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER)) {
                openAddressFromField();
                return true;
            }
            return false;
        });
        addressInput.setOnFocusChangeListener((view, hasFocus) -> {
            if (hasFocus && currentTab() != null && currentTab().home) addressInput.selectAll();
        });
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, dp(40), 1f);
        inputParams.setMargins(dp(3), 0, dp(3), 0);
        row.addView(addressInput, inputParams);

        TextView go = iconButton("↵", "بحث أو فتح", 18);
        go.setTextColor(Color.WHITE);
        go.setBackground(round(COLOR_ACCENT, 13, COLOR_ACCENT));
        go.setOnClickListener(v -> openAddressFromField());
        row.addView(go, new LinearLayout.LayoutParams(dp(41), dp(40)));

        pageColumn.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
    }

    private void buildActionBar() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), 0, dp(10), dp(7));
        row.setBackgroundColor(COLOR_BG);

        tabButton = chipButton("▢ 1", false);
        tabButton.setOnClickListener(v -> showTabs());
        row.addView(tabButton, weightedChip());

        bookmarkButton = chipButton("☆ حفظ", false);
        bookmarkButton.setOnClickListener(v -> toggleBookmark());
        LinearLayout.LayoutParams bookmarkParams = weightedChip();
        bookmarkParams.setMargins(dp(6), 0, dp(6), 0);
        row.addView(bookmarkButton, bookmarkParams);

        saverButton = chipButton("✦ توفير البيانات", false);
        saverButton.setOnClickListener(v -> setDataSaver(!dataSaver));
        row.addView(saverButton, weightedChip());

        pageColumn.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(43)));
    }

    private void buildBottomBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(5), dp(5), dp(5), dp(5));
        bar.setBackgroundColor(COLOR_PANEL);

        TextView home = bottomButton("⌂", "الرئيسية");
        home.setOnClickListener(v -> loadHome(currentTab()));
        bar.addView(home, bottomWeight());
        TextView bookmarks = bottomButton("☆", "العلامات");
        bookmarks.setOnClickListener(v -> showBookmarks());
        bar.addView(bookmarks, bottomWeight());
        TextView history = bottomButton("◷", "السجل");
        history.setOnClickListener(v -> showHistory());
        bar.addView(history, bottomWeight());
        TextView downloads = bottomButton("↓", "التنزيلات");
        downloads.setOnClickListener(v -> openDownloads());
        bar.addView(downloads, bottomWeight());
        pageColumn.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(57)));
    }

    private LinearLayout.LayoutParams weightedChip() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(36), 1f);
        return params;
    }

    private LinearLayout.LayoutParams bottomWeight() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
    }

    private TextView iconButton(String text, String description, int textSize) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextColor(COLOR_MUTED);
        button.setTextSize(textSize);
        button.setGravity(Gravity.CENTER);
        button.setContentDescription(description);
        button.setBackground(round(COLOR_BG, 12, Color.TRANSPARENT));
        button.setFocusable(true);
        return button;
    }

    private TextView chipButton(String text, boolean selected) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextColor(selected ? COLOR_ACCENT : COLOR_MUTED);
        button.setTextSize(10);
        button.setGravity(Gravity.CENTER);
        button.setSingleLine(true);
        button.setPadding(dp(5), 0, dp(5), 0);
        button.setBackground(round(selected ? Color.rgb(229, 245, 241) : COLOR_PANEL, 12, COLOR_LINE));
        return button;
    }

    private TextView bottomButton(String icon, String label) {
        TextView button = new TextView(this);
        button.setText(icon + "\n" + label);
        button.setTextColor(COLOR_MUTED);
        button.setTextSize(10);
        button.setGravity(Gravity.CENTER);
        button.setLineSpacing(0, .9f);
        button.setBackground(round(Color.TRANSPARENT, 10, Color.TRANSPARENT));
        return button;
    }

    private GradientDrawable round(int fill, int radiusDp, int stroke) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(radiusDp));
        if (stroke != Color.TRANSPARENT) shape.setStroke(dp(1), stroke);
        return shape;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void restoreTabs() {
        JSONArray savedTabs;
        try { savedTabs = new JSONArray(preferences.getString("tabs", "[]")); }
        catch (JSONException error) { savedTabs = new JSONArray(); }
        int wantedActive = preferences.getInt("active_tab", 0);
        if (savedTabs.length() == 0) {
            createTab(null, false);
            return;
        }
        int count = Math.min(savedTabs.length(), MAX_TABS);
        for (int i = 0; i < count; i++) {
            JSONObject item = savedTabs.optJSONObject(i);
            String url = item == null ? "" : item.optString("url", "");
            createTab(url.isEmpty() ? null : url, false);
        }
        activeIndex = Math.max(0, Math.min(wantedActive, tabs.size() - 1));
        attachActiveTab();
        updateToolbarState();
    }

    private void persistTabs() {
        JSONArray array = new JSONArray();
        for (BrowserTab tab : tabs) {
            JSONObject item = new JSONObject();
            try {
                item.put("url", tab.home ? "" : tab.url);
                item.put("title", tab.title);
            } catch (JSONException ignored) { }
            array.put(item);
        }
        preferences.edit().putString("tabs", array.toString()).putInt("active_tab", activeIndex).apply();
    }

    private BrowserTab currentTab() {
        if (tabs.isEmpty() || activeIndex < 0 || activeIndex >= tabs.size()) return null;
        return tabs.get(activeIndex);
    }

    private WebView currentWebView() {
        BrowserTab tab = currentTab();
        return tab == null ? null : tab.webView;
    }

    private int indexOf(BrowserTab tab) {
        return tabs.indexOf(tab);
    }

    private void createTab(String url, boolean focus) {
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, "وصلتي للحد الأقصى ديال التبويبات.", Toast.LENGTH_SHORT).show();
            return;
        }
        BrowserTab tab = new BrowserTab();
        tab.webView = createWebView(tab);
        tabs.add(tab);
        activeIndex = tabs.size() - 1;
        attachActiveTab();
        if (url == null || url.isEmpty()) loadHome(tab); else loadUrl(tab, url);
        if (focus && addressInput != null) {
            addressInput.requestFocus();
            addressInput.selectAll();
        }
        updateToolbarState();
        persistTabs();
    }

    private void attachActiveTab() {
        if (webHost == null || tabs.isEmpty()) return;
        webHost.removeAllViews();
        BrowserTab tab = currentTab();
        if (tab != null && tab.webView != null) {
            ViewGroup parent = (ViewGroup) tab.webView.getParent();
            if (parent != null) parent.removeView(tab.webView);
            webHost.addView(tab.webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            tab.webView.onResume();
            if (addressInput != null && !addressInput.hasFocus()) addressInput.setText(tab.home ? "" : tab.url);
        }
        updateToolbarState();
    }

    private void switchTab(int index) {
        if (index < 0 || index >= tabs.size()) return;
        activeIndex = index;
        attachActiveTab();
        persistTabs();
    }

    private void closeTab(int index) {
        if (index < 0 || index >= tabs.size()) return;
        BrowserTab tab = tabs.remove(index);
        if (tab.webView != null) {
            ViewGroup parent = (ViewGroup) tab.webView.getParent();
            if (parent != null) parent.removeView(tab.webView);
            tab.webView.stopLoading();
            tab.webView.destroy();
        }
        if (tabs.isEmpty()) {
            activeIndex = 0;
            createTab(null, false);
        } else {
            if (index < activeIndex) activeIndex--;
            else if (index == activeIndex) activeIndex = Math.max(0, activeIndex - 1);
            attachActiveTab();
        }
        updateToolbarState();
        persistTabs();
    }

    private WebView createWebView(BrowserTab tab) {
        WebView webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(!dataSaver);
        settings.setBlockNetworkImage(dataSaver);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        applyUserAgent(settings);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return routeUrl(view, request.getUrl().toString(), request.isForMainFrame());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeUrl(view, url, true);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                int tabIndex = indexOf(tab);
                if (tabIndex == activeIndex) {
                    if (progressBar != null) { progressBar.setVisibility(View.VISIBLE); progressBar.setProgress(8); }
                    if (isHttpUrl(url)) {
                        tab.home = false;
                        tab.url = url;
                        if (addressInput != null && !addressInput.hasFocus()) addressInput.setText(url);
                    }
                    updateToolbarState();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isHomeUrl(url)) {
                    tab.home = true;
                    tab.url = "";
                    tab.title = "تبويب جديد";
                } else if (isHttpUrl(url)) {
                    tab.home = false;
                    tab.url = url;
                    if (tab.title == null || tab.title.isEmpty() || "تبويب جديد".equals(tab.title)) tab.title = hostTitle(url);
                    addHistory(tab.title, url);
                }
                int tabIndex = indexOf(tab);
                if (tabIndex == activeIndex) {
                    if (progressBar != null) { progressBar.setProgress(100); progressBar.setVisibility(View.GONE); }
                    if (addressInput != null && !addressInput.hasFocus()) addressInput.setText(tab.home ? "" : tab.url);
                    updateToolbarState();
                }
                persistTabs();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && indexOf(tab) == activeIndex) {
                    if (progressBar != null) progressBar.setVisibility(View.GONE);
                    Toast.makeText(MainActivity.this, "ما قدرناش نحملو الصفحة. تأكد من الاتصال وحاول مرة أخرى.", Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Never bypass certificate warnings in a browser.
                handler.cancel();
                if (indexOf(tab) == activeIndex) Toast.makeText(MainActivity.this, "اتصال HTTPS غير موثوق، تم إيقاف الصفحة للحماية.", Toast.LENGTH_LONG).show();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (indexOf(tab) == activeIndex && progressBar != null) {
                    progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                    progressBar.setProgress(newProgress);
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (title != null && !title.trim().isEmpty() && !isHomeUrl(view.getUrl())) tab.title = title.trim();
                if (indexOf(tab) == activeIndex) updateToolbarState();
                persistTabs();
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (!isUserGesture || tabs.size() >= MAX_TABS) return false;
                createTab(null, false);
                BrowserTab newTab = currentTab();
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(newTab.webView);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                int index = -1;
                for (int i = 0; i < tabs.size(); i++) if (tabs.get(i).webView == window) { index = i; break; }
                if (index >= 0) closeTab(index);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
                fullScreenView = view;
                fullScreenCallback = callback;
                pageColumn.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent;
                try {
                    intent = params.createIntent();
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "ما كاينش تطبيق لاختيار الملفات.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> startDownload(url, userAgent, contentDisposition, mimeType));
        return webView;
    }

    private void hideCustomView() {
        if (fullScreenView == null) return;
        root.removeView(fullScreenView);
        fullScreenView = null;
        pageColumn.setVisibility(View.VISIBLE);
        root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        configureSystemBars();
        WebChromeClient.CustomViewCallback callback = fullScreenCallback;
        fullScreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private boolean routeUrl(WebView view, String rawUrl, boolean mainFrame) {
        if (rawUrl == null) return true;
        Uri uri = Uri.parse(rawUrl);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("http".equals(scheme) || "https".equals(scheme) || "about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)) return false;
        if ("file".equals(scheme) || "javascript".equals(scheme)) return true;
        try {
            Intent intent;
            if ("intent".equals(scheme)) {
                intent = Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME);
                if (intent.getPackage() != null) {
                    try { startActivity(intent); return true; } catch (ActivityNotFoundException ignored) { }
                }
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null && isHttpUrl(fallback)) { view.loadUrl(fallback); return true; }
                return true;
            }
            intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (Exception ignored) {
            if (mainFrame) Toast.makeText(this, "ما قدرناش نفتح هاد الرابط.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void loadHome(BrowserTab tab) {
        if (tab == null || tab.webView == null) return;
        tab.home = true;
        tab.url = "";
        tab.title = "تبويب جديد";
        tab.webView.loadDataWithBaseURL(HOME_BASE, homeHtml(), "text/html", "UTF-8", null);
        if (indexOf(tab) == activeIndex && addressInput != null && !addressInput.hasFocus()) addressInput.setText("");
        persistTabs();
        updateToolbarState();
    }

    private String homeHtml() {
        return "<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><meta name='color-scheme' content='light'><title>Neurio</title>" +
                "<style>*{box-sizing:border-box}body{margin:0;padding:28px 18px 38px;font-family:system-ui,'Noto Sans Arabic',sans-serif;color:#172432;background:#f4f7fb;text-align:center}.mark{width:62px;height:62px;display:grid;place-items:center;margin:7vh auto 16px;border-radius:21px;color:#fff;background:linear-gradient(145deg,#219486,#145e70);font-size:29px;font-weight:800;box-shadow:0 12px 28px #176e7230}h1{margin:0;font-size:26px}h1 span{color:#187d77}p{margin:9px auto 23px;max-width:380px;color:#758394;font-size:13px;line-height:1.9}.links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;max-width:500px;margin:0 auto}.links a{min-height:76px;display:flex;align-items:center;gap:12px;padding:13px;border:1px solid #e6edf2;border-radius:17px;color:#172432;background:#fff;text-decoration:none;text-align:right;box-shadow:0 6px 20px #1b31450b}.icon{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:13px;color:#fff;background:#e84545;font-weight:800}.g{color:#4285f4;background:#edf3ff}.w{color:#263645;background:#eef2f4}.m{color:#458e78;background:#e5f4ef;font-size:22px}.name{font-size:12px;font-weight:700;direction:ltr;text-align:right}.hint{margin:24px auto 0;padding:12px 14px;max-width:500px;border-radius:13px;color:#637484;background:#eaf1f5;font-size:10px;line-height:1.9;text-align:right}@media(max-width:360px){body{padding-inline:12px}.links{gap:8px}.links a{padding:9px}.name{font-size:11px}}</style></head><body>" +
                "<div class='mark'>N</div><h1>مرحبا بك في <span>Neurio</span></h1><p>بحث سريع، مواقعك المفضلة، وتجربة تصفح بسيطة. اكتب عنواناً أو بحثاً في الشريط أعلاه.</p>" +
                "<div class='links'><a href='https://www.youtube.com'><span class='icon'>▶</span><span class='name'>YouTube</span></a><a href='https://www.google.com'><span class='icon g'>G</span><span class='name'>Google</span></a><a href='https://www.wikipedia.org'><span class='icon w'>W</span><span class='name'>Wikipedia</span></a><a href='https://maps.google.com'><span class='icon m'>⌖</span><span class='name'>Maps</span></a></div>" +
                "<div class='hint'><b>الفيديو:</b> خلي جودة YouTube على Auto باش تنقص فرصة التقطيع. الاتصال البطيء ما كيضمنش جودة عالية مستمرة.</div></body></html>";
    }

    private void loadUrl(BrowserTab tab, String url) {
        if (tab == null || tab.webView == null) return;
        if (!isHttpUrl(url)) { loadHome(tab); return; }
        tab.home = false;
        tab.url = url;
        tab.title = hostTitle(url);
        tab.webView.loadUrl(url);
        if (indexOf(tab) == activeIndex && addressInput != null) addressInput.setText(url);
        updateToolbarState();
        persistTabs();
    }

    private void loadInCurrentTab(String url) {
        if (tabs.isEmpty()) createTab(url, false); else loadUrl(currentTab(), url);
    }

    private void openAddressFromField() {
        String input = addressInput.getText().toString().trim();
        if (input.isEmpty()) { addressInput.requestFocus(); return; }
        String url;
        if (input.matches("(?i)^https?://.*")) {
            url = input;
        } else if (!input.contains(" ") && input.matches("(?i)^(localhost(?::\\d+)?|(?:[a-z0-9-]+\\.)+[a-z]{2,}(?::\\d+)?(?:/.*|\\?.*|#.*)?)$")) {
            url = "https://" + input;
        } else {
            url = "https://www.google.com/search?q=" + Uri.encode(input);
        }
        try {
            Uri parsed = Uri.parse(url);
            if (!isHttpUrl(parsed.toString())) throw new IllegalArgumentException("Invalid web URL");
        } catch (Exception error) {
            url = "https://www.google.com/search?q=" + Uri.encode(input);
        }
        hideKeyboard();
        addressInput.clearFocus();
        loadInCurrentTab(url);
    }

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null && addressInput != null) imm.hideSoftInputFromWindow(addressInput.getWindowToken(), 0);
        } catch (Exception ignored) { }
    }

    private void updateToolbarState() {
        if (tabs.isEmpty()) return;
        BrowserTab tab = currentTab();
        if (tab == null) return;
        if (tabButton != null) tabButton.setText("▢ " + tabs.size() + " تبويب");
        if (addressInput != null && !addressInput.hasFocus()) addressInput.setText(tab.home ? "" : tab.url);
        if (backButton != null) backButton.setAlpha(tab.webView != null && tab.webView.canGoBack() ? 1f : .55f);
        if (forwardButton != null) forwardButton.setAlpha(tab.webView != null && tab.webView.canGoForward() ? 1f : .55f);
        if (bookmarkButton != null) {
            boolean saved = !tab.home && isBookmarked(tab.url);
            bookmarkButton.setText(saved ? "★ محفوظ" : "☆ حفظ");
            bookmarkButton.setTextColor(saved ? COLOR_ACCENT : COLOR_MUTED);
        }
        if (saverButton != null) {
            saverButton.setText(dataSaver ? "✓ توفير البيانات" : "✦ توفير البيانات");
            saverButton.setTextColor(dataSaver ? COLOR_ACCENT : COLOR_MUTED);
            saverButton.setBackground(round(dataSaver ? Color.rgb(229, 245, 241) : COLOR_PANEL, 12, COLOR_LINE));
        }
    }

    private boolean isHttpUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        return scheme != null && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && uri.getHost() != null;
    }

    private boolean isHomeUrl(String url) {
        return url != null && (url.startsWith(HOME_BASE) || url.startsWith("about:blank"));
    }

    private String hostTitle(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return "موقع ويب";
            return host.startsWith("www.") ? host.substring(4) : host;
        } catch (Exception error) { return "موقع ويب"; }
    }

    private void setDataSaver(boolean enabled) {
        dataSaver = enabled;
        preferences.edit().putBoolean("data_saver", enabled).apply();
        for (BrowserTab tab : tabs) {
            if (tab.webView != null) {
                WebSettings settings = tab.webView.getSettings();
                settings.setLoadsImagesAutomatically(!enabled);
                settings.setBlockNetworkImage(enabled);
            }
        }
        updateToolbarState();
        Toast.makeText(this, enabled ? "توفير البيانات شغال: تحميل الصور متوقف. حدّث الصفحة الحالية لتطبيق التغيير." : "توفير البيانات توقف.", Toast.LENGTH_LONG).show();
    }

    private void applyUserAgent(WebSettings settings) {
        if (!desktopMode) {
            settings.setUserAgentString(null);
            return;
        }
        String ua = WebSettings.getDefaultUserAgent(this);
        ua = ua.replace("; wv", "").replace(" Mobile", "").replace(" Android", "");
        settings.setUserAgentString(ua);
    }

    private void toggleDesktopMode() {
        desktopMode = !desktopMode;
        preferences.edit().putBoolean("desktop_mode", desktopMode).apply();
        for (BrowserTab tab : tabs) {
            if (tab.webView != null) {
                applyUserAgent(tab.webView.getSettings());
                tab.webView.getSettings().setUseWideViewPort(true);
                tab.webView.getSettings().setLoadWithOverviewMode(true);
            }
        }
        Toast.makeText(this, desktopMode ? "وضع سطح المكتب تفعّل؛ غادي نعاود نحمل الصفحة." : "رجعنا لوضع الهاتف.", Toast.LENGTH_SHORT).show();
        WebView web = currentWebView();
        if (web != null && !currentTab().home) web.reload();
    }

    private void toggleBookmark() {
        BrowserTab tab = currentTab();
        if (tab == null || tab.home || !isHttpUrl(tab.url)) {
            Toast.makeText(this, "فتح شي موقع أولاً باش تحفظو.", Toast.LENGTH_SHORT).show();
            return;
        }
        ArrayList<JSONObject> list = readObjectList("bookmarks");
        int found = -1;
        for (int i = 0; i < list.size(); i++) if (tab.url.equals(list.get(i).optString("url"))) { found = i; break; }
        if (found >= 0) {
            list.remove(found);
            Toast.makeText(this, "تحيدات العلامة المحفوظة.", Toast.LENGTH_SHORT).show();
        } else {
            JSONObject item = new JSONObject();
            try { item.put("title", tab.title); item.put("url", tab.url); } catch (JSONException ignored) { }
            list.add(0, item);
            Toast.makeText(this, "تحفظ الموقع في العلامات.", Toast.LENGTH_SHORT).show();
        }
        writeObjectList("bookmarks", list);
        updateToolbarState();
    }

    private boolean isBookmarked(String url) {
        if (url == null) return false;
        for (JSONObject item : readObjectList("bookmarks")) if (url.equals(item.optString("url"))) return true;
        return false;
    }

    private void showBookmarks() {
        ArrayList<JSONObject> bookmarks = readObjectList("bookmarks");
        if (bookmarks.isEmpty()) {
            new AlertDialog.Builder(this).setTitle("العلامات").setMessage("مازال ما حفظتي حتى موقع. ضغط على ☆ حفظ فاش تفتح صفحة.")
                    .setPositiveButton("مفهوم", null).show();
            return;
        }
        String[] labels = new String[bookmarks.size()];
        for (int i = 0; i < bookmarks.size(); i++) labels[i] = bookmarks.get(i).optString("title", "موقع") + "\n" + bookmarks.get(i).optString("url", "");
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("العلامات المحفوظة")
                .setItems(labels, (d, which) -> loadInCurrentTab(bookmarks.get(which).optString("url")))
                .setPositiveButton("إضافة الصفحة الحالية", (d, which) -> toggleBookmark())
                .setNegativeButton("إغلاق", null).create();
        dialog.setOnShowListener(d -> dialog.getListView().setOnItemLongClickListener((parent, view, position, id) -> {
            JSONObject item = bookmarks.get(position);
            new AlertDialog.Builder(this).setMessage("تحيد " + item.optString("title", "هاد الموقع") + " من العلامات؟")
                    .setNegativeButton("إلغاء", null).setPositiveButton("حذف", (confirm, which) -> {
                        ArrayList<JSONObject> updated = readObjectList("bookmarks");
                        String url = item.optString("url");
                        for (int i = updated.size() - 1; i >= 0; i--) {
                            if (url.equals(updated.get(i).optString("url"))) updated.remove(i);
                        }
                        writeObjectList("bookmarks", updated);
                        dialog.dismiss(); showBookmarks();
                    }).show();
            return true;
        }));
        dialog.show();
    }

    private void showHistory() {
        ArrayList<JSONObject> history = readObjectList("history");
        if (history.isEmpty()) {
            new AlertDialog.Builder(this).setTitle("سجل التصفح").setMessage("مازال ما كاين حتى موقع فالسجل.")
                    .setPositiveButton("مفهوم", null).show();
            return;
        }
        String[] labels = new String[Math.min(history.size(), 40)];
        for (int i = 0; i < labels.length; i++) labels[i] = history.get(i).optString("title", "موقع") + "\n" + history.get(i).optString("url", "");
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("آخر المواقع")
                .setItems(labels, (d, which) -> loadInCurrentTab(history.get(which).optString("url")))
                .setPositiveButton("مسح السجل", (d, which) -> {
                    preferences.edit().remove("history").apply();
                    Toast.makeText(this, "تم مسح سجل التصفح.", Toast.LENGTH_SHORT).show();
                }).setNegativeButton("إغلاق", null).create();
        dialog.show();
    }

    private void showTabs() {
        String[] labels = new String[tabs.size()];
        for (int i = 0; i < tabs.size(); i++) {
            BrowserTab tab = tabs.get(i);
            labels[i] = (i == activeIndex ? "●  " : "○  ") + tab.title + (tab.home ? "\nصفحة رئيسية" : "\n" + tab.url);
        }
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("علامات التبويب · " + tabs.size())
                .setItems(labels, (d, which) -> switchTab(which))
                .setPositiveButton("＋ تبويب جديد", (d, which) -> createTab(null, true))
                .setNegativeButton("إغلاق", null).create();
        dialog.setOnShowListener(d -> dialog.getListView().setOnItemLongClickListener((parent, view, position, id) -> {
            if (tabs.size() <= 1) {
                Toast.makeText(this, "خلي على الأقل تبويب واحد.", Toast.LENGTH_SHORT).show();
                return true;
            }
            closeTab(position);
            dialog.dismiss();
            showTabs();
            return true;
        }));
        dialog.show();
    }

    private void showMenu(View anchor) {
        android.widget.PopupMenu menu = new android.widget.PopupMenu(this, anchor);
        menu.getMenu().add(Menu.NONE, 1, 1, "＋ تبويب جديد");
        menu.getMenu().add(Menu.NONE, 2, 2, "علامات التبويب");
        menu.getMenu().add(Menu.NONE, 3, 3, "العلامات المحفوظة");
        menu.getMenu().add(Menu.NONE, 4, 4, "سجل التصفح");
        menu.getMenu().add(Menu.NONE, 5, 5, "التنزيلات");
        menu.getMenu().add(Menu.NONE, 6, 6, dataSaver ? "إيقاف توفير البيانات" : "توفير البيانات (الصور)");
        menu.getMenu().add(Menu.NONE, 7, 7, desktopMode ? "إيقاف وضع سطح المكتب" : "عرض نسخة سطح المكتب");
        menu.getMenu().add(Menu.NONE, 8, 8, "مشاركة الصفحة");
        menu.getMenu().add(Menu.NONE, 9, 9, "إعدادات الأداء والفيديو");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: createTab(null, true); return true;
                case 2: showTabs(); return true;
                case 3: showBookmarks(); return true;
                case 4: showHistory(); return true;
                case 5: openDownloads(); return true;
                case 6: setDataSaver(!dataSaver); return true;
                case 7: toggleDesktopMode(); return true;
                case 8: shareCurrentPage(); return true;
                case 9: showPerformanceInfo(); return true;
                default: return false;
            }
        });
        menu.show();
    }

    private void showPerformanceInfo() {
        new AlertDialog.Builder(this).setTitle("الأداء وجودة الفيديو")
                .setMessage("توفير البيانات يوقف تحميل الصور، وقد يخلي شكل بعض المواقع ناقص. الكاش كيساعد فالموارد اللي تزارت من قبل، لكن ما كيخزنش كل صفحة أو فيديو.\n\nفـ YouTube ختار Auto لتقليل التقطيع. التطبيق ما كيفرضش 720p: جودة الفيديو كتحددها الشبكة وYouTube والخادم.")
                .setPositiveButton("مفهوم", null).setNeutralButton("تفعيل توفير البيانات", (d, w) -> setDataSaver(!dataSaver)).show();
    }

    private void openDownloads() {
        try {
            startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "مدير التنزيلات ديال النظام ما متوفرش.", Toast.LENGTH_SHORT).show();
        }
    }

    private void startDownload(String url, String userAgent, String disposition, String mimeType) {
        if (!isHttpUrl(url)) {
            Toast.makeText(this, "هاد النوع ديال الرابط ما نقدرش ننزلوه.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28 &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = new String[]{url, userAgent == null ? "" : userAgent, disposition == null ? "" : disposition, mimeType == null ? "" : mimeType};
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 4103);
            return;
        }
        enqueueDownload(url, userAgent, disposition, mimeType);
    }

    private void enqueueDownload(String url, String userAgent, String disposition, String mimeType) {
        try {
            String fileName = URLUtil.guessFileName(url, disposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("Neurio Browser");
            if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            if (Build.VERSION.SDK_INT >= 24) request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            if (userAgent != null && !userAgent.isEmpty()) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("Download service unavailable");
            manager.enqueue(request);
            Toast.makeText(this, "بدا التنزيل. تقدر تتابعو فالإشعارات أو التنزيلات.", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "ما قدرناش نبداو التنزيل.", Toast.LENGTH_LONG).show();
        }
    }

    private void shareCurrentPage() {
        BrowserTab tab = currentTab();
        if (tab == null || tab.home || !isHttpUrl(tab.url)) {
            Toast.makeText(this, "فتح صفحة باش تقدر تشاركها.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, tab.url);
        startActivity(Intent.createChooser(send, "مشاركة الصفحة"));
    }

    private void updateNetworkStatus() {
        try {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo info = manager == null ? null : manager.getActiveNetworkInfo();
            boolean connected = info != null && info.isConnected();
            networkLabel.setText(connected ? "● متصل" : "○ بلا إنترنت");
            networkLabel.setTextColor(connected ? COLOR_ACCENT : Color.rgb(180, 91, 82));
        } catch (Exception error) {
            networkLabel.setText("الاتصال");
        }
    }

    private void addHistory(String title, String url) {
        if (!isHttpUrl(url) || isHomeUrl(url)) return;
        ArrayList<JSONObject> history = readObjectList("history");
        for (int i = history.size() - 1; i >= 0; i--) {
            if (url.equals(history.get(i).optString("url"))) history.remove(i);
        }
        JSONObject entry = new JSONObject();
        try { entry.put("title", title == null || title.isEmpty() ? hostTitle(url) : title); entry.put("url", url); entry.put("visited", System.currentTimeMillis()); }
        catch (JSONException ignored) { }
        history.add(0, entry);
        while (history.size() > 100) history.remove(history.size() - 1);
        writeObjectList("history", history);
    }

    private ArrayList<JSONObject> readObjectList(String key) {
        ArrayList<JSONObject> list = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(preferences.getString(key, "[]"));
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null && item.has("url")) list.add(item);
            }
        } catch (JSONException ignored) { }
        return list;
    }

    private void writeObjectList(String key, ArrayList<JSONObject> list) {
        JSONArray array = new JSONArray();
        for (JSONObject item : list) array.put(item);
        preferences.edit().putString(key, array.toString()).apply();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent == null ? null : intent.getData();
        if (data != null && isHttpUrl(data.toString())) loadInCurrentTab(data.toString());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER_REQUEST && fileChooserCallback != null) {
            Uri[] result = resultCode == RESULT_OK ? FileChooserParams.parseResult(resultCode, data) : null;
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 4103 && pendingDownload != null) {
            String[] download = pendingDownload;
            pendingDownload = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                enqueueDownload(download[0], download[1], download[2], download[3]);
            } else {
                Toast.makeText(this, "خاص الإذن باش نحفظ الملف فالتنزيلات.", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (fullScreenView != null) {
            hideCustomView();
            return;
        }
        if (addressInput != null && addressInput.hasFocus()) {
            hideKeyboard();
            addressInput.clearFocus();
            return;
        }
        WebView web = currentWebView();
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        if (tabs.size() > 1) { closeTab(activeIndex); return; }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        WebView web = currentWebView();
        if (web != null) web.onResume();
        updateNetworkStatus();
    }

    @Override
    protected void onPause() {
        for (BrowserTab tab : tabs) if (tab.webView != null) tab.webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) { fileChooserCallback.onReceiveValue(null); fileChooserCallback = null; }
        for (BrowserTab tab : tabs) {
            if (tab.webView != null) {
                ViewGroup parent = (ViewGroup) tab.webView.getParent();
                if (parent != null) parent.removeView(tab.webView);
                tab.webView.stopLoading();
                tab.webView.destroy();
            }
        }
        tabs.clear();
        super.onDestroy();
    }
}
