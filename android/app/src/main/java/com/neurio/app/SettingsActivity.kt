package com.neurio.app

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import com.neurio.R
import com.neurio.client.ControllerOverlay
import com.neurio.common.AudioMode
import com.neurio.host.InputInjector

/** Streaming + input preferences, plus the honest limitations dialog. */
class SettingsActivity : AppCompatActivity() {

    private lateinit var prefs: PrefsStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        prefs = PrefsStore(this)

        setupSpinner(R.id.spResolution, listOf("AUTO", "1080", "720", "480"), prefs.resolutionPref()) {
            prefs.setResolutionPref(it)
        }
        setupSpinner(R.id.spFps, listOf("AUTO", "60", "30"), prefs.fpsPref()) {
            prefs.setFpsPref(it)
        }
        setupSpinner(R.id.spCodec, listOf("AUTO", "H264", "H265"), prefs.codecPref()) {
            prefs.setCodecPref(it)
        }

        val bitrateBar = findViewById<SeekBar>(R.id.sbBitrate)
        val bitrateLabel = findViewById<TextView>(R.id.tvBitrateVal)
        bitrateBar.max = 16
        bitrateBar.progress = (prefs.maxBitrateKbps() / 1000).coerceIn(2, 16)
        bitrateLabel.text = getString(R.string.bitrate_value, bitrateBar.progress)
        bitrateBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val mbps = progress.coerceAtLeast(2)
                bitrateLabel.text = getString(R.string.bitrate_value, mbps)
                if (fromUser) prefs.setMaxBitrateKbps(mbps * 1000)
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        val rgAudio = findViewById<RadioGroup>(R.id.rgAudio)
        when (runCatching { AudioMode.valueOf(prefs.audioPref()) }.getOrDefault(AudioMode.AUTO)) {
            AudioMode.AUTO -> rgAudio.check(R.id.rbAudioAuto)
            AudioMode.INTERNAL -> rgAudio.check(R.id.rbAudioInternal)
            AudioMode.MIC -> rgAudio.check(R.id.rbAudioMic)
            AudioMode.OFF -> rgAudio.check(R.id.rbAudioOff)
        }
        rgAudio.setOnCheckedChangeListener { _, checkedId ->
            val mode = when (checkedId) {
                R.id.rbAudioInternal -> AudioMode.INTERNAL
                R.id.rbAudioMic -> AudioMode.MIC
                R.id.rbAudioOff -> AudioMode.OFF
                else -> AudioMode.AUTO
            }
            prefs.setAudioPref(mode.name)
        }

        val mirrorSwitch = findViewById<SwitchCompat>(R.id.swMirrorTouch)
        mirrorSwitch.isChecked = prefs.mirrorTouchDefault()
        mirrorSwitch.setOnCheckedChangeListener { _, isChecked ->
            prefs.setMirrorTouchDefault(isChecked)
        }

        findViewById<Button>(R.id.btnResetLayout).setOnClickListener {
            prefs.clearControllerLayout()
            ControllerOverlay.defaultSpecs() // defaults are rebuilt next session
            Toast.makeText(this, R.string.layout_reset, Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.btnAccessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        findViewById<Button>(R.id.btnLimitations).setOnClickListener { showLimitations() }

        findViewById<TextView>(R.id.tvVersion).text =
            getString(R.string.version_line, com.neurio.BuildConfig.VERSION_NAME)
    }

    override fun onResume() {
        super.onResume()
        val state = findViewById<TextView>(R.id.tvAccessibilityState)
        if (InputInjector.isEnabled(this)) {
            state.setText(R.string.input_ready)
        } else {
            state.setText(R.string.input_missing)
        }
    }

    private fun setupSpinner(
        viewId: Int,
        options: List<String>,
        current: String,
        onPick: (String) -> Unit
    ) {
        val spinner = findViewById<Spinner>(viewId)
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, options)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinner.adapter = adapter
        val index = options.indexOf(current).coerceAtLeast(0)
        spinner.setSelection(index)
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                onPick(options[position])
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun showLimitations() {
        AlertDialog.Builder(this)
            .setTitle(R.string.limitations_title)
            .setMessage(R.string.limitations_body)
            .setPositiveButton(R.string.ok, null)
            .show()
    }
}
