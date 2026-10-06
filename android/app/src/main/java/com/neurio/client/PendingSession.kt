package com.neurio.client

import com.neurio.common.StreamConfig

/**
 * Hand-off between ClientActivity (discovery + pairing input) and
 * StreamViewActivity (fullscreen player). The values are consumed once.
 */
object PendingSession {
    var host: DiscoveredHost? = null
    var pairingCode: String = ""
    var config: StreamConfig? = null
    var manualAddress: java.net.InetSocketAddress? = null
}
