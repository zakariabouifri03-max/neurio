package com.neurio.vm.runtime;

import android.content.SharedPreferences;

import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * File-backed {@link SharedPreferences} that lives inside a device sandbox.
 *
 * <p>The framework implementation always writes into the shared
 * {@code shared_prefs/} directory of the real data dir, which would defeat the
 * whole point of {@link VirtualContext}. This one keeps the same contract —
 * typed getters, an {@link Editor} with {@code apply()}/{@code commit()} and
 * change listeners — but persists to {@code vm/<device>/prefs/<name>.json}.
 *
 * <p>The file is small and read once, so the synchronous write on
 * {@code commit()} is not a performance problem; {@code apply()} hands the same
 * write to a background thread like the platform does.
 */
public final class SandboxPreferences implements SharedPreferences {

    private static final String TAG = "SandboxPrefs";
    private static final java.util.concurrent.Executor IO_EXECUTOR =
            java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "neurio-prefs");
                t.setPriority(Thread.MIN_PRIORITY);
                t.setDaemon(true);
                return t;
            });

    private final File file;
    private JSONObject data;
    private final List<OnSharedPreferenceChangeListener> listeners = new ArrayList<>();

    public SandboxPreferences(File file) {
        this.file = file;
        load();
    }

    private synchronized void load() {
        if (data != null) return;
        if (file.isFile()) {
            try {
                data = new JSONObject(Io.read(file));
                return;
            } catch (Exception e) {
                Log.w(TAG, "corrupt prefs " + file.getName() + " — starting empty");
            }
        }
        data = new JSONObject();
    }

    private synchronized void write() {
        try {
            Io.write(file, data.toString());
        } catch (Exception e) {
            Log.e(TAG, "could not write prefs " + file.getName(), e);
        }
    }

    // ── reads ──────────────────────────────────────────────────────────────

    @Override
    public synchronized Map<String, ?> getAll() {
        load();
        Map<String, Object> out = new HashMap<>();
        for (java.util.Iterator<String> it = data.keys(); it.hasNext(); ) {
            String k = it.next();
            out.put(k, unwrap(k));
        }
        return out;
    }

    private Object unwrap(String key) {
        Object v = data.opt(key);
        if (v instanceof JSONArray) {
            JSONArray arr = (JSONArray) v;
            Set<String> set = new LinkedHashSet<>();
            for (int i = 0; i < arr.length(); i++) set.add(arr.optString(i));
            return set;
        }
        return v == JSONObject.NULL ? null : v;
    }

    @Override
    public synchronized String getString(String key, String defValue) {
        load();
        return data.has(key) ? data.optString(key, defValue) : defValue;
    }

    @Override
    @SuppressWarnings("unchecked")
    public synchronized Set<String> getStringSet(String key, Set<String> defValues) {
        load();
        Object v = unwrap(key);
        return v instanceof Set ? new LinkedHashSet<>((Set<String>) v) : defValues;
    }

    @Override
    public synchronized int getInt(String key, int defValue) {
        load();
        return data.has(key) ? data.optInt(key, defValue) : defValue;
    }

    @Override
    public synchronized long getLong(String key, long defValue) {
        load();
        return data.has(key) ? data.optLong(key, defValue) : defValue;
    }

    @Override
    public synchronized float getFloat(String key, float defValue) {
        load();
        return data.has(key) ? (float) data.optDouble(key, defValue) : defValue;
    }

    @Override
    public synchronized boolean getBoolean(String key, boolean defValue) {
        load();
        return data.has(key) ? data.optBoolean(key, defValue) : defValue;
    }

    @Override
    public synchronized boolean contains(String key) {
        load();
        return data.has(key);
    }

    @Override public Editor edit() { return new SandboxEditor(); }

    // ── listeners ──────────────────────────────────────────────────────────

    @Override
    public synchronized void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {
        if (l != null && !listeners.contains(l)) listeners.add(l);
    }

    @Override
    public synchronized void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {
        listeners.remove(l);
    }

    private synchronized void notifyChange(Set<String> keys) {
        if (keys.isEmpty()) return;
        for (OnSharedPreferenceChangeListener l : new ArrayList<>(listeners)) {
            for (String k : keys) {
                try { l.onSharedPreferenceChanged(this, k); } catch (Throwable ignored) { }
            }
        }
    }

    // ── editor ─────────────────────────────────────────────────────────────

    private final class SandboxEditor implements Editor {

        private final Map<String, Object> puts = new HashMap<>();
        private final Set<String> removals = new HashSet<>();
        private boolean clear;

        @Override public Editor putString(String key, String value) { puts.put(key, value); return this; }

        @Override public Editor putStringSet(String key, Set<String> values) {
            puts.put(key, values == null ? null : new LinkedHashSet<>(values));
            return this;
        }

        @Override public Editor putInt(String key, int value) { puts.put(key, value); return this; }

        @Override public Editor putLong(String key, long value) { puts.put(key, value); return this; }

        @Override public Editor putFloat(String key, float value) {
            puts.put(key, Double.valueOf(value));
            return this;
        }

        @Override public Editor putBoolean(String key, boolean value) { puts.put(key, value); return this; }

        @Override public Editor remove(String key) { removals.add(key); return this; }

        @Override public Editor clear() { clear = true; return this; }

        @Override public boolean commit() { return applyToData(); }

        @Override
        public void apply() {
            final Map<String, Object> snapshotPuts = new HashMap<>(puts);
            final Set<String> snapshotRemovals = new HashSet<>(removals);
            final boolean snapshotClear = clear;
            // the platform applies immediately in memory and defers the write;
            // we defer the whole thing, which is close enough for our use
            IO_EXECUTOR.execute(() -> applyToData(snapshotClear, snapshotRemovals, snapshotPuts));
        }

        private boolean applyToData() {
            return applyToData(clear, removals, puts);
        }
    }

    private synchronized boolean applyToData(boolean clear, Set<String> removals, Map<String, Object> puts) {
        load();
        try {
            if (clear) data = new JSONObject();
            for (String k : removals) data.remove(k);
            Set<String> touched = new LinkedHashSet<>();
            for (Map.Entry<String, Object> e : puts.entrySet()) {
                Object v = e.getValue();
                if (v == null) {
                    data.remove(e.getKey());
                } else if (v instanceof Set) {
                    JSONArray arr = new JSONArray();
                    for (Object s : (Set<?>) v) arr.put(String.valueOf(s));
                    data.put(e.getKey(), arr);
                } else if (v instanceof Float) {
                    data.put(e.getKey(), ((Float) v).doubleValue());
                } else {
                    data.put(e.getKey(), v);
                }
                touched.add(e.getKey());
            }
            touched.addAll(removals);
            if (clear) touched.add(null);
            write();
            notifyChange(touched);
            return true;
        } catch (JSONException e) {
            Log.e(TAG, "commit failed", e);
            return false;
        }
    }
}
