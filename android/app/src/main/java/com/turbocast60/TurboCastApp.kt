package com.turbocast60

import android.app.Application
import com.turbocast60.capture.StreamStateStore

class TurboCastApp : Application() {
    override fun onCreate() {
        super.onCreate()
        StreamStateStore.resetIfProcessRestarted()
    }
}
