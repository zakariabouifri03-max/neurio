package com.vyro.play.di

import android.content.Context
import coil.ImageLoader
import com.vyro.play.BuildConfig
import com.vyro.play.VyroPlayApplication
import com.vyro.play.domain.repository.ConnectivityRepository
import com.vyro.play.data.connectivity.ConnectivityRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Named
import kotlinx.serialization.json.Json
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideJson(): Json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
            isLenient = true
            coerceInputValues = true
        }

    /**
     * A bounded HTTP cache. Caching YouTube Data API responses is explicitly allowed
     * (see the API Terms of Service) and dramatically reduces quota consumption when
     * the user rotates the device or navigates back.
     */
    @Provides
    @Singleton
    fun provideHttpCache(
        @ApplicationContext context: Context,
    ): Cache = Cache(File(context.cacheDir, "vyro_http"), HTTP_CACHE_BYTES)

    @Provides
    @Singleton
    fun provideOkHttpClient(cache: Cache): OkHttpClient =
        OkHttpClient.Builder()
            .cache(cache)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addNetworkInterceptor { chain ->
                // Only cache successful GETs, and only for a short window.
                val response = chain.proceed(chain.request())
                if (chain.request().method == "GET" && response.isSuccessful) {
                    response.newBuilder()
                        .header("Cache-Control", "public, max-age=$RESPONSE_MAX_AGE_SECONDS")
                        .removeHeader("Pragma")
                        .build()
                } else {
                    response
                }
            }
            .addInterceptor { chain ->
                val request =
                    chain.request().newBuilder()
                        .header("User-Agent", USER_AGENT)
                        .header("Accept-Encoding", "gzip")
                        .build()
                chain.proceed(request)
            }
            .build()

    /**
     * The key compiled in from `local.properties` (or the `YOUTUBE_API_KEY` environment
     * variable). It may legitimately be empty: the user can paste their own key in
     * Settings at runtime, and the app degrades to a clear "add a key" screen instead
     * of shipping a secret in the APK.
     */
    @Provides
    @Named("buildTimeApiKey")
    fun provideBuildTimeApiKey(): String = BuildConfig.YOUTUBE_API_KEY

    @Provides
    @Singleton
    fun provideImageLoader(
        @ApplicationContext context: Context,
    ): ImageLoader =
        VyroPlayApplication.createImageLoader(
            context = context,
            memoryFraction = if (BuildConfig.DEBUG) 0.25 else 0.18,
            diskBytes = IMAGE_CACHE_BYTES,
        )

    private const val HTTP_CACHE_BYTES = 8L * 1024 * 1024
    private const val IMAGE_CACHE_BYTES = 24L * 1024 * 1024
    private const val RESPONSE_MAX_AGE_SECONDS = 300
    private const val USER_AGENT = "VYRO-PLAY-Android/${BuildConfig.VERSION_NAME}"
}

@Module
@InstallIn(SingletonComponent::class)
abstract class ConnectivityModule {
    @Binds
    @Singleton
    abstract fun bindConnectivity(impl: ConnectivityRepositoryImpl): ConnectivityRepository
}
