package de.robv.android.xposed;

/** Stub declaration — see {@code XC_LoadPackage} for why this module exists. */
public interface IXposedHookZygoteInit extends IXposedMod {
    void initZygote(StartupParam startupParam) throws Throwable;

    /** Handed to {@link #initZygote}. */
    class StartupParam {
        public String modulePath;
        public boolean startsSystemServer;

        public StartupParam() {}
    }
}
