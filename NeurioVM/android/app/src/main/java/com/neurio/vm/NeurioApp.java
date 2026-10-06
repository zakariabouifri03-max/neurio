package com.neurio.vm;

import android.app.Application;

import com.neurio.vm.runtime.ProcessBridge;
import com.neurio.vm.util.Log;

/**
 * Process entry point.
 *
 * <p>Exactly one thing has to happen here, before anything else: claim the
 * WebView data-directory suffix for this process. The framework forbids doing it
 * later than the first WebView creation, so it cannot be deferred to an activity.
 * Everything else in this app can be initialised lazily.
 *
 * <p>The same class runs in the main process and in each isolated browser
 * process; {@link ProcessBridge} works out which one this is.
 */
public final class NeurioApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        ProcessBridge.onProcessStart(this);
        Log.i("NeurioApp", "application started in process '"
                + ProcessBridge.processName(this) + "'");
    }
}
