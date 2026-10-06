package ma.filebox;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Everything about "how much room is left, and what is eating it". */
public final class Space {

    private Space() {}

    public static long freeBytes(File dir) {
        try {
            StatFs st = new StatFs(dir.getAbsolutePath());
            return st.getAvailableBytes();
        } catch (Exception e) {
            return dir.getFreeSpace();
        }
    }

    public static long totalBytes(File dir) {
        try {
            return new StatFs(dir.getAbsolutePath()).getTotalBytes();
        } catch (Exception e) {
            return dir.getTotalSpace();
        }
    }

    public static String human(long n) {
        if (n < 1024) return n + " B";
        String[] u = {"KB", "MB", "GB", "TB"};
        double v = n;
        int i = -1;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return String.format(Locale.US, v >= 100 ? "%.0f %s" : "%.1f %s", v, u[i]);
    }

    // ── content:// helpers ──────────────────────────────────────────────────
    public static String displayName(Context c, Uri uri) {
        String name = null;
        try (Cursor cur = c.getContentResolver().query(uri, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int i = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = cur.getString(i);
            }
        } catch (Exception ignored) {}
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name == null) name = "file";
        }
        return name;
    }

    public static long sizeOf(Context c, Uri uri) {
        try (Cursor cur = c.getContentResolver().query(uri, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int i = cur.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !cur.isNull(i)) return cur.getLong(i);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    public static InputStream open(Context c, Uri uri) throws java.io.IOException {
        InputStream in = c.getContentResolver().openInputStream(uri);
        if (in == null) throw new java.io.IOException("cannot open " + uri);
        return in;
    }

    /**
     * A cheap, collision-resistant-enough fingerprint: size + SHA-256 of the
     * first and last 64 KB. Full hashing of every file on the phone would take
     * minutes; this finds the real-world duplicates (re-downloads, forwarded
     * photos) in seconds.
     */
    public static String fingerprint(InputStream in, long size) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        final int CH = 64 * 1024;
        byte[] buf = new byte[CH];
        int read = 0;
        while (read < CH) {
            int n = in.read(buf, read, CH - read);
            if (n < 0) break;
            read += n;
        }
        md.update(buf, 0, read);
        md.update(longBytes(size));

        // tail
        long skip = Math.max(0, size - CH - read);
        if (in.skip(skip) == skip && size > 2L * CH) {
            int t = 0;
            while (t < CH) {
                int n = in.read(buf, t, CH - t);
                if (n < 0) break;
                t += n;
            }
            md.update(buf, 0, t);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format(Locale.US, "%02x", b));
        return sb.append(':').append(size).toString();
    }

    private static byte[] longBytes(long v) {
        byte[] b = new byte[8];
        for (int i = 0; i < 8; i++) b[i] = (byte) (v >> (i * 8));
        return b;
    }

    // ── deleting the originals ──────────────────────────────────────────────
    /**
     * Removes a document the user picked through the SAF picker. Returns false
     * (rather than throwing) when the provider refuses — the caller reports it.
     */
    public static boolean deleteDocument(Context c, Uri uri) {
        try {
            if (DocumentsContract.isDocumentUri(c, uri)) {
                return DocumentsContract.deleteDocument(c.getContentResolver(), uri);
            }
            if ("file".equals(uri.getScheme())) {
                return new File(uri.getPath()).delete();
            }
            return c.getContentResolver().delete(uri, null, null) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    // ── the vault folder ────────────────────────────────────────────────────
    public static File vaultDir(Context c) {
        File d = new File(c.getExternalFilesDir(null), "vaults");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static List<File> vaultFiles(Context c) {
        File[] fs = vaultDir(c).listFiles((dir, name) -> name.toLowerCase(Locale.US).endsWith(".zip"));
        List<File> out = new ArrayList<>();
        if (fs != null) Collections.addAll(out, fs);
        Collections.sort(out, new Comparator<File>() {
            @Override public int compare(File a, File b) {
                return Long.compare(b.lastModified(), a.lastModified());
            }
        });
        return out;
    }

    public static File restoredDir(Context c) {
        File d = new File(c.getExternalFilesDir(null), "restored");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Guards against "../" escaping the target directory when extracting. */
    public static File safeChild(File dir, String entryName) throws java.io.IOException {
        String clean = entryName.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);
        File out = new File(dir, clean);
        if (!out.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)
                && !out.getCanonicalPath().equals(dir.getCanonicalPath())) {
            throw new java.io.IOException("unsafe entry name: " + entryName);
        }
        File parent = out.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        return out;
    }

    /**
     * Keeps only the sizes that appear more than once — the candidates for a
     * duplicate scan. (Iterating values() while removing from the same map
     * would throw ConcurrentModificationException, hence the second map.)
     */
    public static Map<Long, List<String>> groupBySize(Map<String, Long> files) {
        Map<Long, List<String>> by = new HashMap<>();
        for (Map.Entry<String, Long> e : files.entrySet()) {
            List<String> l = by.get(e.getValue());
            if (l == null) { l = new ArrayList<>(); by.put(e.getValue(), l); }
            l.add(e.getKey());
        }
        Map<Long, List<String>> dupes = new HashMap<>();
        for (Map.Entry<Long, List<String>> e : by.entrySet()) {
            if (e.getValue().size() > 1) dupes.put(e.getKey(), e.getValue());
        }
        return dupes;
    }
}
