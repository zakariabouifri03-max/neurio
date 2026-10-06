import ma.zakaria.reelsoffline.Extract;
import ma.zakaria.reelsoffline.Sniffer;
import ma.zakaria.reelsoffline.Util;

import java.util.ArrayList;

/**
 * Desktop test harness for the two pieces that decide whether the app can save
 * anything at all: the HTML/JSON extractor and the WebView sniffer filter.
 *
 * Run with android/tools/test.sh — it compiles app sources against android.jar
 * with ecj and runs them on the JVM (the org/json shim in this folder replaces
 * the stubbed copy inside android.jar).
 */
public class ExtractTest {

    private static int passed = 0;
    private static int failed = 0;

    public static void main(String[] args) {
        reel();
        videoFallbackOnly();
        photoCarousel();
        singlePhoto();
        avatarOnly();
        captions();
        snifferFilter();

        System.out.println();
        System.out.println(failed == 0 ? ("ALL " + passed + " CHECKS PASSED ✅")
                : (failed + " CHECK(S) FAILED ❌  (" + passed + " passed)"));
        System.exit(failed == 0 ? 0 : 1);
    }

    /* ------------------------------------------------------------ fixtures */

    private static final String CDN = "https://scontent.cdninstagram.com/v/t51.2885-15/";

    private static String reelHtml() {
        return "<!DOCTYPE html><html><head>"
                + "<meta property=\"og:title\" content=\"Zakaria on Instagram: &quot;Beach day&quot;\" />"
                + "<meta property=\"og:image\" content=\"" + CDN + "COVER_s640x640.jpg?se=7&amp;stp=dst-jpg\" />"
                + "<meta property=\"og:video\" content=\"https://scontent.cdninstagram.com/v/t50.2886-16/"
                + "VID_n.mp4?bytestart=0&amp;byteend=999&amp;mime=video%2Fmp4\" />"
                + "</head><body><script>"
                + "{\"shortcode\":\"ABC123\","
                + "\"video_url\":\"https:\\/\\/scontent.cdninstagram.com\\/v\\/t50.2886-16\\/VID_n.mp4"
                + "?bytestart=0\\u0026byteend=999\","
                + "\"display_url\":\"" + CDN + "COVER_s640x640.jpg\","
                + "\"owner\":{\"username\":\"zak\",\"id\":\"42\"},"
                + "\"edge_media_to_caption\":{\"edges\":[{\"node\":{\"text\":\"Beach day\"}}]}}"
                + "</script>"
                + "<img class=\"EmbeddedMediaImage\" src=\"" + CDN + "AVATAR_s150x150.jpg\" />"
                + "</body></html>";
    }

    /* --------------------------------------------------------------- tests */

    private static void reel() {
        Extract.Result r = Extract.parse(reelHtml(), null, null, null);
        check("reel: media count", 1, r.medias.size());
        check("reel: is a video", true, r.hasVideo());
        check("reel: url cleaned", true, r.best().url.endsWith("/VID_n.mp4"));
        check("reel: referer-free cdn host", true, r.best().url.startsWith("https://scontent.cdninstagram.com/"));
        check("reel: author", "zak", r.author);
        check("reel: caption", "Beach day", r.caption);
        check("reel: cover picked (not avatar)", true,
                r.cover != null && r.cover.contains("COVER_s640x640"));
    }

    private static void videoFallbackOnly() {
        // no JSON blob at all: only <video src> + a sniffed url
        String html = "<html><body><video src=\"https://scontent.cdninstagram.com/v/t50/x.mp4\"></video>"
                + "<meta property=\"og:image\" content=\"" + CDN + "thumb.jpg\" /></body></html>";
        ArrayList<String> sniffed = new ArrayList<>();
        sniffed.add("https://scontent.cdninstagram.com/v/t50/y.mp4?bytestart=1");
        Extract.Result r = Extract.parse(html, null, sniffed, null);
        check("fallback: exactly one video kept", 1, r.medias.size());
        check("fallback: <video src> first", "https://scontent.cdninstagram.com/v/t50/x.mp4", r.medias.get(0).url);
        check("fallback: sniffed url kept as alternate", 1, r.medias.get(0).alts.size());
    }

    private static void photoCarousel() {
        String html = "<script>{\"shortcode\":\"C1\",\"edge_sidecar_to_children\":{\"edges\":["
                + "{\"node\":{\"display_url\":\"" + CDN + "A_s640x640.jpg\"}},"
                + "{\"node\":{\"display_url\":\"" + CDN + "B_s640x640.jpg\"}}]}}</script>";
        Extract.Result r = Extract.parse(html, null, null, null);
        check("carousel: two photos", 2, r.medias.size());
        check("carousel: no video", false, r.hasVideo());
        check("carousel: keeps order", true, r.medias.get(0).url.contains("/A_s640x640"));
    }

    private static void singlePhoto() {
        String html = "<meta property=\"og:image\" content=\"" + CDN + "only.jpg?se=1\" />";
        Extract.Result r = Extract.parse(html, null, null, null);
        check("photo: one media", 1, r.medias.size());
        check("photo: not a video", false, r.hasVideo());
        check("photo: query kept", true, r.medias.get(0).url.endsWith("only.jpg?se=1"));
    }

    private static void avatarOnly() {
        String html = "<img src=\"" + CDN + "profile_s150x150.jpg\" />";
        Extract.Result r = Extract.parse(html, null, null, null);
        check("avatar-only page: nothing found", 0, r.medias.size());
    }

    private static void captions() {
        check("caption: strips the og prefix", "Beach day 🏖",
                Extract.cleanCaption("1,234 likes, 56 comments - Zakaria (@zak) on Instagram: “Beach day 🏖”"));
        check("caption: plain text untouched", "hello", Extract.cleanCaption("hello"));
        check("caption: html entities", "a & b", Extract.cleanCaption("a &amp; b"));
        check("caption: null safe", "", Extract.cleanCaption(null));
    }

    private static void snifferFilter() {
        final ArrayList<String> videos = new ArrayList<>();
        final ArrayList<String> images = new ArrayList<>();
        Sniffer s = new Sniffer(new Sniffer.Sink() {
            public void onMedia(boolean video, String url) {
                (video ? videos : images).add(url);
            }

            public void onPage(String html, String probeJson) { }

            public void onLog(String line) { }
        });
        s.see("https://www.instagram.com/api/v1/media/123/info/");
        s.see("https://scontent.cdninstagram.com/v/t50.2886-16/VID.mp4?_nc_cat=1&bytestart=0");
        s.see("https://scontent.cdninstagram.com/v/t51.2885-15/IMG.jpg");
        s.see("data:image/png;base64,AAAA");
        check("sniffer: one video", 1, videos.size());
        check("sniffer: one image", 1, images.size());
        check("sniffer: ignores api endpoints", true, videos.get(0).contains("/VID.mp4"));
    }

    /* ------------------------------------------------------------- helpers */

    private static void check(String what, Object expected, Object actual) {
        boolean ok = expected == null ? actual == null : expected.equals(actual);
        if (ok) {
            passed++;
            System.out.println("  ✓ " + what);
        } else {
            failed++;
            System.out.println("  ✗ " + what + "  expected <" + expected + "> got <" + actual + ">");
        }
    }

    private static void check(String what, int expected, int actual) {
        check(what, Integer.valueOf(expected), Integer.valueOf(actual));
    }
}
