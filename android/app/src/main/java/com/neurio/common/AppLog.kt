package com.neurio.common

import android.util.Log

/** Tiny logging facade so every component uses a consistent tag prefix. */
object AppLog {
    private const val PREFIX = "Neurio/"

    fun d(component: String, msg: String) = Log.d(PREFIX + component, msg)
    fun i(component: String, msg: String) = Log.i(PREFIX + component, msg)
    fun w(component: String, msg: String, t: Throwable? = null) =
        if (t == null) Log.w(PREFIX + component, msg) else Log.w(PREFIX + component, msg, t)
    fun e(component: String, msg: String, t: Throwable? = null) =
        if (t == null) Log.e(PREFIX + component, msg) else Log.e(PREFIX + component, msg, t)
}
