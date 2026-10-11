package com.vyro.core

import com.vyro.core.util.Formatters
import kotlin.test.Test
import kotlin.test.assertEquals

class FormattersTest {
    @Test
    fun compactCountFormatsThousandsAndMillions() {
        assertEquals("0", Formatters.compactCount(0L))
        assertEquals("940", Formatters.compactCount(940L))
        assertEquals("1K", Formatters.compactCount(1_000L))
        assertEquals("12.3K", Formatters.compactCount(12_345L))
        assertEquals("1.2M", Formatters.compactCount(1_234_567L))
        assertEquals("3.4B", Formatters.compactCount(3_400_000_000L))
    }

    @Test
    fun groupedCountAddsSeparators() {
        assertEquals("1,234,567", Formatters.groupedCount(1_234_567L))
        assertEquals("999", Formatters.groupedCount(999L))
        assertEquals("1,000", Formatters.groupedCount(1_000L))
    }

    @Test
    fun clockDurationOmitsHoursWhenUnnecessary() {
        assertEquals("0:00", Formatters.clockDuration(0L))
        assertEquals("0:07", Formatters.clockDuration(7_000L))
        assertEquals("12:34", Formatters.clockDuration(754_000L))
        assertEquals("1:02:03", Formatters.clockDuration(3_723_000L))
    }

    @Test
    fun spokenDurationIsReadable() {
        assertEquals("7 seconds", Formatters.spokenDuration(7_000L))
        assertEquals("2 minutes", Formatters.spokenDuration(120_000L))
        assertEquals("1 hour 2 minutes", Formatters.spokenDuration(3_720_000L))
    }

    @Test
    fun relativeTimeCoversEveryBucket() {
        val now = 1_710_150_900_000L // 2024-03-11T09:15:00Z
        assertEquals("just now", Formatters.relativeTime(now, now))
        assertEquals("5m ago", Formatters.relativeTime(now - 5 * 60_000L, now))
        assertEquals("3h ago", Formatters.relativeTime(now - 3 * 3_600_000L, now))
        assertEquals("yesterday", Formatters.relativeTime(now - 24 * 3_600_000L, now))
        assertEquals("4d ago", Formatters.relativeTime(now - 4 * 86_400_000L, now))
        assertEquals("2w ago", Formatters.relativeTime(now - 15 * 86_400_000L, now))
        assertEquals("3mo ago", Formatters.relativeTime(now - 100 * 86_400_000L, now))
        assertEquals("2 years ago", Formatters.relativeTime(now - 800 * 86_400_000L, now))
    }

    @Test
    fun shortDateRendersMonthDayYear() {
        assertEquals("Mar 11, 2024", Formatters.shortDate(1_710_148_500_000L))
        assertEquals("Jan 1, 2000", Formatters.shortDate(946_684_800_000L))
        assertEquals("", Formatters.shortDate(0L))
        assertEquals("", Formatters.shortDate(-1L))
    }

    @Test
    fun shortDateHandlesEpochAndLeapYears() {
        // 1970-01-01 plus one day must not drift.
        assertEquals("Jan 2, 1970", Formatters.shortDate(86_400_000L))
        // 2024 is a leap year: 2024-02-29 must exist.
        assertEquals("Feb 29, 2024", Formatters.shortDate(1_709_164_800_000L))
        // A timestamp inside 2024-03-11 must map to that day regardless of the hour.
        assertEquals("Mar 11, 2024", Formatters.shortDate(1_710_148_500_000L + 3_600_000L))
    }

    @Test
    fun fileSizeUsesBinaryUnits() {
        assertEquals("0 B", Formatters.fileSize(0L))
        assertEquals("1 KB", Formatters.fileSize(1_024L))
        assertEquals("1 MB", Formatters.fileSize(1_048_576L))
        assertEquals("2.5 GB", Formatters.fileSize(2_684_354_560L))
    }
}
