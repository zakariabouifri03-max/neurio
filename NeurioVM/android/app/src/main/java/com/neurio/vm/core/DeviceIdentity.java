package com.neurio.vm.core;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * A complete synthetic handset identity.
 *
 * <p>Everything a remote service can observe about "which phone is this" lives
 * here: the {@code android.os.Build} fingerprint, the ANDROID_ID, the telephony
 * identifiers, the display geometry, the locale/timezone pair, and the knobs
 * that decide how aggressively each layer is spoofed.
 *
 * <p>Instances are immutable value objects; {@link #toBuilder()} produces a
 * mutable copy for the editor screen.
 */
public final class DeviceIdentity {

    // ── bookkeeping ────────────────────────────────────────────────────────
    public final String id;            // stable UUID, also the sandbox folder name
    public final String label;         // user visible name, e.g. "Pixel 8 — work"
    public final long createdAt;
    public final String notes;

    // ── android.os.Build ───────────────────────────────────────────────────
    public final String manufacturer;  // Build.MANUFACTURER
    public final String brand;         // Build.BRAND
    public final String model;         // Build.MODEL
    public final String device;        // Build.DEVICE   (codename)
    public final String product;       // Build.PRODUCT
    public final String board;         // Build.BOARD
    public final String hardware;      // Build.HARDWARE (ranchu / qcom / mt6789 …)
    public final String bootloader;    // Build.BOOTLOADER
    public final String displayId;     // Build.DISPLAY
    public final String buildId;       // Build.ID       (AP2A.240905.005 …)
    public final String release;       // Build.VERSION.RELEASE ("14")
    public final int sdkInt;           // Build.VERSION.SDK_INT    (34)
    public final String securityPatch; // Build.VERSION.SECURITY_PATCH
    public final String fingerprint;   // Build.FINGERPRINT — derived, see below
    public final String kernel;        // uname -r as seen by /proc

    // ── identifiers ────────────────────────────────────────────────────────
    public final String androidId;     // Settings.Secure.ANDROID_ID (16 hex)
    public final String serial;        // Build.getSerial()
    public final String gsfId;         // Google Services Framework id (16 hex)
    public final String advertisingId; // GAID, a UUID
    public final String imei;          // 15 digits, valid Luhn
    public final String meid;
    public final String simSerial;     // ICCID, 19–20 digits
    public final String imsi;          // 15 digits, mcc+mnc prefixed
    public final String wifiMac;
    public final String bluetoothMac;
    public final String operatorName;  // "Maroc Telecom"
    public final String operatorMccMnc;// "60400"
    public final String simCountry;    // "ma"

    // ── display / locale ───────────────────────────────────────────────────
    public final int screenWidth;      // physical pixels
    public final int screenHeight;
    public final int densityDpi;       // 420, 440, 480 …
    public final String timezoneId;    // "Africa/Casablanca"
    public final String language;      // "fr"
    public final String country;       // "MA"
    public final int chromeMajor;      // WebView / Chrome major version reported in the UA

    // ── spoofing knobs ─────────────────────────────────────────────────────
    public final boolean spoofBuild;      // rewrite android.os.Build via LSPosed
    public final boolean spoofSettings;   // rewrite ANDROID_ID / GSF id
    public final boolean spoofTelephony;  // rewrite IMEI / IMSI / operator
    public final boolean spoofWebView;    // isolated WebView data dir + UA
    public final boolean spoofJsApi;      // navigator / screen / Intl overrides
    public final boolean spoofWebGl;      // UNMASKED_VENDOR_WEBGL / RENDERER_WEBGL
    public final boolean spoofCanvas;     // per-device canvas + audio fingerprint noise
    public final boolean spoofBattery;    // fake charging state / level
    public final int batteryLevel;        // 0..100 when spoofBattery

    private DeviceIdentity(Builder b) {
        this.id = b.id;
        this.label = b.label;
        this.createdAt = b.createdAt;
        this.notes = b.notes;

        this.manufacturer = b.manufacturer;
        this.brand = b.brand;
        this.model = b.model;
        this.device = b.device;
        this.product = b.product;
        this.board = b.board;
        this.hardware = b.hardware;
        this.bootloader = b.bootloader;
        this.displayId = b.displayId;
        this.buildId = b.buildId;
        this.release = b.release;
        this.sdkInt = b.sdkInt;
        this.securityPatch = b.securityPatch;
        this.fingerprint = b.fingerprint != null ? b.fingerprint
                : buildFingerprint(b.brand, b.device, b.release, b.buildId, b.securityPatch, b.model);
        this.kernel = b.kernel;

        this.androidId = b.androidId;
        this.serial = b.serial;
        this.gsfId = b.gsfId;
        this.advertisingId = b.advertisingId;
        this.imei = b.imei;
        this.meid = b.meid;
        this.simSerial = b.simSerial;
        this.imsi = b.imsi;
        this.wifiMac = b.wifiMac;
        this.bluetoothMac = b.bluetoothMac;
        this.operatorName = b.operatorName;
        this.operatorMccMnc = b.operatorMccMnc;
        this.simCountry = b.simCountry;

        this.screenWidth = b.screenWidth;
        this.screenHeight = b.screenHeight;
        this.densityDpi = b.densityDpi;
        this.timezoneId = b.timezoneId;
        this.language = b.language;
        this.country = b.country;
        this.chromeMajor = b.chromeMajor;

        this.spoofBuild = b.spoofBuild;
        this.spoofSettings = b.spoofSettings;
        this.spoofTelephony = b.spoofTelephony;
        this.spoofWebView = b.spoofWebView;
        this.spoofJsApi = b.spoofJsApi;
        this.spoofWebGl = b.spoofWebGl;
        this.spoofCanvas = b.spoofCanvas;
        this.spoofBattery = b.spoofBattery;
        this.batteryLevel = b.batteryLevel;
    }

    /**
     * AOSP fingerprint layout:
     * {@code brand/product/device:release/buildId/incremental:tags/type}
     * e.g. {@code google/oriole/oriole:14/AP2A.240905.005/12231197:user/release-keys}
     */
    public static String buildFingerprint(String brand, String device, String release,
                                          String buildId, String incremental, String model) {
        String b = lower(brand == null ? "generic" : brand);
        String p = lower(device == null ? "generic" : device);
        String d = p;
        String inc = incremental == null || incremental.isEmpty() ? "12231197" : incremental;
        return b + "/" + p + "/" + d + ":" + release + "/" + buildId + "/" + inc
                + ":user/release-keys";
    }

    private static String lower(String s) {
        return s.toLowerCase(Locale.US).replace(' ', '_');
    }

    /** What the user sees in the device list. */
    public String displayName() {
        return label == null || label.isEmpty() ? (manufacturer + " " + model) : label;
    }

    public String localeTag() {
        return language + "-" + country;
    }

    public float densityFactor() {
        return densityDpi / 160f;
    }

    public int screenWidthDp() {
        return Math.round(screenWidth / densityFactor());
    }

    public int screenHeightDp() {
        return Math.round(screenHeight / densityFactor());
    }

    public Builder toBuilder() {
        Builder b = new Builder();
        b.id = id; b.label = label; b.createdAt = createdAt; b.notes = notes;
        b.manufacturer = manufacturer; b.brand = brand; b.model = model; b.device = device;
        b.product = product; b.board = board; b.hardware = hardware; b.bootloader = bootloader;
        b.displayId = displayId; b.buildId = buildId; b.release = release; b.sdkInt = sdkInt;
        b.securityPatch = securityPatch; b.fingerprint = fingerprint; b.kernel = kernel;
        b.androidId = androidId; b.serial = serial; b.gsfId = gsfId; b.advertisingId = advertisingId;
        b.imei = imei; b.meid = meid; b.simSerial = simSerial; b.imsi = imsi;
        b.wifiMac = wifiMac; b.bluetoothMac = bluetoothMac; b.operatorName = operatorName;
        b.operatorMccMnc = operatorMccMnc; b.simCountry = simCountry;
        b.screenWidth = screenWidth; b.screenHeight = screenHeight; b.densityDpi = densityDpi;
        b.timezoneId = timezoneId; b.language = language; b.country = country;
        b.chromeMajor = chromeMajor;
        b.spoofBuild = spoofBuild; b.spoofSettings = spoofSettings; b.spoofTelephony = spoofTelephony;
        b.spoofWebView = spoofWebView; b.spoofJsApi = spoofJsApi; b.spoofWebGl = spoofWebGl;
        b.spoofCanvas = spoofCanvas; b.spoofBattery = spoofBattery; b.batteryLevel = batteryLevel;
        return b;
    }

    public static Builder builder() {
        return new Builder();
    }

    // ── JSON ───────────────────────────────────────────────────────────────

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("label", label);
        o.put("createdAt", createdAt);
        o.put("notes", notes);
        o.put("manufacturer", manufacturer);
        o.put("brand", brand);
        o.put("model", model);
        o.put("device", device);
        o.put("product", product);
        o.put("board", board);
        o.put("hardware", hardware);
        o.put("bootloader", bootloader);
        o.put("displayId", displayId);
        o.put("buildId", buildId);
        o.put("release", release);
        o.put("sdkInt", sdkInt);
        o.put("securityPatch", securityPatch);
        o.put("fingerprint", fingerprint);
        o.put("kernel", kernel);
        o.put("androidId", androidId);
        o.put("serial", serial);
        o.put("gsfId", gsfId);
        o.put("advertisingId", advertisingId);
        o.put("imei", imei);
        o.put("meid", meid);
        o.put("simSerial", simSerial);
        o.put("imsi", imsi);
        o.put("wifiMac", wifiMac);
        o.put("bluetoothMac", bluetoothMac);
        o.put("operatorName", operatorName);
        o.put("operatorMccMnc", operatorMccMnc);
        o.put("simCountry", simCountry);
        o.put("screenWidth", screenWidth);
        o.put("screenHeight", screenHeight);
        o.put("densityDpi", densityDpi);
        o.put("timezoneId", timezoneId);
        o.put("language", language);
        o.put("country", country);
        o.put("chromeMajor", chromeMajor);
        o.put("spoofBuild", spoofBuild);
        o.put("spoofSettings", spoofSettings);
        o.put("spoofTelephony", spoofTelephony);
        o.put("spoofWebView", spoofWebView);
        o.put("spoofJsApi", spoofJsApi);
        o.put("spoofWebGl", spoofWebGl);
        o.put("spoofCanvas", spoofCanvas);
        o.put("spoofBattery", spoofBattery);
        o.put("batteryLevel", batteryLevel);
        return o;
    }

    public static DeviceIdentity fromJson(JSONObject o) throws JSONException {
        Builder b = new Builder();
        b.id = o.optString("id", null);
        b.label = o.optString("label", "");
        b.createdAt = o.optLong("createdAt", System.currentTimeMillis());
        b.notes = o.optString("notes", "");
        b.manufacturer = o.optString("manufacturer", "Google");
        b.brand = o.optString("brand", "google");
        b.model = o.optString("model", "Pixel 8");
        b.device = o.optString("device", "shiba");
        b.product = o.optString("product", b.device);
        b.board = o.optString("board", "shiba");
        b.hardware = o.optString("hardware", "tensor");
        b.bootloader = o.optString("bootloader", "unknown");
        b.displayId = o.optString("displayId", "AP2A");
        b.buildId = o.optString("buildId", "AP2A.240905.005");
        b.release = o.optString("release", "14");
        b.sdkInt = o.optInt("sdkInt", 34);
        b.securityPatch = o.optString("securityPatch", "2024-09-05");
        b.fingerprint = o.optString("fingerprint", null);
        b.kernel = o.optString("kernel", "5.10.0");
        b.androidId = o.optString("androidId", "");
        b.serial = o.optString("serial", "");
        b.gsfId = o.optString("gsfId", "");
        b.advertisingId = o.optString("advertisingId", "");
        b.imei = o.optString("imei", "");
        b.meid = o.optString("meid", "");
        b.simSerial = o.optString("simSerial", "");
        b.imsi = o.optString("imsi", "");
        b.wifiMac = o.optString("wifiMac", "");
        b.bluetoothMac = o.optString("bluetoothMac", "");
        b.operatorName = o.optString("operatorName", "");
        b.operatorMccMnc = o.optString("operatorMccMnc", "");
        b.simCountry = o.optString("simCountry", "");
        b.screenWidth = o.optInt("screenWidth", 1080);
        b.screenHeight = o.optInt("screenHeight", 2400);
        b.densityDpi = o.optInt("densityDpi", 420);
        b.timezoneId = o.optString("timezoneId", "Africa/Casablanca");
        b.language = o.optString("language", "fr");
        b.country = o.optString("country", "MA");
        b.chromeMajor = o.optInt("chromeMajor", 128);
        b.spoofBuild = o.optBoolean("spoofBuild", true);
        b.spoofSettings = o.optBoolean("spoofSettings", true);
        b.spoofTelephony = o.optBoolean("spoofTelephony", true);
        b.spoofWebView = o.optBoolean("spoofWebView", true);
        b.spoofJsApi = o.optBoolean("spoofJsApi", true);
        b.spoofWebGl = o.optBoolean("spoofWebGl", true);
        b.spoofCanvas = o.optBoolean("spoofCanvas", true);
        b.spoofBattery = o.optBoolean("spoofBattery", false);
        b.batteryLevel = o.optInt("batteryLevel", 87);
        return b.build();
    }

    /** Mutable accumulator; also the target of the editor screen. */
    public static final class Builder {
        public String id;
        public String label = "";
        public long createdAt = System.currentTimeMillis();
        public String notes = "";

        public String manufacturer = "Google";
        public String brand = "google";
        public String model = "Pixel 8";
        public String device = "shiba";
        public String product = "shiba";
        public String board = "shiba";
        public String hardware = "tensor";
        public String bootloader = "unknown";
        public String displayId = "AP2A";
        public String buildId = "AP2A.240905.005";
        public String release = "14";
        public int sdkInt = 34;
        public String securityPatch = "2024-09-05";
        public String fingerprint; // null → derived in the constructor
        public String kernel = "5.10.0";

        public String androidId = "";
        public String serial = "";
        public String gsfId = "";
        public String advertisingId = "";
        public String imei = "";
        public String meid = "";
        public String simSerial = "";
        public String imsi = "";
        public String wifiMac = "";
        public String bluetoothMac = "";
        public String operatorName = "";
        public String operatorMccMnc = "";
        public String simCountry = "";

        public int screenWidth = 1080;
        public int screenHeight = 2400;
        public int densityDpi = 420;
        public String timezoneId = "Africa/Casablanca";
        public String language = "fr";
        public String country = "MA";
        public int chromeMajor = 128;

        public boolean spoofBuild = true;
        public boolean spoofSettings = true;
        public boolean spoofTelephony = true;
        public boolean spoofWebView = true;
        public boolean spoofJsApi = true;
        public boolean spoofWebGl = true;
        public boolean spoofCanvas = true;
        public boolean spoofBattery = false;
        public int batteryLevel = 87;

        public Builder label(String v) { this.label = v; return this; }

        public DeviceIdentity build() {
            return new DeviceIdentity(this);
        }
    }
}
