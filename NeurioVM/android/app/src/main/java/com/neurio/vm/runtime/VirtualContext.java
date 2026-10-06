package com.neurio.vm.runtime;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;

import com.neurio.vm.core.DeviceIdentity;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;

/**
 * A {@link Context} whose every storage entry point is redirected into one
 * device's sandbox.
 *
 * <p>Hand this to anything that should behave as if it were running on a
 * different handset: file I/O, {@code SharedPreferences}, databases and the
 * cache all land under {@code filesDir/vm/<device-id>/} instead of the shared
 * app data directory. Two devices therefore cannot see each other's cookies,
 * tokens, saved form data or downloads — that isolation is what makes the
 * second device a *second device* rather than a second tab.
 *
 * <p><b>Do not</b> use it to construct a {@code android.webkit.WebView}: the
 * WebView factory reaches into the real data directory and the process-wide
 * data-directory suffix, so WebView isolation is handled by
 * {@link ProcessBridge} running the browser in its own process instead.
 */
public final class VirtualContext extends ContextWrapper {

    private final DeviceIdentity device;
    private final File base;
    private final File filesDir;
    private final File cacheDir;
    private final File prefsDir;
    private final File dbDir;
    private final File externalDir;

    public VirtualContext(Context real, DeviceIdentity device) {
        super(real);
        this.device = device;
        this.base = Sandbox.dir(real, device);
        this.filesDir = Sandbox.files(real, device);
        this.cacheDir = Sandbox.cache(real, device);
        this.prefsDir = Sandbox.prefs(real, device);
        this.dbDir = Sandbox.databases(real, device);
        this.externalDir = new File(base, "external");
        Sandbox.ensure(real, device);
    }

    public DeviceIdentity device() { return device; }

    public File sandboxRoot() { return base; }

    // ── directories ────────────────────────────────────────────────────────

    @Override public File getFilesDir() { ensure(filesDir); return filesDir; }

    @Override public File getCacheDir() { ensure(cacheDir); return cacheDir; }

    @Override public File getCodeCacheDir() { ensure(new File(base, "code_cache")); return new File(base, "code_cache"); }

    @Override public File getDataDir() { ensure(base); return base; }

    @Override public File getNoBackupFilesDir() { ensure(new File(base, "no_backup")); return new File(base, "no_backup"); }

    @Override
    public File getDir(String name, int mode) {
        File d = new File(base, "app_" + name);
        ensure(d);
        return d;
    }

    @Override public File getExternalFilesDir(String type) {
        File d = type == null ? externalDir : new File(externalDir, type);
        ensure(d);
        return d;
    }

    @Override public File getExternalCacheDir() { ensure(cacheDir); return cacheDir; }

    // ── files ──────────────────────────────────────────────────────────────

    @Override public File getFileStreamPath(String name) { return new File(filesDir, sanitize(name)); }

    @Override
    public FileInputStream openFileInput(String name) throws FileNotFoundException {
        File f = getFileStreamPath(name);
        if (!f.exists()) throw new FileNotFoundException(name);
        return new FileInputStream(f);
    }

    @Override
    public FileOutputStream openFileOutput(String name, int mode) throws FileNotFoundException {
        ensure(filesDir);
        return new FileOutputStream(getFileStreamPath(name), (mode & Context.MODE_APPEND) != 0);
    }

    @Override
    public boolean deleteFile(String name) {
        return getFileStreamPath(name).delete();
    }

    @Override
    public String[] fileList() {
        String[] names = filesDir.list();
        return names == null ? new String[0] : names;
    }

    // ── databases ──────────────────────────────────────────────────────────

    @Override public File getDatabasePath(String name) { ensure(dbDir); return new File(dbDir, sanitize(name)); }

    @Override
    public String[] databaseList() {
        String[] names = dbDir.list();
        return names == null ? new String[0] : names;
    }

    @Override
    public boolean deleteDatabase(String name) {
        File f = getDatabasePath(name);
        boolean ok = f.delete();
        for (String suffix : new String[]{"-journal", "-wal", "-shm"}) {
            ok |= new File(f.getPath() + suffix).delete();
        }
        return ok;
    }

    // ── preferences ────────────────────────────────────────────────────────

    @Override
    public SharedPreferences getSharedPreferences(String name, int mode) {
        ensure(prefsDir);
        return new SandboxPreferences(new File(prefsDir, sanitize(name) + ".json"));
    }

    // Note: Context.getSharedPreferences(File, int) is deliberately NOT
    // overridden. It is not present in every compile target this project builds
    // against, and nothing in NeurioVM calls it — the name+mode variant above
    // covers every preference this app creates.

    // ── helpers ────────────────────────────────────────────────────────────

    private static void ensure(File d) {
        if (!d.isDirectory() && !d.mkdirs()) {
            // best effort: the caller will surface the IOException itself
            d.mkdirs();
        }
    }

    /** Blocks {@code ../} escapes so a hostile name cannot leave the sandbox. */
    private static String sanitize(String name) {
        String n = name == null ? "default" : name.replace('\\', '/');
        while (n.contains("/")) n = n.substring(n.lastIndexOf('/') + 1);
        n = n.replace("..", "_");
        return n.isEmpty() ? "default" : n;
    }
}
