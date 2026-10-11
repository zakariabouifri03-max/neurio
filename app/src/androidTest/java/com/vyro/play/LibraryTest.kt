package com.vyro.play

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vyro.play.data.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibraryTest {
    private lateinit var db: AppDatabase
    private lateinit var repo: VideoRepository
    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        repo = VideoRepository(db.libraryDao(), Preferences(context))
    }
    @After fun close() { db.close() }
    @Test fun favoritesAndHistoryAreIndependent() = runBlocking {
        val card = VideoCard("abcdefghijk", "Video", "Channel", "")
        repo.favorite(card); assertEquals(1, repo.favorites.first().size)
        repo.watched(card, false); assertTrue(repo.history.first().isEmpty())
        repo.watched(card, true); assertEquals(1, repo.history.first().size)
        repo.removeHistory(card.id); assertTrue(repo.history.first().isEmpty())
        assertEquals(1, repo.favorites.first().size)
        repo.favorite(card); assertTrue(repo.favorites.first().isEmpty())
    }
    @Test fun localFileAndPermissionReferenceLifecycle() = runBlocking {
        val uri = "content://test.provider/video/1"
        repo.addLocal(uri, "My clip"); repo.addLocal(uri, "My clip")
        assertEquals(1, repo.locals.first().size)
        assertEquals(uri, repo.locals.first().first().localUri)
        val id = "local:$uri"
        repo.position(id, 5000, 20000, true)
        assertEquals(5000, repo.history.first().first().positionMs)
        repo.clearHistory(); assertTrue(repo.history.first().isEmpty())
        assertEquals(1, repo.locals.first().size)
        repo.removeLocal(id); assertTrue(repo.locals.first().isEmpty())
    }
    @Test fun searchHistoryClear() = runBlocking {
        repo.searchTerm("cats"); assertEquals("cats", repo.searches.first().first().term)
        repo.clearSearches(); assertTrue(repo.searches.first().isEmpty())
    }
}
