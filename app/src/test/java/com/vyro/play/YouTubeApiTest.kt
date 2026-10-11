package com.vyro.play

import com.vyro.play.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.net.UnknownHostException

class YouTubeApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: YouTubeApi
    @Before fun start() {
        server = MockWebServer(); server.start()
        api = Retrofit.Builder().baseUrl(server.url("/")).addConverterFactory(GsonConverterFactory.create()).build().create(YouTubeApi::class.java)
    }
    @After fun stop() { server.shutdown() }
    @Test fun `search parses real response metadata and next token`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"nextPageToken":"NEXT","items":[{"id":{"videoId":"abcdefghijk"},"snippet":{"title":"Actual title","channelTitle":"Actual channel","thumbnails":{"high":{"url":"https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"}}}}]}"""))
        val page = api.search(query = "music", key = "test")
        assertEquals("NEXT", page.nextPageToken)
        assertEquals("Actual title", page.items!!.first().card()!!.title)
        assertEquals("Actual channel", page.items!!.first().card()!!.channel)
        val req = server.takeRequest()
        assertEquals("NEXT", page.nextPageToken)
        assertTrue(req.path!!.contains("q=music"))
        assertTrue(req.path!!.contains("type=video%2Cchannel"))
    }
    @Test fun `popular pagination sends chart region and token`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"items":[],"nextPageToken":"PAGE3"}"""))
        val response = api.videos(chart = "mostPopular", region = "US", max = 20, page = "PAGE2", key = "test")
        assertEquals("PAGE3", response.nextPageToken)
        val path = server.takeRequest().path!!
        assertTrue(path.contains("chart=mostPopular")); assertTrue(path.contains("pageToken=PAGE2")); assertTrue(path.contains("regionCode=US"))
    }
    @Test fun `quota error produces useful message`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(403).setBody("{}"))
        try { api.search(query = "test", key = "test"); fail("Expected failure") }
        catch (e: HttpException) { assertTrue(e.friendly().contains("quota")) }
    }
    @Test fun `invalid items and empty pages are safe`() {
        assertNull(SearchItem(ResourceId(videoId = "bad"), Snippet(title = "Invalid")).card())
        assertNull(VideoItem(id = null).card())
        assertEquals("", (null as Snippet?).image())
        assertTrue(VideoResponse(items = null).items.orEmpty().isEmpty())
        assertTrue(UnknownHostException().friendly().contains("internet"))
    }
}
