package com.neurio.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.neurio.common.AppLog
import java.util.ArrayDeque

/**
 * LAN discovery over Android NSD (mDNS). The host registers
 * `_neurio._tcp.` with small TXT attributes; clients discover and resolve.
 *
 * Resolution is serialized through a queue because NsdManager only allows a
 * single outstanding resolve on most Android versions.
 */
class DiscoveryService(context: Context) {

    companion object {
        private const val TAG = "Discovery"
        const val SERVICE_TYPE = "_neurio._tcp."
        const val TXT_PROTO = "proto"
        const val TXT_STATE = "state"
        const val TXT_GAME = "game"
        const val TXT_DEVICE = "device"
    }

    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    @Volatile private var resolving = false
    @Volatile private var discoverActive = false

    // ---- Host side ---------------------------------------------------------

    fun register(
        serviceName: String,
        port: Int,
        attrs: Map<String, String>,
        onRegistered: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        val info = NsdServiceInfo().apply {
            this.serviceName = serviceName
            this.serviceType = SERVICE_TYPE
            for ((k, v) in attrs) setAttribute(k, v)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(reg: NsdServiceInfo) {
                AppLog.i(TAG, "registered ${reg.serviceName} on port $port")
                onRegistered(reg.serviceName ?: serviceName)
            }

            override fun onRegistrationFailed(reg: NsdServiceInfo, errorCode: Int) {
                AppLog.e(TAG, "registration failed code=$errorCode")
                onError("NSD registration failed (code $errorCode)")
            }

            override fun onServiceUnregistered(reg: NsdServiceInfo) {
                AppLog.d(TAG, "unregistered ${reg.serviceName}")
            }

            override fun onUnregistrationFailed(reg: NsdServiceInfo, errorCode: Int) {
                AppLog.w(TAG, "unregistration failed code=$errorCode")
            }
        }
        registrationListener = listener
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            AppLog.e(TAG, "registerService threw", e)
            onError(e.message ?: "registerService failed")
        }
    }

    fun unregister() {
        val listener = registrationListener ?: return
        registrationListener = null
        try {
            nsd.unregisterService(listener)
        } catch (e: Exception) {
            AppLog.w(TAG, "unregister: ${e.message}")
        }
    }

    // ---- Client side -------------------------------------------------------

    fun discover(
        onFound: (NsdServiceInfo) -> Unit,
        onLost: (String) -> Unit,
        onResolved: (NsdServiceInfo) -> Unit,
        onError: (String) -> Unit
    ) {
        if (discoverActive) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoverActive = false
                AppLog.e(TAG, "start discovery failed code=$errorCode")
                onError("Discovery failed (code $errorCode)")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                AppLog.w(TAG, "stop discovery failed code=$errorCode")
            }

            override fun onDiscoveryStarted(serviceType: String) {
                discoverActive = true
                AppLog.i(TAG, "discovery started for $serviceType")
            }

            override fun onDiscoveryStopped(serviceType: String) {
                discoverActive = false
            }

            override fun onServiceFound(info: NsdServiceInfo) {
                if (info.serviceType != SERVICE_TYPE) return
                AppLog.d(TAG, "found ${info.serviceName}")
                onFound(info)
                enqueueResolve(info, onResolved)
            }

            override fun onServiceLost(info: NsdServiceInfo) {
                AppLog.d(TAG, "lost ${info.serviceName}")
                onLost(info.serviceName ?: "")
            }
        }
        discoveryListener = listener
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            AppLog.e(TAG, "discoverServices threw", e)
            onError(e.message ?: "discoverServices failed")
        }
    }

    private fun enqueueResolve(info: NsdServiceInfo, onResolved: (NsdServiceInfo) -> Unit) {
        synchronized(resolveQueue) {
            resolveQueue.addLast(info)
            if (resolving) return
            resolving = true
        }
        resolveNext(onResolved)
    }

    private fun resolveNext(onResolved: (NsdServiceInfo) -> Unit) {
        val next = synchronized(resolveQueue) { resolveQueue.pollFirst() }
        if (next == null) {
            synchronized(resolveQueue) { resolving = false }
            return
        }
        try {
            nsd.resolveService(next, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                    AppLog.w(TAG, "resolve failed ${info.serviceName} code=$errorCode")
                    resolveNext(onResolved)
                }

                override fun onServiceResolved(info: NsdServiceInfo) {
                    try {
                        onResolved(info)
                    } catch (e: Exception) {
                        AppLog.w(TAG, "resolved-handler error", e)
                    }
                    resolveNext(onResolved)
                }
            })
        } catch (e: Exception) {
            AppLog.w(TAG, "resolveService threw: ${e.message}")
            resolveNext(onResolved)
        }
    }

    fun stopDiscovery() {
        val listener = discoveryListener ?: return
        discoveryListener = null
        discoverActive = false
        try {
            nsd.stopServiceDiscovery(listener)
        } catch (e: Exception) {
            AppLog.w(TAG, "stopDiscovery: ${e.message}")
        }
    }
}
