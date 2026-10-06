package com.neurio.vm.spoof;

import com.neurio.vm.core.DeviceIdentity;

import java.util.Locale;

/**
 * Builds the User-Agent strings and Client Hints a real handset would send.
 *
 * <p>Three flavours are produced from one identity:
 * <ul>
 *   <li>{@link #chrome(DeviceIdentity)} — the browser UA, set on
 *       {@code WebSettings.setUserAgentString()} so every request carries it;</li>
 *   <li>{@link #webView(DeviceIdentity)} — the {@code ; wv} variant an app's
 *       embedded WebView reports, useful when reproducing what an app would
 *       send;</li>
 *   <li>{@link #clientHints(DeviceIdentity)} — the {@code navigator.userAgentData}
 *       high-entropy values, injected into the page by {@code spoof.js}.</li>
 * </ul>
 *
 * <p>Chrome build numbers are taken from real release trains so that
 * {@code Chrome/128.0.6613.127} cannot be caught out by a version-consistency
 * check against the {@code Sec-CH-UA-Full-Version-List} hint.
 */
public final class UserAgents {

    /** {@code major → "build.patch"} from actual Chrome for Android releases. */
    private static final String[][] CHROME_BUILDS = {
            {"132", "6921", "92"}, {"131", "6778", "127"}, {"130", "6723", "117"},
            {"129", "6668", "100"}, {"128", "6613", "127"}, {"127", "6533", "103"},
            {"126", "6478", "182"}, {"125", "6422", "165"}, {"124", "6367", "207"},
            {"123", "6312", "122"}, {"122", "6261", "157"}, {"121", "6167", "184"},
            {"120", "6099", "230"}, {"119", "6045", "199"}, {"118", "6045", "123"},
            {"117", "5938", "150"}, {"116", "5845", "187"}, {"115", "5790", "188"},
            {"114", "5735", "190"}, {"113", "5672", "93"},  {"112", "5615", "138"},
            {"110", "5481", "178"}, {"108", "5359", "125"}, {"104", "5112", "101"},
            {"96",  "4664", "110"}, {"89",  "4389", "127"}, {"83",  "4103", "121"},
            {"74",  "3729", "169"},
    };

    private UserAgents() {}

    /** Full {@code major.build.patch} triple for the identity's Chrome major. */
    public static String fullVersion(DeviceIdentity d) {
        String major = String.valueOf(d.chromeMajor);
        for (String[] row : CHROME_BUILDS) {
            if (row[0].equals(major)) return row[0] + ".0." + row[1] + "." + row[2];
        }
        return major + ".0." + nearestBuild(major) + ".100";
    }

    private static String nearestBuild(String major) {
        int m;
        try { m = Integer.parseInt(major); } catch (NumberFormatException e) { return "6613"; }
        String best = CHROME_BUILDS[0][1];
        int bestDiff = Integer.MAX_VALUE;
        for (String[] row : CHROME_BUILDS) {
            int diff = Math.abs(Integer.parseInt(row[0]) - m);
            if (diff < bestDiff) { bestDiff = diff; best = row[1]; }
        }
        return best;
    }

    /** True for tablet-class presets — they do not send the {@code Mobile} token. */
    public static boolean isTablet(DeviceIdentity d) {
        return d.screenWidthDp() >= 600 || d.screenHeightDp() >= 600;
    }

    /** Chrome for Android UA. */
    public static String chrome(DeviceIdentity d) {
        return String.format(Locale.US,
                "Mozilla/5.0 (Linux; Android %s; %s Build/%s) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s%s Safari/537.36",
                d.release, d.model, d.buildId, fullVersion(d), isTablet(d) ? "" : " Mobile");
    }

    /** WebView UA — the {@code ; wv} marker plus {@code Version/4.0}. */
    public static String webView(DeviceIdentity d) {
        return String.format(Locale.US,
                "Mozilla/5.0 (Linux; Android %s; %s Build/%s; wv) AppleWebKit/537.36 (KHTML, like Gecko)"
                        + " Version/4.0 Chrome/%s%s Safari/537.36",
                d.release, d.model, d.buildId, fullVersion(d), isTablet(d) ? "" : " Mobile");
    }

    /** What a desktop browser would send — used by the "look like a PC" toggle. */
    public static String desktop(DeviceIdentity d) {
        return String.format(Locale.US,
                "Mozilla/5.0 (Linux; Android %s; %s Build/%s) AppleWebKit/537.36 (KHTML, like Gecko)"
                        + " Chrome/%s Safari/537.36",
                d.release, d.model, d.buildId, fullVersion(d));
    }

    /** {@code Sec-CH-UA} style brand list, e.g. {@code "Chromium";v="128", "Google Chrome";v="128"}. */
    public static String clientHints(DeviceIdentity d) {
        String major = String.valueOf(d.chromeMajor);
        int brandSeed = Integer.parseInt(major) % 8;
        // Chrome rotates the order of the GREASE brand every major release.
        String grease = GREASE[brandSeed];
        return "\"Not)A;Brand\";v=\"" + grease + "\", \"Chromium\";v=\"" + major
                + "\", \"Google Chrome\";v=\"" + major + "\"";
    }

    public static String fullVersionList(DeviceIdentity d) {
        String fv = fullVersion(d);
        String major = String.valueOf(d.chromeMajor);
        String grease = GREASE[Integer.parseInt(major) % 8];
        return "\"Not)A;Brand\";v=\"8.0.0.0\", \"Chromium\";v=\"" + fv
                + "\", \"Google Chrome\";v=\"" + fv + "\"";
    }

    /** Grease versions Chrome actually rotates through. */
    private static final String[] GREASE = {"8", "24", "99", "100", "9", "5", "16", "2"};

    /** {@code Sec-CH-UA-Platform} — Android reports the release-less name. */
    public static String platform(DeviceIdentity d) {
        return "Android";
    }

    public static String platformVersion(DeviceIdentity d) {
        return d.release + ".0.0";
    }

    /** CPU architecture implied by the hardware string. */
    public static String arch(DeviceIdentity d) {
        String hw = d.hardware == null ? "" : d.hardware.toLowerCase(Locale.US);
        if (hw.contains("goldfish") || hw.contains("vbox") || hw.contains("ranchu")) {
            return hw.contains("x86") || d.model.toLowerCase(Locale.US).contains("x86") ? "x86" : "arm";
        }
        return "arm";
    }

    public static int bitness(DeviceIdentity d) {
        return 64;
    }
}
