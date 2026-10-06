package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.ArrayList;

/**
 * Browse Instagram inside the app. Everything that looks like a video/photo on
 * the way through is collected, and one tap saves the one you are looking at.
 */
public class BrowserActivity extends Activity implements Sniffer.Sink {

    private WebView web;
    private Sniffer sniffer;
    private TextView counter;
    private TextView save;
    private ProgressBar spin;
    private ImageView desktopIcon;

    private final ArrayList<Extract.Media> found = new ArrayList<>();
    private boolean desktop = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private static final String HOME = "https://www.instagram.com/";
    private static final String LIMIT = "https://www.instagram.com/accounts/login/";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_browser);

        web = findViewById(R.id.web);
        counter = findViewById(R.id.counter);
        save = findViewById(R.id.save);
        spin = findViewById(R.id.spin);
        desktopIcon = findViewById(R.id.desktop);

        sniffer = new Sniffer(this);
        sniffer.attach(web);
        sniffer.setDesktop(false);
        web.clearCache(false);

        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.reload).setOnClickListener(v -> web.reload());
        desktopIcon.setOnClickListener(v -> {
            desktop = !desktop;
            String url = web.getUrl();
            sniffer.setDesktop(desktop);
            applyUa();
            desktopIcon.setAlpha(desktop ? 1f : 0.5f);
            if (url != null) web.loadUrl(url);
        });
        save.setOnClickListener(v -> pick());
        desktopIcon.setAlpha(0.5f);

        web.loadUrl(HOME);
        tick();
    }

    private void applyUa() {
        WebSettings s = web.getSettings();
        s.setUserAgentString(desktop ? Util.UA_DESKTOP : Util.UA_MOBILE);
    }

    private void tick() {
        ui.postDelayed(() -> {
            if (isFinishing()) return;
            int p = web.getProgress();
            spin.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            tick();
        }, 400);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        try {
            web.destroy();
        } catch (Throwable ignored) { }
        super.onDestroy();
    }

    /* ------------------------------------------------------------ Sniffer */

    @Override
    public void onMedia(boolean video, String url) {
        for (Extract.Media m : found) {
            if (m.url.equals(url)) return;
        }
        Extract.Media m = new Extract.Media(url, video);
        found.add(m);
        runOnUiThread(this::refresh);
    }

    @Override
    public void onPage(String html, String probeJson) {
        Extract.Result r = Extract.parse(html, probeJson, sniffer.videos(), sniffer.images());
        if (r.medias.isEmpty()) return;
        boolean addCover = r.cover != null;
        for (Extract.Media m : r.medias) {
            boolean dup = false;
            for (Extract.Media f : found) if (key(f.url).equals(key(m.url))) dup = true;
            if (!dup) found.add(m);
        }
        if (addCover) {
            boolean dup = false;
            for (Extract.Media f : found) if (key(f.url).equals(key(r.cover))) dup = true;
            if (!dup) found.add(new Extract.Media(r.cover, false));
        }
        // remember author/caption of this page for the download titles
        if (r.author != null && !r.author.isEmpty()) lastAuthor = r.author;
        if (r.caption != null && !r.caption.isEmpty()) lastCaption = r.caption;
        runOnUiThread(this::refresh);
    }

    private String lastAuthor = "";
    private String lastCaption = "";

    @Override
    public void onLog(String line) {
    }

    private static String key(String url) {
        String u = Util.stripQuery(url);
        int i = u.lastIndexOf('/');
        return i >= 0 ? u.substring(i) : u;
    }

    private void refresh() {
        int n = found.size();
        counter.setText(n == 0 ? getString(R.string.browse_tip) : getString(R.string.browse_save_n, n));
        save.setAlpha(n == 0 ? 0.45f : 1f);
    }

    /* -------------------------------------------------------------- save */

    private void pick() {
        if (found.isEmpty()) {
            Util.toast(this, getString(R.string.add_fail));
            return;
        }
        final ArrayList<Extract.Media> list = new ArrayList<>(found);
        final String[] labels = new String[list.size()];
        final boolean[] checked = new boolean[list.size()];
        for (int i = 0; i < list.size(); i++) {
            Extract.Media m = list.get(i);
            String kind = m.video ? "🎬 فيديو" : "🖼 صورة";
            labels[i] = kind + "  #" + (i + 1);
            checked[i] = m.video;      // pre-select the videos, they are what we want
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.browse_pick)
                .setMultiChoiceItems(labels, checked, (d, which, isChecked) -> checked[which] = isChecked)
                .setPositiveButton(R.string.add_down, (d, w) -> {
                    ArrayList<Extract.Media> pick = new ArrayList<>();
                    for (int i = 0; i < list.size(); i++) if (checked[i]) pick.add(list.get(i));
                    if (pick.isEmpty()) return;
                    started = false;
                    for (Extract.Media m : pick) enqueueSingle(m);
                    found.removeAll(pick);
                    refresh();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private boolean started = false;

    private void enqueueSingle(Extract.Media m) {
        DownloadService.Job job = new DownloadService.Job();
        job.id = "br_" + Util.md5(m.url).substring(0, 12) + "_" + (System.currentTimeMillis() / 1000);
        job.kind = m.video ? "video" : "photo";
        job.url = web.getUrl() == null ? HOME : web.getUrl();
        job.author = lastAuthor;
        job.caption = lastCaption;
        job.title = !lastAuthor.isEmpty() ? "@" + lastAuthor
                : (m.video ? "ريل من التصفح" : "صورة من التصفح");
        ArrayList<Extract.Media> one = new ArrayList<>();
        one.add(m);
        job.medias = one;
        job.cookie = AddActivity.cookiesFor(m.url);
        DownloadService.enqueue(this, job);
        started = true;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
