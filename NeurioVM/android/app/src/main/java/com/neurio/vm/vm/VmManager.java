package com.neurio.vm.vm;

import android.content.Context;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Owns the set of live {@link VmSession}s — one per virtual device — and runs
 * backend work off the main thread.
 *
 * <p>Single instance per process. The UI talks to this, never to a backend
 * directly, so that "which backend is actually running this device" has exactly
 * one answer and the notification service can reflect it.
 */
public final class VmManager {

    private static final String TAG = "VmManager";

    public interface Callback {
        void onDone(VmSession session, Throwable error);
    }

    private static volatile VmManager instance;

    private final Context ctx;
    private final VmSettings settings;
    private final Map<String, VmSession> sessions = new LinkedHashMap<>();
    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "neurio-vm");
        t.setDaemon(true);
        return t;
    });

    private volatile Capability capability;

    public static VmManager get(Context ctx) {
        VmManager local = instance;
        if (local == null) {
            synchronized (VmManager.class) {
                local = instance;
                if (local == null) {
                    local = new VmManager(ctx.getApplicationContext());
                    instance = local;
                }
            }
        }
        return local;
    }

    private VmManager(Context ctx) {
        this.ctx = ctx;
        this.settings = new VmSettings(ctx);
    }

    public Context context() { return ctx; }

    public VmSettings settings() { return settings; }

    public Capability capability() { return capability; }

    // ── probing ────────────────────────────────────────────────────────────

    public void probe(final CapabilityProbe.Callback cb, boolean force) {
        CapabilityProbe.probe(ctx, c -> {
            capability = c;
            Log.i(TAG, "probe done: " + c.headline());
            cb.onProbed(c);
        }, force);
    }

    /** Blocking variant for the service, which is already on a worker thread. */
    public Capability probeSync(boolean force) {
        if (!force && capability != null) return capability;
        capability = CapabilityProbe.probeSync(ctx);
        return capability;
    }

    // ── sessions ───────────────────────────────────────────────────────────

    public synchronized VmSession sessionFor(DeviceIdentity d, String backendId) {
        VmSession existing = sessions.get(d.id);
        if (existing != null && existing.backendId().equals(backendId)) return existing;
        if (existing != null && existing.state() != VmSession.State.STOPPED) {
            stopNow(existing);
        }
        VmSession s = new VmSession(ctx, d, backendId);
        sessions.put(d.id, s);
        return s;
    }

    public synchronized VmSession sessionOf(String deviceId) {
        return sessions.get(deviceId);
    }

    public synchronized List<VmSession> sessions() {
        return Collections.unmodifiableList(new ArrayList<>(sessions.values()));
    }

    public synchronized boolean anyRunning() {
        for (VmSession s : sessions.values()) {
            VmSession.State st = s.state();
            if (st == VmSession.State.RUNNING || st == VmSession.State.DEGRADED
                    || st == VmSession.State.STARTING) {
                return true;
            }
        }
        return false;
    }

    public synchronized int runningCount() {
        int n = 0;
        for (VmSession s : sessions.values()) {
            VmSession.State st = s.state();
            if (st == VmSession.State.RUNNING || st == VmSession.State.DEGRADED) n++;
        }
        return n;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Starts {@code device} on the requested backend, or on the auto-selected one
     * when {@code backendId} is empty. Always returns immediately; the result
     * arrives on {@code cb}.
     */
    public void start(final DeviceIdentity device, final String backendId, final Callback cb) {
        final Capability cap = capability != null ? capability : probeSync(false);
        final VmBackend backend = Backends.byId(
                backendId == null || backendId.isEmpty()
                        ? Backends.preferred(cap, settings).id()
                        : backendId,
                settings);
        final VmSession session = sessionFor(device, backend.id());

        Log.i(TAG, "starting " + device.displayName() + " on backend '" + backend.id() + "'");
        exec.execute(() -> {
            Throwable error = null;
            try {
                session.log("backend: " + backend.name() + " — " + Backends.tier(backend));
                session.log("verdict: " + backend.verdict(cap));
                session.setState(VmSession.State.STARTING);
                backend.start(session);
                if (session.state() == VmSession.State.STARTING) {
                    session.setState(VmSession.State.RUNNING);
                }
            } catch (Throwable t) {
                error = t;
                Log.e(TAG, "backend " + backend.id() + " failed", t);
                session.setState(VmSession.State.FAILED, t.getClass().getSimpleName()
                        + ": " + t.getMessage());
            }
            if (cb != null) cb.onDone(session, error);
        });
    }

    public void stop(final DeviceIdentity device) {
        final VmSession session = sessions.get(device.id);
        if (session == null) return;
        exec.execute(() -> stopNow(session));
    }

    private void stopNow(VmSession session) {
        try {
            VmBackend b = Backends.byId(session.backendId(), settings);
            b.stop(session);
        } catch (Throwable t) {
            Log.e(TAG, "stop failed", t);
            session.setState(VmSession.State.FAILED, "stop: " + t.getMessage());
        }
    }

    public void stopAll() {
        for (VmSession s : new ArrayList<>(sessions.values())) stopNow(s);
    }

    /** Drops finished sessions so the map does not grow across a long session. */
    public synchronized void prune() {
        List<String> gone = new ArrayList<>();
        for (Map.Entry<String, VmSession> e : sessions.entrySet()) {
            if (e.getValue().state() == VmSession.State.STOPPED) gone.add(e.getKey());
        }
        for (String k : gone) sessions.remove(k);
    }
}
