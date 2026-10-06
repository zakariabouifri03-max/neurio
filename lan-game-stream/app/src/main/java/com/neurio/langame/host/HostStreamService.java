package com.neurio.langame.host;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import com.neurio.langame.R;
import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.ui.main.MainActivity;

import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Foreground service that keeps the host pipeline alive while the game owns the
 * screen.
 *
 * <p>Why a foreground service is mandatory here (not an optimisation):</p>
 * <ul>
 *   <li>From Android 10 (API 29) a {@link MediaProjection} may only be created by
 *       an app that is running a foreground service of type
 *       {@code mediaProjection}.</li>
 *   <li>From Android 14 (API 34) that service must be started <i>before</i>
 *       {@code getMediaProjection()} is called, and it needs the
 *       {@code FOREGROUND_SERVICE_MEDIA_PROJECTION} permission.</li>
 * </ul>
 * The service also holds a partial wake lock and a high-performance Wi-Fi lock so
 * the radio is not put to sleep mid-frame.</p>
 */
public class HostStreamService extends Service implements StreamServer.Listener {

    private static final String TAG = "HostService";
    private static final String CHANNEL_ID = "lgs-host-stream";
    private static final int NOTIFICATION_ID = 0x4C47;

    public static final String ACTION_START = "com.neurio.langame.START_HOST";
    public static final String ACTION_STOP = "com.neurio.langame.STOP_HOST";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_GAME_NAME = "gameName";

    private static volatile HostStreamService instance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    private StreamServer server;
    private MediaProjection projection;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private long lastNotificationUpdateMs;
    private String stateMessage = "starting";

    /** Observer used by the host UI (implemented by HostActivity / performance screen). */
    public interface Listener extends StreamServer.Listener {
    }

    public static HostStreamService get() {
        return instance;
    }

    public static boolean isRunning() {
        return instance != null && instance.server != null;
    }

    /** Starts host mode. {@code resultData} is the MediaProjection permission result. */
    public static void start(Context context, int resultCode, Intent resultData, String gameName) {
        Intent intent = new Intent(context, HostStreamService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_RESULT_CODE, resultCode);
        intent.putExtra(EXTRA_RESULT_DATA, resultData);
        intent.putExtra(EXTRA_GAME_NAME, gameName == null ? "" : gameName);
        context.startForegroundService(intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, HostStreamService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    /* ------------------------------------------------------------------ */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        acquireLocks();
        Logger.i(TAG, "Host service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            Logger.i(TAG, "Stop requested");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) {
            // Restarted by the system without a MediaProjection: nothing we can do.
            stopSelf();
            return START_NOT_STICKY;
        }

        // 1) Foreground first — required before any MediaProjection is created.
        startInForeground("Waiting for a client");

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        String gameName = intent.getStringExtra(EXTRA_GAME_NAME);
        if (resultData == null) {
            Logger.e(TAG, "No MediaProjection permission data");
            stopSelf();
            return START_NOT_STICKY;
        }

        // 2) Projection, then its mandatory callback.
        try {
            MediaProjectionManager manager =
                    (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(resultCode, resultData);
            if (projection == null) {
                Logger.e(TAG, "getMediaProjection returned null");
                stopSelf();
                return START_NOT_STICKY;
            }
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    Logger.w(TAG, "MediaProjection stopped (user revoked or system)");
                    mainHandler.post(() -> {
                        notifyWarning("Screen capture permission was revoked");
                        stopSelf();
                    });
                }
            }, mainHandler);
        } catch (Exception e) {
            Logger.e(TAG, "Projection setup failed", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        // 3) The engine.
        server = new StreamServer(this, this, projection);
        server.setGameName(gameName == null ? "" : gameName);
        server.start();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        Logger.i(TAG, "Host service destroyed");
        if (server != null) {
            server.stop();
            server = null;
        }
        if (projection != null) {
            try {
                projection.stop();
            } catch (Exception ignored) {
            }
            projection = null;
        }
        releaseLocks();
        instance = null;
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;   // started service; the UI observes through the static instance
    }

    /* ------------------------------------------------------------------ *
     *  Public surface for the UI
     * ------------------------------------------------------------------ */

    public void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    public StreamServer.Stats stats() {
        return server == null ? new StreamServer.Stats() : server.stats();
    }

    public StreamServer.State state() {
        return server == null ? StreamServer.State.IDLE : server.state();
    }

    public String pairingCode() {
        return server == null ? "" : server.pairingCode();
    }

    public void regeneratePairingCode() {
        if (server != null) {
            server.regeneratePairingCode();
        }
    }

    public String stateMessage() {
        return stateMessage;
    }

    /** The game name is shown on the client's HUD while it streams. */
    public void setGameName(String gameName) {
        if (server != null) {
            server.setGameName(gameName);
        }
    }

    public String describeLink() {
        return server == null ? "" : server.describeLink();
    }

    /* ------------------------------------------------------------------ *
     *  StreamServer.Listener
     * ------------------------------------------------------------------ */

    @Override
    public void onState(StreamServer.State state, String message) {
        stateMessage = message;
        updateNotification(message);
        for (Listener listener : listeners) {
            listener.onState(state, message);
        }
    }

    @Override
    public void onClientConnected(String name, String device) {
        updateNotification(name + " connected");
        for (Listener listener : listeners) {
            listener.onClientConnected(name, device);
        }
    }

    @Override
    public void onClientDisconnected(String reason) {
        updateNotification("Waiting for a client");
        for (Listener listener : listeners) {
            listener.onClientDisconnected(reason);
        }
    }

    @Override
    public void onStats(StreamServer.Stats stats) {
        for (Listener listener : listeners) {
            listener.onStats(stats);
        }
        // Refresh the notification a couple of times per minute, not per frame.
        long now = System.currentTimeMillis();
        if (now - lastNotificationUpdateMs > 2500) {
            lastNotificationUpdateMs = now;
            if (stats.state == StreamServer.State.STREAMING) {
                updateNotification(String.format(Locale.US, "%s · %d×%d · %.0f FPS · %d ms",
                        stats.clientName, stats.profile == null ? 0 : stats.profile.width,
                        stats.profile == null ? 0 : stats.profile.height, stats.fps,
                        Math.round(stats.networkRttMs)));
            } else {
                updateNotification(stateMessage);
            }
        }
    }

    @Override
    public void onWarning(String message) {
        for (Listener listener : listeners) {
            listener.onWarning(message);
        }
    }

    /* ------------------------------------------------------------------ *
     *  Notification + locks
     * ------------------------------------------------------------------ */

    private void createNotificationChannel() {
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                getString(R.string.notif_channel_host), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while this phone streams a game to a paired client");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void startInForeground(String text) {
        Notification notification = buildNotification(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String text) {
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(text));
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, HostStreamService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_stat_stream)
                .setOngoing(true)
                .setContentIntent(contentIntent)
                .addAction(new Notification.Action.Builder(null,
                        getString(R.string.stop_stream), stopIntent).build())
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void acquireLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lgs:host-stream");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
            WifiManager wm = (WifiManager) getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lgs:host-wifi");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        } catch (Exception e) {
            Logger.w(TAG, "Could not acquire locks: " + e.getMessage());
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {
        }
        wakeLock = null;
        wifiLock = null;
    }

    private void notifyWarning(String message) {
        for (Listener listener : listeners) {
            listener.onWarning(message);
        }
    }

    /** Ports are documented here so the UI can show them. */
    public static String portSummary() {
        return "control " + Configuration.PORT_CONTROL + " · video " + Configuration.PORT_VIDEO
                + " · audio " + Configuration.PORT_AUDIO + " · input " + Configuration.PORT_INPUT;
    }
}
