package com.aivision.camera.gallery;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.aivision.camera.ai.EngineBridge;
import com.aivision.camera.media.MediaLibrary;
import com.aivision.camera.ui.CompareView;
import com.aivision.camera.ui.IconButton;
import com.aivision.camera.ui.Icons;
import com.aivision.camera.ui.ZoomImageView;

import java.util.ArrayList;
import java.util.List;

/**
 * Full screen viewer: pinch to zoom, side by side Before/After for anything the AI touched (using the
 * untouched original kept in private storage), the measured AI report, share and delete, and inline
 * playback of videos through the platform player.
 */
public class ViewerActivity extends Activity {

    private MediaLibrary library;
    private final List<MediaLibrary.Item> items = new ArrayList<MediaLibrary.Item>();
    private int index;
    private ZoomImageView zoom;
    private CompareView compare;
    private ScrollView reportScroll;
    private TextView reportText, title, meta;
    private FrameLayout stage;
    private IconButton compareBtn, reportBtn, prevBtn, nextBtn, playBtn;
    private boolean compareMode;
    private Bitmap current, before;

    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        library = new MediaLibrary(this);
        index = getIntent().getIntExtra("index", 0);
        boolean photosOnly = getIntent().getBooleanExtra("photosOnly", false);
        boolean videosOnly = getIntent().getBooleanExtra("videosOnly", false);
        items.addAll(library.query(!videosOnly, !photosOnly, 0));
        buildUi();
        show(Math.max(0, Math.min(index, items.size() - 1)));
    }

    private float d() {
        return getResources().getDisplayMetrics().density;
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF050607);

        stage = new FrameLayout(this);
        root.addView(stage, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        zoom = new ZoomImageView(this);
        stage.addView(zoom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        compare = new CompareView(this);
        compare.setVisibility(View.GONE);
        stage.addView(compare, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(0xCC0B0D10);
        top.setPadding(Math.round(d() * 4), Math.round(d() * 18), Math.round(d() * 6), Math.round(d() * 4));
        IconButton back = new IconButton(this).icon(Icons.CHEVRON_LEFT).iconSize(20f).style(IconButton.STYLE_PLAIN);
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        top.addView(back);
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        title = new TextView(this);
        title.setTextColor(Color.WHITE);
        title.setTextSize(12.5f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        meta = new TextView(this);
        meta.setTextColor(0x99FFFFFF);
        meta.setTextSize(10f);
        titles.addView(title);
        titles.addView(meta);
        top.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        reportBtn = new IconButton(this).icon(Icons.INFO).label("REPORT").iconSize(19f);
        reportBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                reportScroll.setVisibility(reportScroll.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
            }
        });
        top.addView(reportBtn);
        IconButton share = new IconButton(this).icon(Icons.SHARE).label("SHARE").iconSize(19f);
        share.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                share();
            }
        });
        top.addView(share);
        IconButton del = new IconButton(this).icon(Icons.TRASH).label("DELETE").iconSize(19f);
        del.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmDelete();
            }
        });
        top.addView(del);
        root.addView(top, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        reportScroll = new ScrollView(this);
        reportScroll.setVisibility(View.GONE);
        reportScroll.setBackgroundColor(0xE6101216);
        reportText = new TextView(this);
        reportText.setTextColor(0xD9FFFFFF);
        reportText.setTextSize(10.5f);
        reportText.setTypeface(Typeface.MONOSPACE);
        reportText.setPadding(Math.round(d() * 12), Math.round(d() * 10), Math.round(d() * 12), Math.round(d() * 10));
        reportScroll.addView(reportText);
        FrameLayout.LayoutParams rp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                Math.round(d() * 240));
        rp.gravity = Gravity.TOP;
        rp.topMargin = Math.round(d() * 62);
        root.addView(reportScroll, rp);

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        bottom.setGravity(Gravity.CENTER);
        bottom.setBackgroundColor(0xCC0B0D10);
        bottom.setPadding(0, Math.round(d() * 4), 0, Math.round(d() * 8));
        prevBtn = new IconButton(this).icon(Icons.CHEVRON_LEFT).label("PREV").iconSize(20f);
        prevBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                show(index - 1);
            }
        });
        bottom.addView(prevBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        compareBtn = new IconButton(this).icon(Icons.COMPARE).label("BEFORE/AFTER").iconSize(20f);
        compareBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (before == null) {
                    toast("No original stored for this item");
                    return;
                }
                compareMode = !compareMode;
                compareBtn.setSelectedState(compareMode);
                compare.setVisibility(compareMode ? View.VISIBLE : View.GONE);
                zoom.setVisibility(compareMode ? View.GONE : View.VISIBLE);
                if (compareMode) compare.set(before, current);
            }
        });
        bottom.addView(compareBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.2f));
        playBtn = new IconButton(this).icon(Icons.PLAY).label("PLAY").iconSize(20f);
        playBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                play();
            }
        });
        bottom.addView(playBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        nextBtn = new IconButton(this).icon(Icons.CHEVRON_RIGHT).label("NEXT").iconSize(20f);
        nextBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                show(index + 1);
            }
        });
        bottom.addView(nextBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.gravity = Gravity.BOTTOM;
        root.addView(bottom, bp);
        setContentView(root);
    }

    private void show(final int i) {
        if (items.isEmpty()) {
            toast("Nothing to show");
            finish();
            return;
        }
        index = Math.max(0, Math.min(items.size() - 1, i));
        final MediaLibrary.Item item = items.get(index);
        compareMode = false;
        compareBtn.setSelectedState(false);
        compare.setVisibility(View.GONE);
        zoom.setVisibility(View.VISIBLE);
        reportScroll.setVisibility(View.GONE);
        title.setText(item.name);
        String report = library.getReport(item.name);
        meta.setText((item.video ? "VIDEO" : "PHOTO") + "   " + item.width + "x" + item.height
                + "   " + (item.sizeBytes / 1024) + " KB" + (report == null ? "" : "   - AI processed"));
        reportText.setText(EngineBridge.humanReport(report) + "\nFile: " + (item.path == null ? item.uri.toString() : item.path));
        playBtn.setEnabled(item.video);
        playBtn.setAlpha(item.video ? 1f : 0.35f);
        before = null;
        compareBtn.setEnabled(library.hasOriginal(item.name));
        compareBtn.setAlpha(compareBtn.isEnabled() ? 1f : 0.35f);
        current = null;
        zoom.setBitmap(null);
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap bmp = null;
                try {
                    if (item.video) {
                        MediaMetadataRetriever r = new MediaMetadataRetriever();
                        r.setDataSource(ViewerActivity.this, item.uri);
                        bmp = r.getFrameAtTime(0);
                        r.release();
                    } else {
                        BitmapFactory.Options o = new BitmapFactory.Options();
                        o.inJustDecodeBounds = true;
                        java.io.InputStream is = getContentResolver().openInputStream(item.uri);
                        BitmapFactory.decodeStream(is, null, o);
                        if (is != null) is.close();
                        int sample = 1;
                        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) > 2048) sample *= 2;
                        BitmapFactory.Options o2 = new BitmapFactory.Options();
                        o2.inSampleSize = sample;
                        java.io.InputStream is2 = getContentResolver().openInputStream(item.uri);
                        bmp = BitmapFactory.decodeStream(is2, null, o2);
                        if (is2 != null) is2.close();
                    }
                } catch (Throwable t) {
                    bmp = null;
                }
                final Bitmap full = bmp;
                final byte[] orig = library.loadOriginal(item.name);
                Bitmap ob = null;
                if (orig != null) {
                    ob = EngineBridge.decodeScaled(orig, 1600);
                }
                final Bitmap origBmp = ob;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        current = full;
                        before = origBmp;
                        zoom.setBitmap(full);
                        if (compareMode && before != null) compare.set(before, current);
                    }
                });
            }
        }, "viewer-load").start();
    }

    private void play() {
        if (items.isEmpty()) return;
        MediaLibrary.Item item = items.get(index);
        if (!item.video) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(item.uri, "video/mp4");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Throwable t) {
            toast("No video player available");
        }
    }

    private void share() {
        if (items.isEmpty()) return;
        MediaLibrary.Item item = items.get(index);
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(item.video ? "video/mp4" : "image/jpeg");
        i.putExtra(Intent.EXTRA_STREAM, item.uri);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "Share with"));
    }

    private void confirmDelete() {
        if (items.isEmpty()) return;
        final MediaLibrary.Item item = items.get(index);
        new AlertDialog.Builder(this)
                .setTitle("Delete " + item.name + "?")
                .setPositiveButton("Delete", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        library.delete(item);
                        items.remove(item);
                        if (items.isEmpty()) {
                            finish();
                        } else {
                            show(Math.min(index, items.size() - 1));
                        }
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (current != null && !current.isRecycled()) current.recycle();
    }
}
