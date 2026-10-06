package com.neurio.app

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.neurio.R
import com.neurio.client.ClientActivity
import com.neurio.host.HostActivity

/** Landing screen: HOST GAME / JOIN GAME / SETTINGS / PERFORMANCE. */
class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<android.widget.FrameLayout>(R.id.btnHost)
            .setOnClickListener { startActivity(Intent(this, HostActivity::class.java)) }
        findViewById<android.widget.FrameLayout>(R.id.btnJoin)
            .setOnClickListener { startActivity(Intent(this, ClientActivity::class.java)) }
        findViewById<android.widget.FrameLayout>(R.id.btnSettings)
            .setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        findViewById<android.widget.FrameLayout>(R.id.btnPerformance)
            .setOnClickListener { startActivity(Intent(this, PerformanceActivity::class.java)) }

        findViewById<TextView>(R.id.tvFooter).text =
            getString(R.string.footer_note, Build.VERSION.RELEASE)

        requestNotificationPermission()
        updateWifiStatus()
    }

    override fun onResume() {
        super.onResume()
        updateWifiStatus()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    private fun updateWifiStatus() {
        val status = findViewById<TextView>(R.id.tvWifiStatus)
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val caps = network?.let { cm.getNetworkCapabilities(it) }
        val onWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true ||
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true
        if (onWifi) {
            status.setText(R.string.wifi_ok)
            status.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_wifi, 0, 0, 0)
        } else {
            status.setText(R.string.wifi_missing)
            status.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_wifi_off, 0, 0, 0)
            Toast.makeText(this, R.string.wifi_hint, Toast.LENGTH_LONG).show()
        }
    }
}
