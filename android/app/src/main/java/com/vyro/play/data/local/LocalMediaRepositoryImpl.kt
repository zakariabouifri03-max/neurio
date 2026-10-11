package com.vyro.play.data.repository

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import androidx.core.database.getLongOrNull
import com.vyro.core.model.LocalVideo
import com.vyro.play.domain.repository.LocalMediaRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads the user's own video files from MediaStore.
 *
 * Works without any storage permission on Android 10+ (scoped storage) and uses the
 * READ_EXTERNAL_STORAGE/READ_MEDIA_VIDEO permission declared in the manifest on older
 * releases.
 */
@Singleton
class LocalMediaRepositoryImpl
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : LocalMediaRepository {
        override suspend fun scan(): List<LocalVideo> =
            withContext(Dispatchers.IO) {
                val resolver: ContentResolver = context.contentResolver
                val collection =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                    } else {
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    }

                val projection =
                    arrayOf(
                        MediaStore.Video.Media._ID,
                        MediaStore.Video.Media.DISPLAY_NAME,
                        MediaStore.Video.Media.DURATION,
                        MediaStore.Video.Media.SIZE,
                        MediaStore.Video.Media.DATE_ADDED,
                        MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
                        MediaStore.Video.Media.WIDTH,
                        MediaStore.Video.Media.HEIGHT,
                    )

                val videos = ArrayList<LocalVideo>(64)

                runCatching {
                    resolver.query(
                        collection,
                        projection,
                        null,
                        null,
                        "${MediaStore.Video.Media.DATE_ADDED} DESC",
                    )?.use { cursor ->
                        val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                        val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                        val durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
                        val sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                        val dateIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
                        val bucketIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)
                        val widthIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.WIDTH)
                        val heightIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.HEIGHT)

                        while (cursor.moveToNext()) {
                            val id = cursor.getLong(idIndex)
                            val uri = ContentUris.withAppendedId(collection, id)
                            videos +=
                                LocalVideo(
                                    uri = uri.toString(),
                                    displayName = cursor.getString(nameIndex).orEmpty(),
                                    durationMillis = cursor.getLong(durationIndex),
                                    sizeBytes = cursor.getLongOrNull(sizeIndex) ?: 0L,
                                    dateAddedMillis = (cursor.getLongOrNull(dateIndex) ?: 0L) * 1000L,
                                    bucketName = cursor.getString(bucketIndex),
                                    width = cursor.getInt(widthIndex),
                                    height = cursor.getInt(heightIndex),
                                )
                        }
                    }
                }

                videos
            }
    }
