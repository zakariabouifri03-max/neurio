package com.neurio.vm.core;

import android.content.Context;

import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The single source of truth for the fleet of virtual handsets.
 *
 * <p>Everything is kept in one AES-GCM encrypted blob written through
 * {@link Vault}; only the *id* of the currently active device is duplicated in
 * plaintext at {@code filesDir/vm/active.txt}, because the isolated browser
 * runs in a second process ({@code :vm}) and has to know which WebView data
 * directory suffix to claim before it is allowed to touch a WebView at all.
 * A bare UUID leaks nothing.
 */
public final class ProfileStore {

    private static final String TAG = "ProfileStore";
    private static final String VAULT_FILE = "profiles.nvm";
    private static final int FORMAT_VERSION = 1;

    private static volatile ProfileStore instance;

    private final Context ctx;
    private final Vault vault;
    private final List<DeviceIdentity> devices = new ArrayList<>();
    private String activeId;
    private boolean loaded;

    public static ProfileStore get(Context ctx) {
        ProfileStore local = instance;
        if (local == null) {
            synchronized (ProfileStore.class) {
                local = instance;
                if (local == null) {
                    local = new ProfileStore(ctx.getApplicationContext());
                    instance = local;
                }
            }
        }
        return local;
    }

    private ProfileStore(Context ctx) {
        this.ctx = ctx;
        this.vault = new Vault(ctx, VAULT_FILE);
    }

    // ── loading / saving ───────────────────────────────────────────────────

    /** Loads synchronously; cheap (a few KB) and called from a worker thread by the UI. */
    public synchronized void ensureLoaded() {
        if (loaded) return;
        devices.clear();
        try {
            String json = vault.load();
            if (json != null) parse(json);
        } catch (Exception e) {
            Log.e(TAG, "vault unreadable — starting with an empty fleet", e);
        }
        if (activeId == null && !devices.isEmpty()) activeId = devices.get(0).id;
        loaded = true;
    }

    private void parse(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        activeId = root.optString("active", null);
        JSONArray arr = root.optJSONArray("devices");
        if (arr == null) return;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            try {
                devices.add(DeviceIdentity.fromJson(o));
            } catch (JSONException e) {
                Log.w(TAG, "skipping corrupt profile at index " + i);
            }
        }
    }

    public synchronized void persist() {
        try {
            JSONObject root = new JSONObject();
            root.put("version", FORMAT_VERSION);
            root.put("active", activeId == null ? JSONObject.NULL : activeId);
            root.put("savedAt", System.currentTimeMillis());
            JSONArray arr = new JSONArray();
            for (DeviceIdentity d : devices) arr.put(d.toJson());
            root.put("devices", arr);
            vault.save(root.toString());
        } catch (Exception e) {
            Log.e(TAG, "could not persist the fleet", e);
        }
    }

    /** {@code true} when a first-run device should be created by the caller. */
    public synchronized boolean isEmpty() {
        ensureLoaded();
        return devices.isEmpty();
    }

    // ── queries ────────────────────────────────────────────────────────────

    public synchronized List<DeviceIdentity> list() {
        ensureLoaded();
        return Collections.unmodifiableList(new ArrayList<>(devices));
    }

    public synchronized DeviceIdentity get(String id) {
        ensureLoaded();
        if (id == null) return null;
        for (DeviceIdentity d : devices) if (id.equals(d.id)) return d;
        return null;
    }

    public synchronized DeviceIdentity active() {
        ensureLoaded();
        DeviceIdentity d = get(activeId);
        if (d == null && !devices.isEmpty()) {
            d = devices.get(0);
            activeId = d.id;
        }
        return d;
    }

    public synchronized void setActive(String id) {
        ensureLoaded();
        if (get(id) == null) return;
        activeId = id;
        publishActivePointer(id);
        persist();
        Log.i(TAG, "active device → " + get(id).displayName());
    }

    /** The {@code :vm} process reads this to pick its WebView data-dir suffix. */
    private void publishActivePointer(String id) {
        try {
            Sandbox.writeActivePointer(ctx, id);
        } catch (Exception e) {
            Log.w(TAG, "could not publish the active-device pointer: " + e.getMessage());
        }
    }

    public synchronized String activeId() {
        ensureLoaded();
        return activeId;
    }

    // ── mutations ──────────────────────────────────────────────────────────

    public synchronized DeviceIdentity add(DeviceIdentity d) {
        ensureLoaded();
        devices.add(d);
        if (activeId == null) {
            activeId = d.id;
            publishActivePointer(d.id);
        }
        Sandbox.ensure(ctx, d);
        persist();
        Log.i(TAG, "created device " + d.displayName() + " (" + d.id + ")");
        return d;
    }

    public synchronized void update(DeviceIdentity d) {
        ensureLoaded();
        for (int i = 0; i < devices.size(); i++) {
            if (devices.get(i).id.equals(d.id)) {
                devices.set(i, d);
                persist();
                Log.i(TAG, "updated device " + d.displayName());
                return;
            }
        }
        add(d);
    }

    /** Removes the profile and wipes its sandbox: cookies, storage, downloads. */
    public synchronized void remove(String id) {
        ensureLoaded();
        DeviceIdentity gone = get(id);
        devices.remove(gone);
        if (gone != null) Sandbox.destroy(ctx, gone);
        if (id != null && id.equals(activeId)) {
            activeId = devices.isEmpty() ? null : devices.get(0).id;
            if (activeId != null) publishActivePointer(activeId);
        }
        persist();
        Log.i(TAG, "deleted device " + (gone == null ? id : gone.displayName()));
    }

    // ── import / export ────────────────────────────────────────────────────

    /** Portable, human-readable export of one device (identifiers included — treat as a secret). */
    public static String exportOne(DeviceIdentity d) throws JSONException {
        JSONObject root = new JSONObject();
        root.put("app", "NeurioVM");
        root.put("version", FORMAT_VERSION);
        root.put("device", d.toJson());
        return root.toString(2);
    }

    /** Accepts either a single-device export or a whole-fleet export. */
    public static DeviceIdentity importOne(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        JSONObject d = root.optJSONObject("device");
        if (d == null) {
            JSONArray arr = root.optJSONArray("devices");
            if (arr != null && arr.length() > 0) d = arr.optJSONObject(0);
        }
        if (d == null) throw new JSONException("no device object in this file");
        DeviceIdentity.Builder b = DeviceIdentity.fromJson(d).toBuilder();
        b.id = java.util.UUID.randomUUID().toString(); // never collide with an existing sandbox
        b.createdAt = System.currentTimeMillis();
        return b.build();
    }

    /** Whole-fleet backup. */
    public synchronized String exportAll() throws JSONException {
        ensureLoaded();
        JSONObject root = new JSONObject();
        root.put("app", "NeurioVM");
        root.put("version", FORMAT_VERSION);
        root.put("exportedAt", System.currentTimeMillis());
        root.put("active", activeId == null ? JSONObject.NULL : activeId);
        JSONArray arr = new JSONArray();
        for (DeviceIdentity d : devices) arr.put(d.toJson());
        root.put("devices", arr);
        return root.toString(2);
    }

    /** Returns how many devices were added. */
    public synchronized int importAll(String json) throws JSONException {
        ensureLoaded();
        JSONObject root = new JSONObject(json);
        JSONArray arr = root.optJSONArray("devices");
        if (arr == null) {
            add(importOne(json));
            return 1;
        }
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            DeviceIdentity.Builder b = DeviceIdentity.fromJson(o).toBuilder();
            b.id = java.util.UUID.randomUUID().toString();
            b.createdAt = System.currentTimeMillis();
            add(b.build());
            n++;
        }
        return n;
    }

    // ── housekeeping ───────────────────────────────────────────────────────

    /** Re-issues identifiers for every device that still uses ones from an import. */
    public synchronized int reissueAll() {
        ensureLoaded();
        int n = 0;
        for (int i = 0; i < devices.size(); i++) {
            devices.set(i, IdentityFactory.reissue(devices.get(i)));
            n++;
        }
        persist();
        return n;
    }

    /** Wipes every profile, every sandbox and the encryption key. */
    public synchronized void factoryReset() {
        ensureLoaded();
        for (DeviceIdentity d : new ArrayList<>(devices)) Sandbox.destroy(ctx, d);
        devices.clear();
        activeId = null;
        vault.destroy();
        Io.deleteRecursive(Sandbox.root(ctx));
        Log.i(TAG, "factory reset complete");
    }

    public Vault.Mode vaultMode() {
        return vault.mode();
    }
}
