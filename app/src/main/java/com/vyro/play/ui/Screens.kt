package com.vyro.play.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.vyro.play.data.*
import kotlinx.coroutines.launch

private val tabs = listOf("Home", "Search", "Popular", "Library", "Settings")
@Composable fun VyroRoot(model: VyroViewModel, imported: Int, importError: String?, clearImportError: () -> Unit,
    pickFile: () -> Unit, landscape: (Boolean) -> Unit, openLink: (String) -> Unit) {
    val settings by model.settings.collectAsState()
    var tab by remember { mutableStateOf("Home") }
    var active by remember { mutableStateOf<VideoCard?>(null) }
    var libraryTab by remember { mutableStateOf("Favorites") }
    val favorites by model.favorites.collectAsState()
    val history by model.history.collectAsState()
    val locals by model.locals.collectAsState()
    val searches by model.searches.collectAsState()
    val query by model.query.collectAsState()
    val results by model.results.collectAsState()
    val popular by model.popular.collectAsState()
    val busy by model.busy.collectAsState()
    val popularBusy by model.popularBusy.collectAsState()
    val error by model.error.collectAsState()
    val popularError by model.popularError.collectAsState()
    val count by model.localCount.collectAsState()
    val scope = rememberCoroutineScope()
    fun play(card: VideoCard) {
        if (card.isChannel) { openLink("https://www.youtube.com/channel/${card.id}"); return }
        active = card
        model.action { watched(card, settings.history) }
    }
    fun back() { active = null; landscape(false) }
    BackHandler(active != null || tab != "Home") { if (active != null) back() else tab = "Home" }
    LaunchedEffect(settings.apiKey) { if (settings.apiKey.isNotBlank()) model.popular() }
    LaunchedEffect(imported) { if (imported > 0) { tab = "Library"; libraryTab = "Local" } }
    VyroTheme(settings.theme) {
        if (active != null) {
            PlayerScreen(active!!, settings, model, onBack = ::back, landscape = landscape, openLink = openLink)
        } else {
            Scaffold(
                topBar = { Header(tab, onSettings = { tab = "Settings" }) },
                bottomBar = {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                        tabs.forEach { item ->
                            NavigationBarItem(selected = tab == item, onClick = { tab = item }, icon = {
                                Icon(when(item) { "Home" -> Icons.Default.Home; "Search" -> Icons.Default.Search; "Popular" -> Icons.Default.Whatshot; "Library" -> Icons.Default.VideoLibrary; else -> Icons.Default.Settings }, null)
                            }, label = { Text(item) })
                        }
                    }
                }
            ) { inset ->
                Column(Modifier.fillMaxSize().padding(inset)) {
                    if (importError != null) { ErrorPanel(importError, clearImportError) }
                    when (tab) {
                        "Home" -> HomeScreen(settings.apiKey.isNotBlank(), history, popular.items, popularBusy, popularError,
                            onSearch = { tab = "Search" }, onPopular = { tab = "Popular" }, onLibrary = { libraryTab = "Local"; tab = "Library" }, onSettings = { tab = "Settings" }, play = ::play)
                        "Search" -> SearchScreen(query, model::query, { model.search() }, searches, results, busy, error,
                            onNext = { model.search(true) }, onRetry = { model.search() }, onRemoveSearch = { term -> model.action { removeSearch(term) } },
                            play = ::play, favorites = favorites.map { it.id }.toSet(), toggle = { model.action { favorite(it) } })
                        "Popular" -> ListingScreen("Popular in the US", "Trending videos from YouTube's mostPopular chart. Availability varies by region.", popular.items, popularBusy, popularError,
                            onRetry = { model.popular() }, onNext = { model.popular(true) }, popular.next != null, ::play, favorites.map { it.id }.toSet(), { model.action { favorite(it) } })
                        "Library" -> LibraryScreen(libraryTab, { libraryTab = it }, favorites, history, locals, ::play, pickFile,
                            openLink, { model.action { favorite(it) } }, { model.action { removeHistory(it) } }, { model.action { clearHistory() } },
                            { model.action { removeLocal(it) } }, settings.history)
                        else -> SettingsScreen(settings, count, model, openLink)
                    }
                }
            }
        }
    }
}

@Composable private fun Header(title: String, onSettings: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxWidth().height(70.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("V", style = MaterialTheme.typography.headlineMedium, color = Violet, fontWeight = FontWeight.Black)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("VYRO PLAY", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
                Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = Cyan)
            }
            IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Settings") }
        }
    }
}
@Composable private fun Title(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}
@Composable private fun Hero(onSearch: () -> Unit) {
    Surface(shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Violet.copy(alpha = .32f), Cyan.copy(alpha = .14f), MaterialTheme.colorScheme.surface))).padding(24.dp)) {
            Text("YOUR NEXT WATCH\nSTARTS HERE.", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(10.dp))
            Text("Discover on YouTube. Keep what matters close.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(20.dp))
            Button(onClick = onSearch) { Icon(Icons.Default.Search, null); Spacer(Modifier.width(8.dp)); Text("Explore videos") }
        }
    }
}
@Composable private fun HomeScreen(configured: Boolean, history: List<SavedVideo>, popular: List<VideoCard>, loading: Boolean, error: String?, onSearch: () -> Unit, onPopular: () -> Unit, onLibrary: () -> Unit, onSettings: () -> Unit, play: (VideoCard) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Hero(onSearch) }
        if (!configured) item { Notice("Connect to YouTube", "Add your own YouTube Data API v3 key in Settings to discover real videos.", "Open settings", onSettings) }
        item { Title("Continue watching", "View history", { onLibrary() }) }
        val ongoing = history.filter { it.localUri.isNotBlank() && it.positionMs > 0 && (it.durationMs == 0L || it.positionMs < it.durationMs - 10000) }.take(3)
        if (ongoing.isEmpty()) item { Hint("Local videos with saved progress appear here. Play a file to get started.") }
        items(ongoing, key = { "continue${it.id}" }) { saved -> VideoTile(saved.toCard(), { play(saved.toCard()) }, false, {}, "Resume at ${formatTime(saved.positionMs)}") }
        item { Title("Popular now", "See all", onPopular) }
        if (loading && popular.isEmpty()) items(3) { SkeletonTile() }
        if (error != null && configured) item { Hint(error) }
        if (popular.isEmpty() && !loading && error == null) item { Hint("Popular videos appear here when your API key is configured and you are online.") }
        items(popular.take(4), key = { "popular${it.id}" }) { card -> VideoTile(card, { play(card) }, false, {}) }
        item { OutlinedButton(onClick = onLibrary, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.FolderOpen, null); Spacer(Modifier.width(8.dp)); Text("Open my local library") } }
    }
}
@Composable private fun SearchScreen(query: String, onQuery: (String) -> Unit, search: () -> Unit, recent: List<RecentSearch>, results: Page, loading: Boolean, error: String?, onNext: () -> Unit, onRetry: () -> Unit, onRemoveSearch: (String) -> Unit, play: (VideoCard) -> Unit, favorites: Set<String>, toggle: (VideoCard) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(query, onQuery, label = { Text("Search YouTube videos & channels") }, singleLine = true, modifier = Modifier.weight(1f),
                leadingIcon = { Icon(Icons.Default.Search, null) }, trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }) { Icon(Icons.Default.Close, "Clear query") } },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { search() }))
            Spacer(Modifier.width(8.dp)); FilledIconButton(onClick = search) { Icon(Icons.Default.ArrowForward, "Search") }
        }
        LazyColumn(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (recent.isNotEmpty() && results.items.isEmpty()) {
                item { Title("Recent searches") }
                items(recent, key = { it.term }) { term ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { onQuery(term.term); search() }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.History, null); Spacer(Modifier.width(8.dp)); Text(term.term, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        IconButton(onClick = { onRemoveSearch(term.term) }) { Icon(Icons.Default.Close, "Remove ${term.term}") }
                    }
                }
            }
            if (loading && results.items.isEmpty()) items(4) { SkeletonTile() }
            if (error != null) item { Notice("Search unavailable", error, "Retry", onRetry) }
            if (results.items.isEmpty() && !loading && error == null) item { Hint("Search real videos and channels. Suggestions here come from your own recent searches; YouTube's Data API does not provide autocomplete.") }
            items(results.items, key = { it.id }) { card -> VideoTile(card, { play(card) }, card.id in favorites, { toggle(card) }) }
            if (results.next != null) item { Button(onClick = onNext, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text(if (loading) "Loading…" else "Load more") } }
        }
    }
}
@Composable private fun ListingScreen(title: String, subtitle: String, cards: List<VideoCard>, loading: Boolean, error: String?, onRetry: () -> Unit, onNext: () -> Unit, hasNext: Boolean, play: (VideoCard) -> Unit, favorites: Set<String>, toggle: (VideoCard) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Title(title); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant); Spacer(Modifier.height(4.dp)); OutlinedButton(onClick = onRetry) { Icon(Icons.Default.Refresh, null); Text("Refresh") } }
        if (loading && cards.isEmpty()) items(4) { SkeletonTile() }
        if (error != null) item { Notice("Cannot load videos", error, "Try again", onRetry) }
        items(cards, key = { it.id }) { card -> VideoTile(card, { play(card) }, card.id in favorites, { toggle(card) }) }
        if (hasNext) item { Button(onClick = onNext, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text(if (loading) "Loading…" else "Load more") } }
    }
}
@Composable private fun LibraryScreen(selected: String, select: (String) -> Unit, favorites: List<SavedVideo>, history: List<SavedVideo>, locals: List<SavedVideo>, play: (VideoCard) -> Unit, pickFile: () -> Unit, openLink: (String) -> Unit, toggle: (VideoCard) -> Unit, removeHistory: (String) -> Unit, clearHistory: () -> Unit, removeLocal: (String) -> Unit, tracking: Boolean) {
    val sections = listOf("Favorites", "History", "Continue", "Offline", "Local")
    Column {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            sections.forEach { label -> FilterChip(selected = label == selected, onClick = { select(label) }, label = { Text(label) }, modifier = Modifier.padding(end = 8.dp)) }
        }
        LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (selected) {
                "Offline" -> {
                    item { Title("Watch offline, the right way") }
                    item { Notice("YouTube offline viewing", "Eligible downloads are managed and played in the official YouTube app, subject to account, subscription, region, copyright and DRM restrictions. VYRO PLAY does not download YouTube videos.", "Open YouTube", { openLink("https://www.youtube.com/") }) }
                    item { Notice("Your own video files", "Use the Android file picker to grant read access to a video on this device. Nothing is uploaded.", "Choose a video", pickFile) }
                }
                else -> {
                    val list = when(selected) {
                        "Favorites" -> favorites
                        "History" -> history
                        "Continue" -> history.filter { it.localUri.isNotEmpty() && it.positionMs > 0 && (it.durationMs == 0L || it.positionMs < it.durationMs - 10000) }
                        else -> locals
                    }
                    item { Title(when(selected) { "Continue" -> "Continue watching"; "Local" -> "Local video library"; else -> selected }) }
                    if (selected == "History") item { Row { Text(if (tracking) "History stays on your device." else "History tracking is off.", modifier = Modifier.weight(1f)); if (list.isNotEmpty()) TextButton(onClick = clearHistory) { Text("Clear all") } } }
                    if (selected == "Local") item { Button(onClick = pickFile, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add my video") } }
                    if (list.isEmpty()) item { Hint(when(selected) { "Favorites" -> "Tap the heart on a video to save it here."; "History" -> "Videos you open appear here when history is enabled."; "Continue" -> "Pause a local video and return to resume from where you left off."; else -> "No files yet. Add a video from your device using the button above." }) }
                    items(list, key = { it.id }) { saved ->
                        VideoTile(saved.toCard(), { play(saved.toCard()) }, saved.favorite, { toggle(saved.toCard()) },
                            if (selected == "Continue") "Resume at ${formatTime(saved.positionMs)}" else null)
                        if (selected == "History" || selected == "Local" || selected == "Favorites") TextButton(onClick = { when(selected) { "History" -> removeHistory(saved.id); "Local" -> removeLocal(saved.id); else -> toggle(saved.toCard()) } }) {
                            Text(when(selected) { "History" -> "Remove from history"; "Local" -> "Remove from library"; else -> "Remove favorite" })
                        }
                    }
                }
            }
        }
    }
}
fun SavedVideo.toCard() = VideoCard(id, title, channel, thumbnail)
fun formatTime(ms: Long): String { val s = ms / 1000; return "%d:%02d".format(s / 60, s % 60) }
@Composable private fun VideoTile(card: VideoCard, play: () -> Unit, favorite: Boolean, toggle: () -> Unit, badge: String? = null) {
    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth().clickable(onClick = play)) {
        Column {
            Box(Modifier.fillMaxWidth().height(185.dp).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                if (card.thumbnail.isNotBlank()) AsyncImage(model = card.thumbnail, contentDescription = "Thumbnail for ${card.title}", modifier = Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                else Icon(Icons.Default.PlayCircle, null, tint = Cyan, modifier = Modifier.size(56.dp))
                if (card.isChannel) Surface(Modifier.align(Alignment.BottomStart).padding(10.dp), shape = RoundedCornerShape(6.dp), color = Violet) { Text("CHANNEL", Modifier.padding(5.dp), color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelSmall) }
                if (badge != null) Surface(Modifier.align(Alignment.BottomEnd).padding(10.dp), shape = RoundedCornerShape(6.dp)) { Text(badge, Modifier.padding(5.dp), style = MaterialTheme.typography.labelSmall) }
            }
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(card.title, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    Text(listOfNotNull(card.channel.takeIf { it.isNotBlank() }, card.views.takeIf { it.isNotBlank() }?.let { "$it views" }).joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                if (!card.isChannel && !card.id.startsWith("local:")) IconButton(onClick = toggle) { Icon(if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, if (favorite) "Remove favorite" else "Add favorite", tint = if (favorite) Violet else MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}
@Composable private fun SkeletonTile() { Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth().height(245.dp)) {} }
@Composable private fun Hint(message: String) { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) }
@Composable private fun Notice(title: String, body: String, action: String, onAction: () -> Unit) { Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) { Column(Modifier.fillMaxWidth().padding(20.dp)) { Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium); Spacer(Modifier.height(6.dp)); Text(body); Spacer(Modifier.height(10.dp)); TextButton(onClick = onAction) { Text(action); Icon(Icons.Default.ArrowForward, null) } } } }
@Composable fun ErrorPanel(message: String, dismiss: () -> Unit) { Surface(color = MaterialTheme.colorScheme.errorContainer) { Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) { Text(message, Modifier.weight(1f)); IconButton(onClick = dismiss) { Icon(Icons.Default.Close, "Dismiss") } } } }
