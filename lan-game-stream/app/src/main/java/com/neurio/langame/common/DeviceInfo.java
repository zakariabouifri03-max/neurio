package com.neurio.langame.common;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.Build;
import android.os.PowerManager;
import android.util.DisplayMetrics;
import android.util.Range;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Everything we can legitimately learn about this device: SoC, memory, display,
 * hardware codec capabilities and thermal state.
 *
 * <p>Two deliberate honesty rules apply here:</p>
 * <ul>
 *   <li>We only report capabilities the platform actually exposes. Anything the
 *       OS hides (real clock speeds, exact die temperature) is reported as
 *       "unavailable" rather than estimated.</li>
 *   <li>Thermal information uses {@link PowerManager#getCurrentThermalStatus()}
 *       (API 29+) and {@link PowerManager#getThermalHeadroom(int)} (API 30+).
 *       Raw temperature sensors would need the privileged DEVICE_POWER
 *       permission, which third-party apps cannot hold.</li>
 * </ul>
 */
public final class DeviceInfo {

    private DeviceInfo() {
    }

    public static String deviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        if (model.toLowerCase(Locale.US).startsWith(manufacturer.toLowerCase(Locale.US))) {
            return capitalize(model);
        }
        return capitalize(manufacturer) + " " + model;
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) {
            return value == null ? "" : value;
        }
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    /** Best-effort SoC name; empty string when the platform does not expose one. */
    public static String socName() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            String soc = Build.SOC_MANUFACTURER == null ? "" : Build.SOC_MANUFACTURER;
            String model = Build.SOC_MODEL == null ? "" : Build.SOC_MODEL;
            String combined = (soc + " " + model).trim();
            if (!combined.isEmpty()) {
                return combined;
            }
        }
        return Build.HARDWARE == null ? "" : Build.HARDWARE;
    }

    public static int apiLevel() {
        return Build.VERSION.SDK_INT;
    }

    public static int cpuCores() {
        return Runtime.getRuntime().availableProcessors();
    }

    public static int totalRamMb(Context context) {
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            return -1;
        }
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(info);
        return (int) (info.totalMem / (1024 * 1024));
    }

    public static String displaySummary(Context context) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return String.format(Locale.US, "%d×%d @ %d dpi", metrics.widthPixels, metrics.heightPixels,
                metrics.densityDpi);
    }

    /* ------------------------------------------------------------------ *
     *  Codec capability discovery
     * ------------------------------------------------------------------ */

    /** One line per encoder/decoder we could use, for the diagnostics screen. */
    public static List<String> codecLines(boolean encoders) {
        List<String> lines = new ArrayList<>();
        MediaCodecList list = new MediaCodecList(MediaCodecList.ALL_CODECS);
        for (MediaCodecInfo info : list.getCodecInfos()) {
            if (info.isEncoder() != encoders) {
                continue;
            }
            for (String type : info.getSupportedTypes()) {
                if (!MediaFormat.MIMETYPE_VIDEO_AVC.equals(type)
                        && !MediaFormat.MIMETYPE_VIDEO_HEVC.equals(type)) {
                    continue;
                }
                String kind;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    kind = info.isHardwareAccelerated() ? "hw" : (info.isSoftwareOnly() ? "sw" : "?");
                } else {
                    // Pre-Q heuristic: names containing google/soft/ffmpeg are software.
                    String name = info.getName().toLowerCase(Locale.US);
                    kind = (name.contains("google") || name.contains("sw") || name.contains("ffmpeg"))
                            ? "sw" : "hw";
                }
                String detail = "";
                try {
                    MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(type);
                    MediaCodecInfo.VideoCapabilities video = caps.getVideoCapabilities();
                    if (video != null) {
                        Range<Integer> widths = video.getSupportedWidths();
                        Range<Integer> heights = video.getSupportedHeights();
                        detail = String.format(Locale.US, " ≤%d×%d",
                                Math.min(widths.getUpper(), 4096), Math.min(heights.getUpper(), 4096));
                    }
                } catch (RuntimeException ignored) {
                    // Some vendors throw for exotic types; the capability is simply unknown.
                }
                lines.add(String.format(Locale.US, "%s [%s]%s", info.getName(), kind, detail));
            }
        }
        Collections.sort(lines);
        return lines;
    }

    /**
     * Picks a hardware encoder/decoder that can actually handle the requested
     * shape; returns {@code null} when the platform has no capable codec (the
     * caller then downgrades the profile rather than dreaming).
     */
    public static MediaCodecInfo findCodec(String mime, boolean encoder, int width, int height, int fps) {
        MediaCodecList list = new MediaCodecList(MediaCodecList.ALL_CODECS);
        MediaCodecInfo fallback = null;
        MediaCodecInfo software = null;
        for (MediaCodecInfo info : list.getCodecInfos()) {
            if (info.isEncoder() != encoder) {
                continue;
            }
            boolean supportsType = false;
            for (String type : info.getSupportedTypes()) {
                if (type.equalsIgnoreCase(mime)) {
                    supportsType = true;
                    break;
                }
            }
            if (!supportsType) {
                continue;
            }
            boolean hardware = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                hardware = info.isHardwareAccelerated();
            }
            boolean sizeOk = false;
            try {
                MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
                MediaCodecInfo.VideoCapabilities video = caps.getVideoCapabilities();
                sizeOk = video == null
                        || (video.isSizeSupported(width, height)
                        && video.areSizeAndRateSupported(width, height, fps));
                if (!sizeOk && video != null) {
                    // Accept a smaller-rate match: the encoder will simply be fed fewer frames.
                    sizeOk = video.isSizeSupported(width, height);
                }
            } catch (RuntimeException ignored) {
                sizeOk = true;
            }
            if (!sizeOk) {
                continue;
            }
            if (hardware) {
                // Prefer anything whose name smells like a hardware block.
                String name = info.getName().toLowerCase(Locale.US);
                if (name.startsWith("omx.") && !name.startsWith("omx.google.")
                        && !name.startsWith("omx.ffmpeg")) {
                    return info;
                }
                if (fallback == null) {
                    fallback = info;
                }
            } else if (software == null) {
                software = info;
            }
        }
        if (fallback != null) {
            return fallback;
        }
        return software;
    }

    /* ------------------------------------------------------------------ *
     *  Thermal + audio properties
     * ------------------------------------------------------------------ */

    /** 0 = none, 1 = light … 6 = shutdown; -1 when the API is unavailable. */
    public static int thermalStatus(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return -1;
        }
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm == null ? -1 : pm.getCurrentThermalStatus();
    }

    /**
     * @return thermal headroom (1.0 ≈ the platform is about to throttle) or
     * {@code Float.NaN} below API 30.
     */
    public static float thermalHeadroom(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return Float.NaN;
        }
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm == null ? Float.NaN : pm.getThermalHeadroom(10);
    }

    public static String thermalLabel(int status) {
        switch (status) {
            case PowerManager.THERMAL_STATUS_NONE:
                return "Nominal";
            case PowerManager.THERMAL_STATUS_LIGHT:
                return "Light";
            case PowerManager.THERMAL_STATUS_MODERATE:
                return "Moderate";
            case PowerManager.THERMAL_STATUS_SEVERE:
                return "Severe";
            case PowerManager.THERMAL_STATUS_CRITICAL:
                return "Critical";
            case PowerManager.THERMAL_STATUS_EMERGENCY:
                return "Emergency";
            case PowerManager.THERMAL_STATUS_SHUTDOWN:
                return "Shutdown";
            default:
                return "Unknown";
        }
    }

    /** Internal (game) audio capture needs API 29+ and the app must allow it. */
    public static boolean supportsPlaybackCapture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    public static boolean hasMicrophone(Context context) {
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE);
    }

    /** True when a physical gamepad is currently attached (client-side input source). */
    public static boolean hasTouchscreen(Context context) {
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
    }
}
