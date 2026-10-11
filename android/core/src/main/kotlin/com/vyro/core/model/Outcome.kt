package com.vyro.core.model

/**
 * A tiny, explicit result type so screens can render Loading / Success / Failure
 * without juggling nullable data plus a separate error field.
 */
sealed interface Outcome<out T> {
    data object Loading : Outcome<Nothing>

    data class Success<out T>(val data: T) : Outcome<T>

    data class Failure(val error: AppError) : Outcome<Nothing>
}

inline fun <T, R> Outcome<T>.map(transform: (T) -> R): Outcome<R> =
    when (this) {
        is Outcome.Success -> Outcome.Success(transform(data))
        is Outcome.Failure -> this
        Outcome.Loading -> Outcome.Loading
    }

fun <T> Outcome<T>.dataOrNull(): T? = (this as? Outcome.Success)?.data

fun <T> Outcome<T>.errorOrNull(): AppError? = (this as? Outcome.Failure)?.error

/** Machine-friendly error taxonomy used for both logging and user-facing copy. */
sealed interface AppError {
    data object MissingApiKey : AppError

    data object Offline : AppError

    data object Timeout : AppError

    data object Network : AppError

    data class Http(val code: Int, val message: String) : AppError

    /** YouTube Data API returned 403 with a quota reason. */
    data object QuotaExceeded : AppError

    data object NotFound : AppError

    data object Parsing : AppError

    data class Unknown(val cause: String) : AppError
}
