package com.aivision.camera.gallery;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.aivision.camera.media.MediaLibrary;
import com.aivision.camera.ui.IconButton;
import com.aivision.camera.ui.Icons;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The built-in gallery: a real MediaStore backed grid of everything the app saved, with the AI badge on
 * enhanced shots, a filter for photos/videos, multi select share and delete, and thumbnails decoded off
 * the UI thread.
 */
public class GalleryActivity extends Activity {

    private MediaLibrary library;
    private GridView grid;
    private Adapter adapter;
    private TextView countLabel, empty;
    private IconButton backBtn, selectBtn, shareBtn, deleteBtn;
    private final Set<Long> selected = new HashSet<Long>();
    private boolean selectionMode;
    private boolean videosOnly, photosOnly;
    private final ExecutorService thumbs = Executors.newFixedThreadPool(4);
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        library = new MediaLibrary(this);
        getWindow().setBackgroundDrawableResource(android.R.color.black);
        buildUi();
        reload();
    }

    @Override
    protected void onResume() {
        super.onResume();
        reload();
    }

    private float d() {
        return getResources().getDisplayMetrics().density;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF07080A);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(Math.round(d() * 4), Math.round(d() * 18), Math.round(d() * 8), Math.round(d() * 4));
        bar.setBackgroundColor(0xFF0B0D10);

        backBtn = new IconButton(this).icon(Icons.CHEVRON_LEFT).iconSize(20f).style(IconButton.STYLE_PLAIN);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        bar.addView(backBtn);

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView t = new TextView(this);
        t.setText("AI VISION GALLERY");
        t.setTextColor(0xFFFFC24B);
        t.setTextSize(11f);
        t.setLetterSpacing(0.14f);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        countLabel = new TextView(this);
        countLabel.setTextColor(0x80FFFFFF);
        countLabel.setTextSize(10.5f);
        titles.addView(t);
        titles.addView(countLabel);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView filter = new TextView(this);
        filter.setText("FILTER");
        filter.setTextColor(0xFFFFC24B);
        filter.setTextSize(10.5f);
        filter.setPadding(Math.round(d() * 10), Math.round(d() * 8), Math.round(d() * 10), Math.round(d() * 8));
        filter.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final String[] options = {"Everything", "Photos only", "Videos only"};
                new AlertDialog.Builder(GalleryActivity.this)
                        .setTitle("Show")
                        .setItems(options, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                photosOnly = which == 1;
                                videosOnly = which == 2;
                                reload();
                            }
                        }).show();
            }
        });
        bar.addView(filter);

        selectBtn = new IconButton(this).icon(Icons.CHECK).label("SELECT").iconSize(19f);
        selectBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                selectionMode = !selectionMode;
                selected.clear();
                selectBtn.setSelectedState(selectionMode);
                adapter.notifyDataSetChanged();
                updateActions();
            }
        });
        bar.addView(selectBtn);

        shareBtn = new IconButton(this).icon(Icons.SHARE).label("SHARE").iconSize(19f);
        shareBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                shareSelected();
            }
        });
        bar.addView(shareBtn);

        deleteBtn = new IconButton(this).icon(Icons.TRASH).label("DELETE").iconSize(19f);
        deleteBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmDelete();
            }
        });
        bar.addView(deleteBtn);
        root.addView(bar);

        empty = new TextView(this);
        empty.setText(com.aivision.camera.R.string.no_items);
        empty.setTextColor(0x66FFFFFF);
        empty.setTextSize(13f);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(0, Math.round(d() * 60), 0, 0);
        root.addView(empty);

        grid = new GridView(this);
        grid.setNumColumns(3);
        grid.setHorizontalSpacing(Math.round(d() * 3));
        grid.setVerticalSpacing(Math.round(d() * 3));
        grid.setPadding(0, Math.round(d() * 6), 0, Math.round(d() * 6));
        grid.setBackgroundColor(0xFF07080A);
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        adapter = new Adapter();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                MediaLibrary.Item item = adapter.items.get(position);
                if (selectionMode) {
                    toggleSelection(item);
                    return;
                }
                Intent i = new Intent(GalleryActivity.this, ViewerActivity.class);
                i.putExtra("index", position);
                i.putExtra("photosOnly", photosOnly);
                i.putExtra("videosOnly", videosOnly);
                startActivity(i);
            }
        });
        grid.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(AdapterView<?> parent, View view, int position, long id) {
                selectionMode = true;
                selectBtn.setSelectedState(true);
                toggleSelection(adapter.items.get(position));
                return true;
            }
        });
        root.addView(grid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void toggleSelection(MediaLibrary.Item item) {
        if (selected.contains(item.id)) selected.remove(item.id);
        else selected.add(item.id);
        adapter.notifyDataSetChanged();
        updateActions();
    }

    private void updateActions() {
        shareBtn.setEnabled(!selected.isEmpty());
        deleteBtn.setEnabled(!selected.isEmpty());
        countLabel.setText(adapter.items.size() + (selectionMode ? " items - " + selected.size() + " selected" : " items"));
    }

    private void shareSelected() {
        ArrayList<Uri> uris = new ArrayList<Uri>();
        for (MediaLibrary.Item it : adapter.items) {
            if (selected.contains(it.id)) uris.add(it.uri);
        }
        if (uris.isEmpty()) return;
        Intent i = new Intent(Intent.ACTION_SEND_MULTIPLE);
        i.setType(photosOnly ? "image/*" : "image/*");
        i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "Share with"));
    }

    private void confirmDelete() {
        if (selected.isEmpty()) return;
        new AlertDialog.Builder(this)
                .setTitle("Delete " + selected.size() + " item(s)?")
                .setMessage("This removes them from the device gallery.")
                .setPositiveButton("Delete", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        for (MediaLibrary.Item it : new ArrayList<MediaLibrary.Item>(adapter.items)) {
                            if (selected.contains(it.id)) library.delete(it);
                        }
                        selected.clear();
                        selectionMode = false;
                        selectBtn.setSelectedState(false);
                        reload();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void reload() {
        List<MediaLibrary.Item> items = library.query(!videosOnly, !photosOnly, 0);
        adapter.setItems(items);
        empty.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);
        grid.setVisibility(items.isEmpty() ? View.GONE : View.VISIBLE);
        updateActions();
    }

    @Override
    protected void onDestroy() {
        thumbs.shutdownNow();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ adapter

    private class Adapter extends BaseAdapter {
        final List<MediaLibrary.Item> items = new ArrayList<MediaLibrary.Item>();

        void setItems(List<MediaLibrary.Item> list) {
            items.clear();
            items.addAll(list);
            notifyDataSetChanged();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Object getItem(int position) {
            return items.get(position);
        }

        @Override
        public long getItemId(int position) {
            return items.get(position).id;
        }

        @Override
        public View getView(int position, View convert, ViewGroup parent) {
            final MediaLibrary.Item item = items.get(position);
            FrameLayout cell = new FrameLayout(GalleryActivity.this);
            final ImageView iv = new ImageView(GalleryActivity.this);
            iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
            iv.setBackgroundColor(0xFF121418);
            cell.addView(iv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            int size = Math.round(getResources().getDisplayMetrics().widthPixels / 3f);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, size);
            cell.setLayoutParams(lp);

            TextView badge = new TextView(GalleryActivity.this);
            boolean hasReport = library.getReport(item.name) != null;
            badge.setText(item.video ? (hasReport ? "AI VIDEO" : "VIDEO") : (hasReport ? "AI" : ""));
            badge.setTextColor(item.video ? 0xFF4CE0D2 : 0xFFFFC24B);
            badge.setTextSize(9f);
            badge.setPadding(Math.round(d() * 5), Math.round(d() * 2), Math.round(d() * 5), Math.round(d() * 2));
            badge.setBackgroundColor(0x99000000);
            FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT);
            bp.gravity = Gravity.BOTTOM | Gravity.START;
            bp.setMargins(Math.round(d() * 5), 0, 0, Math.round(d() * 5));
            cell.addView(badge, bp);

            if (item.video) {
                TextView play = new TextView(GalleryActivity.this);
                play.setText("PLAY");
                play.setTextColor(Color.WHITE);
                play.setTextSize(9f);
                play.setPadding(Math.round(d() * 5), Math.round(d() * 2), Math.round(d() * 5), Math.round(d() * 2));
                play.setBackgroundColor(0x99000000);
                FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT);
                pp.gravity = Gravity.TOP | Gravity.END;
                pp.setMargins(0, Math.round(d() * 5), Math.round(d() * 5), 0);
                cell.addView(play, pp);
            }

            if (selectionMode) {
                View mark = new View(GalleryActivity.this);
                mark.setBackgroundColor(selected.contains(item.id) ? 0x88FFC24B : 0x33000000);
                cell.addView(mark, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                TextView check = new TextView(GalleryActivity.this);
                check.setText(selected.contains(item.id) ? "SELECTED" : "");
                check.setTextColor(Color.WHITE);
                check.setTextSize(9f);
                FrameLayout.LayoutParams cp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT);
                cp.gravity = Gravity.TOP | Gravity.START;
                cp.setMargins(Math.round(d() * 5), Math.round(d() * 5), 0, 0);
                cell.addView(check, cp);
            }

            iv.setTag(item.uri.toString());
            final int thumbSize = Math.max(160, size / 2);
            thumbs.execute(new Runnable() {
                @Override
                public void run() {
                    final Bitmap bmp = library.thumbnail(item, thumbSize);
                    if (bmp == null) return;
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (item.uri.toString().equals(iv.getTag())) iv.setImageBitmap(bmp);
                        }
                    });
                }
            });
            return cell;
        }
    }
}
