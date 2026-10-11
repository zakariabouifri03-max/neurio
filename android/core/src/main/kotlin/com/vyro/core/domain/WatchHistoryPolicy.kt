package com.vyro.core.domain

import com.vyro.core.model.HistorySort
import com.vyro.core.model.WatchHistoryEntry

/** Rules for merging and ordering the local watch history. */
object WatchHistoryPolicy {
    /**
     * Re-watching a video refreshes its timestamp and increments the counter instead of
     * creating a duplicate row; the list is then capped to keep the database small.
     */
    fun merged(
        history: List<WatchHistoryEntry>,
        entry: WatchHistoryEntry,
        limit: Int,
    ): List<WatchHistoryEntry> {
        val existing = history.firstOrNull { it.videoId == entry.videoId }
        val updated =
            if (existing == null) {
                entry
            } else {
                entry.copy(
                    watchCount = existing.watchCount + 1,
                    progressMillis = if (entry.progressMillis > 0L) entry.progressMillis else existing.progressMillis,
                )
            }
        val others = history.filterNot { it.videoId == entry.videoId }
        return (listOf(updated) + others)
            .sortedByDescending { it.lastWatchedMillis }
            .take(limit.coerceAtLeast(1))
    }

    fun sorted(
        history: List<WatchHistoryEntry>,
        sort: HistorySort,
    ): List<WatchHistoryEntry> =
        when (sort) {
            HistorySort.RECENT -> history.sortedByDescending { it.lastWatchedMillis }
            HistorySort.MOST_WATCHED ->
                history.sortedWith(
                    compareByDescending<WatchHistoryEntry> { it.watchCount }
                        .thenByDescending { it.lastWatchedMillis },
                )
        }

    /** Watch progress as a 0f..1f fraction, clamped for safety. */
    fun progressFraction(entry: WatchHistoryEntry): Float {
        if (entry.durationMillis <= 0L) return 0f
        return (entry.progressMillis.toFloat() / entry.durationMillis.toFloat()).coerceIn(0f, 1f)
    }

    fun isCompleted(entry: WatchHistoryEntry): Boolean = progressFraction(entry) >= 0.95f
}
