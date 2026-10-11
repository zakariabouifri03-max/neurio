package com.vyro.core.util

import kotlin.math.abs

/** Pure, locale-light formatting helpers shared by every screen. */
object Formatters {
    private const val K = 1_000L
    private const val M = 1_000_000L
    private const val B = 1_000_000_000L

    /**
     * Compact count used for view/subscriber numbers: `0`, `940`, `12K`, `1.2M`, `3.4B`.
     */
    fun compactCount(value: Long): String {
        if (value <= 0L) return "0"
        return when {
            value >= B -> "${trim(value / B.toDouble())}B"
            value >= M -> "${trim(value / M.toDouble())}M"
            value >= K -> "${trim(value / K.toDouble())}K"
            else -> value.toString()
        }
    }

    /** Locale-aware style grouping is avoided on purpose: it allocates and is slow in lists. */
    fun groupedCount(value: Long): String {
        if (value <= 0L) return "0"
        val digits = value.toString()
        val builder = StringBuilder(digits.length + digits.length / 3)
        var index = 0
        val leading = digits.length % 3
        if (leading > 0) {
            builder.append(digits, 0, leading)
            index = leading
        }
        while (index < digits.length) {
            if (builder.isNotEmpty()) builder.append(',')
            builder.append(digits, index, index + 3)
            index += 3
        }
        return builder.toString()
    }

    /** `1:05:09`, `12:34`, `0:07`. */
    fun clockDuration(millis: Long): String {
        if (millis <= 0L) return "0:00"
        val totalSeconds = millis / 1000L
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0) {
            "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
        } else {
            "$minutes:${seconds.toString().padStart(2, '0')}"
        }
    }

    /** Spoken-word style duration, used in the player's accessibility labels. */
    fun spokenDuration(millis: Long): String {
        if (millis <= 0L) return "unknown length"
        val totalSeconds = millis / 1000L
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        val parts = mutableListOf<String>()
        if (hours > 0) parts += "$hours hour${if (hours == 1L) "" else "s"}"
        if (minutes > 0) parts += "$minutes minute${if (minutes == 1L) "" else "s"}"
        if (seconds > 0 && hours == 0L) parts += "$seconds second${if (seconds == 1L) "" else "s"}"
        return parts.joinToString(" ")
    }

    private val MONTHS =
        arrayOf(
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        )

    /**
     * Short relative time: `just now`, `12m ago`, `3h ago`, `yesterday`, `5d ago`,
     * `3w ago`, `4mo ago`, then `Mar 2024`.
     */
    fun relativeTime(timestampMillis: Long, nowMillis: Long): String {
        if (timestampMillis <= 0L) return ""
        val diff = nowMillis - timestampMillis
        if (diff < 0) return "scheduled"
        val minutes = diff / 60_000L
        if (minutes < 1) return "just now"
        if (minutes < 60) return "${minutes}m ago"
        val hours = minutes / 60L
        if (hours < 24) return "${hours}h ago"
        val days = hours / 24L
        if (days == 1L) return "yesterday"
        if (days < 7) return "${days}d ago"
        if (days < 30) return "${days / 7L}w ago"
        if (days < 365) return "${days / 30L}mo ago"
        val years = days / 365L
        return "$years year${if (years == 1L) "" else "s"} ago"
    }

    /** Absolute date used in the player's metadata block; `0` inputs render empty. */
    fun shortDate(timestampMillis: Long): String {
        if (timestampMillis <= 0L) return ""
        val days = Iso8601DateTime.daysFromCivil(1970, 1, 1) + timestampMillis / 86_400_000L
        val (year, month, day) = civilFromDays(days)
        val monthName = MONTHS.getOrElse(month - 1) { "?" }
        return "$monthName $day, $year"
    }

    internal fun civilFromDays(days: Long): Triple<Int, Int, Int> {
        val z = days + 719_468L
        val era = (if (z >= 0) z else z - 146_096L) / 146_097L
        val doe = z - era * 146_097L
        val yoe = (doe - doe / 1460L + doe / 36_524L - doe / 146_096L) / 365L
        val y = yoe + era * 400L
        val doy = doe - (365L * yoe + yoe / 4L - yoe / 100L)
        val mp = (5L * doy + 2L) / 153L
        val d = doy - (153L * mp + 2L) / 5L + 1L
        val m = if (mp < 10L) mp + 3L else mp - 9L
        return Triple((if (m <= 2L) y + 1L else y).toInt(), m.toInt(), d.toInt())
    }

    private fun trim(value: Double): String {
        val rounded = (value * 10.0).toLong() / 10.0
        val text = rounded.toString()
        return if (text.endsWith(".0")) text.dropLast(2) else text
    }

    /** `1.4 GB`, `230 MB`. */
    fun fileSize(bytes: Long): String {
        if (bytes <= 0L) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var size = bytes.toDouble()
        var unit = 0
        while (size >= 1024.0 && unit < units.lastIndex) {
            size /= 1024.0
            unit++
        }
        return "${trim(size)} ${units[unit]}"
    }

    fun sameDay(a: Long, b: Long): Boolean {
        if (a <= 0L || b <= 0L) return false
        return abs(a - b) < 86_400_000L
    }
}
