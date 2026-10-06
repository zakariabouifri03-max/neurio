package com.neurio.lanstream.platform

import android.app.Application
import android.content.Context
import com.neurio.lanstream.core.SettingsRepository
import com.neurio.lanstream.discovery.DiscoveryManager
import com.neurio.lanstream.media.CodecCapabilities

/** Application entry point: owns the process-wide singletons. */
class NeurioApp : Application() {

    lateinit var settings: SettingsRepository
        private set

    lateinit var discovery: DiscoveryManager
        private set

    override fun onCreate() {
        super.onCreate()
        settings = SettingsRepository(this)
        discovery = DiscoveryManager(this)
        Notifications.createChannels(this)
        CodecCapabilities.logSummary()
    }
}

/** Convenience accessor for the app graph. */
val Context.neurioApp: NeurioApp
    get() = applicationContext as NeurioApp
