package ma.filebox;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Pushes a vault off the phone over WebDAV (Nextcloud, Freebox, Synology,
 * davfs2, the Node server in Filebox/server, ...). No libraries — a WebDAV PUT
 * is just an HTTP PUT with a Basic auth header.
 */
public final class Backup {

    public interface Progress {
        void on(float fraction);
    }

    private Backup() {}

    private static HttpURLConnection open(String url, String method, String user, String pass)
            throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setInstanceFollowRedirects(true);
        if (user != null && !user.isEmpty()) {
            String token = android.util.Base64.encodeToString(
                    (user + ":" + (pass == null ? "" : pass)).getBytes("UTF-8"),
                    android.util.Base64.NO_WRAP);
            c.setRequestProperty("Authorization", "Basic " + token);
        }
        return c;
    }

    /** PROPFIND on the root — the cheapest way to prove the credentials work. */
    public static String probe(String baseUrl, String user, String pass) {
        HttpURLConnection c = null;
        try {
            c = open(baseUrl.replaceAll("/+$", "") + "/", "PROPFIND", user, pass);
            c.setRequestProperty("Depth", "0");
            int code = c.getResponseCode();
            return (code >= 200 && code < 300) ? null : ("HTTP " + code);
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * PUTs the file, creating the collection first if needed.
     * @return null on success, or a human-readable failure reason.
     */
    public static String put(String baseUrl, String remotePath, File file,
                             String user, String pass, Progress prog) {
        String root = baseUrl.replaceAll("/+$", "");
        String path = remotePath.replaceAll("^/+", "");

        // MKCOL each missing segment; 405 means it already exists, which is fine
        String[] segments = path.split("/");
        StringBuilder acc = new StringBuilder(root);
        for (int i = 0; i < segments.length - 1; i++) {
            acc.append('/').append(segments[i]);
            HttpURLConnection mk = null;
            try {
                mk = open(acc.toString(), "MKCOL", user, pass);
                mk.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (mk != null) mk.disconnect();
            }
        }

        HttpURLConnection c = null;
        try {
            c = open(root + "/" + path, "PUT", user, pass);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(file.length());
            c.setRequestProperty("Content-Type", "application/zip");

            long total = file.length();
            long sent = 0;
            try (InputStream in = new FileInputStream(file); OutputStream out = c.getOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    sent += n;
                    if (prog != null) prog.on(total == 0 ? 1f : sent / (float) total);
                }
                out.flush();
            }
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) return null;
            return "HTTP " + code;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
