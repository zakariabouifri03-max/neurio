package de.robv.android.xposed;

/**
 * Stub declaration. A hook that fully replaces the original method body.
 */
public abstract class XC_MethodReplacement extends XC_MethodHook {

    public XC_MethodReplacement() {}

    public XC_MethodReplacement(int priority) {}

    protected abstract Object replaceHookedMethod(MethodHookParam param) throws Throwable;

    @Override
    protected final void beforeHookedMethod(MethodHookParam param) throws Throwable {
        try {
            Object result = replaceHookedMethod(param);
            param.setResult(result);
        } catch (Throwable t) {
            param.setThrowable(t);
        }
    }

    @Override
    protected final void afterHookedMethod(MethodHookParam param) throws Throwable {}

    /** Convenience factory matching the real API. */
    public static XC_MethodReplacement returnConstant(final Object value) {
        return new XC_MethodReplacement(PRIORITY_DEFAULT) {
            @Override
            protected Object replaceHookedMethod(MethodHookParam param) {
                return value;
            }
        };
    }

    public static final int PRIORITY_DEFAULT = 50;
    public static final int PRIORITY_SYSTEM = 1000;
}
