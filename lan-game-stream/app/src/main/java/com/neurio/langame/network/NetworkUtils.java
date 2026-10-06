package com.neurio.langame.network;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.neurio.langame.common.Logger;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

/**
 * Local-network helpers: which address are we reachable on, is the link Wi-Fi or
 * a hotspot, how good is the radio, and what is the broadcast address for the
 * UDP discovery fallback.
 */
public final class NetworkUtils {

    private static final String TAG = "Network";

    private NetworkUtils() {
    }

    /** Result of inspecting the current link. */
    public static final class LinkInfo {
        public String localIp = "0.0.0.0";
        public String broadcastIp = "255.255.255.255";
        public boolean wifi;
        public boolean hotspot;
        public int linkSpeedMbps = -1;
        public int frequencyMhz = -1;
        public int rssi = Integer.MIN_VALUE;
        public String interfaceName = "";

        public boolean is5Ghz() {
            return frequencyMhz >= 4900;
        }

        public String band() {
            if (frequencyMhz <= 0) {
                return "unknown";
            }
            return is5Ghz() ? "5 GHz" : "2.4 GHz";
        }

        public String describe() {
            return String.format(Locale.US, "%s · %s · %s%s", localIp, band(),
                    linkSpeedMbps > 0 ? linkSpeedMbps + " Mbps" : "link speed n/a",
                    hotspot ? " · hotspot" : "");
        }
    }

    /** Enumerates the device's IPv4 addresses, preferring Wi-Fi-ish interfaces. */
    public static LinkInfo inspect(Context context) {
        LinkInfo info = new LinkInfo();
        List<NetworkInterface> interfaces = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> enumeration = NetworkInterface.getNetworkInterfaces();
            if (enumeration != null) {
                interfaces = Collections.list(enumeration);
            }
        } catch (SocketException e) {
            Logger.w(TAG, "Cannot enumerate interfaces: " + e.getMessage());
        }

        NetworkInterface best = null;
        Inet4Address bestAddress = null;
        int bestScore = -1;
        for (NetworkInterface ni : interfaces) {
            try {
                if (!ni.isUp() || ni.isLoopback()) {
                    continue;
                }
            } catch (SocketException e) {
                continue;
            }
            for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                InetAddress address = ia.getAddress();
                if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) {
                    continue;
                }
                String name = ni.getName().toLowerCase(Locale.US);
                int score = 0;
                if (name.startsWith("wlan")) {
                    score = 100;
                } else if (name.startsWith("ap") || name.startsWith("swlan")) {
                    score = 90;         // hotspot/softap interfaces
                } else if (name.startsWith("eth")) {
                    score = 80;
                } else if (name.startsWith("rndis") || name.startsWith("usb")) {
                    score = 70;         // USB tethering
                } else {
                    score = 10;
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = ni;
                    bestAddress = (Inet4Address) address;
                }
            }
        }

        if (bestAddress != null) {
            info.localIp = bestAddress.getHostAddress();
            info.interfaceName = best == null ? "" : best.getName();
            for (InterfaceAddress ia : best.getInterfaceAddresses()) {
                if (ia.getBroadcast() != null && ia.getAddress() instanceof Inet4Address) {
                    info.broadcastIp = ia.getBroadcast().getHostAddress();
                    break;
                }
            }
            String name = info.interfaceName.toLowerCase(Locale.US);
            info.hotspot = name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("rndis");
        }

        WifiInfo wifiInfo = wifiInfo(context);
        if (wifiInfo != null) {
            info.wifi = true;
            info.linkSpeedMbps = wifiInfo.getLinkSpeed();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                info.frequencyMhz = wifiInfo.getFrequency();
            }
            info.rssi = wifiInfo.getRssi();
        }
        return info;
    }

    @SuppressWarnings("deprecation") // getConnectionInfo has no non-deprecated replacement pre-31
    private static WifiInfo wifiInfo(Context context) {
        try {
            WifiManager wm = (WifiManager) context.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wm == null) {
                return null;
            }
            WifiInfo info = wm.getConnectionInfo();
            if (info == null || info.getNetworkId() < 0) {
                return null;
            }
            return info;
        } catch (Exception e) {
            return null;
        }
    }

    /** Signal strength description shown in host/client lists. */
    public static String signalLabel(LinkInfo info) {
        if (info.rssi == Integer.MIN_VALUE) {
            return info.wifi ? "Wi-Fi" : "wired/other";
        }
        int level = WifiManager.calculateSignalLevel(info.rssi, 4);
        switch (level) {
            case 0:
                return "weak signal";
            case 1:
                return "fair signal";
            case 2:
                return "good signal";
            default:
                return "excellent signal";
        }
    }

    public static String ticker(int rssi) {
        if (rssi == Integer.MIN_VALUE) {
            return "▪▪▪";
        }
        int level = WifiManager.calculateSignalLevel(rssi, 4);
        switch (level) {
            case 0:
                return "▁";
            case 1:
                return "▁▃";
            case 2:
                return "▁▃▅";
            default:
                return "▁▃▅▇";
        }
    }

    /** True for RFC1918 / link-local addresses — the only ones we ever stream to. */
    public static boolean isPrivateAddress(String ip) {
        if (ip == null) {
            return false;
        }
        if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
            return true;
        }
        if (ip.startsWith("172.")) {
            try {
                int second = Integer.parseInt(ip.split("\\.")[1]);
                return second >= 16 && second <= 31;
            } catch (Exception e) {
                return false;
            }
        }
        return false;
    }

    /** Descending sort key: private/link addresses first, everything else after. */
    public static int addressScore(String ip) {
        if (ip == null) {
            return -100;
        }
        if (ip.startsWith("192.168.")) {
            return 30;
        }
        if (ip.startsWith("10.")) {
            return 20;
        }
        if (ip.startsWith("172.")) {
            return 15;
        }
        if (ip.startsWith("169.254.")) {
            return 5;
        }
        return 0;
    }

    /** Whether the device is currently on Wi-Fi (or Wi-Fi hotspot) at all. */
    public static boolean isOnWifi(Context context) {
        ConnectivityManager cm =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            return false;
        }
        Network network = cm.getActiveNetwork();
        if (network == null) {
            return false;
        }
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        if (caps == null) {
            return false;
        }
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_USB);
    }

    /** Best-effort local IP of the active network, used to pre-fill the manual IP field. */
    public static String localAddress(Context context) {
        return inspect(context).localIp;
    }

    /** Link properties of the active network (for diagnostics). */
    public static String activeLinkDescription(Context context) {
        ConnectivityManager cm =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            return "no connectivity manager";
        }
        Network network = cm.getActiveNetwork();
        if (network == null) {
            return "no active network";
        }
        LinkProperties props = cm.getLinkProperties(network);
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        StringBuilder sb = new StringBuilder();
        sb.append(props != null ? props.getInterfaceName() : "?");
        if (caps != null) {
            sb.append(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? " · wifi" : "");
            sb.append(caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? " · ethernet" : "");
            sb.append(caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? " · cellular" : "");
            sb.append(caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ? " · vpn" : "");
        }
        return sb.toString();
    }
}
