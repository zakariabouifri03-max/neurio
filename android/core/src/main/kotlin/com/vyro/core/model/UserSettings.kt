package com.vyro.core.model

/** Complete, immutable snapshot of everything the user can configure. */
data class UserSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = true,
    val pureBlack: Boolean = false,
    val thumbnailQuality: ThumbnailQuality = ThumbnailQuality.MEDIUM,
    val preferredQuality: PlaybackQuality = PlaybackQuality.AUTO,
    val captionsEnabled: Boolean = true,
    val captionsLanguage: String = "en",
    val autoplayNext: Boolean = true,
    val dataSaver: Boolean = false,
    val safeSearch: Boolean = false,
    val regionCode: String = "US",
    val rememberSearchHistory: Boolean = true,
    val maxHistoryEntries: Int = 200,
    val reducedAnimations: Boolean = false,
    val apiKeyOverride: String = "",
) {
    companion object {
        val DEFAULT = UserSettings()
        const val MIN_HISTORY_ENTRIES = 20
        const val MAX_HISTORY_ENTRIES = 1000
    }
}

enum class ThemeMode(val label: String) {
    SYSTEM("System"),
    LIGHT("Light"),
    DARK("Dark"),
}

/** Sort order offered on the History screen. */
enum class HistorySort(val label: String) {
    RECENT("Most recent"),
    MOST_WATCHED("Most watched"),
}

/** Categories exposed as quick chips on the home screen. */
enum class ExploreCategory(val id: String, val label: String, val query: String) {
    TRENDING("trending", "Trending", "trending now"),
    MUSIC("music", "Music", "official music video"),
    GAMING("gaming", "Gaming", "gameplay walkthrough"),
    TECH("tech", "Tech", "technology review"),
    SPORTS("sports", "Sports", "sports highlights"),
    MOVIES("movies", "Movies", "movie trailer"),
    LEARNING("learning", "Learning", "learn programming tutorial"),
    NEWS("news", "News", "news today"),
}
