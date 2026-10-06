package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Runs a bundled HTML5 game straight from the APK — no internet needed. */
public class GameActivity extends Activity {

    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_ASSET = "asset";

    private WebView web;
    private ProgressBar spin;

    public static void open(Context c, String title, String asset) {
        Intent i = new Intent(c, GameActivity.class);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_ASSET, asset);
        c.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_game);
        web = findViewById(R.id.web);
        spin = findViewById(R.id.spin);

        String title = getIntent().getStringExtra(EXTRA_TITLE);
        final String asset = getIntent().getStringExtra(EXTRA_ASSET);
        ((TextView) findViewById(R.id.title)).setText(title == null ? getString(R.string.games_title) : title);

        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.reload).setOnClickListener(v -> web.reload());

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        if (Build.VERSION.SDK_INT >= 16) s.setAllowFileAccessFromFileURLs(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        s.setUserAgentString(Util.UA_MOBILE);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setBackgroundColor(0xFF000000);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                return true;
            }

            @Override
            public void onProgressChanged(WebView view, int p) {
                spin.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        web.loadUrl("file:///android_asset/" + (asset == null ? "games/bash-baqi-racing.html" : asset));
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            web.onPause();
            web.pauseTimers();
        } catch (Throwable ignored) { }
    }

    @Override
    protected void onResume() {
        super.onResume();
        try {
            web.onResume();
            web.resumeTimers();
        } catch (Throwable ignored) { }
    }

    @Override
    protected void onDestroy() {
        try {
            web.destroy();
        } catch (Throwable ignored) { }
        super.onDestroy();
    }
}
