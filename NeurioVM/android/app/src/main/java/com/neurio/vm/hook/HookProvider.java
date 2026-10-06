package com.neurio.vm.hook;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;

/**
 * Read-only bridge that lets the LSPosed module — running inside somebody
 * else's process — fetch the current virtual identity.
 *
 * <p>A hooked app cannot read {@code /data/data/com.neurio.vm}: different UID,
 * and {@code MODE_WORLD_READABLE} has been rejected since Android 7. An exported
 * {@link ContentProvider} is the supported way to cross that boundary, and it
 * needs no permission on either side.
 *
 * <p><b>What is exposed, and why that is acceptable:</b> one row containing the
 * synthetic identity currently published (model, fingerprint, ANDROID_ID, IMEI,
 * MACs) and the list of package names the user asked to spoof. None of it is the
 * real device's data — that is the entire point of the app — but the package
 * list does reveal which apps the user is spoofing. The provider is therefore
 * switched off whenever hooking is disabled, and the console screen says so.
 */
public final class HookProvider extends ContentProvider {

    public static final String COLUMN_JSON = "json";
    public static final String COLUMN_ENABLED = "enabled";
    public static final String COLUMN_MODE = "mode";
    public static final String COLUMN_DEVICE = "device";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(
                new String[]{COLUMN_JSON, COLUMN_ENABLED, COLUMN_MODE, COLUMN_DEVICE});
        HookConfig cfg = getContext() == null ? null : HookConfig.load(getContext());
        if (cfg != null && cfg.enabled && cfg.identity != null) {
            try {
                cursor.addRow(new Object[]{
                        new org.json.JSONObject()
                                .put("enabled", true)
                                .put("mode", cfg.mode)
                                .put("packages", new org.json.JSONArray(new java.util.ArrayList<>(cfg.packages)))
                                .put("identity", cfg.identity.toJson())
                                .toString(),
                        1, cfg.mode, cfg.identity.displayName()
                });
            } catch (org.json.JSONException e) {
                // an unparseable config is the same as no config
            }
        }
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        return "vnd.android.cursor.item/vnd." + HookConfig.AUTHORITY + ".active";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("NeurioVM's hook provider is read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("NeurioVM's hook provider is read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("NeurioVM's hook provider is read-only");
    }
}
