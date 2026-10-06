package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.TextView;

import java.util.ArrayList;

/**
 * Paste (or share) an Instagram link → the app loads the public embed page in a
 * hidden WebView, extracts the real CDN url and downloads it.
 */
public class AddActivity extends Activity implements Sniffer.Sink {

    private EditText urlField;
    private TextView status;
    private WebView web;
    private Sniffer sniffer;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private String shortcode = "";
    private String sourceUrl = "";
    private boolean finished = false;
    private int tries = 0;
    private int attempt = 0;
    private Extract.Result lastResult;

    /** 1: embed page (mobile) · 2: embed page (desktop) · 3: the post itself */
    private static final int MAX_ATTEMPTS = 3;
    private static final int TICKS_PER_ATTEMPT = 8;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_add);

        urlField = findViewById(R.id.url);
        status = findViewById(R.id.status);
        web = findViewById(R.id.web);

        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.paste).setOnClickListener(v -> pasteFromClipboard());
        findViewById(R.id.go).setOnClickListener(v -> analyse());
        findViewById(R.id.browseBtn).setOnClickListener(v -> startActivity(new Intent(this, BrowserActivity.class)));

        sniffer = new Sniffer(this);
        sniffer.attach(web);
        web.setBackgroundColor(0x00000000);

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    /* ------------------------------------------------------------ intent */

    private void handleIntent(Intent i) {
        if (i == null) return;
        String text = null;
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            text = i.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null) text = i.getStringExtra(Intent.EXTRA_SUBJECT);
        } else if (Intent.ACTION_VIEW.equals(i.getAction())) {
            text = i.getDataString();
        }
        if (text == null) {
            text = clipboardText();
            if (text != null && Util.shortcode(text) != null) {
                urlField.setText(text.trim());
                say(getString(R.string.add_ready));
            }
            return;
        }
        urlField.setText(text.trim());
        urlField.setSelection(urlField.getText().length());
        analyse();
    }

    private String clipboardText() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                CharSequence s = cm.getPrimaryClip().getItemAt(0).coerceToText(this);
                return s == null ? null : s.toString();
            }
        } catch (Throwable ignored) { }
        return null;
    }

    private void pasteFromClipboard() {
        String s = clipboardText();
        if (s == null || s.trim().isEmpty()) {
            Util.toast(this, "الحافظة خاوية");
            return;
        }
        urlField.setText(s.trim());
        urlField.setSelection(urlField.getText().length());
        say(getString(R.string.add_ready));
    }

    private void say(String s) {
        status.setText(s);
    }

    /* ----------------------------------------------------------- analyse */

    private void analyse() {
        String raw = urlField.getText().toString().trim();
        if (TextUtils.isEmpty(raw)) {
            say(getString(R.string.add_bad_link));
            return;
        }
        String u = Util.firstUrl(raw);
        if (u == null) u = raw;

        if (!Util.online(this)) {
            say(getString(R.string.add_offline));
            return;
        }

        finished = false;
        tries = 0;
        lastResult = null;

        if (Util.isDirectMedia(u)) {
            sourceUrl = u;
            shortcode = Util.md5(u).substring(0, 10);
            ArrayList<Extract.Media> one = new ArrayList<>();
            one.add(new Extract.Media(u, Util.isVideoUrl(u)));
            download(one, null, "");
            return;
        }

        if (!Util.isInstagram(u)) {
            say(getString(R.string.add_bad_link));
            return;
        }
        String code = Util.shortcode(u);
        if (code == null) {
            say(getString(R.string.add_bad_link));
            return;
        }
        shortcode = code;
        sourceUrl = u;
        attempt = 0;
        nextAttempt();
        if (android.os.Build.VERSION.SDK_INT >= 19) web.resumeTimers();
        say(getString(R.string.add_analyzing));
        ui.postDelayed(poll, 900);
    }

    /** Walks through every page variant that can expose the media. */
    private void nextAttempt() {
        if (finished || isFinishing()) return;
        if (lastResult != null) return;
        attempt++;
        if (attempt > MAX_ATTEMPTS) return;
        sniffer.clear();
        boolean desktop;
        String url;
        if (attempt == 1) {
            desktop = false;
            url = Util.embedUrl(shortcode);
        } else if (attempt == 2) {
            desktop = true;
            url = Util.embedUrl(shortcode);
        } else {
            desktop = true;
            url = "https://www.instagram.com/p/" + shortcode + "/";
        }
        sniffer.setDesktop(desktop);
        try {
            web.getSettings().setUserAgentString(desktop ? Util.UA_DESKTOP : Util.UA_MOBILE);
        } catch (Throwable ignored) { }
        web.loadUrl(url);
    }

    /** Last resort: let the user grab it from the built-in browser. */
    private void offerBrowser() {
        if (isFinishing() || finished) return;
        new AlertDialog.Builder(this)
                .setTitle(R.string.add_fail)
                .setMessage(R.string.browse_tip)
                .setPositiveButton(R.string.btn_browse, (d, w) ->
                        startActivity(new Intent(this, BrowserActivity.class)))
                .setNegativeButton(R.string.close, null)
                .show();
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (finished || isFinishing()) return;
            tries++;
            sniffer.probe(web);
            // the sniffer may already have a real media url from the network layer
            if (!sniffer.videos().isEmpty() || !sniffer.images().isEmpty()) {
                ui.postDelayed(check, 1200);
            }
            if (tries % TICKS_PER_ATTEMPT == 0) {
                nextAttempt();                       // different page / user agent
                if (finished) return;
            }
            if (tries < MAX_ATTEMPTS * TICKS_PER_ATTEMPT + TICKS_PER_ATTEMPT) {
                ui.postDelayed(this, 1300);
            } else if (lastResult == null) {
                say(getString(R.string.add_fail));
                ui.post(() -> offerBrowser());
            }
        }
    };

    private final Runnable check = new Runnable() {
        @Override
        public void run() {
            if (finished || isFinishing()) return;
            if (lastResult != null) return;
            // only the network sniffer output here: if the post turns out to be a
            // photo carousel we wait for the HTML parse instead of grabbing avatars
            if (sniffer.videos().isEmpty()) return;
            Extract.Result r = Extract.parse(null, null, sniffer.videos(), null);
            if (!r.medias.isEmpty()) {
                lastResult = r;
                proceed(r);
            }
        }
    };

    /* ------------------------------------------------------------ Sniffer */

    @Override
    public void onMedia(boolean video, String url) {
        runOnUiThread(() -> {
            if (finished) return;
            int n = sniffer.videos().size() + sniffer.images().size();
            if (n > 0 && lastResult == null) {
                say((video ? "🎬 " : "🖼 ") + getString(R.string.dl_started) + " (" + n + ")");
            }
        });
    }

    @Override
    public void onPage(String html, String probeJson) {
        if (finished || isFinishing()) return;
        final Extract.Result r = Extract.parse(html, probeJson, sniffer.videos(), sniffer.images());
        if (r.medias.isEmpty()) return;
        runOnUiThread(() -> {
            if (finished) return;
            lastResult = r;
            proceed(r);
        });
    }

    @Override
    public void onLog(String line) {
        // kept silent: only interesting while debugging
    }

    /* ----------------------------------------------------------- proceed */

    private void proceed(Extract.Result r) {
        ui.removeCallbacksAndMessages(null);
        final String author = r.author == null ? "" : r.author;
        final String caption = r.caption == null ? "" : r.caption;

        if (r.medias.size() == 1 || r.hasVideo()) {
            ArrayList<Extract.Media> pick = new ArrayList<>();
            if (r.hasVideo()) {
                pick.add(r.best());
            } else {
                pick.addAll(r.medias);
            }
            String what = r.hasVideo() ? getString(R.string.add_found_video) : getString(R.string.add_found_photo);
            say(what);
            download(pick, r.cover, "");
            return;
        }

        // carousel: let the user pick which pictures to keep
        final String[] labels = new String[r.medias.size()];
        for (int i = 0; i < r.medias.size(); i++) labels[i] = "🖼 صورة " + (i + 1);
        final boolean[] checked = new boolean[r.medias.size()];
        for (int i = 0; i < checked.length; i++) checked[i] = true;
        new AlertDialog.Builder(this)
                .setTitle(R.string.browse_pick)
                .setMultiChoiceItems(labels, checked, (d, which, isChecked) -> checked[which] = isChecked)
                .setPositiveButton(R.string.add_down, (d, w) -> {
                    ArrayList<Extract.Media> pick = new ArrayList<>();
                    for (int i = 0; i < r.medias.size(); i++) if (checked[i]) pick.add(r.medias.get(i));
                    if (pick.isEmpty()) return;
                    say(getString(R.string.add_found_photo));
                    download(pick, r.cover, "");
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void download(ArrayList<Extract.Media> medias, String cover, String referer) {
        if (medias.isEmpty()) {
            say(getString(R.string.add_fail));
            return;
        }
        finished = true;
        String first = medias.get(0).url;

        DownloadService.Job job = new DownloadService.Job();
        job.shortcode = shortcode;
        job.id = "ig_" + (shortcode == null ? Util.md5(first).substring(0, 10) : shortcode)
                + "_" + (System.currentTimeMillis() / 1000);
        job.url = Util.isInstagram(sourceUrl) ? sourceUrl : (referer == null ? first : referer);
        job.cover = cover;
        job.kind = medias.get(0).video ? "video" : "photo";
        job.medias = medias;
        job.author = "";
        job.caption = "";
        job.title = "";
        if (lastResult != null) {
            job.author = lastResult.author == null ? "" : lastResult.author;
            job.caption = lastResult.caption == null ? "" : lastResult.caption;
            if (job.title.isEmpty() && !job.caption.isEmpty()) job.title = Util.trimTo(job.caption, 60);
            if (job.title.isEmpty() && !job.author.isEmpty()) job.title = "@" + job.author;
        }
        job.cookie = cookiesFor(first);
        tries = 0;
        DownloadService.enqueue(this, job);

        Util.toast(this, getString(R.string.add_saved));
        ui.postDelayed(this::finish, 500);
    }

    static String cookiesFor(String mediaUrl) {
        try {
            CookieManager cm = CookieManager.getInstance();
            String a = cm.getCookie("https://www.instagram.com/");
            String b = mediaUrl == null ? null : cm.getCookie(mediaUrl);
            StringBuilder sb = new StringBuilder();
            if (a != null) sb.append(a);
            if (b != null && !b.isEmpty()) {
                if (sb.length() > 0) sb.append("; ");
                sb.append(b);
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }
}
