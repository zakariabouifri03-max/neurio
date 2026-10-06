package de.robv.android.xposed;

import java.lang.reflect.Member;
import java.util.Set;

/**
 * Stub declaration of the Xposed entry-point façade.
 *
 * <p>Signatures mirror XposedBridge API 82. Because {@code :xposed-stubs} is a
 * {@code compileOnly} dependency of {@code :app}, none of this is packaged —
 * the real {@code XposedBridge} supplied by LSPosed is what executes at runtime.
 */
public final class XposedBridge {

    private XposedBridge() {}

    public static final int XPOSED_BRIDGE_VERSION = 82;

    /** Writes a line into the Xposed log ({@code /data/adb/lspd/log/}). */
    public static void log(String text) {}

    public static void log(Throwable t) {}

    /** Hooks every overload of {@code methodName} on {@code hookClass}. */
    public static Set<XC_MethodHook.Unhook> hookAllMethods(Class<?> hookClass, String methodName,
                                                           XC_MethodHook callback) {
        return null;
    }

    /** Hooks a single field's getter — used for {@code Settings.Secure} style lookups. */
    public static XC_MethodHook.Unhook hookMethod(Member hookMethod, XC_MethodHook callback) {
        return null;
    }

    /** Invokes the original implementation from inside a hook. */
    public static Object invokeOriginalMethod(Member method, Object thisObject, Object[] args)
            throws Throwable {
        return null;
    }
}
