package com.vyro.play

import com.vyro.core.model.AppError
import com.vyro.play.data.remote.ApiErrorMapper
import kotlinx.serialization.json.Json
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.io.IOException

/** Error classification drives the copy the user sees, so it is pinned down here. */
class ApiErrorMapperTest {

    private val mapper = ApiErrorMapper(Json { ignoreUnknownKeys = true })

    @Test
    fun quotaExceededIsDetectedFromTheReason() {
        val error =
            mapper.mapHttp(
                response(403),
                """
                {"error":{"code":403,"message":"The request cannot be completed because you have exceeded your quota.",
                 "errors":[{"domain":"youtube.quota","reason":"quotaExceeded","message":"quota"}]}}
                """.trimIndent(),
            )
        assertEquals(AppError.QuotaExceeded, error)
    }

    @Test
    fun dailyLimitUsesTheSameBucket() {
        val error =
            mapper.mapHttp(
                response(403),
                """{"error":{"code":403,"errors":[{"reason":"dailyLimitExceeded"}]}}""",
            )
        assertEquals(AppError.QuotaExceeded, error)
    }

    @Test
    fun notFoundIsMapped() {
        assertEquals(AppError.NotFound, mapper.mapHttp(response(404), """{"error":{"code":404}}"""))
    }

    @Test
    fun otherHttpErrorsKeepCodeAndMessage() {
        val error = mapper.mapHttp(response(500, "Server Error"), """{"error":{"code":500,"message":"Backend blew up"}}""")
        assertTrue(error is AppError.Http)
        error as AppError.Http
        assertEquals(500, error.code)
        assertEquals("Backend blew up", error.message)
    }

    @Test
    fun unparseableBodyStillYieldsAnHttpError() {
        val error = mapper.mapHttp(response(400, "Bad Request"), "<html>not json</html>")
        assertTrue(error is AppError.Http)
        assertEquals(400, (error as AppError.Http).code)
    }

    @Test
    fun transportFailuresAreClassified() {
        assertEquals(AppError.Timeout, mapper.mapTransport(SocketTimeoutException("timeout")))
        assertEquals(AppError.Offline, mapper.mapTransport(UnknownHostException("no dns")))
        assertEquals(AppError.Network, mapper.mapTransport(IOException("reset")))
        assertTrue(mapper.mapTransport(IllegalStateException("boom")) is AppError.Unknown)
    }

    private fun response(
        code: Int,
        message: String = "",
    ): Response =
        Response.Builder()
            .request(Request.Builder().url("https://www.googleapis.com/youtube/v3/search").build())
            .protocol(Protocol.HTTP_1_1)
            .code(code)
            .message(message)
            .body("".toResponseBody(null))
            .build()
}
