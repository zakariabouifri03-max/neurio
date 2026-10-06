package com.neurio.app

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.neurio.R
import com.neurio.common.PerfBus
import com.neurio.common.StatsSnapshot

/**
 * Gaming Performance screen: live FPS, latency stages, loss, jitter, bitrate,
 * dropped frames and (battery) temperature. Subscribes to PerfBus, so it works
 * during an active host or client session.
 */
class PerformanceActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private var removeObserver: (() -> Unit)? = null
    private val views = HashMap<Int, TextView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_performance)

        val ids = listOf(
            R.id.pvRole, R.id.pvState, R.id.pvFps, R.id.pvRtt, R.id.pvJitter,
            R.id.pvLoss, R.id.pvBitrate, R.id.pvRes, R.id.pvDecode, R.id.pvEncode,
            R.id.pvDropped, R.id.pvTemp
        )
        for (id in ids) views[id] = findViewById(id)

        findViewById<Button>(R.id.btnClose).setOnClickListener { finish() }

        removeObserver = PerfBus.observe { snap ->
            handler.post { render(snap) }
        }
    }

    private fun fmt(v: Double, digits: Int = 1): String =
        if (v < 0) "—" else String.format(java.util.Locale.US, "%.${digits}f", v)

    private fun render(s: StatsSnapshot) {
        findViewById<LinearLayout>(R.id.idleNote).visibility =
            if (s.active) View.GONE else View.VISIBLE
        views[R.id.pvRole]?.text = s.role
        views[R.id.pvState]?.text =
            getString(if (s.active) R.string.perf_active else R.string.perf_idle)
        views[R.id.pvFps]?.text = fmt(s.fps)
        views[R.id.pvRtt]?.text = if (s.rttMs < 0) "—" else getString(R.string.stat_ms, s.rttMs)
        views[R.id.pvJitter]?.text = if (s.jitterMs < 0) "—" else getString(R.string.stat_ms, s.jitterMs)
        views[R.id.pvLoss]?.text = if (s.lossPct < 0) "—" else fmt(s.lossPct, 2) + "%"
        views[R.id.pvBitrate]?.text = getString(R.string.stat_mbps, s.bitrateMbps)
        views[R.id.pvRes]?.text = if (s.width > 0) "${s.width}×${s.height}" else "—"
        views[R.id.pvDecode]?.text = if (s.decodeMs < 0) "—" else getString(R.string.stat_ms, s.decodeMs)
        views[R.id.pvEncode]?.text = if (s.encodeMs < 0) "—" else getString(R.string.stat_ms, s.encodeMs)
        views[R.id.pvDropped]?.text = s.dropped.toString()
        views[R.id.pvTemp]?.text =
            if (s.batteryTempC > 0) getString(R.string.temp_value, s.batteryTempC) else "—"
    }

    override fun onDestroy() {
        removeObserver?.invoke()
        super.onDestroy()
    }
}
