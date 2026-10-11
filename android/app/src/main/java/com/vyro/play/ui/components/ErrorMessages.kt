package com.vyro.play.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.vyro.core.model.AppError
import com.vyro.play.R

/** Maps the domain error taxonomy onto user-facing copy. */
@Composable
fun errorTitle(error: AppError): String =
    when (error) {
        AppError.MissingApiKey -> stringResource(R.string.state_no_api_key_title)
        AppError.Offline -> stringResource(R.string.state_offline_title)
        AppError.QuotaExceeded -> stringResource(R.string.state_quota_title)
        AppError.NotFound -> stringResource(R.string.state_error_title)
        is AppError.Http -> stringResource(R.string.state_error_title)
        AppError.Timeout -> stringResource(R.string.state_offline_title)
        AppError.Network -> stringResource(R.string.state_offline_title)
        AppError.Parsing -> stringResource(R.string.state_error_title)
        is AppError.Unknown -> stringResource(R.string.state_error_title)
    }

@Composable
fun errorBody(error: AppError): String =
    when (error) {
        AppError.MissingApiKey -> stringResource(R.string.state_no_api_key_body)
        AppError.Offline -> stringResource(R.string.state_offline_body)
        AppError.QuotaExceeded -> stringResource(R.string.state_quota_body)
        AppError.NotFound -> stringResource(R.string.search_no_results_body)
        is AppError.Http -> "HTTP ${error.code}: ${error.message}"
        AppError.Timeout -> "The request timed out. Check your connection and try again."
        AppError.Network -> stringResource(R.string.state_offline_body)
        AppError.Parsing -> "YouTube returned a response this app could not read."
        is AppError.Unknown -> error.cause
    }

/** Errors worth retrying: quota and configuration errors will not fix themselves. */
fun isRetryable(error: AppError): Boolean =
    error !is AppError.MissingApiKey && error !is AppError.QuotaExceeded
