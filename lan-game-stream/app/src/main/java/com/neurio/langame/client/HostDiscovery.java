package com.neurio.langame.client;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Utils;
import com.neurio.langame.network.DiscoveryService;
import com.neurio.langame.network.HostInfo;
import com.neurio.langame.network.NetworkUtils;

import java.io.Closeable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Client-side host browser: collapses NSD + UDP beacon results into one live list,
 * measures a real LAN ping for every host and keeps the entries fresh.
 */
public final class HostDiscovery implements Closeable, DiscoveryService.Listener {

    private static final String TAG = "HostDiscovery";
    private static final long HOST_TTL_MS = 12_000L;

    public interface Listener {
        void onHostsChanged(List<HostInfo> hosts);

        void onState(String message);
    }

    private final Context context;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, HostInfo> hosts = new LinkedHashMap<>();
    private DiscoveryService discovery;
    private Thread refreshThread;
    private volatile boolean running;
    private long pingTurn;

    public HostDiscovery(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    public void start() {
        if (running) {
            return;
        }
        running = true;
        discovery = new DiscoveryService(context, this);
        discovery.startDiscovery();
        refreshThread = Utils.startThread("lgs-host-refresh", Thread.NORM_PRIORITY, () -> {
            while (running) {
                Utils.sleepQuietly(3000);
                prune();
                pingHosts();
            }
        });
        publish("Scanning " + NetworkUtils.inspect(context).describe());
    }

    private void prune() {
        long now = System.currentTimeMillis();
        boolean changed = false;
        synchronized (hosts) {
            List<String> stale = new ArrayList<>();
            for (Map.Entry<String, HostInfo> entry : hosts.entrySet()) {
                if (now - entry.getValue().lastSeenMs > HOST_TTL_MS) {
                    stale.add(entry.getKey());
                }
            }
            for (String key : stale) {
                hosts.remove(key);
                changed = true;
                if (listener != null) {
                    mainHandler.post(() -> listener.onState("Host lost: " + key));
                }
            }
        }
        if (changed) {
            publish(null);
        }
    }

    /** Pings one host per cycle so the list shows live latency without flooding. */
    private void pingHosts() {
        List<HostInfo> snapshot;
        synchronized (hosts) {
            snapshot = new ArrayList<>(hosts.values());
        }
        if (snapshot.isEmpty() || discovery == null) {
            return;
        }
        HostInfo target = snapshot.get((int) (pingTurn++ % snapshot.size()));
        float rtt = discovery.probeHost(target.address, target.controlPort, 400);
        if (rtt >= 0) {
            target.pingMs = target.pingMs < 0 ? rtt : target.pingMs * 0.6f + rtt * 0.4f;
            target.lastSeenMs = System.currentTimeMillis();
            publish(null);
        }
    }

    /** Manual entry ("connect by IP") or a remembered host. */
    public HostInfo addManualHost(String address, int port) {
        HostInfo host = new HostInfo(address.trim(), port);
        host.name = address.trim();
        merge(host);
        return host;
    }

    public HostInfo get(String key) {
        synchronized (hosts) {
            return hosts.get(key);
        }
    }

    public List<HostInfo> current() {
        synchronized (hosts) {
            List<HostInfo> list = new ArrayList<>(hosts.values());
            Collections.sort(list, Comparator
                    .comparingInt((HostInfo host) -> host.isStreaming() ? 0 : 1)
                    .thenComparingDouble(host -> host.pingMs < 0 ? Double.MAX_VALUE : host.pingMs));
            return list;
        }
    }

    private void merge(HostInfo incoming) {
        synchronized (hosts) {
            HostInfo existing = hosts.get(incoming.key());
            if (existing == null) {
                hosts.put(incoming.key(), incoming);
            } else {
                existing.lastSeenMs = System.currentTimeMillis();
                if (!incoming.name.isEmpty()) {
                    existing.name = incoming.name;
                }
                if (!incoming.gameName.isEmpty()) {
                    existing.gameName = incoming.gameName;
                }
                if (!incoming.deviceModel.isEmpty()) {
                    existing.deviceModel = incoming.deviceModel;
                }
                existing.streamDescription = incoming.streamDescription;
                existing.status = incoming.status;
                if (existing.pingMs < 0 && incoming.pingMs >= 0) {
                    existing.pingMs = incoming.pingMs;
                }
            }
        }
        publish(null);
    }

    @Override
    public void onHostFound(HostInfo host) {
        Logger.i(TAG, "Host answer: " + host.name + " " + host.address + ":" + host.controlPort);
        merge(host);
    }

    @Override
    public void onHostLost(String hostKey) {
        synchronized (hosts) {
            hosts.remove(hostKey);
        }
        publish(null);
    }

    @Override
    public void onState(String state) {
        publish(state);
    }

    private void publish(String state) {
        if (listener == null) {
            return;
        }
        List<HostInfo> snapshot = current();
        mainHandler.post(() -> {
            listener.onHostsChanged(snapshot);
            if (state != null) {
                listener.onState(state);
            }
        });
    }

    @Override
    public void close() {
        running = false;
        if (discovery != null) {
            discovery.close();
            discovery = null;
        }
    }
}
