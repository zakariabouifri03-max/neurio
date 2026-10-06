package ma.zakaria.reelsoffline;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** The offline library: a JSON index in filesDir + the media files on disk. */
public final class Db {

    private static final String FILE = "library.json";

    private Db() { }

    public static class Item {
        public String id = "";
        public String shortcode = "";
        public String url = "";
        public String author = "";
        public String caption = "";
        public String title = "";
        public String kind = "video";              // video | photo
        public ArrayList<String> files = new ArrayList<>();
        public ArrayList<String> thumbs = new ArrayList<>();
        public long size = 0;
        public long ts = 0;
        public long duration = 0;

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id);
                o.put("shortcode", shortcode);
                o.put("url", url);
                o.put("author", author);
                o.put("caption", caption);
                o.put("title", title);
                o.put("kind", kind);
                o.put("size", size);
                o.put("ts", ts);
                o.put("duration", duration);
                o.put("files", new JSONArray(files));
                o.put("thumbs", new JSONArray(thumbs));
            } catch (Exception ignored) { }
            return o;
        }

        public static Item fromJson(JSONObject o) {
            Item i = new Item();
            i.id = o.optString("id");
            i.shortcode = o.optString("shortcode");
            i.url = o.optString("url");
            i.author = o.optString("author");
            i.caption = o.optString("caption");
            i.title = o.optString("title");
            i.kind = o.optString("kind", "video");
            i.size = o.optLong("size");
            i.ts = o.optLong("ts");
            i.duration = o.optLong("duration");
            JSONArray f = o.optJSONArray("files");
            if (f != null) for (int k = 0; k < f.length(); k++) i.files.add(f.optString(k));
            JSONArray t = o.optJSONArray("thumbs");
            if (t != null) for (int k = 0; k < t.length(); k++) i.thumbs.add(t.optString(k));
            return i;
        }

        /** First existing thumbnail, or null. */
        public String thumb() {
            for (String t : thumbs) {
                if (t != null && new File(t).exists()) return t;
            }
            return thumbs.isEmpty() ? null : thumbs.get(0);
        }

        public String display() {
            if (title != null && !title.isEmpty()) return title;
            if (caption != null && !caption.isEmpty()) return Util.trimTo(caption, 70);
            if (author != null && !author.isEmpty()) return "@" + author;
            return kind.equals("photo") ? "صورة" : "ريل";
        }
    }

    private static File file(Context c) {
        return new File(c.getFilesDir(), FILE);
    }

    public static synchronized ArrayList<Item> load(Context c) {
        ArrayList<Item> out = new ArrayList<>();
        File f = file(c);
        if (!f.exists()) return out;
        try {
            FileInputStream in = new FileInputStream(f);
            InputStreamReader r = new InputStreamReader(in, "UTF-8");
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            r.close();
            JSONArray arr = new JSONArray(sb.toString());
            for (int i = 0; i < arr.length(); i++) out.add(Item.fromJson(arr.getJSONObject(i)));
        } catch (Exception ignored) { }
        Collections.sort(out, new Comparator<Item>() {
            @Override public int compare(Item a, Item b) { return Long.compare(b.ts, a.ts); }
        });
        return out;
    }

    public static synchronized void save(Context c, List<Item> items) {
        JSONArray arr = new JSONArray();
        for (Item i : items) arr.put(i.toJson());
        File f = file(c);
        File tmp = new File(c.getFilesDir(), FILE + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            OutputStreamWriter w = new OutputStreamWriter(out, "UTF-8");
            w.write(arr.toString());
            w.flush();
            w.close();
            if (f.exists()) f.delete();
            tmp.renameTo(f);
        } catch (Exception ignored) { }
    }

    public static synchronized void add(Context c, Item item) {
        ArrayList<Item> all = load(c);
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id.equals(item.id)) {
                all.set(i, item);
                save(c, all);
                return;
            }
        }
        all.add(item);
        save(c, all);
    }

    public static synchronized Item byId(Context c, String id) {
        for (Item i : load(c)) if (i.id.equals(id)) return i;
        return null;
    }

    /** Removes the entry and the files that belong to it. */
    public static synchronized void remove(Context c, String id) {
        ArrayList<Item> all = load(c);
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id.equals(id)) {
                Item it = all.remove(i);
                for (String p : it.files) try { new File(p).delete(); } catch (Exception ignored) { }
                for (String p : it.thumbs) try { new File(p).delete(); } catch (Exception ignored) { }
                break;
            }
        }
        save(c, all);
    }

    public static synchronized void clearAll(Context c) {
        for (Item it : load(c)) {
            for (String p : it.files) try { new File(p).delete(); } catch (Exception ignored) { }
            for (String p : it.thumbs) try { new File(p).delete(); } catch (Exception ignored) { }
        }
        save(c, new ArrayList<Item>());
    }

    public static long totalSize(List<Item> items) {
        long s = 0;
        for (Item i : items) s += i.size;
        return s;
    }
}
