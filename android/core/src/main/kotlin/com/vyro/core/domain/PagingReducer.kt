package com.vyro.core.domain

import com.vyro.core.model.Video
import com.vyro.core.model.VideoPage

/**
 * Appends paginated results while dropping duplicates, which YouTube happily returns
 * when a video moves between pages of a live result set.
 */
object PagingReducer {
    fun append(
        current: List<Video>,
        page: VideoPage,
    ): List<Video> = append(current, page.items)

    fun append(
        current: List<Video>,
        incoming: List<Video>,
    ): List<Video> {
        val seen = current.mapTo(HashSet(current.size + incoming.size)) { it.id }
        val merged = ArrayList<Video>(current.size + incoming.size)
        merged.addAll(current)
        for (video in incoming) {
            if (seen.add(video.id)) merged.add(video)
        }
        return merged
    }

    /** True when the list has scrolled close enough to the end to trigger a prefetch. */
    fun shouldPrefetch(
        lastVisibleIndex: Int,
        totalCount: Int,
        prefetchDistance: Int = 6,
    ): Boolean = totalCount > 0 && lastVisibleIndex >= totalCount - prefetchDistance
}
