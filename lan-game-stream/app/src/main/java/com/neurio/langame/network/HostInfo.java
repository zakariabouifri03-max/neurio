package com.neurio.langame.network;

import com.neurio.langame.common.Configuration;

import java.util.Locale;

/** A host discovered over NSD, UDP beacon or entered manually. */
public final class HostInfo {

    public enum Source {NSD, UDP_BEACON, MANUAL}

    public String name = "Android phone";
    public String address = "";
    public int controlPort = Configuration.PORT_CONTROL;
    public String gameName = "";
    public String deviceModel = "";
    /** e.g. "1280x720 @ 60 fps" while the host is streaming (empty when idle). */
    public String streamDescription = "";
    /** 0 = idle, 1 = waiting for a client, 2 = streaming. */
    public int status;
    public long lastSeenMs = System.currentTimeMillis();
    /** Measured with a UDP probe before connecting (LAN RTT). */
    public float pingMs = -1f;
    public Source source = Source.NSD;

    public HostInfo() {
    }

    public HostInfo(String address, int controlPort) {
        this.address = address;
        this.controlPort = controlPort;
        this.source = Source.MANUAL;
        this.name = address;
    }

    public boolean isStreaming() {
        return status == 2;
    }

    public String key() {
        return address + ":" + controlPort;
    }

    public String qualityLabel() {
        if (pingMs < 0) {
            return "measuring…";
        }
        if (pingMs < 15) {
            return "Excellent";
        }
        if (pingMs < 40) {
            return "Good";
        }
        if (pingMs < 80) {
            return "Fair";
        }
        return "Weak";
    }

    public Configuration.QualityTier tier() {
        if (pingMs < 0 || pingMs < 30) {
            return Configuration.QualityTier.EXCELLENT;
        }
        if (pingMs < 60) {
            return Configuration.QualityTier.GOOD;
        }
        if (pingMs < 120) {
            return Configuration.QualityTier.WEAK;
        }
        return Configuration.QualityTier.VERY_WEAK;
    }

    public String subtitle() {
        String game = gameName == null || gameName.isEmpty() ? "no game selected" : gameName;
        return String.format(Locale.US, "%s · %s", game,
                pingMs < 0 ? "ping …" : String.format(Locale.US, "ping %d ms", Math.round(pingMs)));
    }

    @Override
    public String toString() {
        return name + " (" + address + ":" + controlPort + ")";
    }
}
