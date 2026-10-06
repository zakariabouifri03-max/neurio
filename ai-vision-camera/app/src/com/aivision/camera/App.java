package com.aivision.camera;

import android.app.Application;
import android.content.SharedPreferences;

import com.aivision.camera.ai.core.AiPipeline;
import com.aivision.camera.ai.core.Parallel;
import com.aivision.camera.ai.core.Tier;
import com.aivision.camera.device.DeviceProfiler;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Application singleton: holds the device profile, the AI thread budget and the user's preferences.
 *
 * <p>Startup order matters. The profiler runs first (on a background thread so the camera preview is
 * never blocked), then the engine's thread pool is sized to the device, which is what makes the same
 * engine behave sensibly on a 2 GB budget phone and on a flagship.
 */
public class App extends Application {

    private static App instance;

    private DeviceProfiler profiler;
    private ExecutorService aiExecutor;
    private SharedPreferences prefs;
    private volatile boolean profiled;

    public static App get() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        prefs = getSharedPreferences("aivision", MODE_PRIVATE);
        aiExecutor = Executors.newSingleThreadExecutor(new java.util.concurrent.ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "ai-pipeline");
                t.setDaemon(true);
                return t;
            }
        });
        // a conservative default until the profile lands
        Parallel.configure(Math.max(2, Runtime.getRuntime().availableProcessors() - 1));
        profiler = new DeviceProfiler(this);
        Thread profilerThread = new Thread(new Runnable() {
            @Override
            public void run() {
                profiler.profile();
                Parallel.configure(profiler.getAiThreads());
                profiled = true;
            }
        }, "device-profiler");
        profilerThread.setDaemon(true);
        profilerThread.start();
    }

    public DeviceProfiler profiler() {
        return profiler;
    }

    public Tier tier() {
        return profiler != null ? profiler.tier() : Tier.MID;
    }

    public boolean isProfiled() {
        return profiled;
    }

    public ExecutorService aiExecutor() {
        return aiExecutor;
    }

    public SharedPreferences prefs() {
        return prefs;
    }

    /** Default AI settings for this device, before any user override. */
    public AiPipeline.Settings defaultSettings() {
        AiPipeline.Settings s = new AiPipeline.Settings();
        s.tier = tier();
        s.requestedFrames = tier().maxBurstFrames;
        s.ultraScale = tier() == Tier.LOW ? 2 : 2;
        s.workingLongEdge = 0;
        return s;
    }
}
