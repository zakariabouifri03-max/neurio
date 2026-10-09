package com.turbocast60.util

import android.util.Base64

object ByteEncoding {
    fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    fun decode(value: String): ByteArray = Base64.decode(value, Base64.DEFAULT)
    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
