package ma.zakaria.reelsoffline;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pulls the real media URLs out of an Instagram embed page.
 *
 * The embed page (…/embed/captioned/) is public — no account needed — and its
 * HTML contains the signed CDN urls (`video_url`, `display_url`, og:image …)
 * plus the DOM probe we run inside the WebView for the "sniffed" fallback.
 */
public final class Extract {

    public static class Media {
        public final String url;
        public final boolean video;
        public final ArrayList<String> alts = new ArrayList<>();
        public String sizeHint = "";

        public Media(String url, boolean video) {
            this.url = url;
            this.video = video;
        }
    }

    public static class Result {
        public final ArrayList<Media> medias = new ArrayList<>();
        public String cover;
        public String author;
        public String caption;
        public String title;

        public boolean hasVideo() {
            for (Media m : medias) if (m.video) return true;
            return false;
        }

        public Media best() {
            for (Media m : medias) if (m.video) return m;
            return medias.isEmpty() ? null : medias.get(0);
        }
    }

    private Extract() { }

    /* ------------------------------------------------------------------ */

    public static Result parse(String html, String probeJson,
                               ArrayList<String> sniffVideos, ArrayList<String> sniffImages) {
        Result r = new Result();
        String h = Util.jsUnescape(html == null ? "" : html);

        r.author = first(h, "\"owner\"\\s*:\\s*\\{[^}]*?\"username\"\\s*:\\s*\"([^\"]+)\"");
        if (r.author == null) r.author = first(h, "\"username\"\\s*:\\s*\"([^\"]+)\"");
        r.caption = ogMeta(h, "og:description");
        if (r.caption == null) r.caption = first(h, "\"edge_media_to_caption\"\\s*:\\s*\\{\"edges\"\\s*:\\s*\\[\\{\"node\"\\s*:\\s*\\{\"text\"\\s*:\\s*\"([^\"]+)\"");
        r.caption = cleanCaption(r.caption);
        r.title = ogMeta(h, "og:title");
        if (r.title == null) r.title = "";

        ArrayList<String> videos = new ArrayList<>();
        videos.addAll(match(h, "\"video_url\"\\s*:\\s*\"([^\"]+)\""));
        String ogv = ogMeta(h, "og:video:secure_url");
        if (ogv == null) ogv = ogMeta(h, "og:video");
        if (ogv != null) videos.add(ogv);
        videos.addAll(match(h, "<video[^>]+src=\"([^\"]+)\""));
        videos.addAll(match(h, "\"(?:contentUrl|src)\"\\s*:\\s*\"(https:[^\"]*?\\.mp4[^\"]*)\""));
        if (probeJson != null) {
            try {
                JSONObject o = new JSONObject(probeJson);
                JSONArray a = o.optJSONArray("videos");
                if (a != null) for (int i = 0; i < a.length(); i++) videos.add(a.optString(i));
                if (r.author == null || r.author.isEmpty()) r.author = o.optString("author");
                if (r.caption.isEmpty()) r.caption = o.optString("caption");
            } catch (Exception ignored) { }
        }
        if (sniffVideos != null) videos.addAll(sniffVideos);

        ArrayList<String> photos = new ArrayList<>();
        photos.addAll(match(h, "\"display_url\"\\s*:\\s*\"([^\"]+)\""));
        String ogi = ogMeta(h, "og:image");
        if (ogi != null) photos.add(ogi);
        photos.addAll(embeddedImages(h));
        if (probeJson != null) {
            try {
                JSONArray a = new JSONObject(probeJson).optJSONArray("images");
                if (a != null) for (int i = 0; i < a.length(); i++) photos.add(a.optString(i));
            } catch (Exception ignored) { }
        }
        if (sniffImages != null) photos.addAll(sniffImages);

        LinkedHashMap<String, Media> out = new LinkedHashMap<>();
        if (!videos.isEmpty()) {
            // The post is a video/reel: the images are just its cover, and the
            // several mp4 urls the page mentions are alternative encodings of
            // the same clip — keep the first one and remember the rest so the
            // download can retry with another CDN url if one fails.
            r.cover = pickCover(photos, videos.get(0));
            addVideoWithAlts(out, videos);
        } else {
            r.cover = photos.isEmpty() ? null : clean(photos.get(0));
            addAll(out, photos, false);
        }
        r.medias.addAll(out.values());
        return r;
    }

    /** "1,234 likes … - zakaria (@zakaria) on Instagram: “my caption”" -> "my caption" */
    public static String cleanCaption(String caption) {
        if (caption == null) return "";
        String c = Util.htmlUnescape(caption).trim();
        Matcher m = Pattern.compile("(?s)^.*?on Instagram[^\\p{L}]*[\\u201C\"\\u2018']?(.*)$").matcher(c);
        if (m.matches()) c = m.group(1).trim();
        c = c.replaceAll("[\\u201D\\u2019\"]+$", "").trim();
        return c;
    }

    /**
     * A reel is one video: the first playable url wins, every other url the page
     * mentions becomes a fallback (they are the same clip on another CDN edge or
     * in another quality). Rare multi-video carousels therefore save the first
     * clip, which is still better than storing the same reel three times.
     */
    private static void addVideoWithAlts(LinkedHashMap<String, Media> out, ArrayList<String> urls) {
        Media main = null;
        for (String raw : urls) {
            String u = clean(raw);
            if (u == null || u.isEmpty() || !Util.isVideoUrl(u)) continue;
            if (main == null) {
                main = new Media(u, true);
                out.put("video", main);
            } else if (!u.equals(main.url) && !main.alts.contains(u)) {
                main.alts.add(u);
            }
        }
    }

    private static void addAll(LinkedHashMap<String, Media> out, ArrayList<String> urls, boolean video) {
        for (String raw : urls) {
            String u = clean(raw);
            if (u == null || u.isEmpty()) continue;
            if (video && !Util.isVideoUrl(u)) continue;
            if (!video && Util.isVideoUrl(u)) continue;
            if (!video && isTiny(u)) continue;
            String key = key(u);
            Media m = out.get(key);
            if (m == null) {
                m = new Media(u, video);
                if (!video) {
                    String better = upgrade(u);
                    if (better != null) m.alts.add(better);
                }
                out.put(key, m);
            } else if (video && !m.url.equals(u)) {
                m.alts.add(u);
            }
        }
        // de-duplicate alts
        for (Media m : out.values()) {
            ArrayList<String> keep = new ArrayList<>();
            for (String a : m.alts) {
                if (!a.equals(m.url) && !keep.contains(a)) keep.add(a);
            }
            m.alts.clear();
            m.alts.addAll(keep);
        }
    }

    /** key ignoring query params so the same file isn't added twice */
    private static String key(String url) {
        String u = Util.stripQuery(url);
        int i = u.lastIndexOf('/');
        return i >= 0 ? u.substring(i) : u;
    }

    private static String clean(String url) {
        String u = Util.cleanMediaUrl(Util.htmlUnescape(url));
        if (u == null || u.isEmpty()) return null;
        if (u.startsWith("//")) u = "https:" + u;
        if (!u.startsWith("http")) return null;
        return u;
    }

    private static boolean isTiny(String url) {
        String l = url.toLowerCase(Locale.US);
        if (l.contains("t51.2885-19")) return true;                 // profile picture
        return l.contains("s100x100") || l.contains("s150x150")
                || l.contains("s240x240") || l.contains("s320x320");
    }

    /** Ask the CDN for a bigger copy of a photo (the page usually serves 640px). */
    private static String upgrade(String url) {
        if (!url.contains("stp=") && !url.contains("_s640x640")) return null;
        String u = url.replace("_s640x640_", "_s1080x1080_")
                .replace("s640x640", "s1080x1080")
                .replace("_s320x320_", "_s1080x1080_")
                .replace("s320x320", "s1080x1080");
        return u.equals(url) ? null : u;
    }

    private static String pickCover(ArrayList<String> photos, String videoUrl) {
        for (String p : photos) {
            String c = clean(p);
            if (c != null && !c.isEmpty() && !isTiny(c) && !Util.isVideoUrl(c)) return c;
        }
        return null;
    }

    private static ArrayList<String> embeddedImages(String h) {
        ArrayList<String> out = new ArrayList<>();
        Matcher m = Pattern.compile("srcset=\"([^\"]+)\"").matcher(h);
        while (m.find()) {
            String best = null;
            int bestW = -1;
            String[] parts = m.group(1).split(",");
            for (String p : parts) {
                String[] bits = p.trim().split("\\s+");
                if (bits.length < 2) continue;
                int w = 0;
                try {
                    w = Integer.parseInt(bits[1].toLowerCase(Locale.US).replace("w", "").replace("x", ""));
                } catch (Exception ignored) { }
                if (w > bestW) {
                    bestW = w;
                    best = bits[0];
                }
            }
            if (best != null) out.add(best);
        }
        Matcher im = Pattern.compile("<img[^>]*>").matcher(h);
        while (im.find()) {
            String tag = im.group();
            boolean embedded = tag.contains("EmbeddedMediaImage") || tag.contains("_post_image");
            Matcher sm = Pattern.compile("src=\"([^\"]+)\"").matcher(tag);
            if (sm.find() && (embedded || !out.contains(sm.group(1)))) out.add(sm.group(1));
        }
        return out;
    }

    /* ------------------------------------------------------------ regex */

    public static ArrayList<String> match(String text, String regex) {
        ArrayList<String> out = new ArrayList<>();
        if (text == null) return out;
        Matcher m = Pattern.compile(regex).matcher(text);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    public static String first(String text, String regex) {
        if (text == null) return null;
        Matcher m = Pattern.compile(regex).matcher(text);
        return m.find() ? m.group(1) : null;
    }

    /** <meta property="og:image" content="…"> in either attribute order. */
    public static String ogMeta(String html, String property) {
        if (html == null) return null;
        String p = Pattern.quote(property);
        String a = first(html, "<meta[^>]*property=\"" + p + "\"[^>]*content=\"([^\"]+)\"");
        if (a == null) a = first(html, "<meta[^>]*content=\"([^\"]+)\"[^>]*property=\"" + p + "\"");
        if (a == null) a = first(html, "<meta[^>]*name=\"" + p + "\"[^>]*content=\"([^\"]+)\"");
        return a == null ? null : Util.htmlUnescape(a);
    }
}
