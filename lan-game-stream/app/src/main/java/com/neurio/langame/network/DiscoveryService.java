package com.neurio.langame.network;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Utils;

import java.io.Closeable;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LAN discovery for both roles.
 *
 * <p>Two mechanisms run side by side, because neither is reliable on every
 * router:</p>
 * <ol>
 *   <li><b>Android NSD / mDNS</b> ({@code _neurio-lgs._tcp}) — the platform
 *       service discovery API. Some access points filter multicast, and some
 *       Android builds ship a flaky NSD daemon.</li>
 *   <li><b>UDP broadcast beacons</b> on {@link Configuration#PORT_DISCOVERY} —
 *       a 3-packet probe with an echoed timestamp, which also gives us a real
 *       LAN round-trip measurement before any session exists.</li>
 * </ol>
 *
 * <p>The host runs {@link #startAdvertising} (both mechanisms); the client runs
 * {@link #startDiscovery} (both mechanisms) and de-duplicates results.</p>
 */
public final class DiscoveryService implements Closeable {

    private static final String TAG = "Discovery";

    /** Callback surface used by the host UI and by {@code HostDiscovery}. */
    public interface Listener {
        /** A host answered (NSD resolve or UDP beacon). */
        void onHostFound(HostInfo host);

        /** A host stopped advertising. */
        void onHostLost(String hostKey);

        /** Human readable state for the UI ("scanning", "mDNS unavailable", …). */
        void onState(String state);
    }

    private final Context context;
    private final Listener listener;
    private final NsdManager nsdManager;
    private final AtomicBoolean closed = new AtomicBoolean();

    /* Host role state. */
    private String advertisedName;
    private int advertisedPort;
    private String advertisedGame = "";
    private volatile int advertisedStatus;
    private NsdManager.RegistrationListener registrationListener;
    private DatagramSocket beaconSocket;
    private Thread beaconResponderThread;
    private Thread beaconBroadcasterThread;
    private WifiManager.MulticastLock multicastLock;

    /* Client role state. */
    private NsdManager.DiscoveryListener discoveryListener;
    private final Queue<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private final AtomicBoolean resolving = new AtomicBoolean();
    private DatagramSocket probeSocket;
    private Thread probeThread;
    private volatile String localAddress = "0.0.0.0";

    public DiscoveryService(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.nsdManager = (NsdManager) this.context.getSystemService(Context.NSD_SERVICE);
    }

    public void setAdvertisedState(String gameName, int status) {
        this.advertisedGame = gameName == null ? "" : gameName;
        this.advertisedStatus = status;
    }

    /* ------------------------------------------------------------------ *
     *  Host: advertising
     * ------------------------------------------------------------------ */

    /** Starts mDNS registration + the UDP beacon responder. */
    public void startAdvertising(String hostName, int controlPort) {
        advertisedName = hostName;
        advertisedPort = controlPort;
        localAddress = NetworkUtils.localAddress(context);
        acquireMulticastLock();
        registerNsdService();
        startBeaconResponder();
        startBeaconBroadcaster();
        state("Advertising as " + hostName + " on " + localAddress);
    }

    private void registerNsdService() {
        if (nsdManager == null) {
            state("NSD unavailable — UDP beacons only");
            return;
        }
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(advertisedName);
        info.setServiceType(Configuration.NSD_SERVICE_TYPE);
        info.setPort(advertisedPort);
        info.setAttribute("device", com.neurio.langame.common.DeviceInfo.deviceName());
        info.setAttribute("game", advertisedGame);
        info.setAttribute("status", String.valueOf(advertisedStatus));
        info.setAttribute("ver", String.valueOf(Configuration.PROTOCOL_VERSION));

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo serviceInfo) {
                Logger.i(TAG, "mDNS registered as " + serviceInfo.getServiceName());
                state("mDNS registered: " + serviceInfo.getServiceName());
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Logger.w(TAG, "mDNS registration failed: " + errorCode);
                state("mDNS registration failed (" + errorCode + ") — using UDP beacons");
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo serviceInfo) {
                Logger.i(TAG, "mDNS unregistered");
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Logger.w(TAG, "mDNS unregistration failed: " + errorCode);
            }
        };
        try {
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registrationListener);
        } catch (Exception e) {
            Logger.e(TAG, "registerService threw", e);
        }
    }

    private void startBeaconResponder() {
        Utils.startThread("lgs-beacon-rx", Thread.NORM_PRIORITY, () -> {
            try {
                DatagramSocket socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(Configuration.PORT_DISCOVERY));
                beaconSocket = socket;
                byte[] buffer = new byte[1500];
                while (!closed.get()) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    socket.receive(packet);
                    ByteBuffer in = ByteBuffer.wrap(packet.getData(), packet.getOffset(),
                            packet.getLength());
                    if (packet.getLength() < 8 || in.getInt() != Protocol.MAGIC_DISCOVERY) {
                        continue;
                    }
                    int version = in.get() & 0xFF;
                    int kind = in.get() & 0xFF;
                    short probeId = in.getShort();
                    if (kind != 1 || version != Configuration.PROTOCOL_VERSION) {
                        continue;   // not a probe we understand
                    }
                    byte[] reply = buildBeacon(probeId);
                    socket.send(new DatagramPacket(reply, reply.length, packet.getAddress(),
                            packet.getPort()));
                }
            } catch (SocketException e) {
                Logger.w(TAG, "Beacon responder socket error: " + e.getMessage());
            } catch (IOException e) {
                if (!closed.get()) {
                    Logger.w(TAG, "Beacon responder stopped: " + e.getMessage());
                }
            }
        });
    }

    private void startBeaconBroadcaster() {
        Utils.startThread("lgs-beacon-tx", Thread.NORM_PRIORITY, () -> {
            while (!closed.get()) {
                Utils.sleepQuietly(2000);
                if (closed.get() || beaconSocket == null) {
                    continue;
                }
                try {
                    int[] broadcasts = broadcastAddresses();
                    byte[] payload = buildBeacon((short) 0);
                    for (int address : broadcasts) {
                        try {
                            beaconSocket.send(new DatagramPacket(payload, payload.length,
                                    InetAddress.getByAddress(new byte[]{
                                            (byte) (address >>> 24), (byte) (address >>> 16),
                                            (byte) (address >>> 8), (byte) address}),
                                    Configuration.PORT_DISCOVERY));
                        } catch (IOException ignored) {
                        }
                    }
                } catch (Exception e) {
                    Logger.w(TAG, "Beacon broadcast failed: " + e.getMessage());
                }
            }
        });
    }

    private byte[] buildBeacon(short probeId) {
        ByteBuffer buf = Protocol.newBuffer(512);
        buf.putInt(Protocol.MAGIC_DISCOVERY);
        buf.put((byte) Configuration.PROTOCOL_VERSION);
        buf.put((byte) 2);                          // kind 2 = beacon reply
        buf.putShort(probeId);
        buf.putShort((short) advertisedPort);
        buf.put((byte) advertisedStatus);
        buf.put((byte) 0);
        Protocol.putString(buf, NetworkUtils.inspect(context).localIp);
        Protocol.putString(buf, advertisedName);
        Protocol.putString(buf, advertisedGame);
        Protocol.putString(buf, com.neurio.langame.common.DeviceInfo.deviceName());
        return Protocol.toBytes(buf);
    }

    private int[] broadcastAddresses() {
        NetworkUtils.LinkInfo link = NetworkUtils.inspect(context);
        List<Integer> addresses = new ArrayList<>();
        addresses.add(ipToInt("255.255.255.255"));
        if (NetworkUtils.isPrivateAddress(link.broadcastIp)) {
            addresses.add(ipToInt(link.broadcastIp));
        }
        int[] out = new int[addresses.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = addresses.get(i);
        }
        return out;
    }

    private static int ipToInt(String ip) {
        String[] parts = ip.split("\\.");
        int value = 0;
        for (int i = 0; i < 4 && i < parts.length; i++) {
            value = (value << 8) | (Integer.parseInt(parts[i]) & 0xFF);
        }
        return value;
    }

    /* ------------------------------------------------------------------ *
     *  Client: discovery
     * ------------------------------------------------------------------ */

    /** Starts mDNS discovery + UDP beacons probing. */
    public void startDiscovery() {
        localAddress = NetworkUtils.localAddress(context);
        acquireMulticastLock();
        startNsdDiscovery();
        startUdpProbing();
    }

    private void startNsdDiscovery() {
        if (nsdManager == null) {
            state("NSD unavailable — UDP probing only");
            return;
        }
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                state("mDNS discovery running");
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                enqueueResolve(serviceInfo);
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                // We cannot map a name back to an address reliably; the UDP beacons
                // refresh liveness instead.
                state("Host went away: " + serviceInfo.getServiceName());
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                state("mDNS discovery stopped");
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Logger.w(TAG, "mDNS discovery failed to start: " + errorCode);
                state("mDNS discovery failed — UDP probing only");
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Logger.w(TAG, "mDNS discovery failed to stop: " + errorCode);
            }
        };
        try {
            nsdManager.discoverServices(Configuration.NSD_SERVICE_TYPE,
                    NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception e) {
            Logger.e(TAG, "discoverServices threw", e);
        }
    }

    /** NsdManager only resolves one service at a time; serialise it. */
    private void enqueueResolve(NsdServiceInfo info) {
        synchronized (resolveQueue) {
            resolveQueue.add(info);
        }
        pumpResolveQueue();
    }

    private void pumpResolveQueue() {
        if (!resolving.compareAndSet(false, true)) {
            return;
        }
        NsdServiceInfo info;
        synchronized (resolveQueue) {
            info = resolveQueue.poll();
        }
        if (info == null || closed.get()) {
            resolving.set(false);
            return;
        }
        try {
            nsdManager.resolveService(info, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    Logger.w(TAG, "Resolve failed for " + serviceInfo.getServiceName() + ": " + errorCode);
                    resolving.set(false);
                    pumpResolveQueue();
                }

                @Override
                public void onServiceResolved(NsdServiceInfo serviceInfo) {
                    if (serviceInfo.getHost() != null) {
                        HostInfo host = new HostInfo(serviceInfo.getHost().getHostAddress(),
                                serviceInfo.getPort());
                        host.source = HostInfo.Source.NSD;
                        host.name = serviceInfo.getServiceName();
                        Map<String, byte[]> attributes = serviceInfo.getAttributes();
                        if (attributes != null) {
                            host.gameName = attribute(attributes, "game");
                            host.deviceModel = attribute(attributes, "device");
                            String status = attribute(attributes, "status");
                            host.status = status.isEmpty() ? 0 : Integer.parseInt(status);
                        }
                        host.lastSeenMs = System.currentTimeMillis();
                        if (listener != null) {
                            listener.onHostFound(host);
                        }
                    }
                    resolving.set(false);
                    pumpResolveQueue();
                }
            });
        } catch (Exception e) {
            Logger.e(TAG, "resolveService threw", e);
            resolving.set(false);
        }
    }

    private static String attribute(Map<String, byte[]> attributes, String key) {
        byte[] value = attributes.get(key);
        return value == null ? "" : new String(value, StandardCharsets.UTF_8);
    }

    private void startUdpProbing() {
        Utils.startThread("lgs-probe", Thread.NORM_PRIORITY, () -> {
            try {
                DatagramSocket socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(0));
                probeSocket = socket;
                byte[] buffer = new byte[1500];
                long nextProbeMs = 0;
                short probeId = 0;
                while (!closed.get()) {
                    long now = System.currentTimeMillis();
                    if (now >= nextProbeMs) {
                        nextProbeMs = now + 1500;
                        probeId++;
                        byte[] probe = buildProbe(probeId);
                        for (int address : broadcastAddresses()) {
                            try {
                                socket.send(new DatagramPacket(probe, probe.length,
                                        InetAddress.getByAddress(new byte[]{
                                                (byte) (address >>> 24), (byte) (address >>> 16),
                                                (byte) (address >>> 8), (byte) address}),
                                        Configuration.PORT_DISCOVERY));
                            } catch (IOException ignored) {
                            }
                        }
                    }
                    socket.setSoTimeout(150);
                    try {
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        socket.receive(packet);
                        parseBeacon(packet);
                    } catch (java.net.SocketTimeoutException ignored) {
                        // Normal: the probe interval is shorter than the timeout.
                    }
                }
            } catch (SocketException e) {
                Logger.w(TAG, "Probe socket error: " + e.getMessage());
            } catch (IOException e) {
                if (!closed.get()) {
                    Logger.w(TAG, "Probe loop stopped: " + e.getMessage());
                }
            }
        });
    }

    private byte[] buildProbe(short probeId) {
        ByteBuffer buf = Protocol.newBuffer(64);
        buf.putInt(Protocol.MAGIC_DISCOVERY);
        buf.put((byte) Configuration.PROTOCOL_VERSION);
        buf.put((byte) 1);                       // kind 1 = probe
        buf.putShort(probeId);
        buf.putLong(System.currentTimeMillis());
        Protocol.putString(buf, com.neurio.langame.common.DeviceInfo.deviceName());
        return Protocol.toBytes(buf);
    }

    private void parseBeacon(DatagramPacket packet) {
        try {
            ByteBuffer in = ByteBuffer.wrap(packet.getData(), packet.getOffset(), packet.getLength());
            if (packet.getLength() < 10 || in.getInt() != Protocol.MAGIC_DISCOVERY) {
                return;
            }
            int version = in.get() & 0xFF;
            int kind = in.get() & 0xFF;
            if (version != Configuration.PROTOCOL_VERSION || kind != 2) {
                return;
            }
            in.getShort();                                        // probe id
            int controlPort = in.getShort() & 0xFFFF;
            int status = in.get() & 0xFF;
            in.get();

            String advertisedAddress = Protocol.getString(in).trim();
            String name = Protocol.getString(in);
            String game = Protocol.getString(in);
            String device = Protocol.getString(in);

            HostInfo host = new HostInfo(packet.getAddress().getHostAddress(), controlPort);
            host.source = HostInfo.Source.UDP_BEACON;
            host.name = advertisedAddress.isEmpty() ? name : advertisedAddress;
            host.deviceModel = device;
            host.gameName = game;
            host.status = status;
            host.pingMs = 6f;   // conservative default; refined by connect-time PING/PONG
            host.lastSeenMs = System.currentTimeMillis();
            if (listener != null) {
                listener.onHostFound(host);
            }
        } catch (Exception e) {
            Logger.w(TAG, "Malformed beacon ignored: " + e.getMessage());
        }
    }

    /**
     * One-shot unicast probe used by "connect by IP": returns the RTT in
     * milliseconds or {@code -1} when the host did not answer.
     */
    public float probeHost(String address, int controlPort, long timeoutMs) {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setSoTimeout((int) timeoutMs);
            InetAddress target = InetAddress.getByName(address);
            short probeId = (short) (System.nanoTime() & 0xFFFF);
            byte[] probe = buildProbe(probeId);
            long start = System.nanoTime();
            socket.send(new DatagramPacket(probe, probe.length, target, Configuration.PORT_DISCOVERY));
            byte[] buffer = new byte[1500];
            DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
            socket.receive(reply);
            float rtt = (System.nanoTime() - start) / 1_000_000f;
            parseBeacon(reply);
            return rtt;
        } catch (Exception e) {
            // Host may not run the UDP responder: fall back to a TCP connect timing
            // so "connect by IP" still reports something meaningful.
            return tcpProbe(address, controlPort, timeoutMs);
        } finally {
            if (socket != null) {
                socket.close();
            }
        }
    }

    private float tcpProbe(String address, int controlPort, long timeoutMs) {
        java.net.Socket socket = new java.net.Socket();
        try {
            long start = System.nanoTime();
            socket.connect(new InetSocketAddress(address, controlPort), (int) timeoutMs);
            return (System.nanoTime() - start) / 1_000_000f;
        } catch (IOException e) {
            return -1f;
        } finally {
            Utils.closeQuietly(socket);
        }
    }

    /** Local IPv4 the client should advertise to the host for video/audio delivery. */
    public String localAddress() {
        return localAddress;
    }

    /* ------------------------------------------------------------------ */

    private void acquireMulticastLock() {
        if (multicastLock != null) {
            return;
        }
        try {
            WifiManager wm = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("lgs-discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (Exception e) {
            Logger.w(TAG, "Multicast lock unavailable: " + e.getMessage());
        }
    }

    private void state(String message) {
        Logger.i(TAG, message);
        if (listener != null) {
            listener.onState(message);
        }
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        if (nsdManager != null) {
            if (registrationListener != null) {
                try {
                    nsdManager.unregisterService(registrationListener);
                } catch (Exception ignored) {
                }
                registrationListener = null;
            }
            if (discoveryListener != null) {
                try {
                    nsdManager.stopServiceDiscovery(discoveryListener);
                } catch (Exception ignored) {
                }
                discoveryListener = null;
            }
        }
        if (beaconSocket != null) {
            beaconSocket.close();
            beaconSocket = null;
        }
        if (probeSocket != null) {
            probeSocket.close();
            probeSocket = null;
        }
        if (multicastLock != null && multicastLock.isHeld()) {
            try {
                multicastLock.release();
            } catch (Exception ignored) {
            }
            multicastLock = null;
        }
        Logger.i(TAG, "Discovery stopped");
    }

    /** Convenience for the UI: the local address of the active link. */
    public String describeLocalLink(Context context) {
        return String.format(Locale.US, "%s", NetworkUtils.inspect(context).describe());
    }

    /** Exposed for tests/diagnostics. */
    public static boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP;
    }
}
