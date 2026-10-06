package com.neurio.langame.host.input;

import android.content.Context;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;

/**
 * Chooses the best available input adapter for the requested mode.
 *
 * <p>The factory never lies: if the user asked for accessibility injection but the
 * service is not enabled, it returns {@code null} and the caller surfaces the
 * reason (the stream still runs, the game just will not receive input).</p>
 */
public final class InputAdapterFactory {

    private static final String TAG = "InputFactory";

    private InputAdapterFactory() {
    }

    /**
     * @param mode the mode picked in Settings
     * @return a prepared adapter, or {@code null} when nothing can inject input
     */
    public static GameInputAdapter create(Context context, Configuration.InputMode mode) {
        switch (mode) {
            case ROOT_SHELL: {
                RootShellInputAdapter adapter = new RootShellInputAdapter();
                if (adapter.prepare(context)) {
                    return adapter;
                }
                Logger.w(TAG, "Root adapter unavailable: " + adapter.status());
                return null;
            }
            case DISABLED:
                return null;
            case ACCESSIBILITY:
            default: {
                AccessibilityInputAdapter adapter = new AccessibilityInputAdapter();
                if (adapter.prepare(context)) {
                    return adapter;
                }
                Logger.w(TAG, "Accessibility adapter unavailable: " + adapter.status());
                // Last resort: a rooted phone can still stream input through the shell.
                RootShellInputAdapter root = new RootShellInputAdapter();
                if (root.prepare(context)) {
                    Logger.i(TAG, "Falling back to the root shell adapter");
                    return root;
                }
                return null;
            }
        }
    }

    /** Human readable explanation for the host UI when no adapter is active. */
    public static String explainFailure(Context context, Configuration.InputMode mode) {
        if (mode == Configuration.InputMode.DISABLED) {
            return "Input injection is disabled in Settings";
        }
        if (!NeurioAccessibilityService.isConnected()) {
            return "Enable the “LAN Game remote input” accessibility service to send "
                    + "controls into the game";
        }
        return "No usable input adapter";
    }
}
