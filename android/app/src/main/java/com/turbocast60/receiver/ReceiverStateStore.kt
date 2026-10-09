package com.turbocast60.receiver

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ReceiverUiState(
    val pairingCode: String = "------",
    val status: String = "Starting receiver…",
    val connected: Boolean = false,
    val width: Int? = null,
    val height: Int? = null,
    val fps: Double = 0.0,
    val lossPercent: Double = 0.0
)

object ReceiverStateStore {
    private val mutable = MutableStateFlow(ReceiverUiState())
    val state = mutable.asStateFlow()
    fun publish(value: ReceiverUiState) { mutable.value = value }
}
