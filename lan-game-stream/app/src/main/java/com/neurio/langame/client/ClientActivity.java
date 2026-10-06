package com.neurio.langame.client;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.neurio.langame.R;
import com.neurio.langame.common.AppSettings;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.network.HostInfo;
import com.neurio.langame.network.NetworkUtils;
import com.neurio.langame.ui.views.UiKit;

import java.util.List;
import java.util.Locale;

/**
 * Join screen: browse hosts on the local network, or type an address.
 *
 * <p>Nothing about the game is fetched here. The client connects, receives a video
 * and audio stream and sends input; the game itself stays on the host phone.</p>
 */
public class ClientActivity extends Activity implements HostDiscovery.Listener {

    private static final int REQ_NEARBY = 5201;

    private AppSettings settings;
    private HostDiscovery discovery;
    private LinearLayout hostList;
    private TextView status;
    private TextView empty;
    private TextView error;
    private EditText ipField;
    private EditText codeField;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_client);
        settings = new AppSettings(this);

        hostList = findViewById(R.id.client_host_list);
        status = findViewById(R.id.client_status);
        empty = findViewById(R.id.client_empty);
        error = findViewById(R.id.client_error);
        ipField = findViewById(R.id.client_ip);
        codeField = findViewById(R.id.client_code);

        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_rescan).setOnClickListener(v -> {
            UiKit.toast(this, R.string.scanning);
            status.setText(R.string.scanning);
        });
        findViewById(R.id.btn_connect).setOnClickListener(v -> connectManual());

        String last = settings.lastHostIp();
        if (last != null && !last.isEmpty()) {
            ipField.setText(last);
        }
        hostList.addView(UiKit.caption(this, getString(R.string.scanning)));

        requestNearbyPermission();
    }

    private void requestNearbyPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.NEARBY_WIFI_DEVICES}, REQ_NEARBY);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (discovery == null) {
            discovery = new HostDiscovery(this, this);
        }
        discovery.start();
    }

    @Override
    protected void onStop() {
        if (discovery != null) {
            discovery.close();
            discovery = null;
        }
        super.onStop();
    }

    /* ------------------------------------------------------------------ *
     *  HostDiscovery.Listener
     * ------------------------------------------------------------------ */

    @Override
    public void onHostsChanged(List<HostInfo> hosts) {
        hostList.removeAllViews();
        if (hosts.isEmpty()) {
            UiKit.setVisible(empty, true);
            return;
        }
        UiKit.setVisible(empty, false);
        for (HostInfo host : hosts) {
            String subtitle = host.deviceModel.isEmpty() ? host.address : host.deviceModel
                    + " · " + host.address;
            if (!host.gameName.isEmpty()) {
                subtitle = subtitle + " · " + host.gameName;
            }
            String trailing = host.isStreaming() ? getString(R.string.client_streaming)
                    : (host.status == 1 ? getString(R.string.waiting_for_client)
                    : getString(R.string.client_idle));
            LinearLayout row = UiKit.listRow(this, null, host.name, subtitle,
                    trailing + " · " + (host.pingMs < 0
                            ? getString(R.string.client_ping_unknown)
                            : String.format(Locale.US, "%.0f ms", host.pingMs)),
                    host.isStreaming() ? UiKit.ACCENT : UiKit.TEXT_SECONDARY,
                    v -> connect(host.address, host.controlPort, codeField.getText().toString()));
            hostList.addView(row);
        }
    }

    @Override
    public void onState(String message) {
        status.setText(message);
    }

    /* ------------------------------------------------------------------ *
     *  Connecting
     * ------------------------------------------------------------------ */

    private void connectManual() {
        String address = ipField.getText().toString().trim();
        if (address.isEmpty()) {
            showError(getString(R.string.client_manual_hint));
            return;
        }
        if (!NetworkUtils.isPrivateAddress(address)) {
            // Refuse public addresses: this must never leave the LAN.
            showError("Only local addresses are allowed (192.168.x.x, 10.x.x.x, 172.16-31.x.x).");
            return;
        }
        connect(address, Configuration.PORT_CONTROL, codeField.getText().toString());
    }

    private void connect(String address, int port, String code) {
        settings.setLastHostIp(address);
        Intent intent = new Intent(this, StreamActivity.class);
        intent.putExtra(StreamActivity.EXTRA_ADDRESS, address);
        intent.putExtra(StreamActivity.EXTRA_PORT, port);
        intent.putExtra(StreamActivity.EXTRA_CODE, code == null ? "" : code.trim());
        startActivity(intent);
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }

    private void showError(String message) {
        error.setText(message);
        UiKit.setVisible(error, true);
    }
}
