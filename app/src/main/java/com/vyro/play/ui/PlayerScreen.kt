package com.vyro.play.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.vyro.play.data.UserSettings
import com.vyro.play.data.VideoCard
import kotlinx.coroutines.launch

@Composable fun PlayerScreen(card: VideoCard, settings: UserSettings, model: VyroViewModel, onBack: () -> Unit, landscape: (Boolean) -> Unit, openLink: (String) -> Unit) {
    val context = LocalContext.current
    val isLocal = card.id.startsWith("local:")
    val url = "https://www.youtube.com/watch?v=${card.id}"
    var full by remember(card.id) { mutableStateOf(false) }
    var retry by remember(card.id) { mutableIntStateOf(0) }
    var error by remember(card.id) { mutableStateOf<String?>(null) }
    var loading by remember(card.id) { mutableStateOf(true) }
    var acknowledged by remember(card.id) { mutableStateOf(false) }
    val cellular = remember { isCellular(context) }
    val configuration = LocalConfiguration.current
    val wide = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val aspect = if (wide) Modifier.fillMaxWidth().weight(1f, fill = false) else Modifier.fillMaxWidth().aspectRatio(16f / 9f)
    BackHandler(full) { full = false; landscape(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
            Text(if (isLocal) "LOCAL PLAYER" else "YOUTUBE PLAYER", modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary)
            IconButton(onClick = { full = !full; landscape(full) }) { Icon(if (full) Icons.Default.FullscreenExit else Icons.Default.Fullscreen, "Toggle landscape full screen") }
        }
        if (!isLocal && settings.warnings && cellular && !acknowledged) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) { Text("Mobile data may be used to stream this video."); TextButton(onClick = { acknowledged = true }) { Text("Continue to YouTube") } }
            }
        } else {
            Box(aspect, contentAlignment = Alignment.Center) {
                if (isLocal) LocalPlayback(card, retry, model, settings.history, { loading = it }, { error = it })
                else YouTubeEmbed(card.id, retry, { loading = it }, { error = it })
                if (loading) CircularProgressIndicator()
            }
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(card.title, style = MaterialTheme.typography.headlineSmall)
            Text(card.channel, color = MaterialTheme.colorScheme.secondary)
            if (error != null) {
                Text(error!!, color = MaterialTheme.colorScheme.error)
                Button(onClick = { error = null; loading = true; retry++ }) { Icon(Icons.Default.Refresh, null); Text("Retry") }
            }
            if (!isLocal) {
                Text("Playback uses the official YouTube embedded player. Captions, full-screen controls and quality are available only when YouTube exposes them for this video and device. Some videos cannot play in embedded players.", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { openLink(url) }) { Icon(Icons.Default.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text("Watch on YouTube") }
            } else Text("Your selected file plays locally. Availability of captions and formats depends on the file and Android device.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
private fun isCellular(context: Context): Boolean {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    return cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
}

@SuppressLint("SetJavaScriptEnabled")
@Composable private fun YouTubeEmbed(id: String, retry: Int, onLoading: (Boolean) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val web = remember(id, retry) {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) { onLoading(false) }
                override fun onReceivedError(view: WebView?, request: android.webkit.WebResourceRequest?, error: android.webkit.WebResourceError?) {
                    if (request?.isForMainFrame == true) { onLoading(false); onError("Could not load YouTube. Check your connection or open the video in YouTube.") }
                }
            }
            // This is YouTube's official embed URL, not a stream extractor. The player owns its controls.
            loadUrl("https://www.youtube.com/embed/$id?playsinline=1&rel=0")
        }
    }
    AndroidView(factory = { web }, modifier = Modifier.fillMaxSize())
    DisposableEffect(web) { onDispose { web.stopLoading(); web.loadUrl("about:blank"); web.destroy() } }
}

@Composable private fun LocalPlayback(card: VideoCard, retry: Int, model: VyroViewModel, tracking: Boolean, onLoading: (Boolean) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember(card.id, retry) { ExoPlayer.Builder(context).build() }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) { onLoading(state == Player.STATE_BUFFERING || state == Player.STATE_IDLE) }
            override fun onPlayerError(error: PlaybackException) { onLoading(false); onError("File unavailable or unsupported. Reconnect its storage or choose another file. (${error.errorCodeName})") }
        }
        player.addListener(listener)
        try {
            // Persisted SAF read grant is reused; no broad storage permission is requested.
            context.contentResolver.openAssetFileDescriptor(Uri.parse(card.id.removePrefix("local:")), "r")?.close()
            player.setMediaItem(MediaItem.fromUri(Uri.parse(card.id.removePrefix("local:"))))
            scope.launch { model.existing(card.id)?.positionMs?.let { player.seekTo(it) } }
            player.prepare(); player.playWhenReady = true
        } catch (_: Exception) { onLoading(false); onError("Cannot access this file. Reconnect the drive or add it again from Local library.") }
        onDispose {
            val position = player.currentPosition.coerceAtLeast(0)
            val duration = player.duration.coerceAtLeast(0)
            model.action { position(card.id, position, duration, tracking) }
            player.removeListener(listener); player.release()
        }
    }
    AndroidView(factory = { PlayerView(it).apply { useController = true; this.player = player } }, update = { it.player = player }, modifier = Modifier.fillMaxSize())
}
