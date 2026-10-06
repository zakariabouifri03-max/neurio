package com.neurio.vm.vm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import com.neurio.vm.ConsoleActivity;
import com.neurio.vm.R;
import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.util.Log;

import java.util.Locale;

/**
 * Keeps a running virtual device alive after the UI goes away, and says so in
 * the notification shade.
 *
 * <p>A QEMU or redroid guest is a child process of this app; if Android considers
 * the app cached it can be killed, taking the VM with it. A foreground service
 * raises the process importance enough to survive a screen-off, which is the
 * difference between a VM you can use and one that dies in your pocket.
 *
 * <p>The service is started with {@code specialUse} foreground type — the VM host
 * genuinely is not one of the platform's predefined categories, and the manifest
 * declares the subtype property that API 34 requires.
 */
public final class VmService extends Service {

    private static final String TAG = "VmService";
    private static final String CHANNEL = "neurio_vm";
    private static final int NOTIFICATION_ID = 0x4E56; // "NV"

    public static final String ACTION_START = "com.neurio.vm.action.START";
    public static final String ACTION_STOP = "com.neurio.vm.action.STOP";
    public static final String ACTION_STOP_ALL = "com.neurio.vm.action.STOP_ALL";
    public static final String EXTRA_DEVICE = "deviceId";
    public static final String EXTRA_BACKEND = "backendId";

    private VmManager manager;
    private final VmSession.Listener listener = new VmSession.Listener() {
        @Override public void onStateChanged(VmSession s) { refresh(s); }
        @Override public void onLog(VmSession s, String line) { }
    };

    /** Convenience starter used by the UI. */
    public static void start(Context ctx, DeviceIdentity d, String backendId) {
        Intent i = new Intent(ctx, VmService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_DEVICE, d.id);
        i.putExtra(EXTRA_BACKEND, backendId == null ? "" : backendId);
        startIt(ctx, i);
    }

    public static void stopDevice(Context ctx, DeviceIdentity d) {
        Intent i = new Intent(ctx, VmService.class);
        i.setAction(ACTION_STOP);
        i.putExtra(EXTRA_DEVICE, d.id);
        startIt(ctx, i);
    }

    public static void stopAll(Context ctx) {
        Intent i = new Intent(ctx, VmService.class);
        i.setAction(ACTION_STOP_ALL);
        startIt(ctx, i);
    }

    private static void startIt(Context ctx, Intent i) {
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable t) {
            // A background-start restriction here means the VM simply runs
            // without the service; the session itself is unaffected.
            Log.w(TAG, "could not start the foreground service: " + t.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        manager = VmManager.get(this);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP_ALL.equals(action)) {
            manager.stopAll();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            String id = intent.getStringExtra(EXTRA_DEVICE);
            DeviceIdentity d = ProfileStore.get(this).get(id);
            if (d != null) manager.stop(d);
            if (!manager.anyRunning()) stopSelf();
            else refresh(null);
            return START_NOT_STICKY;
        }

        String deviceId = intent == null ? null : intent.getStringExtra(EXTRA_DEVICE);
        final DeviceIdentity device = ProfileStore.get(this).get(deviceId);
        if (device == null) {
            Log.w(TAG, "start requested for unknown device " + deviceId);
            stopSelf();
            return START_NOT_STICKY;
        }

        // The notification has to appear quickly; the backend starts on the
        // manager's worker thread and updates it when the state settles.
        startForegroundCompat(build(device, null, VmSession.State.STARTING));
        manager.start(device, intent.getStringExtra(EXTRA_BACKEND), (session, error) -> {
            session.addListener(listener);
            refresh(session);
            if (!manager.anyRunning()) stopSelf();
        });
        return START_STICKY;
    }

    private void refresh(VmSession session) {
        if (session == null || session.state() == VmSession.State.STOPPED) {
            if (!manager.anyRunning()) {
                stopForegroundCompat();
                stopSelf();
                return;
            }
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(NOTIFICATION_ID, build(session == null ? null : session.device(), session,
                    session == null ? VmSession.State.RUNNING : session.state()));
        } catch (Throwable t) {
            Log.w(TAG, "notification update failed: " + t.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        manager.prune();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away must not silently kill a running guest.
        if (manager.anyRunning()) return;
        stopSelf();
    }

    // ── notification ───────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL,
                getString(R.string.channel_vm), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.channel_vm_desc));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification build(DeviceIdentity device, VmSession session, VmSession.State state) {
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        Intent open = new Intent(this, ConsoleActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        String title = device == null
                ? getString(R.string.vm_running_generic)
                : getString(R.string.vm_running_device, device.displayName());

        String backendName = session == null
                ? ""
                : Backends.byId(session.backendId(), manager.settings()).name();
        String text = session == null
                ? String.valueOf(state)
                : String.format(Locale.US, "%s · %s · %s", backendName, state, session.uptimeText());
        if (session != null && session.failure() != null) text = text + " · " + session.failure();

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_chip)
                .setContentIntent(pi)
                .setOngoing(state != VmSession.State.STOPPED && state != VmSession.State.FAILED)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE);

        if (device != null) {
            Intent stop = new Intent(this, VmService.class);
            stop.setAction(ACTION_STOP);
            stop.putExtra(EXTRA_DEVICE, device.id);
            b.addAction(new Notification.Action.Builder(
                    (android.graphics.drawable.Icon) null, getString(R.string.action_stop),
                    PendingIntent.getService(this, 1, stop, piFlags)).build());
        }
        return b.build();
    }

    private void startForegroundCompat(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Throwable t) {
            // On API 33+ without POST_NOTIFICATIONS the service still runs; the
            // notification is simply not shown. Log and carry on rather than
            // losing the VM.
            Log.w(TAG, "startForeground failed: " + t.getClass().getSimpleName()
                    + ": " + t.getMessage());
            try {
                startForeground(NOTIFICATION_ID, n);
            } catch (Throwable ignored) {
                Log.e(TAG, "could not enter the foreground — the VM may be killed in the background");
            }
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Throwable ignored) { }
    }
}
