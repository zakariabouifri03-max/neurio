package com.vyro.play.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.vyro.play.model.NetworkState
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Event-driven network connectivity monitor using Android's ConnectivityManager.NetworkCallback.
 * Zero background polling — emits only when network state changes.
 */
class NetworkMonitor(context: Context) {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    val networkStateFlow: Flow<NetworkState> = callbackFlow {
        val cm = connectivityManager
        if (cm == null) {
            trySend(NetworkState(isOnline = true, isWifi = true, isMetered = false, connectionLabel = "Online"))
            close()
            return@callbackFlow
        }

        fun queryCurrentState(): NetworkState {
            return runCatching {
                val activeNetwork = cm.activeNetwork
                val caps = if (activeNetwork != null) cm.getNetworkCapabilities(activeNetwork) else null
                if (caps == null) {
                    NetworkState(
                        isOnline = false,
                        isWifi = false,
                        isMetered = false,
                        connectionLabel = "Offline"
                    )
                } else {
                    val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    val isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    val isCellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                    val isMetered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

                    val label = when {
                        !hasInternet -> "Offline"
                        isWifi -> "Online (Wi-Fi)"
                        isCellular -> if (isMetered) "Online (Mobile Data · Metered)" else "Online (Mobile Data)"
                        else -> "Online"
                    }

                    NetworkState(
                        isOnline = hasInternet,
                        isWifi = isWifi,
                        isMetered = isMetered,
                        connectionLabel = label
                    )
                }
            }.getOrDefault(
                NetworkState(isOnline = true, isWifi = true, isMetered = false, connectionLabel = "Online")
            )
        }

        trySend(queryCurrentState())

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(queryCurrentState())
            }

            override fun onLost(network: Network) {
                trySend(queryCurrentState())
            }

            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                trySend(queryCurrentState())
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        runCatching {
            cm.registerNetworkCallback(request, callback)
        }

        awaitClose {
            runCatching { cm.unregisterNetworkCallback(callback) }
        }
    }.distinctUntilChanged()
}
