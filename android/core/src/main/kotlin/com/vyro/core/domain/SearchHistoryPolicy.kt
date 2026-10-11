package com.vyro.core.domain

import com.vyro.core.model.SearchQuery

/**
 * Rules for merging, trimming and filtering the local search history.
 *
 * Pure functions: no database, no clock, no Android framework.
 */
object SearchHistoryPolicy {
    fun normalise(raw: String): String = raw.trim().replace(Regex("\\s+"), " ")

    fun isValid(raw: String): Boolean {
        val value = normalise(raw)
        return value.length in 2..100
    }

    /**
     * Adds (or refreshes) [incoming] and returns a list that is:
     *  - de-duplicated case-insensitively (most recent wins)
     *  - ordered newest-first
     *  - capped at [limit]
     */
    fun merged(
        history: List<SearchQuery>,
        incoming: String,
        nowMillis: Long,
        limit: Int,
    ): List<SearchQuery> {
        val value = normalise(incoming)
        if (!isValid(value)) return history

        val existing = history.firstOrNull { it.text.equals(value, ignoreCase = true) }
        val updated =
            if (existing == null) {
                SearchQuery(text = value, updatedAtMillis = nowMillis, useCount = 1)
            } else {
                existing.copy(
                    text = value,
                    updatedAtMillis = nowMillis,
                    useCount = existing.useCount + 1,
                )
            }

        val others = history.filterNot { it.text.equals(value, ignoreCase = true) }
        return (listOf(updated) + others)
            .sortedByDescending { it.updatedAtMillis }
            .take(limit.coerceAtLeast(1))
    }

    /** Prefix matches for the suggestion dropdown, newest first. */
    fun suggestions(
        history: List<SearchQuery>,
        prefix: String,
        maxItems: Int = 8,
    ): List<SearchQuery> {
        val value = normalise(prefix)
        if (value.isEmpty()) return history.take(maxItems)
        return history
            .filter { it.text.contains(value, ignoreCase = true) }
            .sortedWith(compareByDescending<SearchQuery> { it.useCount }.thenByDescending { it.updatedAtMillis })
            .take(maxItems)
    }

    fun without(
        history: List<SearchQuery>,
        entry: SearchQuery,
    ): List<SearchQuery> = history.filterNot { it.text == entry.text }
}
