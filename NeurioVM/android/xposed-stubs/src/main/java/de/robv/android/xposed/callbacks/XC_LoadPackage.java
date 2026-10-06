package de.robv.android.xposed.callbacks;

import android.content.pm.ApplicationInfo;

/**
 * Stub declaration of the real Xposed callback type.
 *
 * <p>Nothing in here is executed: the class exists only so that
 * {@code com.neurio.vm.hook.NeurioHook} can be compiled without pulling the
 * Xposed API from a third-party Maven repository. The app module declares
 * {@code :xposed-stubs} as {@code compileOnly}, so this file is never packaged
 * into the APK. On a device running LSPosed the real implementation is injected
 * into the class loader before application code runs.
 *
 * <p>Only the public fields actually read by {@code NeurioHook} are declared,
 * and they carry exactly the same names and types as in the real API, so the
 * generated field-access bytecode links against the runtime implementation.
 */
public abstract class XC_LoadPackage {

    /** Parameters handed to {@code IXposedHookLoadPackage.handleLoadPackage}. */
    public static final class LoadPackageParam {
        public String packageName;
        public String processName;
        public ApplicationInfo appInfo;
        public boolean firstApplication;
        public ClassLoader classLoader;
    }

    public abstract void handleLoadPackage(LoadPackageParam lpparam) throws Throwable;
}
