package de.robv.android.xposed.callbacks;

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
 * <p><b>This module must stay free of {@code android.*} references:</b> it is a
 * plain Java library with no android.jar on its compile classpath. Only the
 * fields {@code NeurioHook} actually reads are declared, with the same names and
 * types as the real API, so the generated field-access bytecode links against
 * the runtime implementation.
 */
public abstract class XC_LoadPackage {

    /**
     * Parameters handed to {@code IXposedHookLoadPackage.handleLoadPackage}.
     * The real class carries more fields ({@code appInfo}, {@code isFirstApp},
     * {@code processName}); only the two this module uses are declared.
     */
    public static final class LoadPackageParam {
        public String packageName;
        public String processName;
        public ClassLoader classLoader;
    }

    public abstract void handleLoadPackage(LoadPackageParam lpparam) throws Throwable;
}
