package com.neurio.client

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.neurio.R
import com.neurio.app.PrefsStore
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * JOIN GAME screen: discovers hosts on the LAN, shows ping/quality, takes the
 * pairing code and hands the session over to the fullscreen player.
 */
class ClientActivity : AppCompatActivity() {

    private lateinit var discovery: HostDiscovery
    private val hosts = ArrayList<DiscoveredHost>()
    private lateinit var adapter: HostsAdapter
    private lateinit var emptyView: TextView
    private lateinit var scanState: TextView
    private lateinit var pairCard: LinearLayout
    private lateinit var pairHostLabel: TextView
    private lateinit var codeInput: EditText
    private lateinit var connectButton: Button
    private lateinit var manualIp: EditText
    private val handler = Handler(Looper.getMainLooper())

    private var selected: DiscoveredHost? = null
    private var manualTarget: InetSocketAddress? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_client)

        emptyView = findViewById(R.id.tvEmptyHosts)
        scanState = findViewById(R.id.tvScanState)
        pairCard = findViewById(R.id.cardPair)
        pairHostLabel = findViewById(R.id.tvPairHost)
        codeInput = findViewById(R.id.etCode)
        connectButton = findViewById(R.id.btnConnect)
        manualIp = findViewById(R.id.etManualIp)

        adapter = HostsAdapter(hosts) { host -> selectHost(host) }
        val recycler = findViewById<RecyclerView>(R.id.rvHosts)
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter

        connectButton.isEnabled = false
        codeInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {
                connectButton.isEnabled = (s?.length ?: 0) >= 4
            }

            override fun afterTextChanged(s: Editable?) {}
        })

        connectButton.setOnClickListener { startSession(selected, manualTarget) }
        findViewById<Button>(R.id.btnManualConnect).setOnClickListener { connectManual() }

        discovery = HostDiscovery(this)
        discovery.listener = object : HostDiscovery.Listener {
            override fun onHosts(found: List<DiscoveredHost>) {
                handler.post {
                    hosts.clear()
                    hosts.addAll(found)
                    adapter.notifyDataSetChanged()
                    emptyView.visibility = if (hosts.isEmpty()) View.VISIBLE else View.GONE
                    scanState.text = if (hosts.isEmpty()) {
                        getString(R.string.scan_searching)
                    } else {
                        resources.getQuantityString(R.plurals.scan_found, hosts.size, hosts.size)
                    }
                }
            }

            override fun onError(message: String) {
                handler.post {
                    Toast.makeText(this@ClientActivity, message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        discovery.start()
    }

    override fun onPause() {
        super.onPause()
        discovery.stop()
    }

    private fun selectHost(host: DiscoveredHost) {
        selected = host
        manualTarget = null
        pairHostLabel.text = getString(R.string.pair_with, host.serviceName, host.ipLabel)
        pairCard.visibility = View.VISIBLE
        connectButton.isEnabled = (codeInput.text?.length ?: 0) >= 4
        codeInput.requestFocus()
    }

    private fun connectManual() {
        val raw = manualIp.text?.toString()?.trim() ?: ""
        if (raw.isEmpty()) {
            Toast.makeText(this, R.string.enter_ip, Toast.LENGTH_SHORT).show()
            return
        }
        val address = try {
            InetSocketAddress(InetAddress.getByName(raw), com.neurio.host.StreamServer.TCP_PORT)
        } catch (e: Exception) {
            Toast.makeText(this, R.string.bad_ip, Toast.LENGTH_SHORT).show()
            return
        }
        selected = null
        manualTarget = address
        pairHostLabel.text = getString(R.string.pair_with_manual, raw)
        pairCard.visibility = View.VISIBLE
        connectButton.isEnabled = (codeInput.text?.length ?: 0) >= 4
        codeInput.requestFocus()
    }

    private fun startSession(host: DiscoveredHost?, manual: InetSocketAddress?) {
        val code = codeInput.text?.toString()?.trim() ?: ""
        if (code.length < 4) return
        if (host == null && manual == null) return

        PendingSession.host = host
        PendingSession.manualAddress = manual
        PendingSession.pairingCode = code
        PendingSession.config = PrefsStore(this).streamConfigFromPrefs()

        discovery.stop()
        startActivity(Intent(this, StreamViewActivity::class.java))
    }
}

/** Row: host name, ip + streamed game, ping, quality chip, CONNECT. */
class HostsAdapter(
    private val items: List<DiscoveredHost>,
    private val onPick: (DiscoveredHost) -> Unit
) : RecyclerView.Adapter<HostsAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val name: TextView = view.findViewById(R.id.tvHostName)
        val detail: TextView = view.findViewById(R.id.tvHostDetail)
        val ping: TextView = view.findViewById(R.id.tvHostPing)
        val quality: TextView = view.findViewById(R.id.tvHostQuality)
        val pick: Button = view.findViewById(R.id.btnPick)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_host, parent, false)
        return Holder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val host = items[position]
        holder.name.text = host.serviceName
        val game = host.gameLabel.ifEmpty {
            holder.itemView.context.getString(R.string.host_idle)
        }
        holder.detail.text = holder.itemView.context
            .getString(R.string.host_detail, host.ipLabel, game)
        holder.ping.text = if (host.rttMs < 0) "…" else
            holder.itemView.context.getString(R.string.ping_value, host.rttMs)
        holder.quality.text = host.qualityLabel
        holder.quality.setBackgroundResource(
            when (host.qualityLabel) {
                "Excellent" -> R.drawable.bg_pill_good
                "Good" -> R.drawable.bg_pill_good
                "Weak" -> R.drawable.bg_pill_warn
                "Very weak" -> R.drawable.bg_pill_bad
                else -> R.drawable.bg_pill
            }
        )
        holder.pick.setOnClickListener { onPick(host) }
    }
}
