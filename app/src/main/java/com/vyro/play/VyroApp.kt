package com.vyro.play

import android.app.Application
import androidx.room.Room
import com.vyro.play.data.AppDatabase
import com.vyro.play.data.Preferences
import com.vyro.play.data.VideoRepository

class VyroApp : Application() {
    val database by lazy { Room.databaseBuilder(this, AppDatabase::class.java, "vyro.db").build() }
    val preferences by lazy { Preferences(this) }
    val repository by lazy { VideoRepository(database.libraryDao(), preferences) }
}
