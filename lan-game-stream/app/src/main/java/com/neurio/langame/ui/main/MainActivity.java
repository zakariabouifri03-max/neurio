package com.neurio.langame.ui.main;

import android.app.Activity;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;

import com.neurio.langame.R;
import com.neurio.langame.client.ClientActivity;
import com.neurio.langame.host.HostActivity;
import com.neurio.langame.host.HostStreamService;
import com.neurio.langame.ui.performance.PerformanceActivity;
import com.neurio.langame.ui.settings.SettingsActivity;

/**
 * Entry screen: LAN GAME with the three big choices.
 *
 * <p>It also surfaces the two facts that decide whether anything will work: is
 * this phone on Wi-Fi, and is a stream already running on this device.</p>
 */
public class MainActivity extends Activity {

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView networkView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        networkView = findViewById(R.id.main_network);

        findViewById(R.id.card_host).setOnClickListener(v -> open(new Intent(this, HostActivity.class)));
        findViewById(R.id.card_join).setOnClickListener(v -> open(new Intent(this, ClientActivity.class)));
        findViewById(R.id.card_settings).setOnClickListener(v -> open(new Intent(this, SettingsActivity.class)));
        findViewById(R.id.card_performance).setOnClickListener(v ->
                open(new Intent(this, PerformanceActivity.class)));

        animateIn(findViewById(R.id.card_host), 0);
        animateIn(findViewById(R.id.card_join), 60);
        animateIn(findViewById(R.id.card_settings), 120);
        animateIn(findViewById(R.id.card_performance), 180);
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refresh);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refresh);
        super.onPause();
    }

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            updateNetworkLine();
            handler.postDelayed(this, 2000);
        }
    };

    private void updateNetworkLine() {
        StringBuilder sb = new StringBuilder();
        sb.append(isOnWifi() ? "Wi-Fi" : "No Wi-Fi");
        String link = com.neurio.langame.network.NetworkUtils.activeLinkDescription(this);
        if (link != null && !link.isEmpty()) {
            sb.append(" · ").append(link);
        }
        if (HostStreamService.isRunning()) {
            sb.append(" · host streaming now (").append(HostStreamService.get() == null
                    ? "starting" : HostStreamService.get().state()).append(')');
        }
        networkView.setText(sb.toString());
        networkView.setTextColor(isOnWifi()
                ? com.neurio.langame.ui.views.UiKit.ACCENT
                : com.neurio.langame.ui.views.UiKit.WARN);
    }

    private boolean isOnWifi() {
        ConnectivityManager manager =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) {
            return false;
        }
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null
                ? null : manager.getNetworkCapabilities(network);
        return capabilities != null
                && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    private void animateIn(View view, long delayMs) {
        view.setAlpha(0f);
        view.setTranslationY(com.neurio.langame.ui.views.UiKit.dp(this, 14));
        view.animate()
                .alpha(1f)
                .translationY(0f)
                .setStartDelay(delayMs)
                .setDuration(260)
                .start();
    }

    private void open(Intent intent) {
        startActivity(intent);
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }
}
