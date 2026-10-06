package ma.zakaria.reelsoffline;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Locale;

/**
 * Stands in for androidx FileProvider (this app ships without the support
 * library): hands out read-only content:// uris so a saved reel can be sent to
 * WhatsApp / Telegram / anything else.
 */
public class MediaProvider extends ContentProvider {

    public static final String AUTHORITY = "ma.zakaria.reelsoffline.files";

    /** content://ma.zakaria.reelsoffline.files/<reels|thumbs|tmp>/<name> */
    public static Uri uriFor(Context c, File file) {
        File base = c.getExternalFilesDir(null);
        File internal = c.getFilesDir();
        String rel = null;
        if (base != null && file.getAbsolutePath().startsWith(base.getAbsolutePath())) {
            rel = file.getAbsolutePath().substring(base.getAbsolutePath().length() + 1);
        } else if (file.getAbsolutePath().startsWith(internal.getAbsolutePath())) {
            rel = "internal/" + file.getAbsolutePath().substring(internal.getAbsolutePath().length() + 1);
        }
        if (rel == null) return null;
        return new Uri.Builder().scheme("content").authority(AUTHORITY)
                .appendPath(rel.replace(File.separatorChar, '/')).build();
    }

    private File resolve(Uri uri) {
        String rel = uri.getEncodedPath();
        if (rel == null) return null;
        rel = Uri.decode(rel).replace('/', File.separatorChar).replaceFirst("^" + File.separator, "");
        File base;
        if (rel.startsWith("internal" + File.separator)) {
            base = getContext().getFilesDir();
            rel = rel.substring("internal".length() + 1);
        } else {
            File ext = getContext().getExternalFilesDir(null);
            base = ext != null ? ext : getContext().getFilesDir();
        }
        File f = new File(base, rel);
        try {
            if (!f.getCanonicalPath().startsWith(base.getCanonicalPath())) return null;
        } catch (Exception e) {
            return null;
        }
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        if (f == null || !f.exists()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        String l = name == null ? "" : name.toLowerCase(Locale.US);
        if (l.endsWith(".mp4")) return "video/mp4";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
