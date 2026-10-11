package com.vyro.core

import com.vyro.core.util.Iso8601DateTime
import kotlin.test.Test
import kotlin.test.assertEquals

class Iso8601DateTimeTest {
    @Test
    fun parsesUtcTimestamp() {
        // 2024-03-11T09:15:00Z == 1710148500 seconds since the epoch
        val expected = 1_710_148_500_000L
        assertEquals(expected, Iso8601DateTime.parseEpochMillis("2024-03-11T09:15:00Z"))
    }

    @Test
    fun parsesFractionalSecondsAndLowercaseZ() {
        assertEquals(
            Iso8601DateTime.parseEpochMillis("2024-03-11T09:15:00Z"),
            Iso8601DateTime.parseEpochMillis("2024-03-11T09:15:00.000z"),
        )
    }

    @Test
    fun appliesPositiveOffset() {
        val utc = Iso8601DateTime.parseEpochMillis("2024-03-11T09:15:00Z")
        val plusTwo = Iso8601DateTime.parseEpochMillis("2024-03-11T11:15:00+02:00")
        assertEquals(utc, plusTwo)
    }

    @Test
    fun appliesNegativeOffset() {
        val utc = Iso8601DateTime.parseEpochMillis("2024-03-11T09:15:00Z")
        val minusFive = Iso8601DateTime.parseEpochMillis("2024-03-11T04:15:00-05:00")
        assertEquals(utc, minusFive)
    }

    @Test
    fun epochIsZero() {
        assertEquals(0L, Iso8601DateTime.parseEpochMillis("1970-01-01T00:00:00Z"))
    }

    @Test
    fun returnsZeroForInvalidInput() {
        assertEquals(0L, Iso8601DateTime.parseEpochMillis("tomorrow"))
        assertEquals(0L, Iso8601DateTime.parseEpochMillis(""))
        assertEquals(0L, Iso8601DateTime.parseEpochMillis(null))
    }
}
