package com.turbocast60.receiver

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.turbocast60.protocol.PairingHandshake
import com.turbocast60.protocol.SecureControlChannel
import com.turbocast60.util.ByteEncoding
import org.json.JSONObject
import java.io.Closeable
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

/** Companion receiver service hosted by the TurboCast app on Android TV/Google TV or another Android device. */
class ReceiverServer(context: Context) : Closeable {
    private val appContext = context.applicationContext
    private val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val running = AtomicBoolean(false)
    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var currentVideo: RtpH264Receiver? = null
    @Volatile private var currentControl: SecureControlChannel? = null
    @Volatile private var surface: android.view.Surface? = null
    @Volatile private var activeWidth: Int? = null
    @Volatile private var activeHeight: Int? = null
    @Volatile private var activeFps: Double = 0.0
    @Volatile private var activeLoss: Double = 0.0
    @Volatile private var pairingCode = newPairingCode()
    private var serverThread: Thread? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        ReceiverStateStore.publish(ReceiverUiState(pairingCode = pairingCode, status = "Opening local receiver"))
        serverThread = Thread(::serveForever, "TurboCast-TV-server").apply { isDaemon = true; start() }
    }

    fun attachSurface(surface: android.view.Surface?) {
        this.surface = surface
        currentVideo?.attachSurface(surface)
    }

    private fun serveForever() {
        try {
            val server = ServerSocket(0)
            serverSocket = server
            registerReceiver(server.localPort)
            ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Ready on this Wi-Fi network · enter the code on your phone"))
            while (running.get()) {
                val socket = try { server.accept() } catch (_: Exception) { if (running.get()) continue else break }
                socket.tcpNoDelay = true
                socket.keepAlive = true
                handlePeer(socket)
            }
        } catch (_: Throwable) {
            if (running.get()) ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Could not start local receiver. Check Wi-Fi and restart."))
        } finally {
            unregisterReceiver()
        }
    }

    private fun handlePeer(socket: Socket) {
        var channel: SecureControlChannel? = null
        var video: RtpH264Receiver? = null
        try {
            ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Pairing request · confirm the code on both devices"))
            val secureChannel = PairingHandshake.asServer(socket, pairingCode)
            channel = secureChannel
            currentControl = secureChannel
            val sessionVideo = RtpH264Receiver(
                cipher = secureChannel.newVideoDecipher(),
                decoder = H264SurfaceDecoder(),
                onRequestIdr = { runCatching { secureChannel.send(JSONObject().put("type", "REQUEST_IDR")) } },
                onStats = { loss, fps, drops ->
                    activeFps = fps
                    activeLoss = loss
                    val width = activeWidth
                    val height = activeHeight
                    val title = if (width != null && height != null) "Receiving ${width}×$height H.264" else "Paired · waiting for video"
                    ReceiverStateStore.publish(ReceiverUiState(pairingCode, title, true, width, height, fps, loss))
                    runCatching {
                        secureChannel.send(
                            JSONObject()
                                .put("type", "STATS")
                                .put("lossPercent", loss)
                                .put("decodedFps", fps)
                                .put("queueDrops", drops)
                        )
                    }
                }
            )
            video = sessionVideo
            currentVideo = sessionVideo
            sessionVideo.attachSurface(surface)
            sessionVideo.start()
            secureChannel.send(JSONObject().put("type", "READY").put("udpPort", sessionVideo.localPort))
            ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Paired · waiting for video", true))

            while (running.get()) {
                val message = secureChannel.read()
                when (message.optString("type")) {
                    "CONFIG" -> {
                        val width = message.getInt("width")
                        val height = message.getInt("height")
                        val fps = message.optInt("fps", 30)
                        val sps = ByteEncoding.decode(message.getString("sps"))
                        val pps = ByteEncoding.decode(message.getString("pps"))
                        sessionVideo.configure(width, height, fps, sps, pps)
                        secureChannel.send(JSONObject().put("type", "REQUEST_IDR"))
                        activeWidth = width
                        activeHeight = height
                        ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Receiving ${width}×$height H.264", true, width, height, activeFps, activeLoss))
                    }
                    "PING" -> secureChannel.send(JSONObject().put("type", "PONG").put("id", message.getLong("id")))
                    "BITRATE" -> Unit
                    "STOP" -> break
                    else -> secureChannel.send(JSONObject().put("type", "ERROR").put("message", "Unsupported stream control message"))
                }
            }
        } catch (t: Throwable) {
            val message = if (t is SecurityException) "Pairing code was incorrect. Check the TV screen and retry." else "Sender disconnected"
            if (running.get()) ReceiverStateStore.publish(ReceiverUiState(pairingCode, message))
        } finally {
            runCatching { video?.close() }
            runCatching { channel?.close() }
            runCatching { socket.close() }
            if (currentVideo === video) currentVideo = null
            if (currentControl === channel) currentControl = null
            activeWidth = null
            activeHeight = null
            if (running.get()) {
                pairingCode = newPairingCode()
                ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Disconnected · ready for a new pairing"))
            }
        }
    }

    private fun registerReceiver(port: Int) {
        val lock = wifi?.createMulticastLock("TurboCast60-receiver")
        lock?.setReferenceCounted(false)
        lock?.acquire()
        multicastLock = lock
        val model = Build.MODEL?.replace(Regex("[^A-Za-z0-9 -]"), "")?.take(20).orEmpty().ifBlank { "TV" }
        val service = NsdServiceInfo().apply {
            serviceName = "TurboCast TV · $model"
            serviceType = SERVICE_TYPE
            this.port = port
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(registered: NsdServiceInfo) {
                ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Visible as ${registered.serviceName} · enter the code on your phone"))
            }
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Receiver discovery unavailable · keep this screen open"))
            }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
        }
        registrationListener = listener
        runCatching { nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onFailure { ReceiverStateStore.publish(ReceiverUiState(pairingCode, "Could not advertise receiver on Wi-Fi")) }
    }

    private fun unregisterReceiver() {
        registrationListener?.let { runCatching { nsd.unregisterService(it) } }
        registrationListener = null
        runCatching { multicastLock?.release() }
        multicastLock = null
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        runCatching { currentControl?.send(JSONObject().put("type", "STOP")) }
        runCatching { currentControl?.close() }
        runCatching { currentVideo?.close() }
        runCatching { serverSocket?.close() }
        serverThread?.interrupt()
        runCatching { serverThread?.join(700) }
        serverThread = null
        serverSocket = null
        attachSurface(null)
        ReceiverStateStore.publish(ReceiverUiState(status = "Receiver stopped"))
    }

    companion object {
        private const val SERVICE_TYPE = "_turbocast._tcp."
        private fun newPairingCode(): String = "%06d".format(SecureRandom().nextInt(1_000_000))
    }
}
