package de.robv.android.xposed;

import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * Stub declaration — see {@link XC_LoadPackage} for why this module exists.
 * Real interface, implemented by {@code com.neurio.vm.hook.NeurioHook}.
 */
public interface IXposedHookLoadPackage extends IXposedMod {
    void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) throws Throwable;
}
