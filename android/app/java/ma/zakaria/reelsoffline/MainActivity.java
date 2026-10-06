package ma.zakaria.reelsoffline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.LruCache;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Locale;

/** The offline library: everything that is saved on the phone. */
public class MainActivity extends Activity implements EventBus.Listener {

    private static final int REQ_IMPORT = 21;
    private static final int REQ_PERM = 22;

    private GridView grid;
    private View empty;
    private TextView storageLine;
    private ArrayList<Db.Item> items = new ArrayList<>();
    private Adapter adapter;
    private final LruCache<String, Bitmap> cache = new LruCache<>(48);

    private static final String GAME_TITLE = "game";
    private final String[] gameAssets = { "games/bash-baqi-racing.html" };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);

        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(0xFF0B0B0F);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setNavigationBarColor(0xFF17171F);

        grid = findViewById(R.id.grid);
        empty = findViewById(R.id.empty);
        storageLine = findViewById(R.id.storageLine);

        adapter = new Adapter();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> open(items.get(position), 0));
        grid.setOnItemLongClickListener((parent, view, position, id) -> {
            menu(items.get(position));
            return true;
        });

        findViewById(R.id.btnAdd).setOnClickListener(v -> startActivity(new Intent(this, AddActivity.class)));
        findViewById(R.id.btnBrowse).setOnClickListener(v -> startActivity(new Intent(this, BrowserActivity.class)));
        findViewById(R.id.btnImport).setOnClickListener(v -> importFile());
        findViewById(R.id.btnGames).setOnClickListener(v -> pickGame());

        askNotifications();
    }

    @Override
    protected void onResume() {
        super.onResume();
        EventBus.register(this);
        reload();
    }

    @Override
    protected void onPause() {
        EventBus.unregister(this);
        super.onPause();
    }

    @Override
    public void onEvent(String what) {
        runOnUiThread(this::reload);
    }

    /* ------------------------------------------------------------- data */

    private void reload() {
        items = Db.load(this);
        adapter.notifyDataSetChanged();
        boolean none = items.isEmpty();
        empty.setVisibility(none ? View.VISIBLE : View.GONE);
        grid.setVisibility(none ? View.GONE : View.VISIBLE);
        storageLine.setText(getString(R.string.storage_body, Util.human(Db.totalSize(items)), items.size()));
    }

    private void open(Db.Item item, int index) {
        Intent i = new Intent(this, PlayerActivity.class);
        i.putExtra(PlayerActivity.EXTRA_ID, item.id);
        i.putExtra(PlayerActivity.EXTRA_FILE, index);
        startActivity(i);
    }

    private void menu(final Db.Item item) {
        final String[] labels = {
                getString(R.string.play), getString(R.string.share),
                getString(R.string.export), getString(R.string.delete),
                getString(R.string.storage_title)
        };
        new AlertDialog.Builder(this)
                .setTitle(Util.trimTo(item.display(), 40))
                .setItems(labels, (d, w) -> {
                    switch (w) {
                        case 0: open(item, 0); break;
                        case 1:
                            if (!Export.share(this, item)) Util.toast(this, "ما قدرناش نشاركو");
                            break;
                        case 2: export(item); break;
                        case 3: confirmDelete(item); break;
                        default: info(item); break;
                    }
                })
                .show();
    }

    private void info(Db.Item item) {
        StringBuilder sb = new StringBuilder();
        sb.append("النوع: ").append(item.kind.equals("photo") ? "تصاور" : "فيديو").append('\n');
        sb.append("الحجم: ").append(Util.human(item.size)).append('\n');
        sb.append("عدد الملفات: ").append(item.files.size()).append('\n');
        if (item.author != null && !item.author.isEmpty()) sb.append("الحساب: @").append(item.author).append('\n');
        if (!item.caption.isEmpty()) sb.append("\n").append(Util.trimTo(item.caption, 300));
        new AlertDialog.Builder(this)
                .setTitle(item.display())
                .setMessage(sb.toString())
                .setPositiveButton(R.string.open, (d, w) -> open(item, 0))
                .setNeutralButton(R.string.export, (d, w) -> export(item))
                .setNegativeButton(R.string.close, null)
                .show();
    }

    private void export(final Db.Item item) {
        if (Build.VERSION.SDK_INT < 29 && Build.VERSION.SDK_INT >= 23
                && checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE")
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {"android.permission.WRITE_EXTERNAL_STORAGE"}, REQ_PERM);
            return;
        }
        final boolean ok = Export.toGallery(this, item);
        Util.toast(this, getString(ok ? R.string.exported : R.string.export_fail));
    }

    private void confirmDelete(final Db.Item item) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.delete)
                .setMessage(item.display())
                .setPositiveButton(R.string.delete, (d, w) -> {
                    Db.remove(this, item.id);
                    Util.toast(this, getString(R.string.deleted));
                    reload();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    /* ----------------------------------------------------------- import */

    private void importFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"video/*", "image/*"});
        try {
            startActivityForResult(i, REQ_IMPORT);
        } catch (Throwable t) {
            Util.toast(this, "ما كاينش مدير الملفات");
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_IMPORT || res != RESULT_OK || data == null || data.getData() == null) return;
        try {
            Uri uri = data.getData();
            String name = queryName(uri);
            String lower = name.toLowerCase(Locale.US);
            boolean video = lower.endsWith(".mp4") || lower.endsWith(".mkv") || lower.endsWith(".webm");
            String id = "imp_" + Util.md5(uri + ":" + System.currentTimeMillis());
            File reels = Util.reelsDir(this);
            File out = new File(reels, id + (video ? ".mp4" : ".jpg"));
            InputStream in = getContentResolver().openInputStream(uri);
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.close();
            in.close();

            Db.Item item = new Db.Item();
            item.id = id;
            item.kind = video ? "video" : "photo";
            item.title = name;
            item.url = "import";
            item.files.add(out.getAbsolutePath());
            item.size = out.length();
            item.ts = System.currentTimeMillis();
            Db.add(this, item);
            reload();
            Util.toast(this, "تدخّل ✅");
        } catch (Throwable t) {
            Util.toast(this, "ما قدرناش نستوردو الملف");
        }
    }

    private String queryName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String s = c.getString(i);
                    if (s != null && !s.isEmpty()) return s;
                }
            }
        } catch (Throwable ignored) { } finally {
            if (c != null) c.close();
        }
        String last = uri.getLastPathSegment();
        return last == null ? "ملف" : last;
    }

    /* ------------------------------------------------------------ games */

    private void pickGame() {
        String[] titles = { getString(R.string.game_racing) };
        new AlertDialog.Builder(this)
                .setTitle(R.string.games_title)
                .setItems(titles, (d, w) -> GameActivity.open(this, titles[w], gameAssets[w]))
                .setNegativeButton(R.string.close, null)
                .show();
    }

    /* --------------------------------------------------------- permission */

    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            try {
                requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, REQ_PERM);
            } catch (Throwable ignored) { }
        }
    }

    /* ----------------------------------------------------------- adapter */

    private class Adapter extends BaseAdapter {
        @Override public int getCount() { return items.size(); }

        @Override public Object getItem(int i) { return items.get(i); }

        @Override public long getItemId(int i) { return i; }

        @Override
        public View getView(int position, View convert, ViewGroup parent) {
            if (convert == null) {
                convert = LayoutInflater.from(MainActivity.this).inflate(R.layout.item_reel, parent, false);
            }
            Db.Item item = items.get(position);
            ImageView thumb = convert.findViewById(R.id.thumb);
            ImageView kind = convert.findViewById(R.id.kindIcon);
            TextView duration = convert.findViewById(R.id.duration);
            TextView title = convert.findViewById(R.id.title);
            View more = convert.findViewById(R.id.menu);

            thumb.setImageBitmap(null);
            String t = item.thumb();
            Bitmap bmp = t == null ? null : cache.get(t);
            if (bmp == null && t != null) {
                bmp = decode(t, 480);
                if (bmp != null) cache.put(t, bmp);
            }
            if (bmp != null) thumb.setImageBitmap(bmp);

            kind.setImageResource(item.kind.equals("photo") ? R.drawable.ic_photo : R.drawable.ic_video);
            duration.setText(item.kind.equals("photo")
                    ? (item.files.size() > 1 ? item.files.size() + " صور" : "صورة")
                    : Util.mmss(item.duration));
            title.setText(item.display());
            more.setOnClickListener(v -> menu(item));
            return convert;
        }
    }

    private Bitmap decode(String path, int target) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            int scale = 1;
            while (o.outWidth / (scale * 2) >= target) scale *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = scale;
            return BitmapFactory.decodeFile(path, o2);
        } catch (Throwable t) {
            return null;
        }
    }
}
