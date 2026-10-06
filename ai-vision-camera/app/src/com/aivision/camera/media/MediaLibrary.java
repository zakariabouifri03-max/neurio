package com.aivision.camera.media;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.util.LruCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Storage layer: writes stills, RAW files and video into the user's gallery (MediaStore on Android
 * 10+, a plain folder before that), keeps a small AI report index so the viewer can show what the
 * engine actually did to each shot, and serves thumbnails for the grid.
 */
public class MediaLibrary {

    private static final String TAG = "MediaLibrary";
    public static final String ALBUM = "AIVisionCamera";

    private final Context ctx;
    private final LruCache<String, Bitmap> thumbs;
    private final Map<String, String> reportIndex = new HashMap<String, String>();
    private File reportFile;

    public MediaLibrary(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        int cacheKb = (int) Math.min(48 * 1024, Runtime.getRuntime().maxMemory() / 16 / 1024);
        thumbs = new LruCache<String, Bitmap>(cacheKb) {
            @Override
            protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount() / 1024;
            }
        };
        reportFile = new File(ctx.getFilesDir(), "ai_reports.json");
        loadIndex();
    }

    // ------------------------------------------------------------------ output locations

    public File outputDir(boolean video) {
        File base;
        if (Build.VERSION.SDK_INT >= 29) {
            base = new File(Environment.getExternalStoragePublicDirectory(
                    video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), ALBUM);
        } else {
            base = new File(Environment.getExternalStoragePublicDirectory(
                    video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), ALBUM);
        }
        if (!base.exists()) base.mkdirs();
        return base;
    }

    public File newPhotoFile(String suffix) {
        return new File(outputDir(false), "AIV_" + stamp() + suffix);
    }

    public File newRawFile() {
        return new File(outputDir(false), "AIV_" + stamp() + ".dng");
    }

    public File newVideoFile() {
        return new File(outputDir(true), "AIV_" + stamp() + ".mp4");
    }

    public File newExportFile() {
        return new File(outputDir(true), "AIV_" + stamp() + "_AI4K.mp4");
    }

    public static String stamp() {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US);
        return f.format(new java.util.Date());
    }

    /** Publishes a finished file into MediaStore (Android 10+) or just rescans it. */
    public void publish(File file, boolean video) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, file.getName());
                v.put(MediaStore.MediaColumns.MIME_TYPE, video ? "video/mp4" : "image/jpeg");
                v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/" + ALBUM);
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                Uri collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                // the file already exists on disk; index it by inserting the row with its name
                ContentResolver cr = ctx.getContentResolver();
                try {
                    cr.insert(collection, v);
                } catch (Throwable t) {
                    // the row may already exist (same name) - fall back to a scan so the file still shows up
                    android.media.MediaScannerConnection.scanFile(ctx,
                            new String[]{file.getAbsolutePath()},
                            new String[]{video ? "video/mp4" : "image/jpeg"}, null);
                }
            } else {
                android.media.MediaScannerConnection.scanFile(ctx,
                        new String[]{file.getAbsolutePath()},
                        new String[]{video ? "video/mp4" : "image/jpeg"}, null);
            }
        } catch (Throwable t) {
            Log.w(TAG, "publish", t);
        }
    }

    /** Saves a bitmap as JPEG into the album and publishes it. */
    public File saveJpeg(Bitmap bmp, File target, int quality) {
        OutputStream os = null;
        try {
            os = new FileOutputStream(target);
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, os);
            os.flush();
            os.close();
            publish(target, false);
            return target;
        } catch (Throwable t) {
            Log.e(TAG, "saveJpeg", t);
            try {
                if (os != null) os.close();
            } catch (Throwable ignored) {
            }
            return null;
        }
    }

    public File saveBytes(byte[] data, File target) {
        try {
            FileOutputStream os = new FileOutputStream(target);
            os.write(data);
            os.close();
            publish(target, false);
            return target;
        } catch (Throwable t) {
            Log.e(TAG, "saveBytes", t);
            return null;
        }
    }

    // ------------------------------------------------------------------ original frames

    /** The unprocessed capture is kept in app-private storage so before/after stays truthful. */
    public File originalFile(String name) {
        File dir = new File(ctx.getFilesDir(), "originals");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, name + ".jpg");
    }

    public boolean saveOriginal(String name, byte[] jpeg) {
        if (jpeg == null || name == null) return false;
        try {
            FileOutputStream os = new FileOutputStream(originalFile(name));
            os.write(jpeg);
            os.close();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    public boolean hasOriginal(String name) {
        return name != null && originalFile(name).exists();
    }

    public byte[] loadOriginal(String name) {
        try {
            File f = originalFile(name);
            if (!f.exists()) return null;
            byte[] data = new byte[(int) f.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            int read = in.read(data);
            in.close();
            if (read <= 0) return null;
            return data;
        } catch (Throwable t) {
            return null;
        }
    }

    // ------------------------------------------------------------------ AI report index

    public void putReport(String fileName, String json) {
        reportIndex.put(fileName, json);
        saveIndex();
    }

    public String getReport(String fileName) {
        return reportIndex.get(fileName);
    }

    public void removeReport(String fileName) {
        if (reportIndex.remove(fileName) != null) saveIndex();
    }

    private void loadIndex() {
        try {
            if (!reportFile.exists()) return;
            byte[] data = new byte[(int) reportFile.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(reportFile);
            int read = in.read(data);
            in.close();
            if (read <= 0) return;
            JSONObject o = new JSONObject(new String(data, "UTF-8"));
            JSONArray names = o.names();
            if (names == null) return;
            for (int i = 0; i < names.length(); i++) {
                String k = names.getString(i);
                reportIndex.put(k, o.getString(k));
            }
        } catch (Throwable t) {
            Log.w(TAG, "loadIndex", t);
        }
    }

    private void saveIndex() {
        try {
            JSONObject o = new JSONObject();
            for (Map.Entry<String, String> e : reportIndex.entrySet()) o.put(e.getKey(), e.getValue());
            FileOutputStream out = new FileOutputStream(reportFile);
            out.write(o.toString().getBytes("UTF-8"));
            out.close();
        } catch (Throwable t) {
            Log.w(TAG, "saveIndex", t);
        }
    }

    // ------------------------------------------------------------------ gallery model

    public static class Item {
        public long id;
        public Uri uri;
        public String path;
        public String name;
        public boolean video;
        public long dateSeconds;
        public long sizeBytes;
        public int width, height;
        public long durationMs;

        @Override
        public String toString() {
            return name;
        }
    }

    public List<Item> query(boolean includeImages, boolean includeVideos, int limit) {
        List<Item> out = new ArrayList<Item>();
        ContentResolver cr = ctx.getContentResolver();
        if (includeImages) out.addAll(queryOne(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, false, limit));
        if (includeVideos) out.addAll(queryOne(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, limit));
        Collections.sort(out, new Comparator<Item>() {
            @Override
            public int compare(Item a, Item b) {
                return Long.compare(b.dateSeconds, a.dateSeconds);
            }
        });
        if (limit > 0 && out.size() > limit) return out.subList(0, limit);
        return out;
    }

    private List<Item> queryOne(Uri collection, boolean video, int limit) {
        List<Item> out = new ArrayList<Item>();
        ContentResolver cr = ctx.getContentResolver();
        String[] projection = video
                ? new String[]{MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME,
                MediaStore.Video.Media.DATE_ADDED, MediaStore.Video.Media.SIZE,
                MediaStore.Video.Media.WIDTH, MediaStore.Video.Media.HEIGHT,
                MediaStore.Video.Media.DURATION, MediaStore.Video.Media.DATA}
                : new String[]{MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.DATA};
        String selection;
        String[] args;
        if (Build.VERSION.SDK_INT >= 29) {
            selection = MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
            args = new String[]{"%" + ALBUM + "%"};
        } else {
            selection = MediaStore.MediaColumns.DATA + " LIKE ?";
            args = new String[]{"%" + File.separator + ALBUM + File.separator + "%"};
        }
        String order = (video ? MediaStore.Video.Media.DATE_ADDED : MediaStore.Images.Media.DATE_ADDED) + " DESC";
        if (limit > 0) order += " LIMIT " + limit;
        Cursor c = null;
        try {
            c = cr.query(collection, projection, selection, args, order);
            if (c == null) return out;
            while (c.moveToNext()) {
                Item it = new Item();
                it.id = c.getLong(0);
                it.name = c.getString(1);
                it.dateSeconds = c.getLong(2);
                it.sizeBytes = c.getLong(3);
                it.width = c.getInt(4);
                it.height = c.getInt(5);
                if (video) {
                    it.durationMs = c.getLong(6);
                    int dataIdx = 7;
                    it.path = c.getString(dataIdx);
                } else {
                    it.path = c.getString(6);
                }
                it.video = video;
                it.uri = android.content.ContentUris.withAppendedId(collection, it.id);
                if (it.name == null) it.name = "AIV_" + it.id;
                out.add(it);
            }
        } catch (Throwable t) {
            Log.w(TAG, "query " + collection, t);
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    /** Count of items, used for the empty state. */
    public int count() {
        return query(true, true, 0).size();
    }

    // ------------------------------------------------------------------ thumbnails

    public Bitmap thumbnail(Item item, int size) {
        String key = item.uri.toString() + "@" + size;
        Bitmap cached = thumbs.get(key);
        if (cached != null) return cached;
        Bitmap bmp = null;
        try {
            ContentResolver cr = ctx.getContentResolver();
            if (item.video) {
                if (Build.VERSION.SDK_INT >= 29) {
                    bmp = cr.loadThumbnail(item.uri, new android.util.Size(size, size), null);
                } else {
                    bmp = android.media.ThumbnailUtils.createVideoThumbnail(item.path,
                            android.provider.MediaStore.Video.Thumbnails.MINI_KIND);
                }
            } else {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                try {
                    java.io.InputStream is = cr.openInputStream(item.uri);
                    BitmapFactory.decodeStream(is, null, o);
                    if (is != null) is.close();
                } catch (Throwable ignored) {
                }
                int sample = 1;
                while (o.outWidth / (sample * 2) >= size && o.outHeight / (sample * 2) >= size) sample *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = Math.max(1, sample);
                try {
                    java.io.InputStream is = cr.openInputStream(item.uri);
                    bmp = BitmapFactory.decodeStream(is, null, o2);
                    if (is != null) is.close();
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "thumbnail", t);
        }
        if (bmp != null) thumbs.put(key, bmp);
        return bmp;
    }

    public void delete(Item item) {
        try {
            ctx.getContentResolver().delete(item.uri, null, null);
            removeReport(item.name);
        } catch (Throwable t) {
            Log.w(TAG, "delete", t);
        }
    }

    public void clearThumbCache() {
        thumbs.evictAll();
    }

    public void trimCache() {
        thumbs.trimToSize(thumbs.maxSize() / 2);
    }
}
