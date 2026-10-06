package com.neurio.vm.util;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny UI helpers: background work, main-thread marshalling, dialogs, clipboard.
 *
 * <p>Kept in one place so every screen marshals to the main thread the same way —
 * a stray {@code View} touch from a worker thread is the classic Android crash
 * and this class removes the temptation.
 */
public final class Ui {

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ExecutorService BG = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "neurio-ui-bg");
        t.setDaemon(true);
        return t;
    });

    private Ui() {}

    /** Runs {@code body} on a worker thread. */
    public static void bg(Runnable body) {
        BG.execute(body);
    }

    /** Runs {@code body} on the main thread, now if already there. */
    public static void ui(Runnable body) {
        if (Looper.myLooper() == Looper.getMainLooper()) body.run();
        else MAIN.post(body);
    }

    public static void toast(Context ctx, String msg) {
        if (ctx == null) return;
        ui(() -> Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
    }

    public static void alert(Activity a, String title, String message) {
        if (a == null || a.isFinishing()) return;
        ui(() -> new AlertDialog.Builder(a)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(android.R.string.ok, null)
                .show());
    }

    public static void confirm(Activity a, String title, String message, Runnable onYes) {
        if (a == null || a.isFinishing()) return;
        ui(() -> new AlertDialog.Builder(a)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(android.R.string.yes, (DialogInterface d, int w) -> onYes.run())
                .setNegativeButton(android.R.string.no, null)
                .show());
    }

    /** A single-choice dialog whose entries come from {@code items}. */
    public static void choose(Activity a, String title, CharSequence[] items, OnPicked onPicked) {
        if (a == null || a.isFinishing()) return;
        ui(() -> new AlertDialog.Builder(a)
                .setTitle(title)
                .setItems(items, (DialogInterface d, int which) -> onPicked.onPicked(which))
                .setNegativeButton(android.R.string.cancel, null)
                .show());
    }

    public interface OnPicked {
        void onPicked(int which);
    }

    public static void copy(Context ctx, String label, String text) {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText(label, text));
                toast(ctx, ctx.getString(com.neurio.vm.R.string.copied));
            }
        } catch (Throwable t) {
            Log.w("Ui", "clipboard failed: " + t.getMessage());
        }
    }
}
