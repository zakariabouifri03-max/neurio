package com.neurio.vm.runtime;

import android.content.Context;

import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Maps virtual devices onto the fixed set of isolated browser processes.
 *
 * <p>{@code WebView.setDataDirectorySuffix()} may be called exactly once per
 * process, and every {@code android:process} slot has to be declared in the
 * manifest ahead of time. So instead of trying to give each device its own
 * process, NeurioVM keeps {@value #SLOTS} stable slots — {@code :vm0} …
 * {@code :vm3} — and hands them out least-recently-used.
 *
 * <p>The consequence, and the reason this class exists: when a slot changes
 * owner, the WebView profile left behind by the previous device has to go,
 * otherwise the new "handset" would inherit the old one's cookies. That handover
 * is performed by {@link ProcessBridge} inside the slot process, before any
 * WebView is created, using the pointer files this table writes.
 */
public final class SlotTable {

    private static final String TAG = "SlotTable";

    /** Four concurrent virtual displays; enough for real multi-account work. */
    public static final int SLOTS = 4;

    private static final Map<String, Integer> DEVICE_TO_SLOT = new LinkedHashMap<>();
    private static final List<String> LRU = new ArrayList<>();
    private static boolean loaded;

    private SlotTable() {}

    private static File table(Context ctx) {
        return new File(Sandbox.root(ctx), "slots.json");
    }

    public static File pointer(Context ctx, int slot) {
        return new File(Sandbox.root(ctx), "slot" + slot + ".txt");
    }

    public static File owner(Context ctx, int slot) {
        return new File(Sandbox.root(ctx), "slot" + slot + ".owner");
    }

    private static synchronized void ensureLoaded(Context ctx) {
        if (loaded) return;
        DEVICE_TO_SLOT.clear();
        LRU.clear();
        File f = table(ctx);
        if (f.isFile()) {
            try {
                JSONObject o = new JSONObject(Io.read(f));
                Iterator<String> keys = o.keys();
                while (keys.hasNext()) {
                    String id = keys.next();
                    int slot = o.optInt(id, -1);
                    if (slot >= 0 && slot < SLOTS) {
                        DEVICE_TO_SLOT.put(id, slot);
                        LRU.add(id);
                    }
                }
            } catch (JSONException | java.io.IOException e) {
                Log.w(TAG, "slot table unreadable, rebuilding");
            }
        }
        loaded = true;
    }

    private static synchronized void save(Context ctx) {
        try {
            JSONObject o = new JSONObject();
            for (Map.Entry<String, Integer> e : DEVICE_TO_SLOT.entrySet()) o.put(e.getKey(), e.getValue());
            Io.write(table(ctx), o.toString());
        } catch (Exception e) {
            Log.w(TAG, "could not persist the slot table: " + e.getMessage());
        }
    }

    /**
     * Reserves a slot for {@code deviceId}, writes the pointer file the target
     * process will read at startup, and returns the slot index.
     *
     * @return the slot number, or {@code -1} if the pointer could not be written
     */
    public static synchronized int acquire(Context ctx, String deviceId) {
        ensureLoaded(ctx);
        Integer existing = DEVICE_TO_SLOT.get(deviceId);
        int slot;
        if (existing != null) {
            slot = existing;
        } else {
            slot = freeSlot();
            if (slot < 0) slot = evictLru();
            // drop whoever owned this slot before
            for (Iterator<Map.Entry<String, Integer>> it = DEVICE_TO_SLOT.entrySet().iterator(); it.hasNext(); ) {
                Map.Entry<String, Integer> e = it.next();
                if (e.getValue() == slot) {
                    LRU.remove(e.getKey());
                    it.remove();
                }
            }
            DEVICE_TO_SLOT.put(deviceId, slot);
        }
        LRU.remove(deviceId);
        LRU.add(0, deviceId); // most recently used first

        try {
            Io.mkdirs(Sandbox.root(ctx));
            Io.write(pointer(ctx, slot), deviceId);
        } catch (Exception e) {
            Log.e(TAG, "could not write the slot pointer", e);
            return -1;
        }
        save(ctx);
        Log.i(TAG, "device " + deviceId + " → slot :vm" + slot);
        return slot;
    }

    /** Releases a slot when its device is deleted. */
    public static synchronized void release(Context ctx, String deviceId) {
        ensureLoaded(ctx);
        Integer slot = DEVICE_TO_SLOT.remove(deviceId);
        LRU.remove(deviceId);
        if (slot != null) {
            Io.deleteRecursive(pointer(ctx, slot));
            Io.deleteRecursive(owner(ctx, slot));
        }
        save(ctx);
    }

    public static synchronized int slotOf(Context ctx, String deviceId) {
        ensureLoaded(ctx);
        Integer slot = DEVICE_TO_SLOT.get(deviceId);
        return slot == null ? -1 : slot;
    }

    /** A slot nobody owns. */
    private static int freeSlot() {
        boolean[] taken = new boolean[SLOTS];
        for (Integer s : DEVICE_TO_SLOT.values()) if (s >= 0 && s < SLOTS) taken[s] = true;
        for (int i = 0; i < SLOTS; i++) if (!taken[i]) return i;
        return -1;
    }

    /** Last entry of the LRU list — the device that has not been opened for longest. */
    private static int evictLru() {
        if (LRU.isEmpty()) return 0;
        Integer slot = DEVICE_TO_SLOT.get(LRU.get(LRU.size() - 1));
        return slot == null ? 0 : slot;
    }
}
