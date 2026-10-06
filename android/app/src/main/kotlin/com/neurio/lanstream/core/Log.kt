package com.neurio.lanstream.core

import android.util.Log as AndroidLog

/** Thin wrapper so every log line shares one tag and logcat stays greppable. */
object Log {

    private const val TAG = "Neurio"

    fun v(message: String) = AndroidLog.v(TAG, message)
    fun d(message: String) = AndroidLog.d(TAG, message)
    fun i(message: String) = AndroidLog.i(TAG, message)

    fun w(message: String, throwable: Throwable? = null) {
        if (throwable != null) AndroidLog.w(TAG, message, throwable) else AndroidLog.w(TAG, message)
    }

    fun e(message: String, throwable: Throwable? = null) {
        if (throwable != null) AndroidLog.e(TAG, message, throwable) else AndroidLog.e(TAG, message)
    }
}
