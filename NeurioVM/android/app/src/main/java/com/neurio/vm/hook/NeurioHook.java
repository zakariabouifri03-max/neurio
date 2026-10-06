package com.neurio.vm.hook;

import android.bluetooth.BluetoothAdapter;
import android.content.ContentResolver;
import android.content.Context;
import android.net.wifi.WifiInfo;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Log;

import com.neurio.vm.core.DeviceIdentity;

import java.util.TimeZone;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XC_MethodReplacement;
import de.robv.android.xposed.XSharedPreferences;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * The LSPosed module that makes a *native* app believe it is running on the
 * virtual handset.
 *
 * <p>This is the only way to rewrite {@code android.os.Build.MODEL} for somebody
 * else's process: those are static fields in the reader's own JVM, and nothing
 * running inside NeurioVM can reach across to another app's heap. A hook
 * framework can, because it is loaded into every process the user selects.
 *
 * <h2>What gets rewritten</h2>
 * <table>
 *   <tr><td>Build</td><td>MODEL, BRAND, DEVICE, PRODUCT, MANUFACTURER, BOARD,
 *       HARDWARE, BOOTLOADER, DISPLAY, ID, FINGERPRINT, TAGS, TYPE, getSerial()</td></tr>
 *   <tr><td>Build.VERSION</td><td>RELEASE, SDK_INT, SECURITY_PATCH, INCREMENTAL, BASE_OS</td></tr>
 *   <tr><td>Settings.Secure</td><td>android_id, bluetooth_address</td></tr>
 *   <tr><td>TelephonyManager</td><td>deviceId, imei, meid, subscriberId,
 *       simSerialNumber, networkOperator(+Name), simOperator(+Name), country ISOs, line1Number</td></tr>
 *   <tr><td>Network</td><td>WifiInfo.getMacAddress/getBSSID/getSSID,
 *       NetworkInterface.getHardwareAddress, BluetoothAdapter.getAddress</td></tr>
 *   <tr><td>Clock</td><td>TimeZone.getDefault()</td></tr>
 *   <tr><td>Ads</td><td>AdvertisingIdClient$Info.getId() when Play Services is present</td></tr>
 * </table>
 *
 * <h2>What deliberately does not</h2>
 * {@code Locale.getDefault()} is left alone — forcing a locale from a hook
 * breaks date/number formatting and crashes enough apps that the trade is not
 * worth it. The virtual device's locale is applied inside NeurioVM's own
 * browser, where it can be done safely.
 *
 * <h2>Loading order</h2> {@code android.os.Build} is often read before an
 * {@code Application} object exists, so the config is first attempted through
 * {@link XSharedPreferences} (no Context needed). When that is unavailable —
 * which is the normal case on a device where LSPosed cannot read another app's
 * private prefs — the module hooks {@code Application.attach(Context)} and asks
 * {@link HookProvider} as soon as a Context exists. Both paths converge on
 * {@link #apply(HookConfig, XC_LoadPackage.LoadPackageParam)}.
 *
 * <p>Requires: a rooted device with LSPosed installed, NeurioVM enabled as a
 * module, and the target app added to its scope. Without any of that this class
 * is never loaded and the APK behaves exactly as before.
 */
public final class NeurioHook implements IXposedHookLoadPackage {

    private static final String TAG = "NeurioVM/Hook";
    private static boolean applied;

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) throws Throwable {
        final String pkg = lpparam.packageName;
        if (pkg == null || pkg.equals("com.neurio.vm")) return;
        if (pkg.startsWith("android") || pkg.startsWith("com.android.")) return;

        HookConfig early = readFromPrefs();
        if (early != null && early.appliesTo(pkg)) {
            apply(early, lpparam);
            return;
        }
        deferUntilContext(pkg, lpparam);
    }

    /** Fast path: LSPosed's cross-process prefs reader. Needs no Context. */
    private static HookConfig readFromPrefs() {
        try {
            XSharedPreferences p = new XSharedPreferences("com.neurio.vm", HookConfig.PREFS);
            p.reload();
            if (!p.getBoolean(HookConfig.KEY_ENABLED, false)) return null;
            return HookConfig.fromJson(p.getString(HookConfig.KEY_JSON, null));
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Slow path: wait for the target app to be attached to a Context, then read
     * the config through our exported content provider.
     */
    private static void deferUntilContext(final String pkg, final XC_LoadPackage.LoadPackageParam lpparam) {
        XC_MethodHook onContext = new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                if (applied) return;
                Context ctx = null;
                for (Object a : param.args) {
                    if (a instanceof Context) { ctx = (Context) a; break; }
                }
                if (ctx == null && param.args.length > 0 && param.args[0] instanceof android.app.Application) {
                    ctx = ((android.app.Application) param.args[0]).getApplicationContext();
                }
                if (ctx == null) return;
                HookConfig cfg = HookConfig.fromProvider(ctx);
                if (cfg != null && cfg.appliesTo(pkg)) apply(cfg, lpparam);
            }
        };

        try {
            XposedHelpers.findAndHookMethod("android.app.Application", lpparam.classLoader,
                    "attach", Context.class, onContext);
            return;
        } catch (Throwable ignored) { }

        try {
            XposedHelpers.findAndHookMethod("android.app.Instrumentation", lpparam.classLoader,
                    "callApplicationOnCreate", android.app.Application.class, onContext);
        } catch (Throwable t) {
            safeLog("could not hook an application entry point: " + t);
        }
    }

    // ── the hooks ──────────────────────────────────────────────────────────

    private static synchronized void apply(HookConfig cfg, XC_LoadPackage.LoadPackageParam lpparam) {
        if (applied) return;
        applied = true;
        DeviceIdentity d = cfg.identity;
        safeLog("spoofing " + lpparam.packageName + " as " + d.displayName()
                + " [" + d.fingerprint + "]");

        if (d.spoofBuild) hookBuild(d);
        if (d.spoofSettings) hookSettingsSecure(d);
        if (d.spoofTelephony) hookTelephony(d);
        if (d.spoofSettings) hookNetworkIds(d);
        hookTimeZone(d);
        hookAdvertisingId(d, lpparam.classLoader);

        safeLog("hooks installed for " + lpparam.packageName);
    }

    /** {@code android.os.Build} is a bag of {@code static final} fields. */
    private static void hookBuild(DeviceIdentity d) {
        set(Build.class, "MODEL", d.model);
        set(Build.class, "BRAND", d.brand);
        set(Build.class, "DEVICE", d.device);
        set(Build.class, "PRODUCT", d.product);
        set(Build.class, "MANUFACTURER", d.manufacturer);
        set(Build.class, "BOARD", d.board);
        set(Build.class, "HARDWARE", d.hardware);
        set(Build.class, "BOOTLOADER", d.bootloader);
        set(Build.class, "DISPLAY", d.displayId);
        set(Build.class, "ID", d.buildId);
        set(Build.class, "FINGERPRINT", d.fingerprint);
        set(Build.class, "TAGS", "release-keys");
        set(Build.class, "TYPE", "user");
        set(Build.class, "HOST", "abfarm-release");
        set(Build.VERSION.class, "RELEASE", d.release);
        set(Build.VERSION.class, "SECURITY_PATCH", d.securityPatch);
        set(Build.VERSION.class, "INCREMENTAL", "12231197");
        set(Build.VERSION.class, "CODENAME", "REL");
        setInt(Build.VERSION.class, "SDK_INT", d.sdkInt);
        set(Build.VERSION.class, "SDK", String.valueOf(d.sdkInt));

        // Build.getSerial() is a method from API 26; Build.SERIAL is a field before that
        try {
            XposedBridge.hookAllMethods(Build.class, "getSerial",
                    XC_MethodReplacement.returnConstant(d.serial));
        } catch (Throwable ignored) { }
        set(Build.class, "SERIAL", d.serial);

        try {
            XposedBridge.hookAllMethods(Build.class, "getRadioVersion",
                    XC_MethodReplacement.returnConstant(d.buildId));
        } catch (Throwable ignored) { }
    }

    private static void hookSettingsSecure(DeviceIdentity d) {
        try {
            XposedHelpers.findAndHookMethod(Settings.Secure.class, "getString",
                    ContentResolver.class, String.class,
                    new XC_MethodHook() {
                        @Override
                        protected void afterHookedMethod(MethodHookParam param) {
                            String key = (String) param.args[1];
                            if ("android_id".equals(key) && d.androidId != null) {
                                param.setResult(d.androidId);
                            } else if ("bluetooth_address".equals(key) && d.bluetoothMac != null) {
                                param.setResult(d.bluetoothMac);
                            }
                        }
                    });
        } catch (Throwable t) {
            safeLog("Settings.Secure hook failed: " + t);
        }
    }

    /** hookAllMethods covers every overload, so getImei() and getImei(int) both land. */
    private static void hookTelephony(DeviceIdentity d) {
        Class<?> tm = TelephonyManager.class;
        constant(tm, "getDeviceId", d.imei);
        constant(tm, "getImei", d.imei);
        constant(tm, "getMeid", d.meid);
        constant(tm, "getSubscriberId", d.imsi);
        constant(tm, "getSimSerialNumber", d.simSerial);
        constant(tm, "getNetworkOperator", d.operatorMccMnc);
        constant(tm, "getSimOperator", d.operatorMccMnc);
        constant(tm, "getNetworkOperatorName", d.operatorName);
        constant(tm, "getSimOperatorName", d.operatorName);
        constant(tm, "getSimCountryIso", lower(d.simCountry));
        constant(tm, "getNetworkCountryIso", lower(d.simCountry));
        constant(tm, "getLine1Number", "");
        constant(tm, "getVoiceMailNumber", "");
        constantInt(tm, "getPhoneType", TelephonyManager.PHONE_TYPE_GSM);
        constantInt(tm, "getSimState", TelephonyManager.SIM_STATE_READY);
    }

    private static void hookNetworkIds(DeviceIdentity d) {
        try {
            constant(WifiInfo.class, "getMacAddress", d.wifiMac);
            // Android 6+ hands apps a placeholder BSSID/SSID unless location is granted;
            // returning the placeholder keeps us consistent with a stock device.
            constant(WifiInfo.class, "getBSSID", "02:00:00:00:00:00");
            constant(WifiInfo.class, "getSSID", "<unknown ssid>");
        } catch (Throwable t) {
            safeLog("WifiInfo hook failed: " + t);
        }

        try {
            constant(BluetoothAdapter.class, "getAddress", d.bluetoothMac);
        } catch (Throwable t) {
            safeLog("BluetoothAdapter hook failed: " + t);
        }

        // NetworkInterface.getHardwareAddress() is a static method returning byte[]
        try {
            XposedBridge.hookAllMethods(java.net.NetworkInterface.class, "getHardwareAddress",
                    XC_MethodReplacement.returnConstant(macBytes(d.wifiMac)));
        } catch (Throwable t) {
            safeLog("NetworkInterface hook failed: " + t);
        }
    }

    private static void hookTimeZone(DeviceIdentity d) {
        if (d.timezoneId == null || d.timezoneId.isEmpty()) return;
        try {
            XposedBridge.hookAllMethods(TimeZone.class, "getDefault",
                    XC_MethodReplacement.returnConstant(TimeZone.getTimeZone(d.timezoneId)));
        } catch (Throwable t) {
            safeLog("TimeZone hook failed: " + t);
        }
    }

    /** Only present when the target app bundles Play Services ads. */
    private static void hookAdvertisingId(DeviceIdentity d, ClassLoader cl) {
        try {
            Class<?> info = XposedHelpers.findClassIfExists(
                    "com.google.android.gms.ads.identifier.AdvertisingIdClient$Info", cl);
            if (info == null) return;
            constant(info, "getId", d.advertisingId);
            constantBoolean(info, "isLimitAdTrackingEnabled", false);
        } catch (Throwable t) {
            safeLog("AdvertisingIdClient not present or not hookable: " + t);
        }
    }

    // ── small helpers ──────────────────────────────────────────────────────

    private static void set(Class<?> clazz, String field, String value) {
        if (value == null) return;
        try {
            XposedHelpers.setStaticObjectField(clazz, field, value);
        } catch (Throwable t) {
            safeLog("could not set " + clazz.getSimpleName() + "." + field + ": " + t);
        }
    }

    private static void setInt(Class<?> clazz, String field, int value) {
        try {
            XposedHelpers.setStaticIntField(clazz, field, value);
        } catch (Throwable t) {
            safeLog("could not set " + clazz.getSimpleName() + "." + field + ": " + t);
        }
    }

    private static void constant(Class<?> clazz, String method, String value) {
        if (value == null) return;
        try {
            XposedBridge.hookAllMethods(clazz, method, XC_MethodReplacement.returnConstant(value));
        } catch (Throwable ignored) { /* the method may not exist on this API level */ }
    }

    private static void constantInt(Class<?> clazz, String method, int value) {
        try {
            XposedBridge.hookAllMethods(clazz, method, XC_MethodReplacement.returnConstant(value));
        } catch (Throwable ignored) { }
    }

    private static void constantBoolean(Class<?> clazz, String method, boolean value) {
        try {
            XposedBridge.hookAllMethods(clazz, method, XC_MethodReplacement.returnConstant(value));
        } catch (Throwable ignored) { }
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(java.util.Locale.US);
    }

    private static byte[] macBytes(String mac) {
        byte[] out = new byte[6];
        if (mac == null) return out;
        String[] parts = mac.split(":");
        for (int i = 0; i < 6 && i < parts.length; i++) {
            try {
                out[i] = (byte) Integer.parseInt(parts[i].trim(), 16);
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }

    /**
     * XposedBridge.log() is only safe once the framework is up; during early
     * loading a logcat line is the fallback that always works.
     */
    private static void safeLog(String msg) {
        try {
            XposedBridge.log(TAG + ": " + msg);
        } catch (Throwable ignored) { }
        try {
            Log.i(TAG, msg);
        } catch (Throwable ignored) { }
    }
}
