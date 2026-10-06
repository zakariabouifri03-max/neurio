package com.neurio.lanstream.discovery

import java.net.InetAddress

/** A Neurio host seen on the local network. */
data class HostEndpoint(
    val id: String,
    val name: String,
    val address: InetAddress,
    val controlPort: Int,
    val version: Int = 1,
    val gameName: String? = null,
    val busy: Boolean = false,
    val rttMs: Int = -1,
    val source: String = "",
    val lastSeenMs: Long = System.currentTimeMillis()
) {
    val hostAddress: String get() = address.hostAddress ?: ""

    /** Keeps the freshest fields from two discoveries of the same host. */
    fun merge(other: HostEndpoint): HostEndpoint = copy(
        name = if (other.name.isNotBlank()) other.name else name,
        gameName = other.gameName ?: gameName,
        busy = other.busy,
        rttMs = if (other.rttMs >= 0) other.rttMs else rttMs,
        source = if (source.isBlank()) other.source else "$source+${other.source}",
        lastSeenMs = maxOf(lastSeenMs, other.lastSeenMs)
    )

    companion object {
        fun key(address: InetAddress, port: Int): String = "${address.hostAddress}:$port"
    }
}

/** What the host publishes while it is waiting for a player. */
data class AdvertiseInfo(
    val name: String,
    val controlPort: Int,
    val gameName: String? = null,
    val busy: Boolean = false,
    val version: Int = 1
)

interface DiscoveryService {
    fun advertise(info: AdvertiseInfo)
    fun stopAdvertising()
    fun startScan(onUpdate: (List<HostEndpoint>) -> Unit)
    fun stopScan()
    fun release()
}
