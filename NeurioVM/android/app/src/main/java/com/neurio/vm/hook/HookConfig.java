package com.neurio.vm.hook;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * The contract between NeurioVM and the LSPosed module inside it.
 *
 * <p>NeurioVM's own sandbox can only change what <em>web</em> content sees:
 * {@code android.os.Build.MODEL} is a static field in whichever process reads
 * it, and a browser process cannot rewrite it for Facebook's process. Doing that
 * needs a hook framework. This class is the whole of the hand-over:
 *
 * <ul>
 *   <li>{@link #publish(Context, DeviceIdentity, Set, boolean)} writes the
 *       current configuration into {@code SharedPreferences} and the
 *       {@link HookProvider} — called by the app whenever a device becomes
 *       active;</li>
 *   <li>{@link #fromProvider(Context)} reads it back from another process via
 *       the exported content provider — called by {@link NeurioHook} inside the
 *       target app;</li>
 *   <li>{@link #fromJson(String)} parses it.</li>
 * </ul>
 *
 * <p>No Xposed class appears in this file on purpose: it is loaded by the main
 * app, where the Xposed framework does not exist and a stray
 * {@code NoClassDefFoundError} would be fatal. Every reference to the framework
 * lives in {@link NeurioHook}, which is only ever loaded by LSPosed itself.
 */
public final class HookConfig {

    private static final String TAG = "HookConfig";

    public static final String PREFS = "neurio_hook";
    public static final String KEY_ENABLED = "enabled";
    public static final String KEY_JSON = "configJson";
    public static final String KEY_PACKAGES = "packages";
    public static final String KEY_MODE = "mode"; // "all" | "selected"

    /** Authority of the exported provider — must match the manifest. */
    public static final String AUTHORITY = "com.neurio.vm.hook";
    public static final Uri URI = Uri.parse("content://" + AUTHORITY + "/active");

    public final boolean enabled;
    public final String mode;
    public final Set<String> packages;
    public final DeviceIdentity identity;

    private HookConfig(boolean enabled, String mode, Set<String> packages, DeviceIdentity identity) {
        this.enabled = enabled;
        this.mode = mode == null ? "selected" : mode;
        this.packages = packages == null ? Collections.<String>emptySet() : packages;
        this.identity = identity;
    }

    /** Does this configuration apply to {@code pkg}? */
    public boolean appliesTo(String pkg) {
        if (!enabled || identity == null || pkg == null) return false;
        if (pkg.equals("com.neurio.vm")) return false;   // never spoof ourselves
        if (pkg.startsWith("com.android.")) return false; // leave the platform alone
        if ("all".equals(mode)) return true;
        return packages.contains(pkg);
    }

    // ── writing (main app) ─────────────────────────────────────────────────

    public static void publish(Context ctx, DeviceIdentity d, Set<String> pkgs, boolean enabled) {
        String mode = pkgs == null || pkgs.isEmpty() ? "all" : "selected";
        try {
            JSONObject o = new JSONObject();
            o.put("enabled", enabled);
            o.put("mode", mode);
            o.put("packageName", ctx.getPackageName());
            JSONArray arr = new JSONArray();
            if (pkgs != null) for (String p : pkgs) arr.put(p);
            o.put("packages", arr);
            if (d != null) {
                o.put("identity", d.toJson());
                o.put("device", d.displayName());
            }
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit()
                    .putBoolean(KEY_ENABLED, enabled)
                    .putString(KEY_MODE, mode)
                    .putStringSet(KEY_PACKAGES, pkgs == null ? new HashSet<String>() : new HashSet<>(pkgs))
                    .putString(KEY_JSON, o.toString())
                    .apply();
            ctx.getContentResolver().notifyChange(URI, null);
            Log.i(TAG, "hook config published (enabled=" + enabled + ", mode=" + mode
                    + ", device=" + (d == null ? "none" : d.displayName()) + ")");
        } catch (Exception e) {
            Log.e(TAG, "could not publish the hook config", e);
        }
    }

    public static void clear(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        ctx.getContentResolver().notifyChange(URI, null);
    }

    public static HookConfig load(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = sp.getString(KEY_JSON, null);
        return json == null ? null : fromJson(json);
    }

    // ── reading (either side) ──────────────────────────────────────────────

    public static HookConfig fromJson(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(json);
            boolean enabled = o.optBoolean("enabled", false);
            String mode = o.optString("mode", "selected");
            Set<String> pkgs = new HashSet<>();
            JSONArray arr = o.optJSONArray("packages");
            if (arr != null) for (int i = 0; i < arr.length(); i++) pkgs.add(arr.optString(i));
            JSONObject idObj = o.optJSONObject("identity");
            DeviceIdentity d = idObj == null ? null : DeviceIdentity.fromJson(idObj);
            return new HookConfig(enabled, mode, pkgs, d);
        } catch (Exception e) {
            Log.w(TAG, "bad hook config: " + e.getMessage());
            return null;
        }
    }

    /**
     * Reads the config from another process through {@link HookProvider}.
     * Returns null when the provider is absent (NeurioVM not installed) or when
     * nothing has been published yet.
     */
    public static HookConfig fromProvider(Context ctx) {
        if (ctx == null) return null;
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(URI, new String[]{"json"}, null, null, null);
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex("json");
                if (col >= 0) return fromJson(c.getString(col));
            }
        } catch (Throwable t) {
            // SecurityException when the provider is disabled, or the resolver
            // is not ready yet inside a freshly forked app process.
            Log.d(TAG, "provider read failed: " + t.getClass().getSimpleName() + ": " + t.getMessage());
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) { }
        }
        return null;
    }

    @Override
    public String toString() {
        return "HookConfig{enabled=" + enabled + ", mode=" + mode + ", packages=" + packages.size()
                + ", device=" + (identity == null ? "none" : identity.displayName()) + "}";
    }
}
