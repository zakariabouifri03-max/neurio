package com.neurio.vm.spoof;

import android.content.Context;
import android.webkit.WebView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.util.Hex;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;
import java.util.TimeZone;

/**
 * Bridges a {@link DeviceIdentity} into the guest page.
 *
 * <p>Injection happens in two steps, both through
 * {@link WebView#evaluateJavascript(String, android.webkit.ValueCallback)}:
 * <ol>
 *   <li>a bootstrap statement defining {@code window.__NEURIO__} — the config
 *       object built from the identity;</li>
 *   <li>{@code assets/spoof.js}, which reads that config and installs every
 *       override.</li>
 * </ol>
 *
 * <p><b>Known limitation, stated plainly:</b> {@code evaluateJavascript} runs in
 * the main frame only. Without {@code WebViewCompat.addDocumentStartJavaScript}
 * (an AndroidX API, and this project deliberately has no AndroidX dependency) a
 * cross-origin {@code <iframe>} keeps the host's real {@code navigator}. Pages
 * that fingerprint from inside such a frame will see through the spoof. The
 * browser UI therefore shows a warning badge when a page contains iframes.
 */
public final class SpoofScript {

    private static final String TAG = "SpoofScript";
    private static final String ASSET = "spoof.js";
    private static volatile String cachedScript;

    private SpoofScript() {}

    /** Loads {@code assets/spoof.js} once per process. */
    public static String script(Context ctx) {
        String s = cachedScript;
        if (s == null) {
            try {
                s = Io.readAsset(ctx, ASSET);
                cachedScript = s;
            } catch (Exception e) {
                Log.e(TAG, "cannot read " + ASSET, e);
                s = "/* spoof.js missing */";
                cachedScript = s;
            }
        }
        return s;
    }

    /**
     * Full payload: config object + script. Idempotent, so it is safe to run on
     * both {@code onPageStarted} and {@code onPageFinished}.
     */
    public static String payload(Context ctx, DeviceIdentity d) {
        try {
            JSONObject cfg = config(ctx, d);
            return "window.__NEURIO__=" + escapeJs(cfg.toString()) + ";" + script(ctx);
        } catch (JSONException e) {
            Log.e(TAG, "could not build the spoof config", e);
            return "";
        }
    }

    public static void inject(WebView wv, Context ctx, DeviceIdentity d) {
        String p = payload(ctx, d);
        if (p.isEmpty()) return;
        try {
            wv.evaluateJavascript(p, null);
        } catch (Throwable t) {
            Log.w(TAG, "injection failed: " + t.getMessage());
        }
    }

    /**
     * Asks the page for its own view of the device and hands back the JSON.
     *
     * <p>{@code evaluateJavascript} returns the result as a JSON <em>string
     * literal</em> — quoted and backslash-escaped — so it is decoded through
     * {@link org.json.JSONTokener} before being handed to the caller.
     */
    public static void report(WebView wv, final android.webkit.ValueCallback<String> cb) {
        wv.evaluateJavascript(
                "(function(){try{return JSON.stringify(window.__NEURIO_REPORT__())}"
                        + "catch(e){return JSON.stringify({error:String(e)})}})()",
                value -> {
                    if (cb == null) return;
                    cb.onReceiveValue(decode(value));
                });
    }

    private static String decode(String value) {
        if (value == null || "null".equals(value)) return null;
        if (value.length() >= 2 && value.charAt(0) == '"' && value.charAt(value.length() - 1) == '"') {
            try {
                Object parsed = new org.json.JSONTokener(value).nextValue();
                if (parsed instanceof String) return (String) parsed;
            } catch (JSONException e) {
                Log.w(TAG, "could not decode the report: " + e.getMessage());
            }
        }
        return value;
    }

    /** U+2028/U+2029 are valid JSON but are line terminators in JS source. */
    private static String escapeJs(String json) {
        return json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    // ── config construction ────────────────────────────────────────────────

    public static JSONObject config(Context ctx, DeviceIdentity d) throws JSONException {
        int seed = Hex.stableHash(d.androidId == null || d.androidId.isEmpty() ? d.id : d.androidId);
        float dpr = d.densityFactor();
        int cssW = Math.max(320, Math.round(d.screenWidth / dpr));
        int cssH = Math.max(480, Math.round(d.screenHeight / dpr));

        JSONObject o = new JSONObject();
        o.put("device", d.displayName());
        o.put("seed", seed);
        o.put("localeTag", d.localeTag());
        o.put("jsApi", d.spoofJsApi);
        o.put("userAgent", d.spoofWebView ? UserAgents.chrome(d) : null);

        if (d.spoofJsApi) {
            o.put("language", d.language);
            o.put("languages", languages(d));
            o.put("cores", coresFor(d));
            o.put("deviceMemory", memoryFor(d));
            o.put("maxTouchPoints", 5);

            JSONObject uad = new JSONObject();
            uad.put("brands", brands(d));
            uad.put("mobile", !UserAgents.isTablet(d));
            uad.put("platform", UserAgents.platform(d));
            uad.put("architecture", UserAgents.arch(d));
            uad.put("bitness", String.valueOf(UserAgents.bitness(d)));
            uad.put("model", d.model);
            uad.put("platformVersion", UserAgents.platformVersion(d));
            uad.put("uaFullVersion", UserAgents.fullVersion(d));
            uad.put("fullVersionList", fullVersionList(d));
            uad.put("formFactor", UserAgents.isTablet(d) ? "Tablet" : "Mobile");
            o.put("userAgentData", uad);

            JSONObject screen = new JSONObject();
            screen.put("width", cssW);
            screen.put("height", cssH);
            screen.put("availWidth", cssW);
            screen.put("availHeight", Math.max(320, cssH - 48));
            screen.put("colorDepth", 24);
            screen.put("pixelDepth", 24);
            screen.put("dpr", round2(dpr));
            screen.put("portrait", cssH >= cssW);
            o.put("screen", screen);

            JSONObject net = new JSONObject();
            net.put("effectiveType", "4g");
            net.put("downlink", 8.45);
            net.put("rtt", 50);
            o.put("network", net);

            JSONObject store = new JSONObject();
            store.put("quota", 26_000_000_000L);
            store.put("usage", 4_200_000L + (Math.abs(seed) % 900_000));
            o.put("storage", store);

            o.put("mediaDevices", mediaDevices(seed));
        }

        TimeZone tz = TimeZone.getTimeZone(d.timezoneId);
        JSONObject zone = new JSONObject();
        zone.put("id", tz.getID());
        // Date.getTimezoneOffset() returns minutes WEST of UTC; TimeZone returns east
        zone.put("offsetMinutes", -(tz.getOffset(System.currentTimeMillis()) / 60_000));
        o.put("timezone", zone);

        if (d.spoofWebGl) o.put("webgl", webgl(d, seed));
        if (d.spoofCanvas) o.put("canvas", canvas(seed));
        if (d.spoofJsApi) o.put("audio", audio(seed));
        if (d.spoofBattery) {
            JSONObject bat = new JSONObject();
            bat.put("level", round2(Math.max(1, Math.min(100, d.batteryLevel)) / 100f));
            bat.put("charging", d.batteryLevel >= 96);
            o.put("battery", bat);
        }
        if (d.spoofJsApi) {
            JSONObject rtc = new JSONObject();
            rtc.put("maskIp", "192.168." + ((seed >>> 8) & 0xFF) + "." + ((seed >>> 16) & 0xFF));
            rtc.put("maskIpv6", "fe80:0000:0000:0000:0000:0000:0000:0001");
            o.put("webrtc", rtc);
        }
        return o;
    }

    private static JSONArray languages(DeviceIdentity d) throws JSONException {
        JSONArray a = new JSONArray();
        String tag = d.localeTag();
        a.put(d.language);
        if (!tag.equals(d.language)) a.put(tag);
        if (!d.language.equals("en")) { a.put("en-US"); a.put("en"); }
        return a;
    }

    private static JSONArray brands(DeviceIdentity d) throws JSONException {
        JSONArray a = new JSONArray();
        String major = String.valueOf(d.chromeMajor);
        int grease = d.chromeMajor % 8;
        String[] greaseVersions = {"8", "24", "99", "100", "9", "5", "16", "2"};
        a.put(brand("Not)A;Brand", greaseVersions[grease % greaseVersions.length]));
        a.put(brand("Chromium", major));
        a.put(brand("Google Chrome", major));
        return a;
    }

    private static JSONArray fullVersionList(DeviceIdentity d) throws JSONException {
        JSONArray a = new JSONArray();
        String fv = UserAgents.fullVersion(d);
        a.put(brand("Not)A;Brand", "8.0.0.0"));
        a.put(brand("Chromium", fv));
        a.put(brand("Google Chrome", fv));
        return a;
    }

    private static JSONObject brand(String b, String v) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("brand", b);
        o.put("version", v);
        return o;
    }

    /** Physical cores typical for the SoC family behind {@code ro.hardware}. */
    private static int coresFor(DeviceIdentity d) {
        String hw = d.hardware == null ? "" : d.hardware.toLowerCase(Locale.US);
        if (hw.contains("ranchu") || hw.contains("goldfish")) return 4;
        if (hw.contains("vbox")) return 2;
        if (hw.contains("cutf")) return 8;
        if (hw.contains("redroid")) return 8;
        if (hw.contains("pineapple") || hw.contains("kalama") || hw.contains("exynos2400")) return 8;
        if (hw.contains("mt6") || hw.contains("bengal") || hw.contains("holi")) return 8;
        return 8;
    }

    /**
     * navigator.deviceMemory is bucketed by Chrome to 0.25 / 0.5 / 1 / 2 / 4 / 8,
     * so only those values are ever emitted — a "6" would itself be a tell.
     */
    private static int memoryFor(DeviceIdentity d) {
        String hw = d.hardware == null ? "" : d.hardware.toLowerCase(Locale.US);
        if (hw.contains("vbox") || hw.contains("mt6769") || hw.contains("bengal")
                || hw.contains("mt6781") || hw.contains("mt6789")) {
            return 4;
        }
        return 8;
    }

    // ── WebGL ──────────────────────────────────────────────────────────────

    private static JSONObject webgl(DeviceIdentity d, int seed) throws JSONException {
        String hw = d.hardware == null ? "" : d.hardware.toLowerCase(Locale.US);
        String vendor, renderer;
        if (hw.contains("ranchu") || hw.contains("goldfish")) {
            vendor = "Google Inc. (Google)";
            renderer = "ANGLE (Google, Vulkan 1.1.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)),"
                    + " SwiftShader driver)";
        } else if (hw.contains("vbox")) {
            vendor = "VMware, Inc.";
            renderer = "VMware SVGA 3D";
        } else if (hw.contains("cutf")) {
            vendor = "Google Inc. (Google)";
            renderer = "ANGLE (Google, Vulkan 1.1.0 (CrosVM), SwiftShader driver)";
        } else if (hw.contains("redroid")) {
            vendor = "Google Inc. (Google)";
            renderer = "ANGLE (Google, Vulkan 1.1.0 (redroid))";
        } else if (hw.contains("pineapple")) {
            vendor = "Qualcomm";
            renderer = "Adreno (TM) 750";
        } else if (hw.contains("kalama") || hw.contains("taro") || hw.contains("lahaina")) {
            vendor = "Qualcomm";
            renderer = "Adreno (TM) 740";
        } else if (hw.contains("bengal") || hw.contains("holi") || hw.contains("sm6")) {
            vendor = "Qualcomm";
            renderer = "Adreno (TM) 619";
        } else if (hw.contains("exynos") || hw.contains("s5e")) {
            vendor = "ARM";
            renderer = "Mali-G720 MC12";
        } else if (hw.contains("tensor")) {
            vendor = "ARM";
            renderer = "Mali-G715 MC7";
        } else if (hw.contains("kirin") || hw.contains("hisilicon")) {
            vendor = "ARM";
            renderer = "Mali-G76 MP10";
        } else if (hw.contains("mt6897") || hw.contains("mt6877")) {
            vendor = "ARM";
            renderer = "Mali-G610 MC6";
        } else if (hw.contains("mt")) {
            vendor = "ARM";
            renderer = "Mali-G57 MC2";
        } else {
            vendor = "Qualcomm";
            renderer = "Adreno (TM) 640";
        }

        JSONObject g = new JSONObject();
        g.put("vendor", vendor);
        g.put("renderer", renderer);
        g.put("glVersion", "WebGL 1.0 (OpenGL ES 2.0 Chromium)");
        g.put("shadingLanguage", "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)");

        boolean flagship = renderer.contains("750") || renderer.contains("740")
                || renderer.contains("G720") || renderer.contains("G715");
        JSONObject l = new JSONObject();
        l.put("maxTextureSize", flagship ? 16384 : 8192);
        l.put("maxCubeMap", flagship ? 16384 : 8192);
        l.put("maxVertexAttribs", 16);
        l.put("maxVaryingVectors", flagship ? 15 : 16);
        l.put("maxVertexUniforms", flagship ? 4096 : 1024);
        l.put("maxFragmentUniforms", flagship ? 4096 : 1024);
        l.put("maxTextureImageUnits", 16);
        l.put("maxCombinedTextures", flagship ? 80 : 32);
        g.put("limits", l);
        return g;
    }

    // ── canvas / audio ─────────────────────────────────────────────────────

    private static JSONObject canvas(int seed) throws JSONException {
        JSONObject c = new JSONObject();
        c.put("amplitude", 1);
        c.put("coverage", 0.34);
        c.put("alpha", 0.004);
        c.put("dots", 240);
        int r = 40 + (Math.abs(seed) % 176);
        int g = 40 + (Math.abs(seed >>> 8) % 176);
        int b = 40 + (Math.abs(seed >>> 16) % 176);
        c.put("stampColor", String.format(Locale.US, "#%02x%02x%02x", r, g, b));
        return c;
    }

    private static JSONObject audio(int seed) throws JSONException {
        JSONObject a = new JSONObject();
        // just above float32 rounding, so it changes the hash without being audible
        a.put("amplitude", 0.0000200 + (Math.abs(seed) % 100) / 10_000_000.0);
        a.put("touchRender", true);
        return a;
    }

    private static JSONArray mediaDevices(int seed) throws JSONException {
        JSONArray a = new JSONArray();
        a.put(device("audioinput", seed, 1, "Built-in Microphone"));
        a.put(device("audiooutput", seed, 2, "Built-in Speaker"));
        a.put(device("videoinput", seed, 3, "Back Camera"));
        a.put(device("videoinput", seed, 4, "Front Camera"));
        return a;
    }

    private static JSONObject device(String kind, int seed, int n, String label) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("kind", kind);
        o.put("label", label);
        String group = Hex.of(new byte[]{
                (byte) (seed >>> 24), (byte) (seed >>> 16), (byte) (seed >>> 8), (byte) seed,
                (byte) n, (byte) (n * 7), (byte) (n * 13), (byte) (n * 29)});
        o.put("groupId", group);
        o.put("deviceId", Hex.of(new byte[]{
                (byte) (seed >>> 16), (byte) (seed >>> 8), (byte) seed, (byte) n,
                (byte) (n + 1), (byte) (n + 2), (byte) (n + 3), (byte) (n * 31)}));
        return o;
    }

    private static double round2(float v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
