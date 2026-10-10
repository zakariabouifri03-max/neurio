package com.neurio.aivibes.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.neurio.aivibes.MainActivity
import com.neurio.aivibes.audio.AiAudioProcessor
import com.neurio.aivibes.audio.AiRenderersFactory
import com.neurio.aivibes.audio.AudioEngine
import com.neurio.aivibes.audio.SystemEffects

/**
 * Background playback service. Media3 owns the media notification, lock-screen
 * controls, audio-focus handling and "audio becoming noisy" (headphone unplug)
 * pause behaviour — all from one well-tested framework surface.
 */
class MusicService : MediaSessionService() {

    private var mediaSession: MediaSession? = null
    private val systemEffects = SystemEffects()

    override fun onCreate() {
        super.onCreate()

        val processor = AiAudioProcessor(AudioEngine.chain, AudioEngine.analyzer)
        val player = ExoPlayer.Builder(this, AiRenderersFactory(this, processor))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        player.addListener(object : Player.Listener {
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                AudioEngine.onAudioSessionId(audioSessionId)
                if (audioSessionId != C.AUDIO_SESSION_ID_UNSET && audioSessionId > 0) {
                    systemEffects.attach(audioSessionId)
                }
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                AudioEngine.resetProcessingState()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying && AudioEngine.audioSessionId > 0) {
                    systemEffects.applyAssist(AudioEngine.config.value)
                }
            }
        })

        val sessionActivity = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .setId("ai_vibes_session")
            .build()

        // The session id is valid after the first track is prepared.
        if (Build.VERSION.SDK_INT >= 21) {
            val sid = player.audioSessionId
            if (sid != C.AUDIO_SESSION_ID_UNSET && sid > 0) AudioEngine.onAudioSessionId(sid)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        systemEffects.release()
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        super.onDestroy()
    }
}
