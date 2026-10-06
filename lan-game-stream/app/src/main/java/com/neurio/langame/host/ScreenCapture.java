package com.neurio.langame.host;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Surface;

import com.neurio.langame.common.Logger;

/**
 * Owns the {@link VirtualDisplay} that mirrors the host screen into the encoder's
 * input surface.
 *
 * <p>This is the "capture" half of the pipeline:</p>
 * <pre>
 *   game → Android display → MediaProjection → VirtualDisplay → Surface → MediaCodec
 * </pre>
 *
 * <p>The virtual display is sized to the stream's aspect-corrected resolution, so
 * the platform compositor does the scaling on the GPU (inside SurfaceFlinger)
 * instead of us copying and scaling pixels in Java.</p>
 */
public final class ScreenCapture {

    private static final String TAG = "Capture";

    private final Context context;
    private final MediaProjection projection;
    private final HandlerThread handlerThread;
    private final Handler handler;

    private VirtualDisplay virtualDisplay;
    private int width;
    private int height;
    private int densityDpi;
    private boolean released;

    public ScreenCapture(Context context, MediaProjection projection) {
        this.context = context.getApplicationContext();
        this.projection = projection;
        this.handlerThread = new HandlerThread("lgs-capture");
        this.handlerThread.start();
        this.handler = new Handler(handlerThread.getLooper());
    }

    /**
     * Computes the capture size for this display and the requested quality.
     *
     * <p>The aspect ratio of the physical display is preserved (a 20:9 phone
     * captures 1280×576 rather than a letterboxed 1280×720) and the long side is
     * capped by the profile, so the GPU never does more work than the stream
     * needs.</p>
     */
    public static int[] computeCaptureSize(Context context, int requestedWidth, int requestedHeight) {
        int displayWidth = 1080;
        int displayHeight = 1920;
        try {
            DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
            Display display = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (display != null) {
                Display.Mode mode = display.getMode();
                if (mode != null) {
                    displayWidth = mode.getPhysicalWidth();
                    displayHeight = mode.getPhysicalHeight();
                }
            }
        } catch (Exception e) {
            DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            displayWidth = metrics.widthPixels;
            displayHeight = metrics.heightPixels;
        }
        int longSide = Math.max(requestedWidth, requestedHeight);
        int displayLong = Math.max(displayWidth, displayHeight);
        float scale = displayLong > longSide ? (float) longSide / displayLong : 1f;
        int captureWidth = even(Math.round(displayWidth * scale));
        int captureHeight = even(Math.round(displayHeight * scale));
        // Keep both dimensions encoder friendly (multiple of 16 where possible).
        captureWidth = Math.max(2, captureWidth - (captureWidth % 2));
        captureHeight = Math.max(2, captureHeight - (captureHeight % 2));
        return new int[]{captureWidth, captureHeight};
    }

    private static int even(int value) {
        return value % 2 == 0 ? value : value + 1;
    }

    /** Creates (or recreates) the virtual display feeding {@code surface}. */
    public void start(Surface surface, int requestedWidth, int requestedHeight) {
        int[] size = computeCaptureSize(context, requestedWidth, requestedHeight);
        start(surface, size[0], size[1]);
    }

    public void start(Surface surface, int captureWidth, int captureHeight) {
        stop();
        this.width = captureWidth;
        this.height = captureHeight;
        this.densityDpi = densityFor(context, captureWidth, captureHeight);
        int flags = DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR
                | DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC;
        virtualDisplay = projection.createVirtualDisplay(
                "lgs-mirror", captureWidth, captureHeight, densityDpi, flags, surface, null, handler);
        Logger.i(TAG, "Virtual display " + captureWidth + "×" + captureHeight + " @ " + densityDpi + " dpi");
    }

    /**
     * Density is scaled with the capture size so the mirrored content keeps the
     * same physical size; without this, games would render a "tablet" layout.
     */
    private static int densityFor(Context context, int width, int height) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int displayLong = Math.max(metrics.widthPixels, metrics.heightPixels);
        int captureLong = Math.max(width, height);
        if (displayLong <= 0) {
            return metrics.densityDpi;
        }
        float scale = captureLong / (float) displayLong;
        return Math.max(120, Math.round(metrics.densityDpi * scale * (1f / Math.max(0.5f, 1f))));
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    public int densityDpi() {
        return densityDpi;
    }

    public boolean isRunning() {
        return virtualDisplay != null && !released;
    }

    public void stop() {
        if (virtualDisplay != null) {
            try {
                virtualDisplay.release();
            } catch (Exception e) {
                Logger.w(TAG, "Virtual display release failed: " + e.getMessage());
            }
            virtualDisplay = null;
        }
    }

    /** Permanently shuts the capture path down (projection is owned by the caller). */
    public void release() {
        released = true;
        stop();
        try {
            handlerThread.quitSafely();
        } catch (Exception ignored) {
        }
        Logger.i(TAG, "Capture released");
    }
}
