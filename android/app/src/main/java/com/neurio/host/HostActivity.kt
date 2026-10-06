package com.neurio.host

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.neurio.R
import com.neurio.app.PrefsStore
import com.neurio.common.PerfBus

/**
 * HOST MODE: pick an installed game, start the capture/encode pipeline in a
 * foreground service and watch the live session stats. The selected game is
 * launched on this device only - nothing about it is ever sent to the client.
 */
class HostActivity : AppCompatActivity() {

    private lateinit var detector: GameDetector
    private var games = listOf<GameInfo>()
    private var selected: GameInfo? = null

    private lateinit var rvGames: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var dashCard: LinearLayout
    private lateinit var gameCard: LinearLayout
    private lateinit var selIcon: ImageView
    private lateinit var selName: TextView
    private lateinit var selPkg: TextView
    private lateinit var tvPairCode: TextView
    private lateinit var tvState: TextView
    private lateinit var tvClient: TextView
    private lateinit var tvRes: TextView
    private lateinit var tvFps: TextView
    private lateinit var tvBitrate: TextView
    private lateinit var tvEncodeMs: TextView
    private lateinit var tvAudioNote: TextView
    private lateinit var tvInputStatus: TextView
    private lateinit var btnInputSettings: Button
    private lateinit var btnRegenCode: Button

    private val handler = Handler(Looper.getMainLooper())
    private var removePerfObserver: (() -> Unit)? = null

    private val permissionsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val denied = result.filterValues { !it }.keys
            if (denied.contains(Manifest.permission.RECORD_AUDIO)) {
                Toast.makeText(this, R.string.audio_perm_note, Toast.LENGTH_LONG).show()
            }
            requestProjectionConsent()
        }

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                startHostService(result.resultCode, result.data!!)
            } else {
                Toast.makeText(this, R.string.capture_denied, Toast.LENGTH_LONG).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_host)

        rvGames = findViewById(R.id.rvGames)
        emptyView = findViewById(R.id.tvEmptyGames)
        startButton = findViewById(R.id.btnStartStream)
        stopButton = findViewById(R.id.btnStopStream)
        dashCard = findViewById(R.id.cardDashboard)
        gameCard = findViewById(R.id.cardSelectedGame)
        selIcon = findViewById(R.id.ivGameIcon)
        selName = findViewById(R.id.tvGameName)
        selPkg = findViewById(R.id.tvGamePkg)
        tvPairCode = findViewById(R.id.tvPairCode)
        tvState = findViewById(R.id.tvHostState)
        tvClient = findViewById(R.id.tvStatClient)
        tvRes = findViewById(R.id.tvStatRes)
        tvFps = findViewById(R.id.tvStatFps)
        tvBitrate = findViewById(R.id.tvStatBitrate)
        tvEncodeMs = findViewById(R.id.tvStatEncode)
        tvAudioNote = findViewById(R.id.tvAudioNote)
        tvInputStatus = findViewById(R.id.tvInputStatus)
        btnInputSettings = findViewById(R.id.btnInputSettings)
        btnRegenCode = findViewById(R.id.btnRegenCode)

        detector = GameDetector(this)
        games = detector.detect()
        val adapter = GamesAdapter(games) { info -> selectGame(info) }
        rvGames.layoutManager = GridLayoutManager(this, 3)
        rvGames.adapter = adapter
        emptyView.visibility = if (games.isEmpty()) View.VISIBLE else View.GONE

        startButton.isEnabled = false
        startButton.setOnClickListener { prepareStreaming() }
        stopButton.setOnClickListener { stopStreaming() }
        btnInputSettings.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        btnRegenCode.setOnClickListener {
            HostStreamService.instance?.server?.regeneratePairingCode()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshInputStatus()
        attachToService()
        removePerfObserver = PerfBus.observe { snap ->
            handler.post {
                if (snap.active) {
                    tvRes.text = if (snap.width > 0) "${snap.width}×${snap.height}" else "…"
                    tvFps.text = getString(R.string.stat_fps, snap.fps)
                    tvBitrate.text = getString(R.string.stat_mbps, snap.bitrateMbps)
                    tvEncodeMs.text = if (snap.encodeMs >= 0)
                        getString(R.string.stat_ms, snap.encodeMs) else "…"
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        removePerfObserver?.invoke()
        removePerfObserver = null
        HostStreamService.instance?.uiListener = null
    }

    private fun selectGame(info: GameInfo) {
        selected = info
        gameCard.visibility = View.VISIBLE
        selName.text = info.displayTitle
        selPkg.text = info.packageName
        if (info.icon != null) selIcon.setImageDrawable(info.icon) else selIcon.setImageDrawable(null)
        startButton.isEnabled = true
    }

    // ------------------------------------------------------------------ start

    private fun prepareStreaming() {
        val game = selected ?: return
        if (HostStreamService.instance?.server?.running == true) {
            Toast.makeText(this, R.string.already_streaming, Toast.LENGTH_SHORT).show()
            return
        }
        if (!InputInjector.isEnabled(this)) {
            AlertDialog.Builder(this)
                .setTitle(R.string.input_service_title)
                .setMessage(R.string.input_service_body)
                .setPositiveButton(R.string.open_settings) { _, _ ->
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
                .setNegativeButton(R.string.continue_anyway) { _, _ -> requestRuntimePermissions(game) }
                .show()
        } else {
            requestRuntimePermissions(game)
        }
    }

    private fun requestRuntimePermissions(game: GameInfo) {
        val needed = ArrayList<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        pendingGame = game
        if (needed.isEmpty()) {
            requestProjectionConsent()
        } else {
            permissionsLauncher.launch(needed.toTypedArray())
        }
    }

    private var pendingGame: GameInfo? = null

    private fun requestProjectionConsent() {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        AlertDialog.Builder(this)
            .setTitle(R.string.capture_consent_title)
            .setMessage(getString(R.string.capture_consent_body, pendingGame?.displayTitle ?: ""))
            .setPositiveButton(R.string.start_capture) { _, _ ->
                projectionLauncher.launch(mpm.createScreenCaptureIntent())
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun startHostService(resultCode: Int, data: Intent) {
        val game = pendingGame ?: selected ?: return
        val prefs = PrefsStore(this)
        val cfg = prefs.streamConfigFromPrefs()

        val intent = Intent(this, HostStreamService::class.java).apply {
            putExtra(HostStreamService.EXTRA_RESULT_CODE, resultCode)
            putExtra(HostStreamService.EXTRA_RESULT_DATA, data)
            putExtra(HostStreamService.EXTRA_GAME_PKG, game.packageName)
            putExtra(HostStreamService.EXTRA_GAME_LABEL, game.displayTitle)
            putExtra(HostStreamService.EXTRA_TIER, cfg.tier.name)
            putExtra(HostStreamService.EXTRA_CODEC, cfg.codec.name)
            putExtra(HostStreamService.EXTRA_AUDIO, cfg.audioMode.name)
            putExtra(HostStreamService.EXTRA_MAX_BITRATE, cfg.maxBitrateKbps)
        }
        ContextCompat.startForegroundService(this, intent)
        handler.postDelayed({ attachToService() }, 600)
    }

    // ----------------------------------------------------------------- status

    private fun attachToService() {
        val service = HostStreamService.instance ?: return
        service.uiListener = object : StreamServer.Listener {
            override fun onPairingCode(code: String) {
                tvPairCode.text = code
            }

            override fun onClientPaired(name: String) {
                tvClient.text = name
                tvState.setText(R.string.state_paired)
            }

            override fun onClientLost(reason: String) {
                tvClient.setText(R.string.no_client)
                tvState.setText(R.string.state_waiting)
                tvAudioNote.visibility = View.GONE
            }

            override fun onStreamStarted(config: com.neurio.common.StreamConfig) {
                tvState.setText(R.string.state_streaming)
                dashCard.visibility = View.VISIBLE
                findViewById<LinearLayout>(R.id.cardPairRow).visibility = View.VISIBLE
            }

            override fun onStreamStopped(reason: String) {
                tvState.setText(R.string.state_waiting)
            }

            override fun onAudioStatus(mode: AudioCapture.Actual, silent: Boolean) {
                val text = when {
                    mode == AudioCapture.Actual.NONE -> getString(R.string.audio_note_none)
                    mode == AudioCapture.Actual.MIC -> getString(R.string.audio_note_mic)
                    silent -> getString(R.string.audio_note_silent)
                    else -> getString(R.string.audio_note_internal)
                }
                tvAudioNote.text = text
                tvAudioNote.visibility = View.VISIBLE
            }

            override fun onLog(message: String) {
                // The dashboard is intentionally calm; detailed logs go to logcat.
            }

            override fun onAdapted(config: com.neurio.common.StreamConfig) {
                Toast.makeText(
                    this@HostActivity,
                    getString(R.string.adapted_to, config.tier.label),
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        val server = service.server
        // Show the code that is already live (do not invalidate it on re-attach).
        tvPairCode.text = if (server.running) server.currentPairingCode else "······"
        if (server.streaming || server.running) {
            dashCard.visibility = View.VISIBLE
            tvState.setText(if (server.streaming) R.string.state_streaming else R.string.state_waiting)
        }
    }

    private fun refreshInputStatus() {
        val enabled = InputInjector.isEnabled(this)
        tvInputStatus.text = if (enabled)
            getString(R.string.input_ready) else getString(R.string.input_missing)
        btnInputSettings.visibility = if (enabled) View.GONE else View.VISIBLE
    }

    private fun stopStreaming() {
        HostStreamService.instance?.stopStream()
        tvState.setText(R.string.state_idle)
        dashCard.visibility = View.GONE
        findViewById<LinearLayout>(R.id.cardPairRow).visibility = View.GONE
    }
}

/** Grid cell: icon, name, badge. */
class GamesAdapter(
    private val items: List<GameInfo>,
    private val onPick: (GameInfo) -> Unit
) : RecyclerView.Adapter<GamesAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val icon: ImageView = view.findViewById(R.id.ivIcon)
        val name: TextView = view.findViewById(R.id.tvName)
        val badge: TextView = view.findViewById(R.id.tvBadge)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_game, parent, false)
        return Holder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val info = items[position]
        holder.name.text = info.displayTitle
        holder.badge.text = info.badge
        if (info.icon != null) holder.icon.setImageDrawable(info.icon)
        holder.itemView.setOnClickListener { onPick(info) }
    }
}
