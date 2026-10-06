package ma.zakaria.reelsoffline;

import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Build;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;

/**
 * Watches a WebView and collects every media url that goes through it.
 *
 *  - shouldInterceptRequest  -> sees the mp4/jpg requests Instagram itself makes
 *  - JS probe                -> reads <video src>, <img>, og:* after load
 *  - full HTML               -> the embed page embeds the signed CDN urls as JSON
 */
public class Sniffer {

    public interface Sink {
        void onMedia(boolean video, String url);

        void onPage(String html, String probeJson);

        void onLog(String line);
    }

    private final Sink sink;
    private final LinkedHashSet<String> videos = new LinkedHashSet<>();
    private final LinkedHashSet<String> images = new LinkedHashSet<>();
    private String lastProbe = null;
    private boolean desktop = true;

    private static final String JS_PROBE =
            "(function(){var o={videos:[],images:[],author:'',caption:'',title:document.title};" +
            "try{" +
            "var v=document.querySelectorAll('video');" +
            "for(var i=0;i<v.length;i++){var e=v[i];" +
            " if(e.currentSrc){o.videos.push(e.currentSrc);}" +
            " if(e.src){o.videos.push(e.src);}" +
            " var s=e.querySelectorAll('source');" +
            " for(var j=0;j<s.length;j++){if(s[j].src){o.videos.push(s[j].src);} if(s[j].getAttribute('src')){o.videos.push(s[j].getAttribute('src'));}}" +
            "}" +
            "var im=document.querySelectorAll('img');" +
            "for(var i2=0;i2<im.length;i2++){var g=im[i2];var src=g.currentSrc||g.src;" +
            " if(src){o.images.push(src);} var ss=g.getAttribute('srcset');" +
            " if(ss){var p=ss.split(',');for(var k=0;k<p.length;k++){var b=p[k].trim().split(' ');if(b.length>0&&b[0]){o.images.push(b[0]);}}}}" +
            "var us=document.querySelectorAll('a[href*=\"/p/\"],a[href*=\"/reel/\"]');" +
            "var m=location.pathname.match(/(p|reel|reels|tv)\\/([A-Za-z0-9_-]+)/);" +
            "if(m){o.author=o.author;}" +
            "var mt=document.querySelector('meta[property=\"og:description\"]');" +
            "if(mt){o.caption=mt.getAttribute('content');}" +
            "}catch(e){o.err=String(e);}" +
            "return JSON.stringify(o);})()";

    private static final String JS_PLAY =
            "(function(){try{var v=document.querySelectorAll('video');" +
            "for(var i=0;i<v.length;i++){v[i].muted=true;try{v[i].play();}catch(e){}}" +
            "window.scrollTo(0,1);}catch(e){}return 'ok';})()";

    public Sniffer(Sink sink) {
        this.sink = sink;
    }

    public void setDesktop(boolean d) {
        this.desktop = d;
    }

    public ArrayList<String> videos() {
        return new ArrayList<>(videos);
    }

    public ArrayList<String> images() {
        return new ArrayList<>(images);
    }

    public void clear() {
        videos.clear();
        images.clear();
        lastProbe = null;
    }

    /** Configures a WebView for browsing/extraction. */
    public void attach(WebView web) {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(desktop ? Util.UA_DESKTOP : Util.UA_MOBILE);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (Build.VERSION.SDK_INT >= 19) WebView.setWebContentsDebuggingEnabled(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onConsoleMessage(String m, int line, String src) {
                sink.onLog("js: " + m);
            }
        });
        web.setWebViewClient(new WebViewClient() {

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    see(request.getUrl().toString());
                }
                return null;
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                see(url);
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                probe(view);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                sink.onLog("loading " + Util.trimTo(url, 70));
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // some CDNs/ISP proxies use certificates the WebView dislikes
                handler.proceed();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false;
            }
        });
    }

    /** Runs the DOM probe + grabs the page HTML. */
    public void probe(final WebView web) {
        if (web == null) return;
        try {
            web.evaluateJavascript(JS_PLAY, null);
            web.evaluateJavascript(JS_PROBE, value -> {
                String json = unquote(value);
                lastProbe = json;
                try {
                    JSONObject o = new JSONObject(json);
                    JSONArray v = o.optJSONArray("videos");
                    if (v != null) for (int i = 0; i < v.length(); i++) see(v.optString(i));
                    JSONArray im = o.optJSONArray("images");
                    if (im != null) for (int i = 0; i < im.length(); i++) see(im.optString(i));
                } catch (Exception ignored) { }
                web.evaluateJavascript(
                        "(function(){try{return document.documentElement.outerHTML}catch(e){return ''}})()",
                        html -> sink.onPage(unquote(html), lastProbe));
            });
        } catch (Throwable t) {
            sink.onLog("probe failed: " + t);
        }
    }

    /** evaluateJavascript returns a JSON encoded string. */
    private static String unquote(String s) {
        if (s == null) return "";
        try {
            return new JSONArray("[" + s + "]").getString(0);
        } catch (Exception e) {
            return s;
        }
    }

    /** Feeds a url seen by the WebView network layer. */
    public void see(String url) {
        if (url == null) return;
        String clean = Util.cleanMediaUrl(url);
        if (clean == null || !clean.startsWith("http")) return;
        if (clean.startsWith("data:") || clean.startsWith("blob:")) return;
        String l = clean.toLowerCase();
        if (l.contains("instagram.com") && !l.contains("cdninstagram") && !l.contains("fbcdn")) {
            // API/analytics endpoints of the site itself are not media
            if (!Util.isVideoUrl(clean)) return;
        }
        if (Util.isVideoUrl(clean) || l.contains(".mp4") || l.contains("mime=video")) {
            if (videos.add(clean)) sink.onMedia(true, clean);
        } else if (l.contains("cdninstagram") || l.contains("fbcdn.net")
                || l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".webp")) {
            if (images.add(clean)) sink.onMedia(false, clean);
        }
    }

    public View.OnLongClickListener noop() {
        return null;
    }
}
