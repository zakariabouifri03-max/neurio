package com.vyro.play.data.remote

import com.vyro.core.model.AppError
import kotlinx.serialization.json.Json
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Turns transport/HTTP failures into the domain's [AppError] taxonomy, including the
 * YouTube-specific `quotaExceeded` and `dailyLimitExceeded` reasons (HTTP 403).
 */
class ApiErrorMapper(
    private val json: Json,
) {
    fun mapTransport(throwable: Throwable): AppError =
        when (throwable) {
            is SocketTimeoutException -> AppError.Timeout
            is UnknownHostException -> AppError.Offline
            is IOException -> AppError.Network
            else -> AppError.Unknown(throwable.message ?: throwable::class.java.simpleName)
        }

    fun mapHttp(
        response: Response,
        body: String,
    ): AppError {
        val parsed = runCatching { json.decodeFromString<com.vyro.play.data.remote.dto.ApiErrorResponseDto>(body) }.getOrNull()
        val apiError = parsed?.error
        val reason = apiError?.errors?.firstOrNull()?.reason

        return when {
            response.code == 404 -> AppError.NotFound
            reason in QUOTA_REASONS -> AppError.QuotaExceeded
            apiError?.message?.contains("quota", ignoreCase = true) == true -> AppError.QuotaExceeded
            else ->
                AppError.Http(
                    code = apiError?.code ?: response.code,
                    message = apiError?.message ?: response.message.ifBlank { "HTTP ${response.code}" },
                )
        }
    }

    private companion object {
        val QUOTA_REASONS = setOf("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded")
    }
}
