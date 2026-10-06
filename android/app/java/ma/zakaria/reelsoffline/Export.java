package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/** Copies saved reels into the phone gallery so other apps can see them too. */
public final class Export {

    private Export() { }

    public static boolean toGallery(Context c, Db.Item item) {
        boolean all = true;
        for (int i = 0; i < item.files.size(); i++) {
            File f = new File(item.files.get(i));
            if (!f.exists()) continue;
            boolean video = f.getName().toLowerCase(Locale.US).endsWith(".mp4");
            all &= exportOne(c, f, video, item);
        }
        return all;
    }

    private static boolean exportOne(Context c, File src, boolean video, Db.Item item) {
        String name = "reels_offline_" + (item.shortcode == null || item.shortcode.isEmpty()
                ? String.valueOf(System.currentTimeMillis()) : item.shortcode)
                + "_" + src.getName();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = c.getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, video ? "video/mp4" : "image/jpeg");
                v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        video ? Environment.DIRECTORY_MOVIES + "/ReelsOffline"
                                : Environment.DIRECTORY_PICTURES + "/ReelsOffline");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                OutputStream os = cr.openOutputStream(uri);
                if (os == null) return false;
                copy(new FileInputStream(src), os);
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                return true;
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(
                    video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), "ReelsOffline");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, name);
            copy(new FileInputStream(src), new FileOutputStream(out));
            MediaScannerConnection.scanFile(c, new String[] {out.getAbsolutePath()}, null, null);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] b = new byte[64 * 1024];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        out.flush();
        out.close();
        in.close();
    }

    /** Opens the system share sheet with a read-granted content:// uri. */
    public static boolean share(Context c, Db.Item item) {
        if (item.files.isEmpty()) return false;
        File f = new File(item.files.get(0));
        Uri uri = MediaProvider.uriFor(c, f);
        if (uri == null) return false;
        boolean video = f.getName().toLowerCase(Locale.US).endsWith(".mp4");
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(video ? "video/mp4" : "image/jpeg");
        i.putExtra(Intent.EXTRA_STREAM, uri);
        i.putExtra(Intent.EXTRA_TEXT, item.caption == null ? "" : item.caption);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (!(c instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(Intent.createChooser(i, "مشاركة"));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
