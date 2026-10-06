package com.neurio.lanstream

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import com.neurio.lanstream.client.LiveStreamActivity
import com.neurio.lanstream.core.DiscoveryScanner
import com.neurio.lanstream.host.GameLibrary
import com.neurio.lanstream.host.HostSessionService
import com.neurio.lanstream.model.HostAdvertisement
import com.neurio.lanstream.model.HostUiState
import com.neurio.lanstream.model.InstalledGame
import com.neurio.lanstream.model.LocalNetwork
import com.neurio.lanstream.ui.UiKit
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var pageId = "home"
    private var scanner: DiscoveryScanner? = null
    private var discoveredHosts: List<HostAdvertisement> = emptyList()
    private var installedGames: List<InstalledGame> = emptyList()
    private var selectedGame: InstalledGame? = null
    private var gameRows: LinearLayout? = null
    private var hostRows: LinearLayout? = null
    private var hostStatusValue: TextView? = null
    private var hostNetworkValue: TextView? = null
    private var hostStatsValue: TextView? = null
    private var hostCodeValue: TextView? = null
    private var hostDetailValue: TextView? = null
    private var audioPermissionForStart = false
    private var resolution = 720
    private var fps = 60
    private var bitrateLabel = "Medium"
    private var customBitrate = 6_000_000
    private var showControlsByDefault = true
    private var leftHandedControls = false
    private var controlsScale = "Normal"
    private var hostState = HostUiState()
    private var receiverRegistered = false

    private val hostStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != HostSessionService.ACTION_STATUS) return
            if (!intent.getBooleanExtra("running", false)) {
                hostState = hostState.copy(running = false, detail = intent.getStringExtra("detail") ?: "Host stopped")
            } else {
                hostState = HostUiState(
                    running = true,
                    gameName = intent.getStringExtra("game") ?: "",
                    localIp = intent.getStringExtra("ip") ?: "—",
                    pairingCode = intent.getStringExtra("code") ?: "------",
                    connectedPlayer = intent.getStringExtra("player") ?: "Waiting for player",
                    fps = intent.getFloatExtra("fps", 0f).toDouble(),
                    pingMs = intent.getLongExtra("ping", -1L),
                    bitrateMbps = intent.getFloatExtra("bitrate", 0f).toDouble(),
                    packetLossPercent = intent.getFloatExtra("loss", 0f).toDouble(),
                    audioStatus = intent.getStringExtra("audio") ?: "Checking…",
                    detail = intent.getStringExtra("detail") ?: "",
                )
            }
            refreshHostStatusViews()
            if (pageId == "host" && hostRows == null && !hostState.running) showHostPage()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = UiKit.BG
        window.navigationBarColor = UiKit.BG
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        loadPreferences()
        readPersistedHostState()
        showHome()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    @Suppress("DEPRECATION")
    override fun onStart() {
        super.onStart()
        if (!receiverRegistered) {
            val filter = IntentFilter(HostSessionService.ACTION_STATUS)
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(hostStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(hostStatusReceiver, filter)
            }
            receiverRegistered = true
        }
    }

    override fun onResume() {
        super.onResume()
        readPersistedHostState()
        refreshHostStatusViews()
        if (pageId == "join") startScanner()
    }

    override fun onStop() {
        stopScanner()
        if (receiverRegistered) {
            try { unregisterReceiver(hostStatusReceiver) } catch (_: Exception) { }
            receiverRegistered = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        stopScanner()
        worker.shutdownNow()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (hostState.running) showHostPage()
    }

    private fun loadPreferences() {
        val settings = getSharedPreferences("stream_settings", MODE_PRIVATE)
        resolution = settings.getInt("resolution", 720).coerceIn(480, 1080)
        if (resolution !in setOf(480, 720, 1080)) resolution = 720
        fps = settings.getInt("fps", 60).let { if (it == 30) 30 else 60 }
        bitrateLabel = settings.getString("bitrate_label", "Medium") ?: "Medium"
        customBitrate = settings.getInt("custom_bitrate", 6_000_000).coerceIn(750_000, 24_000_000)
        showControlsByDefault = settings.getBoolean("show_controls", true)
        leftHandedControls = settings.getBoolean("left_handed", false)
        controlsScale = settings.getString("controls_scale", "Normal") ?: "Normal"
    }

    private fun savePreferences() {
        getSharedPreferences("stream_settings", MODE_PRIVATE).edit()
            .putInt("resolution", resolution)
            .putInt("fps", fps)
            .putString("bitrate_label", bitrateLabel)
            .putInt("custom_bitrate", customBitrate)
            .putBoolean("show_controls", showControlsByDefault)
            .putBoolean("left_handed", leftHandedControls)
            .putString("controls_scale", controlsScale)
            .apply()
    }

    private fun readPersistedHostState() {
        val p = getSharedPreferences(HostSessionService.PREFS, MODE_PRIVATE)
        hostState = HostUiState(
            running = p.getBoolean("running", false),
            gameName = p.getString("game", "") ?: "",
            localIp = p.getString("ip", "—") ?: "—",
            pairingCode = p.getString("code", "------") ?: "------",
            connectedPlayer = p.getString("player", "Waiting for player") ?: "Waiting for player",
            fps = p.getFloat("fps", 0f).toDouble(),
            pingMs = p.getLong("ping", -1L),
            bitrateMbps = p.getFloat("bitrate", 0f).toDouble(),
            packetLossPercent = p.getFloat("loss", 0f).toDouble(),
            audioStatus = p.getString("audio", "Not started") ?: "Not started",
            detail = p.getString("detail", "") ?: "",
        )
    }

    private fun page(title: String, subtitle: String, id: String, home: Boolean = false): LinearLayout {
        pageId = id
        gameRows = null
        hostRows = null
        hostStatusValue = null
        hostNetworkValue = null
        hostStatsValue = null
        hostCodeValue = null
        hostDetailValue = null
        val frame = FrameLayout(this).apply { setBackgroundColor(UiKit.BG) }
        val scroll = ScrollView(this).apply { clipToPadding = false; isFillViewport = true }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(UiKit.dp(this@MainActivity, 22f), UiKit.dp(this@MainActivity, 18f), UiKit.dp(this@MainActivity, 22f), UiKit.dp(this@MainActivity, 34f))
        }
        if (home) {
            val brandRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val icon = ImageView(this).apply { setImageResource(R.drawable.ic_neurio) }
            brandRow.addView(icon, LinearLayout.LayoutParams(UiKit.dp(this, 42f), UiKit.dp(this, 42f)))
            val brand = UiKit.text(this, "NEURIO", 16f, UiKit.WHITE, true)
            brand.letterSpacing = .16f
            val nameBlock = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(UiKit.dp(this@MainActivity, 12f), 0, 0, 0) }
            nameBlock.addView(brand)
            nameBlock.addView(UiKit.text(this, "LOCAL GAME LINK", 9f, UiKit.CYAN, true))
            brandRow.addView(nameBlock)
            brandRow.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            brandRow.addView(UiKit.smallPill(this, "LAN ONLY", UiKit.GREEN))
            column.addView(brandRow)
            UiKit.addSpace(this, column, 34)
        } else {
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val back = UiKit.text(this, "‹   BACK", 13f, UiKit.CYAN, true).apply {
                setPadding(0, UiKit.dp(this@MainActivity, 8f), UiKit.dp(this@MainActivity, 20f), UiKit.dp(this@MainActivity, 8f))
                setOnClickListener { stopScanner(); showHome() }
            }
            top.addView(back)
            top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            top.addView(UiKit.smallPill(this, "PHONE-TO-PHONE", UiKit.PURPLE))
            column.addView(top)
            UiKit.addSpace(this, column, 23)
        }
        if (title.isNotBlank()) {
            val eyebrow = UiKit.text(this, if (home) "REAL-TIME PLAY OVER WI-FI" else "NEURIO  /  ${id.uppercase()}", 10f, UiKit.CYAN, true)
            eyebrow.letterSpacing = .12f
            column.addView(eyebrow)
            UiKit.addSpace(this, column, 7)
            val heading = UiKit.text(this, title, if (home) 34f else 29f, UiKit.WHITE, true)
            heading.letterSpacing = -.02f
            column.addView(heading)
            UiKit.addSpace(this, column, 8)
            column.addView(UiKit.text(this, subtitle, 14f, UiKit.MUTED))
            UiKit.addSpace(this, column, 22)
        }
        scroll.addView(column)
        frame.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(frame)
        return column
    }

    private fun showHome() {
        stopScanner()
        val column = page(
            title = "LAN GAME\nSTREAM",
            subtitle = "Phone 2 runs the game locally. Phone 1 receives the live play session — no game download, APK, or cloud server.",
            id = "home",
            home = true,
        )
        val hero = UiKit.card(this, 20, alternate = true)
        hero.addView(UiKit.smallPill(this, "DIRECT WI-FI · HARDWARE VIDEO", UiKit.CYAN))
        UiKit.addSpace(this, hero, 14)
        hero.addView(UiKit.text(this, "Your game stays on the host phone.", 19f, UiKit.WHITE, true))
        UiKit.addSpace(this, hero, 7)
        hero.addView(UiKit.text(this, "Live H.264 stream + encrypted input channel. The client never receives installation files.", 13f, UiKit.MUTED))
        column.addView(hero)
        UiKit.addSpace(this, column, 18)
        val hostButton = UiKit.primaryButton(this, "▣     HOST GAME     ·     PHONE 2") { showHostPage() }
        column.addView(hostButton, fullWidth())
        UiKit.addSpace(this, column, 11)
        val joinButton = UiKit.secondaryButton(this, "⌕     JOIN GAME     ·     PHONE 1") { showJoinPage() }
        column.addView(joinButton, fullWidth())
        UiKit.addSpace(this, column, 11)
        val utilityRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        utilityRow.addView(UiKit.secondaryButton(this, "SETTINGS") { showSettingsPage() }, LinearLayout.LayoutParams(0, UiKit.dp(this, 50f), 1f))
        utilityRow.addView(View(this), LinearLayout.LayoutParams(UiKit.dp(this, 10f), 1))
        utilityRow.addView(UiKit.secondaryButton(this, "ABOUT") { showAboutPage() }, LinearLayout.LayoutParams(0, UiKit.dp(this, 50f), 1f))
        column.addView(utilityRow, fullWidth())
        UiKit.addSpace(this, column, 22)
        column.addView(UiKit.text(this, "SAME APP ON BOTH PHONES  ·  SAME WI-FI OR HOTSPOT", 10f, UiKit.MUTED, true).apply { gravity = Gravity.CENTER })
        if (hostState.running) {
            UiKit.addSpace(this, column, 16)
            val active = UiKit.card(this, 16)
            active.addView(UiKit.text(this, "HOST STREAM ACTIVE", 12f, UiKit.GREEN, true))
            UiKit.addSpace(this, active, 4)
            active.addView(UiKit.text(this, "${hostState.gameName} · code ${hostState.pairingCode}", 14f, UiKit.WHITE, true))
            active.setOnClickListener { showHostPage() }
            column.addView(active, fullWidth())
        }
    }

    private fun showHostPage() {
        if (hostState.running) {
            renderHostStatusPage()
            return
        }
        stopScanner()
        val column = page(
            "HOST GAME",
            "Choose an app installed on this phone. Android will launch it normally while Neurio captures the display.",
            "host",
        )
        val note = UiKit.card(this, 16, alternate = true)
        note.addView(UiKit.text(this, "PHONE 2 · GAME HOST", 11f, UiKit.CYAN, true))
        UiKit.addSpace(this, note, 6)
        note.addView(UiKit.text(this, "The game runs here. Its APK, OBB, save data, and assets stay on this phone.", 13f, UiKit.MUTED))
        column.addView(note)
        UiKit.addSpace(this, column, 20)
        column.addView(UiKit.text(this, "GAME LIBRARY", 12f, UiKit.WHITE, true))
        UiKit.addSpace(this, column, 5)
        column.addView(UiKit.text(this, "Launchable apps on Phone 2 · game-category apps are listed first", 12f, UiKit.MUTED))
        UiKit.addSpace(this, column, 11)
        gameRows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(gameRows!!, fullWidth())
        renderGameRows()

        UiKit.addSpace(this, column, 17)
        val quality = UiKit.card(this, 18)
        quality.addView(UiKit.text(this, "STREAM QUALITY", 12f, UiKit.WHITE, true))
        UiKit.addSpace(this, quality, 10)
        addChoiceRow(quality, "Resolution cap", listOf("480p", "720p", "1080p"), "${resolution}p") { value ->
            resolution = value.removeSuffix("p").toInt()
            savePreferences()
        }
        UiKit.addSpace(this, quality, 10)
        addChoiceRow(quality, "Frame rate", listOf("30 FPS", "60 FPS"), "$fps FPS") { value ->
            fps = if (value.startsWith("30")) 30 else 60
            savePreferences()
        }
        UiKit.addSpace(this, quality, 10)
        addChoiceRow(quality, "Bitrate", listOf("Low", "Medium", "High", "Custom"), bitrateLabel) { value ->
            bitrateLabel = value
            savePreferences()
            if (value == "Custom") showCustomBitrateDialog()
            refreshHostQualityLabel()
        }
        column.addView(quality, fullWidth())
        UiKit.addSpace(this, column, 14)
        val selected = selectedGame?.label ?: "No game selected"
        column.addView(UiKit.text(this, "Selected: $selected", 12f, if (selectedGame == null) UiKit.MUTED else UiKit.GREEN, true))
        UiKit.addSpace(this, column, 12)
        val start = UiKit.primaryButton(this, "▶     START STREAM") { beginHostFlow() }
        column.addView(start, fullWidth())
        UiKit.addSpace(this, column, 12)
        column.addView(UiKit.text(this, "For protected or anti-cheat titles, Android may block screen capture or accessibility touch injection. Video capture requires your one-time MediaProjection approval.", 11f, UiKit.MUTED))
        loadAppsAsync()
    }

    private fun renderHostStatusPage() {
        stopScanner()
        val column = page("HOST GAME", "Phone 2 is running the selected game locally and streaming over your LAN.", "host")
        val liveCard = UiKit.card(this, 20, alternate = true)
        liveCard.addView(UiKit.smallPill(this, "●  STREAM ACTIVE", UiKit.GREEN))
        UiKit.addSpace(this, liveCard, 12)
        liveCard.addView(UiKit.text(this, hostState.gameName.ifBlank { "Host session" }, 20f, UiKit.WHITE, true))
        UiKit.addSpace(this, liveCard, 4)
        liveCard.addView(UiKit.text(this, "The actual game stays on Phone 2. No client-side game files are sent.", 12f, UiKit.MUTED))
        UiKit.addSpace(this, liveCard, 16)
        liveCard.addView(UiKit.text(this, "PAIRING CODE", 10f, UiKit.CYAN, true))
        hostCodeValue = UiKit.text(this, hostState.pairingCode, 35f, UiKit.WHITE, true).apply { letterSpacing = .22f }
        liveCard.addView(hostCodeValue!!)
        UiKit.addSpace(this, liveCard, 13)
        hostStatusValue = UiKit.text(this, hostState.connectedPlayer, 13f, UiKit.GREEN, true)
        liveCard.addView(hostStatusValue!!)
        UiKit.addSpace(this, liveCard, 14)
        val networkTitle = UiKit.text(this, "LOCAL NETWORK", 10f, UiKit.CYAN, true)
        liveCard.addView(networkTitle)
        hostNetworkValue = UiKit.text(this, "${hostState.localIp} · TCP ${com.neurio.lanstream.protocol.LanProtocol.TCP_PORT} / UDP ${com.neurio.lanstream.protocol.LanProtocol.VIDEO_PORT}", 12f, UiKit.WHITE)
        liveCard.addView(hostNetworkValue!!)
        UiKit.addSpace(this, liveCard, 12)
        hostStatsValue = UiKit.text(this, statsText(hostState), 13f, UiKit.WHITE, true)
        liveCard.addView(hostStatsValue!!)
        UiKit.addSpace(this, liveCard, 11)
        liveCard.addView(UiKit.text(this, "Audio: ${hostState.audioStatus}", 11f, UiKit.MUTED))
        column.addView(liveCard, fullWidth())
        UiKit.addSpace(this, column, 12)
        hostDetailValue = UiKit.text(this, hostState.detail, 12f, UiKit.MUTED)
        column.addView(hostDetailValue!!)
        UiKit.addSpace(this, column, 15)
        val accessibility = UiKit.secondaryButton(this, "OPTIONAL INPUT SETUP  ·  ACCESSIBILITY") {
            AlertDialog.Builder(this)
                .setTitle("Optional host-side touch input")
                .setMessage("Stock Android does not let a normal app inject arbitrary taps into other apps. To try remote touches, manually enable “Neurio remote touch input” in Accessibility settings on Phone 2. Gestures may still be rejected by protected/anti-cheat games. Video streaming works without this adapter.")
                .setNegativeButton("Not now", null)
                .setPositiveButton("Open settings") { _, _ -> startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                .show()
        }
        column.addView(accessibility, fullWidth())
        UiKit.addSpace(this, column, 10)
        column.addView(UiKit.primaryButton(this, "■     STOP STREAM") { stopHost() }, fullWidth())
        UiKit.addSpace(this, column, 10)
        column.addView(UiKit.text(this, "Use the notification Stop action if Neurio is behind the running game.", 11f, UiKit.MUTED))
    }

    private fun refreshHostStatusViews() {
        if (pageId != "host" || hostRows != null) return
        hostCodeValue?.text = hostState.pairingCode
        hostStatusValue?.text = hostState.connectedPlayer
        hostStatusValue?.setTextColor(if (hostState.connectedPlayer == "Waiting for player") UiKit.MUTED else UiKit.GREEN)
        hostNetworkValue?.text = "${hostState.localIp} · TCP ${com.neurio.lanstream.protocol.LanProtocol.TCP_PORT} / UDP ${com.neurio.lanstream.protocol.LanProtocol.VIDEO_PORT}"
        hostStatsValue?.text = statsText(hostState)
        hostDetailValue?.text = hostState.detail
        if (!hostState.running && pageId == "host") {
            hostRows = null
            hostStatusValue = null
            hostNetworkValue = null
            hostStatsValue = null
            hostCodeValue = null
            hostDetailValue = null
            showHostPage()
        } else if (hostState.running && hostStatusValue == null && pageId == "host") {
            renderHostStatusPage()
        }
    }

    private fun statsText(state: HostUiState): String {
        val ping = if (state.pingMs >= 0) "${state.pingMs} ms" else "—"
        val bitrate = if (state.bitrateMbps > 0) String.format("%.1f Mbps", state.bitrateMbps) else "Waiting"
        val fpsText = if (state.fps > 0) String.format("%.0f FPS", state.fps) else "— FPS"
        return "$fpsText     ·     Ping $ping     ·     $bitrate     ·     Loss ${String.format("%.1f", state.packetLossPercent)}%"
    }

    private fun renderGameRows() {
        val target = gameRows ?: return
        target.removeAllViews()
        if (installedGames.isEmpty()) {
            val loading = UiKit.card(this, 16)
            loading.addView(UiKit.text(this, "Scanning launchable apps…", 13f, UiKit.MUTED))
            target.addView(loading, fullWidth())
            return
        }
        installedGames.take(80).forEach { game ->
            val chosen = selectedGame?.packageName == game.packageName
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(UiKit.dp(this@MainActivity, 13f), UiKit.dp(this@MainActivity, 10f), UiKit.dp(this@MainActivity, 13f), UiKit.dp(this@MainActivity, 10f))
                background = UiKit.rounded(if (chosen) 0xFF172D3B.toInt() else UiKit.CARD, UiKit.dp(this@MainActivity, 17f), if (chosen) UiKit.CYAN else 0xFF26364D.toInt(), UiKit.dp(this@MainActivity, if (chosen) 1.5f else 1f))
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    selectedGame = game
                    renderGameRows()
                    if (pageId == "host") showHostPage() else Unit
                }
            }
            val icon = ImageView(this).apply {
                try { setImageDrawable(packageManager.getApplicationIcon(game.packageName)) } catch (_: Exception) { setImageResource(R.drawable.ic_neurio) }
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            row.addView(icon, LinearLayout.LayoutParams(UiKit.dp(this, 48f), UiKit.dp(this, 48f)))
            val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(UiKit.dp(this@MainActivity, 12f), 0, 0, 0) }
            info.addView(UiKit.text(this, game.label, 14f, UiKit.WHITE, true).apply { maxLines = 1 })
            UiKit.addSpace(this, info, 3)
            info.addView(UiKit.text(this, if (game.isGame) "GAME · ${game.packageName}" else "APP · ${game.packageName}", 10f, if (game.isGame) UiKit.CYAN else UiKit.MUTED))
            row.addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (chosen) row.addView(UiKit.text(this, "✓", 20f, UiKit.GREEN, true))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = UiKit.dp(this, 8f)
            target.addView(row, lp)
        }
    }

    private fun loadAppsAsync() {
        if (installedGames.isNotEmpty() || worker.isShutdown) return
        worker.execute {
            val loaded = GameLibrary.loadLaunchableApps(this)
            runOnUiThread {
                if (pageId != "host" || hostState.running) return@runOnUiThread
                installedGames = loaded
                renderGameRows()
                if (loaded.isEmpty()) {
                    gameRows?.removeAllViews()
                    val empty = UiKit.card(this, 16)
                    empty.addView(UiKit.text(this, "No launchable apps found. Install a game on Phone 2, then reopen the library.", 13f, UiKit.MUTED))
                    gameRows?.addView(empty, fullWidth())
                }
            }
        }
    }

    private fun showJoinPage() {
        stopScanner()
        discoveredHosts = emptyList()
        val column = page(
            "JOIN GAME",
            "Discover a host on your local Wi-Fi. Pair directly with Phone 2 using its short code.",
            "join",
        )
        val info = UiKit.card(this, 15, alternate = true)
        info.addView(UiKit.text(this, "PHONE 1 · PLAYER / CLIENT", 11f, UiKit.PURPLE, true))
        UiKit.addSpace(this, info, 5)
        info.addView(UiKit.text(this, "The game stays on the host. This phone receives live encoded audio/video only; it never downloads the game.", 12f, UiKit.MUTED))
        column.addView(info)
        UiKit.addSpace(this, column, 18)
        val status = UiKit.text(this, "●  SEARCHING THIS WI-FI NETWORK…", 11f, UiKit.CYAN, true)
        column.addView(status)
        UiKit.addSpace(this, column, 10)
        hostRows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(hostRows!!, fullWidth())
        val footer = UiKit.text(this, "If no host appears, put both phones on the same 5 GHz Wi-Fi or create a hotspot. Guest Wi-Fi may block device-to-device traffic.", 11f, UiKit.MUTED)
        UiKit.addSpace(this, column, 12)
        column.addView(footer)
        renderHostCards()
        startScanner()
    }

    private fun startScanner() {
        if (pageId != "join" || scanner != null) return
        scanner = DiscoveryScanner(
            context = this,
            onHostsChanged = { hosts -> runOnUiThread { discoveredHosts = hosts; renderHostCards() } },
            onError = { message -> runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() } },
        ).also { it.start() }
    }

    private fun stopScanner() {
        scanner?.close()
        scanner = null
    }

    private fun renderHostCards() {
        val target = hostRows ?: return
        target.removeAllViews()
        if (discoveredHosts.isEmpty()) {
            val empty = UiKit.card(this, 18)
            empty.addView(UiKit.text(this, "No host found yet", 16f, UiKit.WHITE, true))
            UiKit.addSpace(this, empty, 5)
            empty.addView(UiKit.text(this, "Keep this screen open. Neurio sends a small local discovery broadcast every second.", 12f, UiKit.MUTED))
            target.addView(empty, fullWidth())
            return
        }
        discoveredHosts.forEach { host ->
            val card = UiKit.card(this, 16)
            val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val labels = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            labels.addView(UiKit.text(this, host.deviceName, 16f, UiKit.WHITE, true))
            UiKit.addSpace(this, labels, 3)
            labels.addView(UiKit.text(this, "${host.address}  ·  ${host.gameName}", 11f, UiKit.MUTED))
            header.addView(labels, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            header.addView(UiKit.smallPill(this, if (host.pingMs >= 0) "${host.pingMs} ms" else "PING…", if (host.pingMs < 40) UiKit.GREEN else UiKit.CYAN))
            card.addView(header)
            UiKit.addSpace(this, card, 13)
            card.addView(UiKit.primaryButton(this, "CONNECT  ·  ENTER HOST CODE") { promptPairingCode(host) }, fullWidth())
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = UiKit.dp(this, 10f)
            target.addView(card, lp)
        }
    }

    private fun promptPairingCode(host: HostAdvertisement) {
        val input = EditText(this).apply {
            hint = "6-digit code from Phone 2"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            filters = arrayOf(InputFilter.LengthFilter(6))
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(UiKit.WHITE)
            setHintTextColor(UiKit.MUTED)
            background = UiKit.rounded(UiKit.CARD_ALT, UiKit.dp(this@MainActivity, 14f), 0xFF435977.toInt(), UiKit.dp(this@MainActivity, 1f))
            setPadding(UiKit.dp(this@MainActivity, 12f), UiKit.dp(this@MainActivity, 12f), UiKit.dp(this@MainActivity, 12f), UiKit.dp(this@MainActivity, 12f))
        }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(UiKit.dp(this@MainActivity, 22f), UiKit.dp(this@MainActivity, 8f), UiKit.dp(this@MainActivity, 22f), 0) }
        box.addView(UiKit.text(this, "Pair with ${host.deviceName} on ${host.address}. The code is shown only on Phone 2.", 13f, UiKit.MUTED))
        UiKit.addSpace(this, box, 12)
        box.addView(input, fullWidth())
        val dialog = AlertDialog.Builder(this)
            .setTitle("Secure local pairing")
            .setView(box)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Connect", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val code = input.text?.toString().orEmpty()
                if (!code.matches(Regex("\\d{6}"))) {
                    input.error = "Enter all 6 digits"
                    return@setOnClickListener
                }
                dialog.dismiss()
                stopScanner()
                val launch = Intent(this, LiveStreamActivity::class.java).apply {
                    putExtra(LiveStreamActivity.EXTRA_HOST_IP, host.address)
                    putExtra(LiveStreamActivity.EXTRA_HOST_NAME, host.deviceName)
                    putExtra(LiveStreamActivity.EXTRA_GAME_NAME, host.gameName)
                    putExtra(LiveStreamActivity.EXTRA_SESSION_ID, host.sessionId)
                    putExtra(LiveStreamActivity.EXTRA_TCP_PORT, host.tcpPort)
                    putExtra(LiveStreamActivity.EXTRA_PAIRING_CODE, code)
                    putExtra(LiveStreamActivity.EXTRA_SHOW_CONTROLS, showControlsByDefault)
                    putExtra(LiveStreamActivity.EXTRA_LEFT_HANDED, leftHandedControls)
                    putExtra(LiveStreamActivity.EXTRA_CONTROL_SCALE, scaleValue())
                }
                startActivity(launch)
            }
        }
        dialog.show()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        input.requestFocus()
    }

    private fun showSettingsPage() {
        val column = page("SETTINGS", "Tune the host encoder and Phone 1's local control overlay.", "settings")
        val quality = UiKit.card(this, 18)
        quality.addView(UiKit.text(this, "HOST STREAM", 12f, UiKit.CYAN, true))
        UiKit.addSpace(this, quality, 10)
        addChoiceRow(quality, "Resolution cap", listOf("480p", "720p", "1080p"), "${resolution}p") { value -> resolution = value.removeSuffix("p").toInt(); savePreferences() }
        UiKit.addSpace(this, quality, 11)
        addChoiceRow(quality, "Frame rate", listOf("30 FPS", "60 FPS"), "$fps FPS") { value -> fps = if (value.startsWith("30")) 30 else 60; savePreferences() }
        UiKit.addSpace(this, quality, 11)
        addChoiceRow(quality, "Bitrate", listOf("Low", "Medium", "High", "Custom"), bitrateLabel) { value ->
            bitrateLabel = value
            savePreferences()
            if (value == "Custom") showCustomBitrateDialog()
        }
        UiKit.addSpace(this, quality, 10)
        quality.addView(UiKit.text(this, "Hardware H.264 is preferred when Android exposes a compatible encoder. Unstable Wi-Fi lowers bitrate automatically; reduce resolution/FPS here before starting for more headroom.", 11f, UiKit.MUTED))
        column.addView(quality, fullWidth())
        UiKit.addSpace(this, column, 14)

        val controls = UiKit.card(this, 18)
        controls.addView(UiKit.text(this, "PHONE 1 CONTROLS", 12f, UiKit.PURPLE, true))
        UiKit.addSpace(this, controls, 7)
        controls.addView(settingsSwitch("Show virtual controls by default", "Tap the stream to reveal controls when hidden.", showControlsByDefault) { checked -> showControlsByDefault = checked; savePreferences() })
        UiKit.addSpace(this, controls, 10)
        controls.addView(settingsSwitch("Left-handed layout", "Mirror the on-screen stick and face-button cluster.", leftHandedControls) { checked -> leftHandedControls = checked; savePreferences() })
        UiKit.addSpace(this, controls, 11)
        addChoiceRow(controls, "Control size", listOf("Compact", "Normal", "Large"), controlsScale) { value -> controlsScale = value; savePreferences() }
        UiKit.addSpace(this, controls, 11)
        controls.addView(UiKit.text(this, "Bluetooth gamepads connected to Phone 1 are forwarded as mapped touch zones where possible. Generic touch mapping is game-dependent.", 11f, UiKit.MUTED))
        column.addView(controls, fullWidth())
        UiKit.addSpace(this, column, 14)

        val platform = UiKit.card(this, 18)
        platform.addView(UiKit.text(this, "ANDROID LIMITS", 12f, UiKit.WHITE, true))
        UiKit.addSpace(this, platform, 7)
        platform.addView(UiKit.text(this, "Remote input on Phone 2 is optional and requires the user to manually enable Neurio's Accessibility gesture adapter. Android may deny it in protected or anti-cheat games. Internal game audio is best-effort (Android 10+ and game policy permitting).", 12f, UiKit.MUTED))
        column.addView(platform, fullWidth())
        UiKit.addSpace(this, column, 16)
        column.addView(UiKit.secondaryButton(this, "OPEN ACCESSIBILITY SETTINGS ON THIS PHONE") {
            startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }, fullWidth())
    }

    private fun settingsSwitch(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(UiKit.text(this, title, 13f, UiKit.WHITE, true))
        UiKit.addSpace(this, copy, 2)
        copy.addView(UiKit.text(this, description, 10f, UiKit.MUTED))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val toggle = Switch(this).apply {
            isChecked = checked
            setOnCheckedChangeListener { _, value -> onChange(value) }
            thumbTintList = android.content.res.ColorStateList.valueOf(UiKit.CYAN)
            trackTintList = android.content.res.ColorStateList.valueOf(0xFF34465D.toInt())
        }
        row.addView(toggle)
        return row
    }

    private fun showAboutPage() {
        val column = page("ABOUT NEURIO", "A direct phone-to-phone game streaming prototype. No cloud gaming service and no file transfer.", "about")
        val cards = listOf(
            "PHONE 2 · HOST" to "Select an installed launchable app. Android launches it locally. MediaProjection captures the live display; MediaCodec encodes H.264; LAN discovery advertises only session metadata.",
            "PHONE 1 · CLIENT" to "Pairs using a short code, derives an ephemeral ECDH session key, decrypts H.264/AAC UDP fragments, hardware-decodes video to a SurfaceView, and sends touch/controller events over an authenticated control channel.",
            "NO GAME DOWNLOAD" to "The protocol contains only compressed live media and small control messages. It has no APK, OBB, app-data, cloud upload, or game-installation route.",
            "HONEST PLATFORM LIMITS" to "MediaProjection requires user consent and a foreground service. Internal audio capture needs Android 10+, RECORD_AUDIO permission, and a game that permits playback capture. Arbitrary third-party touch injection is not available to ordinary apps; optional Accessibility gestures are user-enabled and may be blocked.",
            "LOCAL SECURITY" to "Pairing uses a one-time six-digit code with ECDH key agreement and AES-GCM-protected control/media packets. The host rate-limits failed code attempts and accepts one player at a time. Keep both phones on a trusted LAN.",
        )
        cards.forEach { (title, body) ->
            val card = UiKit.card(this, 17)
            card.addView(UiKit.text(this, title, 13f, UiKit.CYAN, true))
            UiKit.addSpace(this, card, 6)
            card.addView(UiKit.text(this, body, 12f, UiKit.MUTED))
            column.addView(card, fullWidth())
            UiKit.addSpace(this, column, 10)
        }
        column.addView(UiKit.text(this, "This repository also includes the original Bash Baqi Racing browser game. Neurio LAN Stream is a separate native Android Studio project in /android.", 11f, UiKit.MUTED))
    }

    private fun beginHostFlow() {
        val game = selectedGame
        if (game == null) {
            Toast.makeText(this, "Select an installed app first", Toast.LENGTH_SHORT).show()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            AlertDialog.Builder(this)
                .setTitle("Optional game audio")
                .setMessage("Android may capture internal game playback on Android 10+ if the game allows it. Audio is optional; the live video stream works if you skip or deny this permission.")
                .setNegativeButton("Video only") { _, _ -> audioPermissionForStart = false; requestProjectionPermission() }
                .setPositiveButton("Allow audio capture") { _, _ -> requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_AUDIO) }
                .show()
        } else {
            audioPermissionForStart = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            requestProjectionPermission()
        }
    }

    private fun requestProjectionPermission() {
        try {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_PROJECTION)
        } catch (e: Exception) {
            AlertDialog.Builder(this).setTitle("Screen capture unavailable").setMessage(e.message ?: "Android could not open the MediaProjection prompt.").setPositiveButton("OK", null).show()
        }
    }

    @Deprecated("Android MediaProjection consent result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_PROJECTION) return
        if (resultCode != RESULT_OK || data == null) {
            Toast.makeText(this, "Screen capture permission is required to host", Toast.LENGTH_LONG).show()
            return
        }
        val game = selectedGame ?: return
        val serviceIntent = Intent(this, HostSessionService::class.java).apply {
            action = HostSessionService.ACTION_START
            putExtra(HostSessionService.EXTRA_RESULT_CODE, resultCode)
            putExtra(HostSessionService.EXTRA_PROJECTION_DATA, data)
            putExtra(HostSessionService.EXTRA_GAME_NAME, game.label)
            putExtra(HostSessionService.EXTRA_GAME_PACKAGE, game.packageName)
            putExtra(HostSessionService.EXTRA_RESOLUTION, resolution)
            putExtra(HostSessionService.EXTRA_FPS, fps)
            putExtra(HostSessionService.EXTRA_BITRATE, bitrateForSelection())
            putExtra(HostSessionService.EXTRA_BITRATE_LABEL, bitrateLabel)
            putExtra(HostSessionService.EXTRA_AUDIO_GRANTED, audioPermissionForStart)
        }
        hostState = HostUiState(running = true, gameName = game.label, localIp = LocalNetwork.bestIpv4Address(), detail = "Starting stream…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent) else startService(serviceIntent)
        renderHostStatusPage()
        mainHandler.postDelayed({
            try {
                val launch = packageManager.getLaunchIntentForPackage(game.packageName)
                if (launch == null) {
                    Toast.makeText(this, "Android could not launch ${game.label}", Toast.LENGTH_LONG).show()
                    stopHost()
                } else {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
                    startActivity(launch)
                }
            } catch (e: Exception) {
                Toast.makeText(this, "Could not launch game: ${e.message ?: "app unavailable"}", Toast.LENGTH_LONG).show()
                stopHost()
            }
        }, 350)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQUEST_AUDIO -> {
                audioPermissionForStart = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
                if (!audioPermissionForStart) Toast.makeText(this, "Continuing with video only; Android did not grant audio capture", Toast.LENGTH_LONG).show()
                requestProjectionPermission()
            }
            REQUEST_NOTIFICATIONS -> Unit // Stream is still foreground; Android may hide its notification if denied.
        }
    }

    private fun stopHost() {
        try { startService(Intent(this, HostSessionService::class.java).setAction(HostSessionService.ACTION_STOP)) } catch (_: Exception) { }
        hostState = HostUiState(running = false, detail = "Host stopped")
        mainHandler.postDelayed({ if (pageId == "host") showHostPage() }, 150)
    }

    private fun addChoiceRow(parent: LinearLayout, title: String, choices: List<String>, selected: String, onSelected: (String) -> Unit) {
        parent.addView(UiKit.text(this, title, 11f, UiKit.MUTED, true))
        UiKit.addSpace(this, parent, 6)
        val horizontalScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val chips = LinkedHashMap<String, TextView>()
        var current = selected
        fun style(chip: TextView, active: Boolean) {
            chip.setTextColor(if (active) UiKit.BG else UiKit.WHITE)
            chip.background = UiKit.rounded(if (active) UiKit.CYAN else UiKit.CARD_ALT, UiKit.dp(this@MainActivity, 24f), if (active) UiKit.CYAN else 0xFF34465D.toInt(), UiKit.dp(this@MainActivity, 1f))
        }
        choices.forEach { choice ->
            val chip = UiKit.text(this, choice, 11f, UiKit.WHITE, true).apply {
                gravity = Gravity.CENTER
                setPadding(UiKit.dp(this@MainActivity, 12f), UiKit.dp(this@MainActivity, 10f), UiKit.dp(this@MainActivity, 12f), UiKit.dp(this@MainActivity, 10f))
            }
            chips[choice] = chip
            style(chip, choice == current)
            chip.setOnClickListener {
                current = choice
                chips.forEach { (value, view) -> style(view, value == current) }
                onSelected(choice)
            }
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, UiKit.dp(this, 39f))
            lp.rightMargin = UiKit.dp(this, 6f)
            row.addView(chip, lp)
        }
        horizontalScroll.addView(row)
        parent.addView(horizontalScroll, fullWidth())
    }

    private fun refreshHostQualityLabel() {
        // The next rendered host page reads persisted quality. The active encoder is unchanged until the next session.
    }

    private fun showCustomBitrateDialog() {
        val slider = android.widget.SeekBar(this).apply {
            max = 23
            progress = ((customBitrate - 750_000) / 1_000_000).coerceIn(0, 23)
        }
        val valueText = UiKit.text(this, "${(customBitrate / 1_000_000f).coerceAtLeast(.75f).formatOneDecimal()} Mbps", 16f, UiKit.CYAN, true).apply { gravity = Gravity.CENTER }
        slider.setOnSeekBarChangeListener(object : android.widget.SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: android.widget.SeekBar?, progress: Int, fromUser: Boolean) {
                customBitrate = (750_000 + progress * 1_000_000).coerceAtMost(24_000_000)
                valueText.text = "${(customBitrate / 1_000_000f).formatOneDecimal()} Mbps"
            }
            override fun onStartTrackingTouch(seekBar: android.widget.SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: android.widget.SeekBar?) = Unit
        })
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(UiKit.dp(this@MainActivity, 24f), UiKit.dp(this@MainActivity, 5f), UiKit.dp(this@MainActivity, 24f), UiKit.dp(this@MainActivity, 5f)) }
        content.addView(valueText)
        UiKit.addSpace(this, content, 10)
        content.addView(slider)
        AlertDialog.Builder(this).setTitle("Custom target bitrate").setView(content)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ -> savePreferences() }
            .show()
    }

    private fun bitrateForSelection(): Int = when (bitrateLabel) {
        "Low" -> 2_000_000
        "High" -> 12_000_000
        "Custom" -> customBitrate
        else -> 6_000_000
    }

    private fun scaleValue(): Float = when (controlsScale) {
        "Compact" -> .82f
        "Large" -> 1.2f
        else -> 1f
    }

    private fun fullWidth() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    companion object {
        private const val REQUEST_PROJECTION = 4102
        private const val REQUEST_AUDIO = 4103
        private const val REQUEST_NOTIFICATIONS = 4104
    }
}

private fun Float.formatOneDecimal(): String = String.format("%.1f", this)
