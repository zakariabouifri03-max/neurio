package de.robv.android.xposed;

import java.lang.reflect.Member;

/**
 * Stub declaration of the hook callback base class.
 * Signatures mirror the real XposedBridge API 82 so that bytecode compiled
 * against this stub links cleanly against the runtime implementation.
 */
public abstract class XC_MethodHook {

    public XC_MethodHook() {}

    public XC_MethodHook(int priority) {}

    protected void beforeHookedMethod(MethodHookParam param) throws Throwable {}

    protected void afterHookedMethod(MethodHookParam param) throws Throwable {}

    /** Runtime information about the hooked invocation. */
    public static class MethodHookParam {
        public Member method;
        public Object thisObject;
        public Object[] args;

        private Object result;
        private Throwable throwable;

        public Object getResult() { return result; }
        public void setResult(Object result) { this.result = result; this.throwable = null; }

        public Throwable getThrowable() { return throwable; }
        public void setThrowable(Throwable throwable) { this.throwable = throwable; this.result = null; }

        public boolean hasThrowable() { return throwable != null; }

        public Object getResultOrThrowable() throws Throwable {
            if (throwable != null) throw throwable;
            return result;
        }

        protected MethodHookParam() {}
    }

    /** Handle returned by every {@code hook*} call. */
    public class Unhook {
        public XC_MethodHook getCallback() { return XC_MethodHook.this; }
        public void unhook() {}
    }
}
