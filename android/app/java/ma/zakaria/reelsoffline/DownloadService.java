package ma.zakaria.reelsoffline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.media.ThumbnailUtils;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.MediaStore;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads media in the background (foreground service, so it keeps going while
 * the user goes back to Instagram) and stores it inside the app.
 *
 * Only needs the internet while the file is being fetched — after that the
 * library works completely offline.
 */
public class DownloadService extends Service {

    public static class Job {
        public String id;
        public String shortcode = "";
        public String url = "";
        public String author = "";
        public String caption = "";
        public String title = "";
        public String kind = "video";
        public String cover;
        public String cookie = "";
        public ArrayList<Extract.Media> medias = new ArrayList<>();
    }

    private static final int NOTIF_ID = 4004;
    private static final String CHANNEL = "downloads";
    private static final Object LOCK = new Object();
    private static final ArrayDeque<Job> QUEUE = new ArrayDeque<>();
    private static Thread worker;
    private static final AtomicBoolean CANCEL = new AtomicBoolean(false);

    /** Queue a download and make sure the service is running. */
    public static void enqueue(Context c, Job job) {
        synchronized (LOCK) {
            QUEUE.add(job);
        }
        Intent i = new Intent(c, DownloadService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable t) {
            Util.toast(c, "ما قدرناش نبداو التحميل");
        }
    }

    /** True while something is queued/downloading (used by the UI spinner). */
    public static boolean busy() {
        synchronized (LOCK) {
            return !QUEUE.isEmpty() || worker != null;
        }
    }

    public static void cancelAll() {
        CANCEL.set(true);
        synchronized (LOCK) {
            QUEUE.clear();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, ongoing(getString(R.string.notif_downloading, "…"), -1, 0, "…"));
        synchronized (LOCK) {
            if (QUEUE.isEmpty() && worker == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            if (worker == null) {
                worker = new Thread(this::loop, "reels-download");
                worker.setPriority(Thread.MIN_PRIORITY + 2);
                worker.start();
            }
        }
        return START_NOT_STICKY;
    }

    /* ------------------------------------------------------------------ */

    private void loop() {
        while (true) {
            Job job;
            synchronized (LOCK) {
                job = QUEUE.poll();
                if (job == null) {
                    worker = null;
                    break;
                }
            }
            try {
                process(job);
            } catch (Throwable t) {
                EventBus.post(EventBus.DOWNLOAD);
            }
        }
        try {
            stopForeground(true);
        } catch (Throwable ignored) { }
        stopSelf();
    }

    /** Worker threads have no looper, so toasts have to hop onto the main one. */
    private void toastFromWorker(final String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Util.toast(DownloadService.this, msg);
            } catch (Throwable ignored) { }
        });
    }

    private void process(Job job) {
        CANCEL.set(false);
        String title = job.title != null && !job.title.isEmpty() ? job.title
                : (job.author != null && !job.author.isEmpty() ? "@" + job.author : "ريل");
        File reels = Util.reelsDir(this);
        File thumbs = Util.thumbsDir(this);
        File tmp = Util.tmpDir(this);

        ArrayList<String> savedFiles = new ArrayList<>();
        ArrayList<String> savedThumbs = new ArrayList<>();
        long total = 0;
        int index = 0;
        int okCount = 0;

        for (Extract.Media media : job.medias) {
            if (CANCEL.get()) break;
            String ext = Util.extOf(media.url);
            String base = job.id + "_" + index;
            File target = new File(reels, base + "." + ext);
            File partial = new File(tmp, base + ".part");
            boolean ok = false;

            ArrayList<String> tries = new ArrayList<>();
            tries.add(media.url);
            tries.addAll(media.alts);
            if (media.video && job.medias.size() == 1) {
                // any other mp4 we sniffed for the same post is a valid fallback
                for (Extract.Media other : job.medias) {
                    if (other.video) tries.add(other.url);
                }
            }

            for (String candidate : tries) {
                if (CANCEL.get()) break;
                try {
                    long bytes = fetch(candidate, job, partial, title, index, job.medias.size());
                    if (bytes > 0) {
                        if (target.exists()) target.delete();
                        if (!partial.renameTo(target)) {
                            copy(partial, target);
                            partial.delete();
                        }
                        total += bytes;
                        ok = true;
                        savedFiles.add(target.getAbsolutePath());
                        break;
                    }
                } catch (Throwable t) {
                    // try the next candidate url
                }
            }
            if (!ok) {
                partial.delete();
                continue;
            }
            okCount++;

            // thumbnail
            String thumbPath = makeThumb(new File(savedFiles.get(savedFiles.size() - 1)), media.video,
                    new File(thumbs, base + ".jpg"), job.cover);
            savedThumbs.add(thumbPath == null ? "" : thumbPath);
            index++;
        }

        if (CANCEL.get()) {
            for (String p : savedFiles) new File(p).delete();
            toastFromWorker("تحيّد التحميل");
            stopForeground(true);
            stopSelf();
            return;
        }

        if (okCount == 0 || savedFiles.isEmpty()) {
            done(getString(R.string.notif_failed), title, null);
            EventBus.post(EventBus.DOWNLOAD);
            return;
        }

        Db.Item item = new Db.Item();
        item.id = job.id;
        item.shortcode = job.shortcode;
        item.url = job.url;
        item.author = job.author == null ? "" : job.author;
        item.caption = job.caption == null ? "" : job.caption;
        item.title = title;
        item.kind = job.kind;
        item.files = savedFiles;
        item.thumbs = savedThumbs;
        item.size = total;
        item.ts = System.currentTimeMillis();
        if (!savedFiles.isEmpty()) item.duration = durationOf(savedFiles.get(0));
        Db.add(this, item);
        EventBus.post(EventBus.LIBRARY);
        done(getString(R.string.notif_done_title), title, item.id);
    }

    /* ------------------------------------------------------- networking */

    private long fetch(String url, Job job, File out, String title, int index, int count)
            throws Exception {
        HttpURLConnection conn = null;
        for (int hop = 0; hop < 5; hop++) {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", Util.UA_DESKTOP);
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            if (job.url != null && !job.url.isEmpty()) conn.setRequestProperty("Referer", job.url);
            if (job.cookie != null && !job.cookie.isEmpty()) conn.setRequestProperty("Cookie", job.cookie);
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new Exception("redirect without location");
                url = loc.startsWith("http") ? loc : new URL(new URL(url), loc).toString();
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new Exception("http " + code);
            }
            break;
        }
        if (conn == null) throw new Exception("no connection");

        long len = -1;
        try {
            len = Long.parseLong(conn.getHeaderField("Content-Length"));
        } catch (Exception ignored) { }
        InputStream in = new BufferedInputStream(conn.getInputStream(), 64 * 1024);
        FileOutputStream fos = new FileOutputStream(out);
        byte[] buf = new byte[64 * 1024];
        long done = 0;
        long last = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            if (CANCEL.get()) break;
            fos.write(buf, 0, n);
            done += n;
            long now = System.currentTimeMillis();
            if (now - last > 400) {
                last = now;
                int pct = len > 0 ? (int) (done * 100 / len) : -1;
                ongoing(getString(R.string.notif_downloading, title + (count > 1 ? " (" + (index + 1) + "/" + count + ")" : "")),
                        pct, done, count > 1 ? (index + 1) + "/" + count : Util.human(done));
            }
        }
        fos.flush();
        fos.close();
        in.close();
        conn.disconnect();
        if (CANCEL.get()) {
            out.delete();
            return 0;
        }
        if (done <= 0 || (len > 0 && done < len)) {
            out.delete();
            throw new Exception("incomplete " + done + "/" + len);
        }
        return done;
    }

    private static void copy(File from, File to) throws Exception {
        InputStream in = new java.io.FileInputStream(from);
        FileOutputStream out = new FileOutputStream(to);
        byte[] b = new byte[64 * 1024];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        out.close();
        in.close();
    }

    /* -------------------------------------------------------- thumbnails */

    private String makeThumb(File media, boolean video, File out, String coverUrl) {
        Bitmap bmp = null;
        try {
            if (video) {
                bmp = ThumbnailUtils.createVideoThumbnail(media.getAbsolutePath(),
                        MediaStore.Video.Thumbnails.MINI_KIND);
            } else {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(media.getAbsolutePath(), o);
                int scale = 1;
                while (o.outWidth / (scale * 2) >= 480) scale *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = scale;
                bmp = BitmapFactory.decodeFile(media.getAbsolutePath(), o2);
            }
        } catch (Throwable ignored) { }
        if (bmp == null && coverUrl != null) {
            File c = new File(Util.tmpDir(this), "cover_" + System.currentTimeMillis() + ".jpg");
            try {
                Job j = new Job();
                fetch(coverUrl, j, c, "cover", 0, 1);
                bmp = BitmapFactory.decodeFile(c.getAbsolutePath());
                c.delete();
            } catch (Throwable ignored) { }
        }
        if (bmp == null) return null;
        try {
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            int target = 600;
            if (w > target) {
                int nh = Math.max(1, h * target / w);
                Bitmap small = Bitmap.createScaledBitmap(bmp, target, nh, true);
                if (small != bmp) bmp.recycle();
                bmp = small;
            }
            FileOutputStream fos = new FileOutputStream(out);
            bmp.compress(Bitmap.CompressFormat.JPEG, 86, fos);
            fos.close();
            bmp.recycle();
            return out.getAbsolutePath();
        } catch (Throwable t) {
            return null;
        }
    }

    private long durationOf(String path) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return d == null ? 0 : Long.parseLong(d);
        } catch (Throwable t) {
            return 0;
        } finally {
            try {
                r.release();
            } catch (Throwable ignored) { }
        }
    }

    /* ----------------------------------------------------- notifications */

    private Notification ongoing(String text, int pct, long bytes, String right) {
        Notification.Builder b = builder();
        b.setSmallIcon(R.mipmap.ic_notif)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        if (pct >= 0) b.setProgress(100, pct, false);
        else b.setProgress(0, 0, true);
        return b.build();
    }

    private void done(String title, String text, String itemId) {
        Notification.Builder b = builder();
        b.setSmallIcon(R.mipmap.ic_notif)
                .setContentTitle(title)
                .setContentText(getString(R.string.notif_done_text, text))
                .setAutoCancel(true);
        Intent open = new Intent(this, PlayerActivity.class);
        if (itemId != null) open.putExtra(PlayerActivity.EXTRA_ID, itemId);
        PendingIntent pi = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        b.setContentIntent(pi);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(itemId == null ? NOTIF_ID + 1 : NOTIF_ID + 2, b.build());
    }

    private Notification.Builder builder() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL,
                        getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            return new Notification.Builder(this, CHANNEL);
        }
        return new Notification.Builder(this);
    }
}
