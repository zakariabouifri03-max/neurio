package com.neurio.langame.host;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;

import com.neurio.langame.common.Logger;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Builds the host's game library from the apps this phone can actually launch.
 *
 * <p>Scope and privacy notes:</p>
 * <ul>
 *   <li>Only <b>launcher</b> activities are enumerated (the manifest declares a
 *       {@code <queries>} block for {@code MAIN/LAUNCHER}, so no
 *       {@code QUERY_ALL_PACKAGES} permission is needed).</li>
 *   <li>The detector reads nothing private: label, icon, package name, version and
 *       the platform's own {@code CATEGORY_GAME} flag.</li>
 *   <li>"Supported status" here means: <i>launchable on this phone</i>. The
 *       prototype does not consult Play Store compatibility lists — the point of
 *       the system is that the client phone never needs the game at all.</li>
 * </ul>
 */
public final class GameDetector {

    private static final String TAG = "GameDetector";

    /** One launchable app on the host. */
    public static final class GameApp {
        public String label = "";
        public String packageName = "";
        public String versionName = "";
        public boolean isGame;
        public boolean isSystemApp;
        public Bitmap icon;

        public String subtitle() {
            return packageName + (versionName.isEmpty() ? "" : " · v" + versionName);
        }

        @Override
        public String toString() {
            return label;
        }
    }

    private static final Map<String, Bitmap> ICON_CACHE = new HashMap<>();

    private GameDetector() {
    }

    /** Enumerates launchable apps; games first, then alphabetical. */
    public static List<GameApp> detect(Context context) {
        PackageManager pm = context.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN, null);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        // Also include TV-style launchers so the library is complete on TV boxes.
        Intent leanback = new Intent(Intent.ACTION_MAIN, null);
        leanback.addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);

        Set<String> seen = new HashSet<>();
        List<GameApp> apps = new ArrayList<>();
        collect(context, pm, main, seen, apps);
        collect(context, pm, leanback, seen, apps);

        Collator collator = Collator.getInstance(Locale.getDefault());
        Collections.sort(apps, new Comparator<GameApp>() {
            @Override
            public int compare(GameApp a, GameApp b) {
                if (a.isGame != b.isGame) {
                    return a.isGame ? -1 : 1;
                }
                return collator.compare(a.label, b.label);
            }
        });
        Logger.i(TAG, "Detected " + apps.size() + " launchable apps ("
                + countGames(apps) + " games)");
        return apps;
    }

    private static int countGames(List<GameApp> apps) {
        int games = 0;
        for (GameApp app : apps) {
            if (app.isGame) {
                games++;
            }
        }
        return games;
    }

    private static void collect(Context context, PackageManager pm, Intent intent,
                                Set<String> seen, List<GameApp> out) {
        List<ResolveInfo> resolved;
        try {
            resolved = pm.queryIntentActivities(intent, 0);
        } catch (Exception e) {
            Logger.w(TAG, "queryIntentActivities failed: " + e.getMessage());
            return;
        }
        for (ResolveInfo info : resolved) {
            if (info.activityInfo == null || info.activityInfo.packageName == null) {
                continue;
            }
            String packageName = info.activityInfo.packageName;
            if (!seen.add(packageName)) {
                continue;
            }
            GameApp app = new GameApp();
            app.packageName = packageName;
            try {
                ApplicationInfo applicationInfo = pm.getApplicationInfo(packageName, 0);
                app.label = String.valueOf(pm.getApplicationLabel(applicationInfo));
                app.isSystemApp = (applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
                app.isGame = isGameCategory(applicationInfo) || looksLikeGame(app.label, packageName);
                if (applicationInfo.packageName != null) {
                    android.content.pm.PackageInfo packageInfo =
                            pm.getPackageInfo(packageName, 0);
                    app.versionName = packageInfo.versionName == null ? "" : packageInfo.versionName;
                }
            } catch (Exception e) {
                app.label = info.loadLabel(pm).toString();
            }
            app.icon = loadIcon(pm, packageName);
            out.add(app);
        }
    }

    private static boolean isGameCategory(ApplicationInfo info) {
        try {
            return info.category == ApplicationInfo.CATEGORY_GAME;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Fallback classifier for apps that do not set {@code CATEGORY_GAME} (plenty of
     * games still do not). Deliberately conservative keyword matching — it only
     * affects the "games first" ordering, never compatibility claims.
     */
    private static boolean looksLikeGame(String label, String packageName) {
        String haystack = (label + " " + packageName).toLowerCase(Locale.US);
        String[] keywords = {"game", "efootball", "pes", "fifa", "football", "soccer",
                "racing", "race", "clash", "pubg", "freefire", "fortnite", "call of duty",
                "minecraft", "roblox", "candy", "puzzle", "shooter", "battle", "arena",
                "asphalt", "nba", "nfl", "truck", "simulator", "simul", "rpg", "quiz",
                "mahjong", "chess", "card", "sports", "fight", "moba", "gta", "pesmobile"};
        for (String keyword : keywords) {
            if (haystack.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    /** Icons are cached: a game library of 100 apps would otherwise thrash the heap. */
    private static Bitmap loadIcon(PackageManager pm, String packageName) {
        synchronized (ICON_CACHE) {
            Bitmap cached = ICON_CACHE.get(packageName);
            if (cached != null) {
                return cached;
            }
        }
        try {
            Drawable drawable = pm.getApplicationIcon(packageName);
            Bitmap bitmap = toBitmap(drawable, 96);
            synchronized (ICON_CACHE) {
                ICON_CACHE.put(packageName, bitmap);
            }
            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private static Bitmap toBitmap(Drawable drawable, int size) {
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, size, size);
        drawable.draw(canvas);
        return bitmap;
    }

    public static GameApp find(Context context, String packageName) {
        if (packageName == null || packageName.isEmpty()) {
            return null;
        }
        for (GameApp app : detect(context)) {
            if (packageName.equals(app.packageName)) {
                return app;
            }
        }
        return null;
    }

    /** Well known titles, used only to pre-select something sensible in the UI. */
    public static final String[] KNOWN_GAME_PACKAGES = {
            "jp.konami.pesam",                 // eFootball
            "com.ea.gp.fifamobile",            // FIFA Mobile
            "com.gameloft.android.ANMP.GloftA9HM",   // Asphalt 9
            "com.tencent.ig",                  // PUBG Mobile
            "com.dts.freefireth",              // Free Fire
            "com.mojang.minecraftpe",           // Minecraft
            "com.roblox.client",                // Roblox
            "com.epicgames.fortnite",           // Fortnite
            "com.activision.callofduty.shooter" // Call of Duty Mobile
    };
}
