package ma.zakaria.reelsoffline;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Environment;
import android.widget.Toast;

import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Small helpers shared by the whole app. */
public final class Util {

    public static final String AUTHORITY = "ma.zakaria.reelsoffline.files";

    public static final String UA_DESKTOP =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    public static final String UA_MOBILE =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

    private static final Pattern IG = Pattern.compile(
            "instagram\\.com/(?:[a-zA-Z0-9_.]+/)?(p|reel|reels|tv|share)/([A-Za-z0-9_-]{5,})");

    private Util() { }

    /** 1.4 MB style size label. */
    public static String human(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double kb = bytes / 1024.0;
        if (kb < 1024) return String.format(Locale.US, "%.0f KB", kb);
        double mb = kb / 1024.0;
        if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb);
        return String.format(Locale.US, "%.2f GB", mb / 1024.0);
    }

    public static String mmss(long ms) {
        if (ms <= 0) return "0:00";
        long s = ms / 1000;
        return String.format(Locale.US, "%d:%02d", s / 60, s % 60);
    }

    public static String md5(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    public static boolean online(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    public static void toast(Context c, String msg) {
        Toast.makeText(c, msg, Toast.LENGTH_SHORT).show();
    }

    /** App-private directory (prefers external so big reels don't fill the internal card). */
    public static File dir(Context c, String name) {
        File base = c.getExternalFilesDir(null);
        if (base == null) base = c.getFilesDir();
        File d = new File(base, name);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static File reelsDir(Context c) { return dir(c, "reels"); }

    public static File thumbsDir(Context c) { return dir(c, "thumbs"); }

    public static File tmpDir(Context c) { return dir(c, "tmp"); }

    public static boolean isInstagram(String url) {
        return url != null && url.toLowerCase(Locale.US).contains("instagram.com");
    }

    /** Shortcode of an instagram post/reel, or null. */
    public static String shortcode(String url) {
        if (url == null) return null;
        Matcher m = IG.matcher(url);
        if (m.find()) return m.group(2);
        // plain "https://instagram.com/reel/XXX" handled by the regex above;
        // also accept a bare shortcode
        if (url.matches("[A-Za-z0-9_-]{6,20}")) return url;
        return null;
    }

    /** Embed URL used to extract the media without being logged in. */
    public static String embedUrl(String shortcode) {
        return "https://www.instagram.com/p/" + shortcode + "/embed/captioned/?cr=1&v=14&wp=720";
    }

    public static String firstUrl(String text) {
        if (text == null) return null;
        Matcher m = Pattern.compile("https?://[^\\s\"'<>]+").matcher(text);
        return m.find() ? m.group() : null;
    }

    /** .mp4 / .jpg / ... (query string ignored) */
    public static boolean isDirectMedia(String url) {
        String u = stripQuery(url);
        String l = u.toLowerCase(Locale.US);
        return l.endsWith(".mp4") || l.endsWith(".jpg") || l.endsWith(".jpeg")
                || l.endsWith(".png") || l.endsWith(".webp") || l.endsWith(".gif");
    }

    public static String stripQuery(String url) {
        if (url == null) return "";
        int q = url.indexOf('?');
        return q >= 0 ? url.substring(0, q) : url;
    }

    /** Extension for a media URL, always usable as a file suffix. */
    public static String extOf(String url) {
        String l = stripQuery(url).toLowerCase(Locale.US);
        int dot = l.lastIndexOf('.');
        if (dot >= 0) {
            String e = l.substring(dot + 1);
            if (e.equals("mp4") || e.equals("jpg") || e.equals("jpeg") || e.equals("png")
                    || e.equals("webp") || e.equals("gif") || e.equals("m4a") || e.equals("mp3")) {
                return e.equals("jpeg") ? "jpg" : e;
            }
        }
        return url != null && url.contains("video") ? "mp4" : "jpg";
    }

    public static boolean isVideoUrl(String url) {
        String l = stripQuery(url).toLowerCase(Locale.US);
        if (l.endsWith(".mp4")) return true;
        if (l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".png") || l.endsWith(".webp")) return false;
        return url != null && url.contains("mime=video");
    }

    /** CDN urls come with range parameters we must not keep when downloading. */
    public static String cleanMediaUrl(String url) {
        if (url == null) return null;
        String u = url.replace("\\u0026", "&").replace("\\/", "/").replace("&amp;", "&");
        for (String p : new String[] {"bytestart", "byteend", "range", "__cb", "_nc_cat_cb"}) {
            u = u.replaceAll("([?&])" + p + "=[^&]*&?", "$1");
        }
        u = u.replaceAll("[?&]$", "");
        return u;
    }

    /** Videos we find in the page HTML are often quoted inside a JS string. */
    public static String jsUnescape(String s) {
        if (s == null) return "";
        return s.replace("\\\\u0026", "&").replace("\\u0026", "&")
                .replace("\\/", "/").replace("\\\"", "\"")
                .replace("\\\\", "\\");
    }

    public static String htmlUnescape(String s) {
        if (s == null) return "";
        return s.replace("&quot;", "\"").replace("&#039;", "'").replace("&#39;", "'")
                .replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&nbsp;", " ").replace("&#064;", "@").replace("&amp;", "&");
    }

    public static String trimTo(String s, int max) {
        if (s == null) return "";
        s = s.trim();
        return s.length() > max ? s.substring(0, max) + "…" : s;
    }

    public static boolean externalStorageWritable() {
        return Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState());
    }
}
