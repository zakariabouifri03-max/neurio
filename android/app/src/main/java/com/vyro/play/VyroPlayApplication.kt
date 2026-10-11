package com.vyro.play

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import javax.inject.Provider

/**
 * Application entry point.
 *
 * Also installs a deliberately small Coil image cache: thumbnails are the single
 * biggest memory consumer in a video browsing app, so on low-end devices we cap both
 * the bitmap pool and the disk cache.
 */
@HiltAndroidApp
class VyroPlayApplication : Application(), ImageLoaderFactory {

    @Inject
    lateinit var imageLoaderProvider: Provider<ImageLoader>

    override fun newImageLoader(): ImageLoader = imageLoaderProvider.get()

    /**
     * Trim Coil's memory cache when the system is under pressure, before Android
     * decides to kill the process.
     */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // onTrimMemory can fire before Hilt has injected the provider.
        if (level >= TRIM_MEMORY_BACKGROUND && ::imageLoaderProvider.isInitialized) {
            imageLoaderProvider.get().memoryCache?.clear()
        }
    }

    companion object {
        /**
         * Coil is configured here (rather than in a DI module) so that the same instance
         * is shared with any `AsyncImage` used before Hilt injection completes.
         */
        fun createImageLoader(
            context: android.content.Context,
            memoryFraction: Double = 0.20,
            diskBytes: Long = 24L * 1024 * 1024,
        ): ImageLoader =
            ImageLoader.Builder(context)
                .memoryCache {
                    MemoryCache.Builder(context)
                        .maxSizePercent(memoryFraction)
                        .build()
                }
                .diskCache {
                    DiskCache.Builder()
                        .directory(context.cacheDir.resolve("vyro_images"))
                        .maxSizeBytes(diskBytes)
                        .build()
                }
                .crossfade(false) // cheaper than a fade on low-end GPUs
                .respectCacheHeaders(false)
                .build()
    }
}
