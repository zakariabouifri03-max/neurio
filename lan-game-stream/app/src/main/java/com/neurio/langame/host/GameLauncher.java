package com.neurio.langame.host;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;

import com.neurio.langame.common.Logger;
import com.neurio.langame.host.input.NeurioAccessibilityService;

import java.util.List;

/**
 * Launches the selected game <b>on the host phone</b> and tells the stream engine
 * whether it actually made it to the foreground.
 *
 * <p>The client phone never receives the game — it receives pixels. So the only
 * thing that happens here is the same {@code ACTION_MAIN} launch the home screen
 * would do, followed by an honest "is it in front?" check when the optional
 * accessibility service is enabled.</p>
 */
public final class GameLauncher {

    private static final String TAG = "GameLauncher";

    private static volatile String currentPackage = "";

    private GameLauncher() {
    }

    public static String currentPackage() {
        return currentPackage;
    }

    public static boolean isInstalled(Context context, String packageName) {
        try {
            context.getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Starts the game's launcher activity.
     *
     * @return true when a launcher activity was found and startActivity did not throw
     */
    public static boolean launch(Context context, String packageName) {
        PackageManager pm = context.getPackageManager();
        Intent intent = pm.getLaunchIntentForPackage(packageName);
        if (intent == null) {
            Intent main = new Intent(Intent.ACTION_MAIN);
            main.addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            main.setPackage(packageName);
            List<ResolveInfo> resolved = pm.queryIntentActivities(main, 0);
            if (resolved.isEmpty()) {
                Logger.w(TAG, "No launchable activity for " + packageName);
                return false;
            }
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        }
        try {
            context.startActivity(intent);
            currentPackage = packageName;
            Logger.i(TAG, "Launched " + packageName);
            return true;
        } catch (Exception e) {
            Logger.e(TAG, "Could not launch " + packageName, e);
            return false;
        }
    }

    /**
     * Whether the game is really in the foreground right now.
     *
     * <p>Only possible while the user has enabled the optional accessibility
     * service (which reports window state changes). Without it we cannot know:
     * {@code getRunningAppProcesses} has been useless for third-party apps since
     * Android 5.1 and usage statistics need a special user-granted permission, so
     * the UI says "unknown" rather than guessing.</p>
     */
    public static boolean isForeground(String packageName) {
        NeurioAccessibilityService service = NeurioAccessibilityService.get();
        if (service == null) {
            return false;
        }
        String foreground = service.foregroundPackage();
        return foreground != null && foreground.equals(packageName);
    }

    public static boolean canObserveForeground() {
        return NeurioAccessibilityService.isConnected();
    }
}
