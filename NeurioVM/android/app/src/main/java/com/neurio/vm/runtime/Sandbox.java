package com.neurio.vm.runtime;

import android.content.Context;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.Vault;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import java.io.File;
import java.util.Locale;

/**
 * On-disk layout of a virtual handset.
 *
 * <pre>
 * filesDir/vm/
 * ├── active.txt                  ← bare UUID, read by the :vm process at startup
 * └── &lt;device-uuid&gt;/
 *     ├── identity.nvm            ← AES-GCM encrypted DeviceIdentity (Vault format)
 *     ├── files/                  ← per-device app files
 *     ├── cache/
 *     ├── prefs/                  ← SharedPreferences of anything handed a VirtualContext
 *     ├── databases/
 *     ├── downloads/              ← WebView DownloadListener target
 *     ├── uploads/                ← files the guest may attach
 *     └── logs/                   ← backend logs, one file per session
 * </pre>
 *
 * <p>Because the identity is stored encrypted *inside* the sandbox, the browser
 * process can boot a device on its own after being killed and restarted by the
 * system — no Intent extra required, and no plaintext identifiers on disk.
 */
public final class Sandbox {

    private static final String TAG = "Sandbox";
    private static final String DIR = "vm";
    private static final String ACTIVE = "active.txt";

    private Sandbox() {}

    public static File root(Context ctx) {
        return new File(ctx.getFilesDir(), DIR);
    }

    public static File dir(Context ctx, DeviceIdentity d) {
        return new File(root(ctx), d.id);
    }

    public static File dir(Context ctx, String id) {
        return new File(root(ctx), id);
    }

    public static File files(Context ctx, DeviceIdentity d)    { return new File(dir(ctx, d), "files"); }
    public static File cache(Context ctx, DeviceIdentity d)    { return new File(dir(ctx, d), "cache"); }
    public static File prefs(Context ctx, DeviceIdentity d)    { return new File(dir(ctx, d), "prefs"); }
    public static File databases(Context ctx, DeviceIdentity d){ return new File(dir(ctx, d), "databases"); }
    public static File downloads(Context ctx, DeviceIdentity d){ return new File(dir(ctx, d), "downloads"); }
    public static File uploads(Context ctx, DeviceIdentity d)  { return new File(dir(ctx, d), "uploads"); }
    public static File logs(Context ctx, DeviceIdentity d)     { return new File(dir(ctx, d), "logs"); }

    /** Creates the tree for a device if it does not exist yet. Idempotent. */
    public static void ensure(Context ctx, DeviceIdentity d) {
        Io.mkdirs(files(ctx, d));
        Io.mkdirs(cache(ctx, d));
        Io.mkdirs(prefs(ctx, d));
        Io.mkdirs(databases(ctx, d));
        Io.mkdirs(downloads(ctx, d));
        Io.mkdirs(uploads(ctx, d));
        Io.mkdirs(logs(ctx, d));
        saveIdentity(ctx, d);
    }

    public static void destroy(Context ctx, DeviceIdentity d) {
        boolean ok = Io.deleteRecursive(dir(ctx, d));
        Log.i(TAG, "sandbox " + d.id + " wiped=" + ok);
    }

    /** Total bytes used by one sandbox — shown on the device screen. */
    public static long size(Context ctx, DeviceIdentity d) {
        return sizeOf(dir(ctx, d));
    }

    private static long sizeOf(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long total = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) total += sizeOf(k);
        return total;
    }

    // ── identity persistence ───────────────────────────────────────────────

    private static File identityFile(Context ctx, DeviceIdentity d) {
        return new File(dir(ctx, d), "identity.nvm");
    }

    public static void saveIdentity(Context ctx, DeviceIdentity d) {
        try {
            Io.mkdirs(dir(ctx, d));
            new Vault(ctx, identityFile(ctx, d)).save(d.toJson().toString());
        } catch (Exception e) {
            Log.e(TAG, "could not store the identity for " + d.id, e);
        }
    }

    /**
     * Reads back an identity given only its UUID. Used by the {@code :vm}
     * process, which starts with nothing but {@code active.txt}.
     */
    public static DeviceIdentity loadIdentity(Context ctx, String id) {
        if (id == null) return null;
        File f = new File(dir(ctx, id), "identity.nvm");
        if (!f.isFile()) return null;
        try {
            String json = new Vault(ctx, f).load();
            return json == null ? null : DeviceIdentity.fromJson(new org.json.JSONObject(json));
        } catch (Exception e) {
            Log.e(TAG, "could not read identity " + id, e);
            return null;
        }
    }

    // ── active-device pointer ──────────────────────────────────────────────

    public static void writeActivePointer(Context ctx, String id) {
        try {
            Io.mkdirs(root(ctx));
            Io.write(new File(root(ctx), ACTIVE), id == null ? "" : id);
        } catch (Exception e) {
            Log.w(TAG, "active pointer write failed: " + e.getMessage());
        }
    }

    public static String readActivePointer(Context ctx) {
        File f = new File(root(ctx), ACTIVE);
        if (!f.isFile()) return null;
        try {
            String s = Io.read(f).trim();
            return s.isEmpty() ? null : s;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The suffix handed to {@code WebView.setDataDirectorySuffix}.
     *
     * <p>The framework restricts this to {@code [A-Za-z0-9_-]} and a maximum of
     * 128 characters, and it may only be set once per process — which is exactly
     * why the browser lives in its own process and why switching device means
     * restarting that process.
     */
    public static String webViewSuffix(DeviceIdentity d) {
        String raw = d == null ? "default" : d.id.replace('-', '_');
        StringBuilder sb = new StringBuilder("nvm_");
        for (int i = 0; i < raw.length() && sb.length() < 64; i++) {
            char c = raw.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '_' || c == '-';
            if (ok) sb.append(c);
        }
        return sb.toString().toLowerCase(Locale.US);
    }
}
