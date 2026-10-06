package com.neurio.langame.common;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

/**
 * SharedPreferences wrapper for every user-tunable knob.
 *
 * <p>Kept dependency free on purpose: the controller layout is stored as a
 * hand-rolled compact string (see {@code ControllerLayout}) instead of pulling in
 * a JSON library.</p>
 */
public final class AppSettings {

    private final SharedPreferences prefs;

    public AppSettings(Context context) {
        prefs = context.getApplicationContext()
                .getSharedPreferences(Configuration.PREFS, Context.MODE_PRIVATE);
    }

    public SharedPreferences raw() {
        return prefs;
    }

    /* ------------------------------ video ------------------------------ */

    public Configuration.Codec codec() {
        String value = prefs.getString(Configuration.KEY_CODEC, Configuration.Codec.AVC.name());
        try {
            return Configuration.Codec.valueOf(value);
        } catch (IllegalArgumentException e) {
            return Configuration.Codec.AVC;
        }
    }

    public void setCodec(Configuration.Codec codec) {
        prefs.edit().putString(Configuration.KEY_CODEC, codec.name()).apply();
    }

    /** Vertical resolution cap in pixels (480/720/1080). */
    public int resolutionCap() {
        return prefs.getInt(Configuration.KEY_RESOLUTION, 1080);
    }

    public void setResolutionCap(int height) {
        prefs.edit().putInt(Configuration.KEY_RESOLUTION, height).apply();
    }

    public int targetFps() {
        return prefs.getInt(Configuration.KEY_FPS, 60);
    }

    public void setTargetFps(int fps) {
        prefs.edit().putInt(Configuration.KEY_FPS, fps).apply();
    }

    public int bitrateCapMbps() {
        return prefs.getInt(Configuration.KEY_BITRATE, 20);
    }

    public void setBitrateCapMbps(int mbps) {
        prefs.edit().putInt(Configuration.KEY_BITRATE, mbps).apply();
    }

    public boolean adaptive() {
        return prefs.getBoolean(Configuration.KEY_ADAPTIVE, true);
    }

    public void setAdaptive(boolean adaptive) {
        prefs.edit().putBoolean(Configuration.KEY_ADAPTIVE, adaptive).apply();
    }

    /* ------------------------------ audio ------------------------------ */

    public boolean captureAudio() {
        return prefs.getBoolean(Configuration.KEY_CAPTURE_AUDIO, true);
    }

    public void setCaptureAudio(boolean enabled) {
        prefs.edit().putBoolean(Configuration.KEY_CAPTURE_AUDIO, enabled).apply();
    }

    /* ------------------------------ input ------------------------------ */

    public Configuration.InputMode inputMode() {
        String value = prefs.getString(Configuration.KEY_INPUT_MODE,
                Configuration.InputMode.ACCESSIBILITY.name());
        try {
            return Configuration.InputMode.valueOf(value);
        } catch (IllegalArgumentException e) {
            return Configuration.InputMode.ACCESSIBILITY;
        }
    }

    public void setInputMode(Configuration.InputMode mode) {
        prefs.edit().putString(Configuration.KEY_INPUT_MODE, mode.name()).apply();
    }

    public boolean haptics() {
        return prefs.getBoolean(Configuration.KEY_HAPTICS, true);
    }

    public void setHaptics(boolean enabled) {
        prefs.edit().putBoolean(Configuration.KEY_HAPTICS, enabled).apply();
    }

    /* ------------------------------ session ------------------------------ */

    public boolean keepScreenOn() {
        return prefs.getBoolean(Configuration.KEY_KEEP_SCREEN_ON, true);
    }

    public void setKeepScreenOn(boolean enabled) {
        prefs.edit().putBoolean(Configuration.KEY_KEEP_SCREEN_ON, enabled).apply();
    }

    public String lastHostIp() {
        return prefs.getString(Configuration.KEY_LAST_HOST_IP, "");
    }

    public void setLastHostIp(String ip) {
        prefs.edit().putString(Configuration.KEY_LAST_HOST_IP, ip).apply();
    }

    public String controllerLayoutJson() {
        return prefs.getString(Configuration.KEY_CONTROLLER_LAYOUT, "");
    }

    public void setControllerLayoutJson(String json) {
        prefs.edit().putString(Configuration.KEY_CONTROLLER_LAYOUT, json).apply();
    }

    /* ------------------------------------------------------------------ */

    /** Builds the profile the host will start with, capped by the user settings. */
    public StreamProfile defaultProfile() {
        Configuration.Codec codec = codec();
        int cap = resolutionCap();
        int fps = targetFps();
        if (cap <= 480) {
            return new StreamProfile(codec, 854, 480, Math.min(fps, 30), 2_500_000);
        }
        if (cap <= 720) {
            return new StreamProfile(codec, 1280, 720, Math.min(fps, 60), 8_000_000);
        }
        return new StreamProfile(codec, 1920, 1080, Math.min(fps, 60), 15_000_000);
    }

    /* ------------------------ controller layouts ------------------------ */

    /**
     * The layout saved for one game, falling back to the shared layout.
     *
     * <p>Per-game storage is what makes the mapper useful: once a player has placed
     * the controls over eFootball's own on-screen buttons, switching to another game
     * no longer drags that layout along.</p>
     */
    public String controllerLayoutJsonFor(String gameName) {
        if (gameName == null || gameName.trim().isEmpty()) {
            return controllerLayoutJson();
        }
        String value = prefs.getString(layoutKey(gameName), "");
        return value == null || value.isEmpty() ? controllerLayoutJson() : value;
    }

    public void setControllerLayoutJsonFor(String gameName, String json) {
        if (gameName == null || gameName.trim().isEmpty()) {
            setControllerLayoutJson(json);
            return;
        }
        prefs.edit().putString(layoutKey(gameName), json).apply();
    }

    public boolean hasLayoutFor(String gameName) {
        return gameName != null && !gameName.trim().isEmpty()
                && !prefs.getString(layoutKey(gameName), "").isEmpty();
    }

    private static String layoutKey(String gameName) {
        String slug = gameName.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9]+", "_");
        return Configuration.KEY_CONTROLLER_LAYOUT + "_" + slug;
    }
}
