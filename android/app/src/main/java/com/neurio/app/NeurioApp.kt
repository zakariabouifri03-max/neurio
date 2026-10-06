package com.neurio.app

import android.app.Application

class NeurioApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Notification channels are created lazily by HostStreamService.
    }
}
