package com.neurio.aivibes

import android.app.Application
import com.neurio.aivibes.headphones.HeadphoneMonitor
import com.neurio.aivibes.playback.LibraryRepository
import com.neurio.aivibes.playback.PlaylistStore
import com.neurio.aivibes.playback.PlayerRepository
import com.neurio.aivibes.settings.SettingsStore

/**
 * Application-scope object graph. Deliberately simple service-locator — no DI
 * framework overhead on budget devices.
 */
class AiVibesApp : Application() {
    lateinit var settings: SettingsStore
        private set
    lateinit var library: LibraryRepository
        private set
    lateinit var playlists: PlaylistStore
        private set
    lateinit var player: PlayerRepository
        private set
    lateinit var headphones: HeadphoneMonitor
        private set

    override fun onCreate() {
        super.onCreate()
        settings = SettingsStore(this)
        library = LibraryRepository(this)
        playlists = PlaylistStore(this)
        player = PlayerRepository(this)
        headphones = HeadphoneMonitor(this)
        headphones.start()
    }

    companion object {
        fun from(context: android.content.Context): AiVibesApp =
            context.applicationContext as AiVibesApp
    }
}
