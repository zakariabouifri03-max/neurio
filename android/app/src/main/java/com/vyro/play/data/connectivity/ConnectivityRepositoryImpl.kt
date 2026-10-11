package com.vyro.play.data.connectivity

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.core.content.getSystemService
import com.vyro.core.model.NetworkClass
import com.vyro.play.domain.repository.ConnectivityRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Observes the active network and classifies it so the player and the thumbnail loader
 * can adapt (quality caps, data saver, offline messaging).
 */
@Singleton
class ConnectivityRepositoryImpl
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : ConnectivityRepository {
        private val manager: ConnectivityManager? = context.getSystemService()

        @OptIn(ExperimentalCoroutinesApi::class)
        override val networkClass: Flow<NetworkClass> =
            callbackFlow {
                val connectivityManager = manager
                if (connectivityManager == null) {
                    trySend(NetworkClass.UNMETERED_WIFI)
                    close()
                    return@callbackFlow
                }

                val callback =
                    object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            trySend(connectivityManager.classify(network))
                        }

                        override fun onCapabilitiesChanged(
                            network: Network,
                            capabilities: NetworkCapabilities,
                        ) {
                            trySend(capabilities.toNetworkClass())
                        }

                        override fun onLost(network: Network) {
                            trySend(NetworkClass.NONE)
                        }

                        override fun onUnavailable() {
                            trySend(NetworkClass.NONE)
                        }
                    }

                connectivityManager.registerDefaultNetworkCallback(callback)
                awaitClose { runCatching { connectivityManager.unregisterNetworkCallback(callback) } }
            }.onStart { emit(current()) }
                .map { it }
                .distinctUntilChanged()

        override fun current(): NetworkClass {
            val connectivityManager = manager ?: return NetworkClass.UNMETERED_WIFI
            val network = connectivityManager.activeNetwork ?: return NetworkClass.NONE
            return connectivityManager.classify(network)
        }

        private fun ConnectivityManager.classify(network: Network): NetworkClass {
            val capabilities = getNetworkCapabilities(network) ?: return NetworkClass.NONE
            return capabilities.toNetworkClass()
        }

        private fun NetworkCapabilities.toNetworkClass(): NetworkClass {
            val hasInternet = hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val validated = hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (!hasInternet || !validated) return NetworkClass.NONE

            val unmetered = hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            val wifi = hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            val ethernet = hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            val cellular = hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)

            val downstreamKbps =
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                    linkDownstreamBandwidthKbps
                } else {
                    0
                }

            return when {
                wifi && unmetered -> NetworkClass.UNMETERED_WIFI
                ethernet -> NetworkClass.UNMETERED_WIFI
                cellular && !unmetered -> NetworkClass.METERED
                downstreamKbps >= FAST_LINK_KBPS -> NetworkClass.FAST
                else -> NetworkClass.SLOW
            }
        }

        private companion object {
            /** ~5 Mbit/s: enough for a stable 1080p stream. */
            const val FAST_LINK_KBPS = 5_000
        }
    }
