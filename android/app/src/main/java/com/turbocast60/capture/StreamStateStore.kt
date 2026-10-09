package com.turbocast60.capture

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface StreamUiState {
    data object Idle : StreamUiState
    data class Starting(val detail: String, val castUrl: String? = null) : StreamUiState
    data class Active(
        val receiverName: String,
        val transport: String,
        val width: Int,
        val height: Int,
        val encoderName: String,
        val hardwareAccelerated: Boolean,
        val targetFps: Int,
        val encodedFps: Double,
        val bitrate: Int,
        val rttMs: Long?,
        val packetLossPercent: Double?,
        val wifiRssiDbm: Int?,
        val note: String? = null,
        val castUrl: String? = null
    ) : StreamUiState
    data class Failed(val reason: String) : StreamUiState
}

/** In-process view of the foreground service; no connection details are persisted or logged. */
object StreamStateStore {
    private val mutableState = MutableStateFlow<StreamUiState>(StreamUiState.Idle)
    val state: StateFlow<StreamUiState> = mutableState.asStateFlow()
    fun publish(value: StreamUiState) { mutableState.value = value }
    fun resetIfProcessRestarted() { mutableState.value = StreamUiState.Idle }
}
