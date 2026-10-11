package com.vyro.core.util

/**
 * Minimal, allocation-light ISO-8601 handling.
 *
 * YouTube returns durations as `PT1H2M3S` and timestamps as `2024-03-11T09:15:00Z`.
 * Both are parsed here so no `java.time` (and therefore no core library desugaring)
 * is required, which keeps the app small on entry-level phones.
 */
object Iso8601Duration {
    private val PATTERN =
        Regex("""^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$""")

    /**
     * @return duration in milliseconds, or `0` when the value cannot be parsed.
     */
    fun parseToMillis(value: String?): Long {
        if (value.isNullOrBlank()) return 0L
        val match = PATTERN.matchEntire(value.trim()) ?: return 0L
        val days = match.groupValues.getOrNull(1)?.toLongOrNull() ?: 0L
        val hours = match.groupValues.getOrNull(2)?.toLongOrNull() ?: 0L
        val minutes = match.groupValues.getOrNull(3)?.toLongOrNull() ?: 0L
        val seconds = match.groupValues.getOrNull(4)?.toDoubleOrNull() ?: 0.0
        return (
            days * 86_400_000L +
                hours * 3_600_000L +
                minutes * 60_000L +
                (seconds * 1000.0).toLong()
        )
    }
}

object Iso8601DateTime {
    private val PATTERN =
        Regex(
            """^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|z|[+-]\d{2}:?\d{2})?$""",
        )

    /**
     * @return epoch milliseconds (UTC), or `0` when the value cannot be parsed.
     */
    fun parseEpochMillis(value: String?): Long {
        if (value.isNullOrBlank()) return 0L
        val match = PATTERN.matchEntire(value.trim()) ?: return 0L
        val year = match.groupValues[1].toIntOrNull() ?: return 0L
        val month = match.groupValues[2].toIntOrNull() ?: return 0L
        val day = match.groupValues[3].toIntOrNull() ?: return 0L
        val hour = match.groupValues[4].toIntOrNull() ?: return 0L
        val minute = match.groupValues[5].toIntOrNull() ?: return 0L
        val second = match.groupValues[6].toIntOrNull() ?: return 0L

        var millis = daysFromCivil(year, month, day) * 86_400_000L
        millis += hour * 3_600_000L + minute * 60_000L + second * 1_000L

        val offset = match.groups[7]?.value
        if (!offset.isNullOrEmpty()) {
            val shift = parseOffsetMillis(offset)
            millis -= shift
        }
        return millis
    }

    private fun parseOffsetMillis(offset: String): Long {
        if (offset == "Z" || offset == "z") return 0L
        val sign = if (offset.startsWith('-')) -1L else 1L
        val digits = offset.drop(1).replace(":", "")
        val hours = digits.substring(0, 2).toLongOrNull() ?: 0L
        val minutes = if (digits.length >= 4) digits.substring(2, 4).toLongOrNull() ?: 0L else 0L
        return sign * (hours * 3_600_000L + minutes * 60_000L)
    }

    /** Howard Hinnant's civil-date algorithm: days since 1970-01-01. */
    internal fun daysFromCivil(year: Int, month: Int, day: Int): Long {
        val y = if (month <= 2) year - 1 else year
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val doy = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097L + doe - 719_468L
    }
}
