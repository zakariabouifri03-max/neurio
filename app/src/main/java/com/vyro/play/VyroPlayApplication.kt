package com.vyro.play

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.vyro.play.data.local.VyroPlayDatabase
import com.vyro.play.data.localvideo.LocalVideoManager
import com.vyro.play.data.preferences.SettingsDataStore
import com.vyro.play.data.remote.YouTubeApiService
import com.vyro.play.data.repository.VyroRepository
import com.vyro.play.network.NetworkMonitor

/**
 * Dependency Injection container and low-end device memory optimizer for VYRO PLAY.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val database: VyroPlayDatabase by lazy {
        VyroPlayDatabase.getInstance(appContext)
    }

    val apiService: YouTubeApiService by lazy {
        YouTubeApiService()
    }

    val localVideoManager: LocalVideoManager by lazy {
        LocalVideoManager(appContext)
    }

    val repository: VyroRepository by lazy {
        VyroRepository(
            database = database,
            apiService = apiService,
            localVideoManager = localVideoManager
        )
    }

    val settingsStore: SettingsDataStore by lazy {
        SettingsDataStore(appContext)
    }

    val networkMonitor: NetworkMonitor by lazy {
        NetworkMonitor(appContext)
    }
}

class VyroPlayApplication : Application(), ImageLoaderFactory {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }

    override fun newImageLoader(): ImageLoader {
        val isLowRam = runCatching {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            am?.isLowRamDevice == true
        }.getOrDefault(false)

        return ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(if (isLowRam) 0.10 else 0.18)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("vyro_thumbnails"))
                    .maxSizeBytes(40L * 1024L * 1024L) // 40 MB disk cache
                    .build()
            }
            .bitmapConfig(if (isLowRam) Bitmap.Config.RGB_565 else Bitmap.Config.ARGB_8888)
            .allowRgb565(true)
            .crossfade(!isLowRam)
            .respectCacheHeaders(false)
            .build()
    }
}
