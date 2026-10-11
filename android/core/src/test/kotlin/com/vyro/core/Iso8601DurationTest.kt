package com.vyro.core

import com.vyro.core.util.Iso8601Duration
import kotlin.test.Test
import kotlin.test.assertEquals

class Iso8601DurationTest {
    @Test
    fun parsesSecondsOnly() {
        assertEquals(7_000L, Iso8601Duration.parseToMillis("PT7S"))
    }

    @Test
    fun parsesMinutesAndSeconds() {
        assertEquals(754_000L, Iso8601Duration.parseToMillis("PT12M34S"))
    }

    @Test
    fun parsesHoursMinutesSeconds() {
        assertEquals(3_729_000L, Iso8601Duration.parseToMillis("PT1H2M9S"))
    }

    @Test
    fun parsesDaysAndHours() {
        assertEquals(90_000_000L, Iso8601Duration.parseToMillis("P1DT1H"))
    }

    @Test
    fun parsesFractionalSeconds() {
        assertEquals(1_500L, Iso8601Duration.parseToMillis("PT1.5S"))
    }

    @Test
    fun returnsZeroForBlankOrGarbage() {
        assertEquals(0L, Iso8601Duration.parseToMillis(null))
        assertEquals(0L, Iso8601Duration.parseToMillis(""))
        assertEquals(0L, Iso8601Duration.parseToMillis("not-a-duration"))
        assertEquals(0L, Iso8601Duration.parseToMillis("P"))
    }
}
