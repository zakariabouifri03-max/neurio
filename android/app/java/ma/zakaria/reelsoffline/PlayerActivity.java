package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.MediaController;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.VideoView;

import java.util.ArrayList;
import java.util.Locale;

/** Plays one saved reel/photo, offline, with swipe-through like a real feed. */
public class PlayerActivity extends Activity {

    public static final String EXTRA_ID = "id";
    public static final String EXTRA_FILE = "file";

    private VideoView video;
    private ZoomImageView photo;
    private ImageView bigPlay;
    private ImageView toggle;
    private ImageView loopIcon;
    private SeekBar seek;
    private TextView title;
    private TextView caption;
    private TextView time;
    private TextView of;
    private ProgressBar spin;
    private View topBar;
    private View bottomBar;

    private final ArrayList<Db.Item> items = new ArrayList<>();
    private final ArrayList<int[]> frames = new ArrayList<>();
    private int pos = 0;
    private boolean loopOne = false;
    private boolean dragging = false;
    private boolean playing = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_player);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(0xCC000000);
            getWindow().setNavigationBarColor(0xCC000000);
        }
        video = findViewById(R.id.video);
        photo = findViewById(R.id.photo);
        bigPlay = findViewById(R.id.bigPlay);
        toggle = findViewById(R.id.toggle);
        loopIcon = findViewById(R.id.loop);
        seek = findViewById(R.id.seek);
        title = findViewById(R.id.title);
        caption = findViewById(R.id.caption);
        time = findViewById(R.id.time);
        of = findViewById(R.id.of);
        spin = findViewById(R.id.spin);
        topBar = findViewById(R.id.topBar);
        bottomBar = findViewById(R.id.bottomBar);

        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.prev).setOnClickListener(v -> step(-1));
        findViewById(R.id.next).setOnClickListener(v -> step(1));
        findViewById(R.id.toggle).setOnClickListener(v -> togglePlay());
        bigPlay.setOnClickListener(v -> togglePlay());
        video.setOnClickListener(v -> togglePlay());
        findViewById(R.id.share).setOnClickListener(v -> current(item -> {
            if (!Export.share(this, item)) Util.toast(this, "ما قدرناش نشاركو");
        }));
        findViewById(R.id.delete).setOnClickListener(v -> current(this::confirmDelete));
        findViewById(R.id.export).setOnClickListener(v -> current(this::export));
        loopIcon.setOnClickListener(v -> {
            loopOne = !loopOne;
            loopIcon.setAlpha(loopOne ? 1f : 0.5f);
            if (playing) video.setVideoPath(currentPath());
        });
        loopIcon.setAlpha(0.5f);

        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int p, boolean fromUser) {
                if (fromUser) {
                    dragging = true;
                    video.seekTo(p);
                    time.setText(Util.mmss(p) + " / " + Util.mmss(video.getDuration()));
                }
            }

            @Override public void onStartTrackingTouch(SeekBar sb) { dragging = true; }

            @Override public void onStopTrackingTouch(SeekBar sb) { dragging = false; }
        });

        items.addAll(Db.load(this));
        String id = getIntent().getStringExtra(EXTRA_ID);
        int file = getIntent().getIntExtra(EXTRA_FILE, 0);
        int startItem = 0;
        for (int i = 0; i < items.size(); i++) if (items.get(i).id.equals(id)) startItem = i;
        buildFrames(startItem, file);
        refreshIcons();
        show();
        ui.postDelayed(tick, 500);
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            video.pause();
        } catch (Throwable ignored) { }
        playing = false;
        updateToggleIcon();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        try {
            video.stopPlayback();
        } catch (Throwable ignored) { }
        super.onDestroy();
    }

    /* ------------------------------------------------------------ frames */

    private void buildFrames(int startItem, int startFile) {
        frames.clear();
        for (int i = 0; i < items.size(); i++) {
            Db.Item it = items.get(i);
            for (int f = 0; f < it.files.size(); f++) frames.add(new int[] {i, f});
        }
        pos = 0;
        for (int k = 0; k < frames.size(); k++) {
            int[] fr = frames.get(k);
            if (fr[0] == startItem && fr[1] == Math.max(0, startFile)) {
                pos = k;
                break;
            }
        }
    }

    private Db.Item currentItem() {
        if (frames.isEmpty()) return null;
        return items.get(frames.get(pos)[0]);
    }

    private String currentPath() {
        Db.Item it = currentItem();
        if (it == null) return null;
        int f = frames.get(pos)[1];
        return f < it.files.size() ? it.files.get(f) : null;
    }

    private interface ItemAction {
        void run(Db.Item item);
    }

    private void current(ItemAction a) {
        Db.Item it = currentItem();
        if (it != null) a.run(it);
    }

    /* -------------------------------------------------------------- show */

    private void show() {
        if (frames.isEmpty()) {
            finish();
            return;
        }
        Db.Item item = currentItem();
        String path = currentPath();
        if (item == null || path == null) {
            step(1);
            return;
        }
        boolean isVideo = path.toLowerCase(Locale.US).endsWith(".mp4");
        title.setText(item.display());
        caption.setText(item.caption == null ? "" : Util.trimTo(item.caption, 160));
        of.setText((pos + 1) + "/" + frames.size());

        if (isVideo) {
            photo.setVisibility(View.GONE);
            video.setVisibility(View.VISIBLE);
            playVideo(path);
        } else {
            try {
                video.stopPlayback();
            } catch (Throwable ignored) { }
            playing = false;
            video.setVisibility(View.GONE);
            photo.setVisibility(View.VISIBLE);
            spin.setVisibility(View.GONE);
            loadPhoto(path);
            bigPlay.setVisibility(View.GONE);
            seek.setEnabled(false);
            time.setText(item.files.size() > 1 ? ("🖼 " + (frames.get(pos)[1] + 1) + "/" + item.files.size()) : "🖼");
        }
    }

    private void playVideo(String path) {
        spin.setVisibility(View.VISIBLE);
        bigPlay.setVisibility(View.GONE);
        seek.setEnabled(true);
        try {
            video.setOnPreparedListener(mp -> {
                mp.setLooping(false);
                video.start();
                playing = true;
                spin.setVisibility(View.GONE);
                seek.setMax(Math.max(1, video.getDuration()));
                updateToggleIcon();
            });
            video.setOnCompletionListener(mp -> {
                if (loopOne) {
                    video.seekTo(0);
                    video.start();
                    playing = true;
                } else {
                    step(1);
                }
            });
            video.setOnErrorListener((mp, what, extra) -> {
                spin.setVisibility(View.GONE);
                Util.toast(PlayerActivity.this, "ما قدرناش نشغّلو الفيديو");
                return true;
            });
            video.setVideoPath(path);
            video.requestFocus();
        } catch (Throwable t) {
            spin.setVisibility(View.GONE);
            Util.toast(this, "ما قدرناش نشغّلو الفيديو");
        }
    }

    private void loadPhoto(String path) {
        try {
            Point size = new Point();
            getWindowManager().getDefaultDisplay().getSize(size);
            int target = Math.max(size.x, size.y);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            int scale = 1;
            while (o.outWidth / (scale * 2) >= target) scale *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = scale;
            Bitmap bmp = BitmapFactory.decodeFile(path, o2);
            photo.setImageBitmap(bmp);
        } catch (Throwable t) {
            Util.toast(this, "ما قدرناش نبيّنو الصورة");
        }
    }

    private void togglePlay() {
        if (video.getVisibility() != View.VISIBLE) return;
        try {
            if (video.isPlaying()) {
                video.pause();
                playing = false;
            } else {
                video.start();
                playing = true;
            }
        } catch (Throwable ignored) { }
        updateToggleIcon();
    }

    private void updateToggleIcon() {
        toggle.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
        bigPlay.setVisibility(playing || video.getVisibility() != View.VISIBLE ? View.GONE : View.VISIBLE);
    }

    private void refreshIcons() {
        loopIcon.setAlpha(loopOne ? 1f : 0.5f);
    }

    private void step(int dir) {
        if (frames.isEmpty()) return;
        pos = (pos + dir + frames.size()) % frames.size();
        show();
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            try {
                if (video.getVisibility() == View.VISIBLE && playing) {
                    if (!dragging) {
                        seek.setProgress(video.getCurrentPosition());
                        time.setText(Util.mmss(video.getCurrentPosition()) + " / " + Util.mmss(video.getDuration()));
                    }
                }
            } catch (Throwable ignored) { }
            ui.postDelayed(this, 500);
        }
    };

    /* ----------------------------------------------------------- actions */

    private void confirmDelete(final Db.Item item) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.delete)
                .setMessage(item.display())
                .setPositiveButton(R.string.delete, (d, w) -> {
                    Db.remove(this, item.id);
                    int keep = Math.max(0, pos - 1);
                    items.clear();
                    items.addAll(Db.load(this));
                    if (items.isEmpty()) {
                        finish();
                        return;
                    }
                    int[] fr = frames.isEmpty() ? new int[] {0, 0} : frames.get(Math.min(keep, frames.size() - 1));
                    buildFrames(Math.min(fr[0], items.size() - 1), 0);
                    show();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void export(Db.Item item) {
        if (Build.VERSION.SDK_INT < 29 && Build.VERSION.SDK_INT >= 23
                && checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE")
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {"android.permission.WRITE_EXTERNAL_STORAGE"}, 33);
            return;
        }
        Util.toast(this, getString(Export.toGallery(this, item) ? R.string.exported : R.string.export_fail));
    }

    @Override
    public void onBackPressed() {
        finish();
    }
}
