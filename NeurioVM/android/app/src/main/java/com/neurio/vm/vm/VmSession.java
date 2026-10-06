package com.neurio.vm.vm;

import android.content.Context;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.runtime.Sandbox;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * One running (or failed) attempt at bringing up a virtual device.
 *
 * <p>A session owns three things: the {@link DeviceIdentity} being presented,
 * the {@link VmBackend} doing the presenting, and the log of what happened.
 * The log is mirrored to {@code vm/<device>/logs/<backend>-<timestamp>.log} so
 * a failure can be read after the app has been killed — which matters a lot when
 * the failure comes from a {@code su} or {@code qemu} process that dies before
 * the UI has drawn.
 */
public final class VmSession {

    public enum State { STOPPED, STARTING, RUNNING, DEGRADED, FAILED }

    private static final String TAG = "VmSession";
    private static final SimpleDateFormat TS =
            new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);

    public interface Listener {
        void onStateChanged(VmSession s);
        void onLog(VmSession s, String line);
    }

    private final Context ctx;
    private final DeviceIdentity device;
    private final String backendId;
    private final List<Listener> listeners = new ArrayList<>();
    private final List<String> log = new ArrayList<>();
    private final File logFile;

    private volatile State state = State.STOPPED;
    private volatile long startedAt;
    private volatile Process process;
    private volatile String failure;
    private volatile int slot = -1;

    public VmSession(Context ctx, DeviceIdentity device, String backendId) {
        this.ctx = ctx.getApplicationContext();
        this.device = device;
        this.backendId = backendId;
        Sandbox.ensure(ctx, device);
        this.logFile = new File(Sandbox.logs(ctx, device),
                backendId + "-" + System.currentTimeMillis() + ".log");
    }

    public Context context() { return ctx; }
    public DeviceIdentity device() { return device; }
    public String backendId() { return backendId; }
    public State state() { return state; }
    public Process process() { return process; }
    public String failure() { return failure; }
    public long startedAt() { return startedAt; }
    public int slot() { return slot; }
    public File logFile() { return logFile; }

    public void setSlot(int slot) { this.slot = slot; }

    public void setProcess(Process p) {
        this.process = p;
    }

    public boolean isAlive() {
        Process p = process;
        if (p == null) return state == State.RUNNING || state == State.DEGRADED;
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true; // still running
        }
    }

    public long uptimeMillis() {
        return startedAt == 0 ? 0 : System.currentTimeMillis() - startedAt;
    }

    public String uptimeText() {
        long ms = uptimeMillis();
        long s = ms / 1000;
        return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }

    public void setState(State s) {
        setState(s, null);
    }

    public void setState(State s, String failure) {
        this.state = s;
        this.failure = failure;
        if (s == State.RUNNING || s == State.DEGRADED) startedAt = System.currentTimeMillis();
        log("state → " + s + (failure == null ? "" : " (" + failure + ")"));
        for (Listener l : snapshotListeners()) l.onStateChanged(this);
    }

    // ── logging ────────────────────────────────────────────────────────────

    public synchronized void log(String line) {
        String stamped = TS.format(new Date()) + "  " + line;
        log.add(stamped);
        while (log.size() > 1000) log.remove(0);
        Log.i(TAG + "/" + backendId, line);
        append(stamped);
        for (Listener l : snapshotListeners()) l.onLog(this, stamped);
    }

    public synchronized List<String> logLines() {
        return new ArrayList<>(log);
    }

    /** Appends one line; rewriting the whole log per line would be O(n²). */
    private void append(String line) {
        File parent = logFile.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) return;
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(logFile, true)) {
            out.write((line + "\n").getBytes(Io.UTF8));
        } catch (Exception e) {
            // the in-memory copy is still shown in the UI
        }
    }

    private synchronized List<Listener> snapshotListeners() {
        return new ArrayList<>(listeners);
    }

    public synchronized void addListener(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
    }

    public synchronized void removeListener(Listener l) {
        listeners.remove(l);
    }
}
