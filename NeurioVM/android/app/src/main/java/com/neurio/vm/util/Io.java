package com.neurio.vm.util;

import android.content.Context;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * Small file / stream helpers. Deliberately dependency-free: the whole project
 * is written against the Android framework only so that the Gradle build has to
 * download nothing but the Android Gradle Plugin.
 */
public final class Io {

    public static final Charset UTF8 = StandardCharsets.UTF_8;

    private Io() {}

    // ── reading ────────────────────────────────────────────────────────────

    public static String read(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            return readFully(in);
        }
    }

    public static String readAsset(Context ctx, String name) throws IOException {
        try (InputStream in = ctx.getAssets().open(name)) {
            return readFully(in);
        }
    }

    public static String readFully(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, in.available()));
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), UTF8);
    }

    public static byte[] readBytes(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(64, file.length()));
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** Reads a single-line pseudo-file such as {@code /proc/cpuinfo} entries. */
    public static String readFirstLine(String path) {
        File f = new File(path);
        if (!f.canRead()) return null;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), UTF8))) {
            return r.readLine();
        } catch (IOException e) {
            return null;
        }
    }

    public static boolean exists(String path) {
        return path != null && new File(path).exists();
    }

    public static boolean canRead(String path) {
        return path != null && new File(path).canRead();
    }

    // ── writing ────────────────────────────────────────────────────────────

    public static void write(File file, String text) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("cannot create " + parent);
        }
        File tmp = new File(file.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(UTF8));
            out.flush();
        }
        if (file.exists() && !file.delete()) {
            // not fatal — the rename below will still replace the content on
            // every filesystem Android uses
            Log.w("Io", "could not remove " + file);
        }
        if (!tmp.renameTo(file)) {
            // fall back to copying in place (some mounts refuse cross-inode rename)
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(UTF8));
                out.flush();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    public static void writeBytes(File file, byte[] data) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("cannot create " + parent);
        }
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(data);
            out.flush();
        }
    }

    public static void mkdirs(File dir) {
        if (!dir.isDirectory() && !dir.mkdirs()) Log.w("Io", "mkdirs failed: " + dir);
    }

    /** Recursively deletes a directory tree; returns true when nothing is left. */
    public static boolean deleteRecursive(File f) {
        if (f == null || !f.exists()) return true;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        return f.delete();
    }

    public static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    /** Human readable byte count, used all over the console UI. */
    public static String humanBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double v = bytes;
        String[] units = {"KB", "MB", "GB", "TB"};
        int i = -1;
        do { v /= 1024.0; i++; } while (v >= 1024 && i < units.length - 1);
        return String.format(java.util.Locale.US, "%.1f %s", v, units[i]);
    }
}
