package com.vyro.play.player

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vyro.play.model.PlaybackSpeedOption
import com.vyro.play.model.VideoQualityOption

/**
 * Controller state for the Official YouTube IFrame Player API integration.
 */
@Stable
class YouTubePlayerController {
    internal var webView: WebView? = null

    var isReady by mutableStateOf(false)
        internal set
    var isPlaying by mutableStateOf(false)
        internal set
    var isBuffering by mutableStateOf(true)
        internal set
    var currentSeconds by mutableLongStateOf(0L)
        internal set
    var durationSeconds by mutableLongStateOf(0L)
        internal set
    var bufferedFraction by mutableFloatStateOf(0f)
        internal set
    var activeQuality by mutableStateOf(VideoQualityOption.AUTO)
        internal set
    var availableQualities by mutableStateOf<List<VideoQualityOption>>(emptyList())
        internal set
    var captionsEnabled by mutableStateOf(false)
        internal set
    var playbackSpeed by mutableStateOf(PlaybackSpeedOption.SPEED_1_0)
        internal set
    var isMuted by mutableStateOf(false)
        internal set
    var playerErrorCode by mutableIntStateOf(0)
        internal set

    fun play() {
        evalJs("window.vyroPlay && window.vyroPlay();")
    }

    fun pause() {
        evalJs("window.vyroPause && window.vyroPause();")
    }

    fun togglePlayPause() {
        if (isPlaying) pause() else play()
    }

    fun seekTo(seconds: Long) {
        val clamped = seconds.coerceAtLeast(0L)
        currentSeconds = clamped
        evalJs("window.vyroSeekTo && window.vyroSeekTo($clamped);")
    }

    fun seekBy(deltaSeconds: Long) {
        val target = (currentSeconds + deltaSeconds).coerceIn(0L, durationSeconds.coerceAtLeast(36000L))
        seekTo(target)
    }

    fun setPreferredQuality(quality: VideoQualityOption) {
        activeQuality = quality
        evalJs("window.vyroSetQuality && window.vyroSetQuality('${quality.ytCode}');")
    }

    fun setCaptions(enabled: Boolean, languageCode: String = "en") {
        captionsEnabled = enabled
        val safeLang = languageCode.replace("'", "")
        evalJs("window.vyroSetCaptions && window.vyroSetCaptions($enabled, '$safeLang');")
    }

    fun setSpeed(speed: PlaybackSpeedOption) {
        playbackSpeed = speed
        evalJs("window.vyroSetPlaybackRate && window.vyroSetPlaybackRate(${speed.rate});")
    }

    fun setMute(muted: Boolean) {
        isMuted = muted
        evalJs("window.vyroSetMuted && window.vyroSetMuted($muted);")
    }

    fun loadVideo(
        videoId: String,
        startSeconds: Long = 0L,
        preferredQuality: VideoQualityOption = VideoQualityOption.UHD_4K
    ) {
        playerErrorCode = 0
        isBuffering = true
        val safeId = videoId.replace("'", "")
        evalJs("window.vyroLoadVideo && window.vyroLoadVideo('$safeId', $startSeconds, '${preferredQuality.ytCode}');")
    }

    private fun evalJs(script: String) {
        webView?.post {
            webView?.evaluateJavascript(script, null)
        }
    }
}

/**
 * JavascriptInterface bridging the Official YouTube IFrame Player API (`YT.Player`)
 * to Jetpack Compose state on the main thread.
 */
class VyroYouTubeBridge(
    private val controller: YouTubePlayerController,
    private val onProgressCallback: (Long, Long) -> Unit,
    private val onVideoEndedCallback: () -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onPlayerReady(durationSec: Double, currentQuality: String, availableQualitiesCsv: String) {
        mainHandler.post {
            controller.isReady = true
            controller.isBuffering = false
            if (durationSec > 0) {
                controller.durationSeconds = durationSec.toLong()
            }
            if (currentQuality.isNotBlank()) {
                controller.activeQuality = VideoQualityOption.fromYtCode(currentQuality)
            }
            parseQualities(availableQualitiesCsv)
        }
    }

    @JavascriptInterface
    fun onPlayerStateChange(stateCode: Int) {
        // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
        mainHandler.post {
            when (stateCode) {
                1 -> {
                    controller.isPlaying = true
                    controller.isBuffering = false
                    controller.playerErrorCode = 0
                }
                2 -> {
                    controller.isPlaying = false
                    controller.isBuffering = false
                }
                3 -> {
                    controller.isBuffering = true
                }
                0 -> {
                    controller.isPlaying = false
                    controller.isBuffering = false
                    onVideoEndedCallback()
                }
                else -> {
                    controller.isBuffering = false
                }
            }
        }
    }

    @JavascriptInterface
    fun onPlayerProgress(currentSec: Double, durationSec: Double, loadedFraction: Double) {
        mainHandler.post {
            val cur = currentSec.toLong().coerceAtLeast(0L)
            val dur = durationSec.toLong().coerceAtLeast(0L)
            controller.currentSeconds = cur
            if (dur > 0L) {
                controller.durationSeconds = dur
            }
            controller.bufferedFraction = loadedFraction.toFloat().coerceIn(0f, 1f)
            onProgressCallback(cur, dur)
        }
    }

    @JavascriptInterface
    fun onQualityChange(qualityCode: String, availableQualitiesCsv: String) {
        mainHandler.post {
            controller.activeQuality = VideoQualityOption.fromYtCode(qualityCode)
            parseQualities(availableQualitiesCsv)
        }
    }

    @JavascriptInterface
    fun onPlayerError(errorCode: Int) {
        // Error codes: 2 invalid param, 5 HTML5 error, 100 not found, 101/150 embed disallowed by owner
        mainHandler.post {
            controller.isBuffering = false
            controller.isPlaying = false
            controller.playerErrorCode = errorCode
        }
    }

    private fun parseQualities(csv: String) {
        if (csv.isBlank()) return
        val parsed = csv.split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { VideoQualityOption.fromYtCode(it) }
            .distinct()
        if (parsed.isNotEmpty()) {
            controller.availableQualities = parsed
        }
    }
}

/**
 * Composable wrapper around the Official YouTube IFrame Player API.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun OfficialYouTubePlayerView(
    videoId: String,
    initialStartSeconds: Long,
    preferredQuality: VideoQualityOption,
    captionsDefaultEnabled: Boolean,
    captionsLanguage: String,
    controller: YouTubePlayerController,
    onProgressUpdate: (Long, Long) -> Unit,
    onVideoEnded: () -> Unit,
    modifier: Modifier = Modifier
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var loadedVideoId by remember { mutableStateOf(videoId) }

    val bridge = remember(controller) {
        VyroYouTubeBridge(
            controller = controller,
            onProgressCallback = onProgressUpdate,
            onVideoEndedCallback = onVideoEnded
        )
    }

    // Pause playback when the app leaves the foreground (YouTube API policy compliance)
    DisposableEffect(lifecycleOwner, controller) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    controller.pause()
                    controller.webView?.onPause()
                }
                Lifecycle.Event.ON_RESUME -> {
                    controller.webView?.onResume()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(videoId) {
        if (videoId != loadedVideoId && controller.isReady) {
            loadedVideoId = videoId
            controller.loadVideo(
                videoId = videoId,
                startSeconds = initialStartSeconds,
                preferredQuality = preferredQuality
            )
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(AndroidColor.BLACK)
                isFocusable = true
                isFocusableInTouchMode = true

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    loadsImagesAutomatically = true
                    cacheMode = WebSettings.LOAD_DEFAULT
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    userAgentString = settings.userAgentString + " VyroPlay/1.0"
                }

                addJavascriptInterface(bridge, "VyroBridge")

                webChromeClient = WebChromeClient()
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val url = request?.url ?: return false
                        val host = url.host?.lowercase().orEmpty()
                        // Allow official YouTube embed frames inside the player; open external links via system
                        return if (host.contains("youtube.com") || host.contains("youtube-nocookie.com") || host.contains("googlevideo.com")) {
                            false
                        } else {
                            openExternalUrl(context, url)
                            true
                        }
                    }
                }

                val htmlContent = buildOfficialYouTubeIframeHtml(
                    videoId = videoId,
                    startSeconds = initialStartSeconds,
                    preferredQualityCode = preferredQuality.ytCode,
                    captionsEnabled = captionsDefaultEnabled,
                    captionsLang = captionsLanguage
                )

                loadDataWithBaseURL(
                    "https://www.youtube.com",
                    htmlContent,
                    "text/html",
                    "utf-8",
                    null
                )
                controller.webView = this
            }
        },
        onRelease = { webView ->
            controller.webView = null
            runCatching {
                webView.loadUrl("about:blank")
                webView.stopLoading()
                webView.removeAllViews()
                webView.destroy()
            }
        }
    )
}

fun openInOfficialYouTubeApp(context: Context, videoId: String) {
    val cleanId = videoId.trim()
    val appIntent = Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$cleanId")).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val webIntent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("https://www.youtube.com/watch?v=$cleanId")
    ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
        context.startActivity(appIntent)
    } catch (_: Exception) {
        runCatching { context.startActivity(webIntent) }
    }
}

private fun openExternalUrl(context: Context, uri: Uri) {
    runCatching {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}

/**
 * Generates the official YouTube IFrame Player API host HTML document.
 * Uses https://www.youtube.com/iframe_api with quality range selection up to hd2160 (4K),
 * caption module control, playback rate control, and progress telemetry.
 */
private fun buildOfficialYouTubeIframeHtml(
    videoId: String,
    startSeconds: Long,
    preferredQualityCode: String,
    captionsEnabled: Boolean,
    captionsLang: String
): String {
    val safeVideoId = videoId.replace("'", "")
    val safeQuality = preferredQualityCode.replace("'", "")
    val safeLang = captionsLang.replace("'", "").ifEmpty { "en" }
    val ccLoadPolicy = if (captionsEnabled) 1 else 0

    return """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: #000000;
      overflow: hidden;
    }
    #player {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    var player = null;
    var preferredQuality = '$safeQuality';
    var captionsActive = $captionsEnabled;
    var captionsLang = '$safeLang';
    var progressTimer = null;

    function onYouTubeIframeAPIReady() {
      player = new YT.Player('player', {
        width: '100%',
        height: '100%',
        videoId: '$safeVideoId',
        playerVars: {
          'autoplay': 1,
          'playsinline': 1,
          'controls': 1,
          'rel': 0,
          'modestbranding': 1,
          'fs': 1,
          'cc_load_policy': $ccLoadPolicy,
          'cc_lang_pref': '$safeLang',
          'iv_load_policy': 3,
          'start': $startSeconds,
          'enablejsapi': 1,
          'origin': 'https://www.youtube.com'
        },
        events: {
          'onReady': onPlayerReady,
          'onStateChange': onPlayerStateChange,
          'onPlaybackQualityChange': onPlaybackQualityChange,
          'onError': onPlayerError
        }
      });
    }

    function applyPreferredQuality() {
      if (!player) return;
      try {
        if (preferredQuality && preferredQuality !== 'auto') {
          if (typeof player.setPlaybackQualityRange === 'function') {
            player.setPlaybackQualityRange(preferredQuality, preferredQuality);
          }
          if (typeof player.setPlaybackQuality === 'function') {
            player.setPlaybackQuality(preferredQuality);
          }
        }
      } catch (e) {}
    }

    function onPlayerReady(event) {
      applyPreferredQuality();
      try {
        var dur = player.getDuration ? player.getDuration() : 0;
        var curQ = player.getPlaybackQuality ? player.getPlaybackQuality() : preferredQuality;
        var levels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels().join(',') : '';
        if (window.VyroBridge && window.VyroBridge.onPlayerReady) {
          window.VyroBridge.onPlayerReady(dur || 0, curQ || 'auto', levels || '');
        }
        player.playVideo();
      } catch (e) {}
      startProgressLoop();
    }

    function onPlayerStateChange(event) {
      var state = event.data;
      if (state === YT.PlayerState.PLAYING) {
        applyPreferredQuality();
        try {
          var levels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels().join(',') : '';
          var curQ = player.getPlaybackQuality ? player.getPlaybackQuality() : preferredQuality;
          if (window.VyroBridge && window.VyroBridge.onQualityChange) {
            window.VyroBridge.onQualityChange(curQ || 'auto', levels || '');
          }
        } catch (e) {}
      }
      if (window.VyroBridge && window.VyroBridge.onPlayerStateChange) {
        window.VyroBridge.onPlayerStateChange(state);
      }
    }

    function onPlaybackQualityChange(event) {
      try {
        var q = event.data || 'auto';
        var levels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels().join(',') : '';
        if (window.VyroBridge && window.VyroBridge.onQualityChange) {
          window.VyroBridge.onQualityChange(q, levels);
        }
      } catch (e) {}
    }

    function onPlayerError(event) {
      if (window.VyroBridge && window.VyroBridge.onPlayerError) {
        window.VyroBridge.onPlayerError(event.data || -1);
      }
    }

    function startProgressLoop() {
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = setInterval(function() {
        if (!player || typeof player.getCurrentTime !== 'function') return;
        try {
          var cur = player.getCurrentTime() || 0;
          var dur = player.getDuration() || 0;
          var loaded = player.getVideoLoadedFraction ? (player.getVideoLoadedFraction() || 0) : 0;
          if (window.VyroBridge && window.VyroBridge.onPlayerProgress) {
            window.VyroBridge.onPlayerProgress(cur, dur, loaded);
          }
        } catch (e) {}
      }, 1000);
    }

    window.vyroPlay = function() {
      if (player && player.playVideo) player.playVideo();
    };

    window.vyroPause = function() {
      if (player && player.pauseVideo) player.pauseVideo();
    };

    window.vyroSeekTo = function(sec) {
      if (player && player.seekTo) player.seekTo(sec, true);
    };

    window.vyroSetQuality = function(q) {
      preferredQuality = q;
      if (!player) return;
      try {
        if (q === 'auto') {
          if (typeof player.setPlaybackQualityRange === 'function') {
            player.setPlaybackQualityRange('small', 'hd2160');
          }
        } else {
          if (typeof player.setPlaybackQualityRange === 'function') {
            player.setPlaybackQualityRange(q, q);
          }
          if (typeof player.setPlaybackQuality === 'function') {
            player.setPlaybackQuality(q);
          }
        }
      } catch (e) {}
    };

    window.vyroSetCaptions = function(enabled, lang) {
      captionsActive = enabled;
      captionsLang = lang || 'en';
      if (!player) return;
      try {
        if (enabled) {
          player.loadModule('captions');
          player.setOption('captions', 'track', {'languageCode': captionsLang});
        } else {
          player.setOption('captions', 'track', {});
        }
      } catch (e) {}
    };

    window.vyroSetPlaybackRate = function(rate) {
      if (player && player.setPlaybackRate) {
        try { player.setPlaybackRate(rate); } catch (e) {}
      }
    };

    window.vyroSetMuted = function(muted) {
      if (!player) return;
      try {
        if (muted && player.mute) player.mute();
        else if (!muted && player.unMute) player.unMute();
      } catch (e) {}
    };

    window.vyroLoadVideo = function(videoId, startSec, q) {
      preferredQuality = q || preferredQuality;
      if (player && player.loadVideoById) {
        player.loadVideoById({
          'videoId': videoId,
          'startSeconds': startSec || 0,
          'suggestedQuality': preferredQuality
        });
        setTimeout(applyPreferredQuality, 600);
      }
    };
  </script>
</body>
</html>
    """.trimIndent()
}
