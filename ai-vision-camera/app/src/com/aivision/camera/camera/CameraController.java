package com.aivision.camera.camera;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureFailure;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.DngCreator;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.MediaRecorder;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * The real camera engine: Camera2 in full manual control, no shortcuts.
 *
 * <p>Capabilities covered here: lens/cluster switching, zoom that maps smoothly from optical to
 * digital, tap to focus with a metering region that follows the zoom, AE/AF/AWB control, full manual
 * (ISO, shutter, focus, white balance, exposure) for Pro mode, flash/torch, burst capture for the AI
 * engine, RAW (DNG) capture when the sensor supports it, 3A lock, JPEG+RAW pairs, 1080p/2K/4K video,
 * high speed slow motion and time lapse.
 *
 * <p>All work runs on a dedicated camera handler thread; the UI only observes the listener callbacks.
 */
public class CameraController {

    public static final String TAG = "CameraController";

    // ------------------------------------------------------------------ listener

    public interface Listener {
        void onCameraOpened(Capabilities caps);

        void onCameraClosed();

        void onCameraError(String message);

        void onPreviewSizeChosen(Size size, int sensorOrientation, boolean front, int displayRotation);

        /** Burst finished: jpeg frames (may be 1) plus optional RAW image data. */
        void onPhotoCaptured(List<byte[]> jpegs, RawFrame raw, int iso, long exposureNs, boolean flashFired);

        void onCaptureProgress(int captured, int total);

        /** Throttled preview luma plane for the live scene model (small, e.g. 320x240). */
        void onAnalysisFrame(byte[] luma, int width, int height, long timestampNs);

        void onZoomChanged(float zoom, boolean digitalZone);

        void onManualState(CaptureResult result);   // live ISO / shutter / focus for Pro mode

        void onFocusState(boolean locked, boolean active);

        void onVideoStarted();

        void onVideoStopped(File file, boolean ok, String message);

        void onSlowMotionUnsupported(String reason);
    }

    public static class RawFrame {
        public byte[] data;
        public int width, height;
        public int format;
        public long timestamp;
        public int iso;
        public long exposureNs;
    }

    public static class Manual {
        public boolean enabled;
        public boolean autoIso = true;
        public boolean autoShutter = true;
        public boolean autoFocus = true;
        public boolean autoWb = true;
        public int iso = 200;
        public long exposureNs = 8_000_000L;   // 1/125 s
        public float focusDiopters = 0f;       // 0 = infinity
        public float wbTemperature = 5000f;
        public float evCompensation = 0f;      // -2 .. +2 in 1/6 steps
        public String toString() {
            return "ISO " + (autoIso ? "auto" : String.valueOf(iso))
                    + ", " + (autoShutter ? "auto" : shutterLabel(exposureNs))
                    + ", " + (autoFocus ? "AF" : String.format(java.util.Locale.US, "%.2f m", focusDistance()))
                    + ", " + (autoWb ? "AWB" : Math.round(wbTemperature) + "K");
        }

        public float focusDistance() {
            return focusDiopters > 0.001f ? 1f / focusDiopters : 0f;
        }
    }

    public static String shutterLabel(long ns) {
        if (ns <= 0) return "auto";
        double s = ns / 1e9;
        if (s >= 1) return String.format(java.util.Locale.US, "%.1fs", s);
        return String.format(java.util.Locale.US, "1/%.0fs", 1.0 / s);
    }

    public static class VideoConfig {
        public int width = 1920, height = 1080, fps = 30;
        public boolean slowMotion;
        public boolean timeLapse;
        public boolean stabilize = true;
        public boolean useHevc;
        public boolean aiUpscaleLabel;      // purely a label hint; the real work happens on export
        public float timeLapseRate = 1f;    // frames captured per second
        public File output;
        public boolean audio = true;
    }

    // ------------------------------------------------------------------ state

    private final Context ctx;
    private final Listener listener;
    private final CameraManager manager;
    private HandlerThread thread;
    private Handler handler;

    private String cameraId;
    private CameraCharacteristics chars;
    private Capabilities caps;
    private CameraDevice device;
    private CameraCaptureSession session;
    private CameraConstrainedHighSpeedCaptureSession highSpeedSession;
    private SurfaceTexture previewTexture;
    private Surface previewSurface;
    private ImageReader jpegReader;
    private ImageReader rawReader;
    private ImageReader analysisReader;
    private CaptureRequest.Builder builder;
    private Size previewSize;
    private Size stillSize;
    private Size rawSize;
    private int sensorOrientation;
    private int displayRotation;
    private int viewWidth = 1080, viewHeight = 1920;

    private float zoom = 1f;
    private int flashMode = CaptureRequest.FLASH_MODE_OFF;
    private boolean torch;
    private int timerSeconds;
    private boolean rawEnabled;
    private boolean analysisEnabled = true;
    private long lastAnalysisNs;
    private boolean front;

    private Manual manual = new Manual();
    private boolean aeLocked, afLocked, awbLocked;
    private MeteringRectangle focusRegion;

    private final List<byte[]> burst = new ArrayList<byte[]>();
    private int burstExpected = 1;
    private int burstGet;
    private boolean capturing;
    private long captureStart;

    private MediaRecorder recorder;
    private File videoFile;
    private boolean recording;
    private long recordStart;
    private boolean videoStabilization;
    private boolean opticalStabilization;
    private int pendingRawW = 0, pendingRawH = 0;
    private byte[] pendingRaw;
    private long pendingRawTs;
    private float aeCompStep = 0f;
    private int aeCompMin = 0, aeCompMax = 0;
    private int lastIso = 200;
    private long lastExposureNs = 8_000_000L;
    private boolean flashFired;

    private final CameraManager.TorchCallback torchCallback;

    public CameraController(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        this.manager = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
        this.torchCallback = Build.VERSION.SDK_INT >= 23 ? new CameraManager.TorchCallback() {
            @Override
            public void onTorchModeChanged(String id, boolean enabled) {
                if (id.equals(cameraId)) torch = enabled;
            }
        } : null;
    }

    // ------------------------------------------------------------------ lifecycle

    public void startThread() {
        if (thread == null) {
            thread = new HandlerThread("camera");
            thread.start();
            handler = new Handler(thread.getLooper());
        }
    }

    public Handler handler() {
        return handler;
    }

    public Capabilities capabilities() {
        return caps;
    }

    public Size previewSize() {
        return previewSize;
    }

    public boolean isFront() {
        return front;
    }

    public float zoom() {
        return zoom;
    }

    public Manual manual() {
        return manual;
    }

    public boolean isRecording() {
        return recording;
    }

    public long recordElapsedMs() {
        return recording ? System.currentTimeMillis() - recordStart : 0;
    }

    /** Picks the default rear (or front) camera id. */
    public String pickCamera(boolean frontWanted) {
        try {
            String best = null;
            int bestScore = -1;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                boolean isFront = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
                if (isFront != frontWanted) continue;
                int score = 1;
                StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                if (map != null) {
                    Size[] sizes = map.getOutputSizes(ImageFormat.JPEG);
                    if (sizes != null && sizes.length > 0) {
                        long mp = 0;
                        for (Size s : sizes) mp = Math.max(mp, (long) s.getWidth() * s.getHeight());
                        score = (int) (mp / 1_000_000L);
                    }
                }
                if (Build.VERSION.SDK_INT >= 28) {
                    try {
                        java.util.Set<String> physical = ch.getPhysicalCameraIds();
                        if (physical != null && physical.size() > 1) score += 40;
                    } catch (Throwable ignored) {
                    }
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = id;
                }
            }
            return best;
        } catch (Throwable t) {
            Log.w(TAG, "pickCamera", t);
            return null;
        }
    }

    public void open(final String cameraId, final SurfaceTexture texture, final int viewW, final int viewH) {
        startThread();
        this.cameraId = cameraId;
        this.previewTexture = texture;
        this.viewWidth = viewW;
        this.viewHeight = viewH;
        if (ctx.checkPermission(Manifest.permission.CAMERA, android.os.Process.myPid(), android.os.Process.myUid())
                != PackageManager.PERMISSION_GRANTED) {
            listener.onCameraError("Camera permission not granted");
            return;
        }
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    closeInternal();
                    chars = manager.getCameraCharacteristics(cameraId);
                    Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                    front = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
                    Integer so = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    sensorOrientation = so == null ? 90 : so;
                    android.util.Rational step = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
                    if (step != null) aeCompStep = step.floatValue();
                    android.util.Range<Integer> range = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
                    if (range != null) {
                        aeCompMin = range.getLower();
                        aeCompMax = range.getUpper();
                    }
                    caps = Capabilities.build(manager, cameraId);
                    if (caps == null) {
                        listener.onCameraError("Cannot read camera capabilities");
                        return;
                    }
                    if (torchCallback != null) manager.registerTorchCallback(torchCallback, handler);
                    chooseSizes();
                    openDevice();
                } catch (Throwable t) {
                    Log.e(TAG, "open failed", t);
                    listener.onCameraError("Cannot open camera: " + t.getClass().getSimpleName());
                }
            }
        });
    }

    private void chooseSizes() throws CameraAccessException {
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) return;
        Size[] previewSizes = map.getOutputSizes(SurfaceTexture.class);
        Size[] jpegSizes = map.getOutputSizes(ImageFormat.JPEG);
        // choose the still size first: cap by the AI profile so a burst fits in memory
        long capBytes = Math.min(96L * 1024 * 1024, Runtime.getRuntime().maxMemory() / 3);
        Size best = null;
        if (jpegSizes != null) {
            List<Size> sorted = new ArrayList<Size>();
            Collections.addAll(sorted, jpegSizes);
            Collections.sort(sorted, new Comparator<Size>() {
                @Override
                public int compare(Size a, Size b) {
                    return Long.compare((long) b.getWidth() * b.getHeight(), (long) a.getWidth() * a.getHeight());
                }
            });
            for (Size s : sorted) {
                long est = (long) s.getWidth() * s.getHeight() * 3L / 4L;   // roughly decoded JPEG size
                if (est <= capBytes / 4) {
                    best = s;
                    break;
                }
            }
            if (best == null) best = sorted.get(sorted.size() - 1);
        }
        stillSize = best;
        if (rawReader == null && caps.rawSupported) {
            Size[] rawSizes = map.getOutputSizes(ImageFormat.RAW_SENSOR);
            if (rawSizes != null && rawSizes.length > 0) rawSize = rawSizes[0];
        }
        // preview size: match the view aspect ratio, prefer 16:9 up to 1080p
        if (previewSizes != null && previewSizes.length > 0) {
            float targetAspect = viewWidth / (float) Math.max(1, viewHeight);
            Size chosen = null;
            int bestScore = Integer.MAX_VALUE;
            for (Size s : previewSizes) {
                float aspect = s.getWidth() / (float) s.getHeight();
                float aspectPenalty = Math.abs(aspect - targetAspect) * 100;
                if (aspectPenalty > 2f) continue;
                int resPenalty = Math.abs(s.getWidth() - 1440) / 10;
                int score = (int) (aspectPenalty * 100) + resPenalty;
                if (s.getWidth() > 1920) score += 200;
                if (score < bestScore) {
                    bestScore = score;
                    chosen = s;
                }
            }
            previewSize = chosen != null ? chosen : previewSizes[0];
        }
    }

    private void openDevice() throws CameraAccessException {
        manager.openCamera(cameraId, new CameraDevice.StateCallback() {
            @Override
            public void onOpened(CameraDevice camera) {
                device = camera;
                try {
                    createSession();
                } catch (Throwable t) {
                    Log.e(TAG, "session", t);
                    listener.onCameraError("Cannot start preview: " + t.getClass().getSimpleName());
                }
            }

            @Override
            public void onDisconnected(CameraDevice camera) {
                camera.close();
                device = null;
            }

            @Override
            public void onError(CameraDevice camera, int error) {
                camera.close();
                device = null;
                listener.onCameraError("Camera error " + error);
            }
        }, handler);
    }

    private void createSession() throws CameraAccessException {
        if (device == null || previewTexture == null) return;
        int maxFrames = caps != null ? Math.max(2, caps.maxBurstFrames) : 4;
        previewTexture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
        previewSurface = new Surface(previewTexture);
        jpegReader = ImageReader.newInstance(stillSize.getWidth(), stillSize.getHeight(), ImageFormat.JPEG, maxFrames);
        jpegReader.setOnImageAvailableListener(onJpeg, handler);
        List<Surface> surfaces = new ArrayList<Surface>();
        surfaces.add(previewSurface);
        surfaces.add(jpegReader.getSurface());
        if (rawEnabled && caps.rawSupported && rawSize != null) {
            rawReader = ImageReader.newInstance(rawSize.getWidth(), rawSize.getHeight(), ImageFormat.RAW_SENSOR, 2);
            rawReader.setOnImageAvailableListener(onRaw, handler);
            surfaces.add(rawReader.getSurface());
        }
        if (analysisEnabled) {
            Size analysisSize = pickAnalysisSize();
            analysisReader = ImageReader.newInstance(analysisSize.getWidth(), analysisSize.getHeight(),
                    ImageFormat.YUV_420_888, 3);
            analysisReader.setOnImageAvailableListener(onAnalysis, handler);
            surfaces.add(analysisReader.getSurface());
        }
        device.createCaptureSession(surfaces, new CameraCaptureSession.StateCallback() {
            @Override
            public void onConfigured(CameraCaptureSession s) {
                session = s;
                try {
                    builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                    builder.addTarget(previewSurface);
                    applyTo(builder, false);
                    session.setRepeatingRequest(builder.build(), captureCallback, handler);
                    listener.onCameraOpened(caps);
                    listener.onPreviewSizeChosen(previewSize, sensorOrientation, front, displayRotation);
                } catch (Throwable t) {
                    Log.e(TAG, "preview", t);
                    listener.onCameraError("Preview configuration failed");
                }
            }

            @Override
            public void onConfigureFailed(CameraCaptureSession s) {
                listener.onCameraError("Camera session configuration failed");
            }
        }, handler);
    }

    private Size pickAnalysisSize() {
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) return new Size(320, 240);
        Size[] sizes = map.getOutputSizes(ImageFormat.YUV_420_888);
        if (sizes == null) return new Size(320, 240);
        Size best = null;
        for (Size s : sizes) {
            if (s.getWidth() > 640 || s.getHeight() > 640) continue;
            if (best == null || s.getWidth() > best.getWidth()) best = s;
        }
        return best == null ? new Size(320, 240) : best;
    }

    // ------------------------------------------------------------------ request building

    /** Applies zoom, focus, exposure and manual settings onto a request builder. */
    private void applyTo(CaptureRequest.Builder b, boolean still) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                b.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoom);
            } else {
                b.set(CaptureRequest.SCALER_CROP_REGION, cropRegionForZoom(zoom));
            }
        } catch (Throwable ignored) {
        }
        b.set(CaptureRequest.CONTROL_AF_MODE, manual.enabled && !manual.autoFocus
                ? CaptureRequest.CONTROL_AF_MODE_OFF : CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        b.set(CaptureRequest.CONTROL_AE_MODE, manual.enabled && !manual.autoIso && !manual.autoShutter
                ? CaptureRequest.CONTROL_AE_MODE_OFF : CaptureRequest.CONTROL_AE_MODE_ON);
        b.set(CaptureRequest.CONTROL_AWB_MODE, manual.enabled && !manual.autoWb
                ? CaptureRequest.CONTROL_AWB_MODE_OFF : CaptureRequest.CONTROL_AWB_MODE_AUTO);
        // flash: the AI engine wants available light, so flash defaults to off and is explicit
        b.set(CaptureRequest.FLASH_MODE, torch ? CaptureRequest.FLASH_MODE_TORCH : flashMode);
        b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, compIndex(manual.evCompensation));
        if (aeLocked) b.set(CaptureRequest.CONTROL_AE_LOCK, true);
        if (awbLocked) b.set(CaptureRequest.CONTROL_AWB_LOCK, true);
        if (focusRegion != null) {
            b.set(CaptureRequest.CONTROL_AF_REGIONS, new MeteringRectangle[]{focusRegion});
            b.set(CaptureRequest.CONTROL_AE_REGIONS, new MeteringRectangle[]{focusRegion});
        }
        if (manual.enabled) {
            if (!manual.autoIso) {
                b.set(CaptureRequest.SENSOR_SENSITIVITY, clampIso(manual.iso));
            }
            if (!manual.autoShutter) {
                b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, clampExposure(manual.exposureNs));
            }
            if (!manual.autoFocus && manualFocusSupported()) {
                b.set(CaptureRequest.LENS_FOCUS_DISTANCE,
                        Math.max(0f, Math.min(manual.focusDiopters, caps.minFocusDistance)));
            }
            if (!manual.autoWb) {
                float[] gains = wbGains(manual.wbTemperature);
                b.set(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_HIGH_QUALITY);
                b.set(CaptureRequest.COLOR_CORRECTION_GAINS, new android.hardware.camera2.params.RggbChannelVector(
                        gains[0], gains[1], gains[1], gains[2]));
            }
        }
        if (still) {
            try {
                b.set(CaptureRequest.JPEG_ORIENTATION, exifDegrees());
            } catch (Throwable ignored) {
            }
            b.set(CaptureRequest.CONTROL_CAPTURE_INTENT, CaptureRequest.CONTROL_CAPTURE_INTENT_STILL_CAPTURE);
            b.set(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY);
            b.set(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_HIGH_QUALITY);
        } else {
            b.set(CaptureRequest.CONTROL_CAPTURE_INTENT, CaptureRequest.CONTROL_CAPTURE_INTENT_PREVIEW);
        }
    }

    /** Converts an EV offset in stops into the device's own exposure compensation index. */
    private int compIndex(float ev) {
        if (aeCompStep <= 0f) return Math.round(ev * 2f);
        int raw = Math.round(ev / aeCompStep);
        return Math.max(aeCompMin, Math.min(aeCompMax, raw));
    }

    /** The JPEG rotation the file must carry so photos appear upright in any gallery. */
    private int exifDegrees() {
        int rot = front ? (sensorOrientation + displayRotation * 90) % 360
                : (sensorOrientation - displayRotation * 90 + 360) % 360;
        return rot;
    }

    private boolean manualFocusSupported() {
        return caps != null && caps.manualFocusSupported;
    }

    private int clampIso(int iso) {
        if (caps == null) return iso;
        return Math.max(caps.minIso, Math.min(iso, caps.maxIso));
    }

    private long clampExposure(long ns) {
        if (caps == null) return ns;
        return Math.max(caps.minExposureNs, Math.min(ns, caps.maxExposureNs));
    }

    private float[] wbGains(float kelvin) {
        // approximation of the Planckian locus gains (R, G, B), fine for a manual WB slider
        double t = Math.max(1500f, Math.min(12000f, kelvin)) / 100.0;
        double r, g, b;
        if (t <= 66) {
            r = 255;
            g = 99.4708025861 * Math.log(t) - 161.1195681661;
        } else {
            r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
            g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
        }
        if (t >= 66) b = 255;
        else if (t <= 19) b = 0;
        else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
        r = Math.max(1, Math.min(255, r));
        g = Math.max(1, Math.min(255, g));
        b = Math.max(1, Math.min(255, b));
        double max = Math.max(r, Math.max(g, b));
        return new float[]{(float) (r / max), (float) (g / max), (float) (b / max)};
    }

    /** Crop region for a zoom factor, keeping the preview aspect ratio inside the sensor area. */
    public Rect cropRegionForZoom(float z) {
        Rect active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        if (active == null) return new Rect(0, 0, 1, 1);
        int w = active.width(), h = active.height();
        float targetAspect = viewWidth / (float) Math.max(1, viewHeight);
        int cropW = w, cropH = h;
        float sensorAspect = w / (float) h;
        if (sensorAspect > targetAspect) cropW = Math.round(h * targetAspect);
        else cropH = Math.round(w / targetAspect);
        cropW = Math.round(cropW / Math.max(1f, z));
        cropH = Math.round(cropH / Math.max(1f, z));
        int cx = active.left + w / 2, cy = active.top + h / 2;
        int left = Math.max(active.left, cx - cropW / 2);
        int top = Math.max(active.top, cy - cropH / 2);
        int right = Math.min(active.right, left + cropW);
        int bottom = Math.min(active.bottom, top + cropH);
        return new Rect(left, top, right, bottom);
    }

    private void updateRepeating() {
        if (session == null || builder == null) return;
        try {
            builder.addTarget(previewSurface);
            applyTo(builder, false);
            session.setRepeatingRequest(builder.build(), captureCallback, handler);
        } catch (Throwable t) {
            Log.w(TAG, "updateRepeating", t);
        }
    }

    // ------------------------------------------------------------------ live parameters

    public void setZoom(final float z) {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                float max = caps != null ? caps.maxZoomToDisplay : 10f;
                float next = Math.max(1f, Math.min(z, max));
                boolean changedLensZone = opticalBudgetCrossed(zoom, next);
                zoom = next;
                updateRepeating();
                listener.onZoomChanged(zoom, digitalBudgetCrossed(zoom));
                if (changedLensZone) {
                    // crossing into the digital range is where the AI engine takes over
                    flashFocusRing();
                }
            }
        });
    }

    private boolean opticalBudgetCrossed(float from, float to) {
        if (caps == null || caps.lenses.isEmpty()) return false;
        float opticalMax = 1f;
        for (Capabilities.Lens l : caps.lenses) opticalMax = Math.max(opticalMax, l.zoomFactor);
        return (from <= opticalMax) != (to <= opticalMax);
    }

    private boolean digitalBudgetCrossed(float z) {
        if (caps == null) return false;
        float opticalMax = 1f;
        for (Capabilities.Lens l : caps.lenses) opticalMax = Math.max(opticalMax, l.zoomFactor);
        return z > opticalMax * 1.05f;
    }

    private void flashFocusRing() {
        // purely visual feedback; the UI reacts to onZoomChanged
    }

    /** Switches to another physical lens (ultra wide / wide / tele). */
    public void switchLens(final String physicalId) {
        if (handler == null || physicalId == null || physicalId.equals(cameraId)) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    boolean wasTorch = torch;
                    SurfaceTexture texture = previewTexture;
                    int w = viewWidth, h = viewHeight;
                    if (session != null) {
                        session.close();
                        session = null;
                    }
                    if (device != null) {
                        device.close();
                        device = null;
                    }
                    open(physicalId, texture, w, h);
                    if (wasTorch) setTorch(true);
                } catch (Throwable t) {
                    listener.onCameraError("Lens switch failed");
                }
            }
        });
    }

    public void setFlashMode(int mode) {
        flashMode = mode;
        updateRepeating();
    }

    public void setTorch(final boolean on) {
        torch = on;
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (manager != null && cameraId != null) manager.setTorchMode(cameraId, on);
                } catch (Throwable ignored) {
                }
                updateRepeating();
            }
        });
    }

    public boolean torchOn() {
        return torch;
    }

    public void setManual(final Manual m) {
        this.manual = m;
        updateRepeating();
    }

    public void setLock3A(final boolean ae, final boolean af, final boolean awb) {
        aeLocked = ae;
        afLocked = af;
        awbLocked = awb;
        updateRepeating();
    }

    /** Tap to focus: converts view coordinates into a metering region on the sensor. */
    public void tapToFocus(final float xView, final float yView) {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (chars == null) return;
                Rect active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
                Rect crop = cropRegionForZoom(zoom);
                if (active == null || previewSize == null) return;
                // view -> sensor: account for the preview crop and the sensor orientation
                float nx, ny;
                if (sensorOrientation == 90 || sensorOrientation == 270) {
                    nx = yView / Math.max(1f, viewHeight);
                    ny = 1f - xView / Math.max(1f, viewWidth);
                } else {
                    nx = xView / Math.max(1f, viewWidth);
                    ny = yView / Math.max(1f, viewHeight);
                }
                if (front) nx = 1f - nx;
                int cx = crop.left + (int) (nx * crop.width());
                int cy = crop.top + (int) (ny * crop.height());
                int half = (int) (Math.min(crop.width(), crop.height()) * 0.10f);
                half = Math.max(half, 40);
                Rect r = new Rect(
                        Math.max(crop.left, cx - half), Math.max(crop.top, cy - half),
                        Math.min(crop.right, cx + half), Math.min(crop.bottom, cy + half));
                focusRegion = new MeteringRectangle(r, MeteringRectangle.METERING_WEIGHT_MAX);
                if (session == null) return;
                try {
                    CaptureRequest.Builder focus = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                    focus.addTarget(previewSurface);
                    applyTo(focus, false);
                    focus.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO);
                    focus.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START);
                    focus.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER,
                            CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_START);
                    session.capture(focus.build(), captureCallback, handler);
                    // then hand control back to continuous AF
                    CaptureRequest.Builder after = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                    after.addTarget(previewSurface);
                    applyTo(after, false);
                    after.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
                    session.setRepeatingRequest(after.build(), captureCallback, handler);
                } catch (Throwable t) {
                    Log.w(TAG, "tapToFocus", t);
                }
            }
        });
    }

    public void setDisplayRotation(int rotation) {
        displayRotation = rotation;
    }

    public void setRawEnabled(boolean enabled) {
        if (rawEnabled == enabled) return;
        rawEnabled = enabled;
        recreateSession();
    }

    public void setAnalysisEnabled(boolean enabled) {
        if (analysisEnabled == enabled) return;
        analysisEnabled = enabled;
        recreateSession();
    }

    public void recreateSession() {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (session != null) {
                        session.close();
                        session = null;
                    }
                    releaseReaders();
                    if (device != null) createSession();
                } catch (Throwable t) {
                    listener.onCameraError("Cannot reconfigure the camera");
                }
            }
        });
    }

    private void releaseReaders() {
        if (jpegReader != null) {
            jpegReader.close();
            jpegReader = null;
        }
        if (rawReader != null) {
            rawReader.close();
            rawReader = null;
        }
        if (analysisReader != null) {
            analysisReader.close();
            analysisReader = null;
        }
    }

    // ------------------------------------------------------------------ capture

    /**
     * Burst capture for the AI engine. Frames are grabbed back to back so the alignment stage has
     * the smallest possible motion between them and the most sub-pixel diversity.
     */
    public void capturePhoto(final int frames, final boolean rawToo, final long delayMs) {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (session == null || device == null) {
                    listener.onCameraError("Camera is not ready");
                    return;
                }
                if (capturing) return;
                capturing = true;
                burstExpected = Math.max(1, frames);
                burstGet = 0;
                burst.clear();
                pendingRaw = null;
                flashFired = flashMode == CaptureRequest.FLASH_MODE_SINGLE;
                captureStart = System.currentTimeMillis();
                try {
                    int aeMode = manual.enabled && !manual.autoIso && !manual.autoShutter
                            ? CaptureRequest.CONTROL_AE_MODE_OFF : CaptureRequest.CONTROL_AE_MODE_ON;
                    // pre-capture trigger so AE/AF settle before the first frame
                    if (aeMode == CaptureRequest.CONTROL_AE_MODE_ON && frames > 1) {
                        CaptureRequest.Builder pre = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                        pre.addTarget(jpegReader.getSurface());
                        applyTo(pre, true);
                        pre.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER,
                                CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_START);
                        pre.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START);
                        session.capture(pre.build(), null, handler);
                    }
                    List<CaptureRequest> requests = new ArrayList<CaptureRequest>();
                    for (int i = 0; i < burstExpected; i++) {
                        CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                        b.addTarget(jpegReader.getSurface());
                        if (rawToo && rawReader != null && i == 0) {
                            b.addTarget(rawReader.getSurface());
                            b.setTag(RAW_TAG);
                        }
                        applyTo(b, true);
                        if (i > 0) {
                            b.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
                        }
                        // a slightly different exposure on alternating frames broadens the usable
                        // dynamic range for the fusion stage without over/under exposing the burst
                        if (frames >= 3) {
                            float ev = (i % 2 == 0) ? 0f : (i == 1 ? -0.4f : 0.4f);
                            b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION,
                                    compIndex(manual.evCompensation + ev));
                        }
                        requests.add(b.build());
                    }
                    if (delayMs > 0) {
                        handler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                fireBurst(requests);
                            }
                        }, delayMs);
                    } else {
                        fireBurst(requests);
                    }
                } catch (Throwable t) {
                    capturing = false;
                    Log.e(TAG, "capture", t);
                    listener.onCameraError("Capture failed: " + t.getClass().getSimpleName());
                }
            }
        });
    }

    private void fireBurst(List<CaptureRequest> requests) {
        try {
            if (requests.size() > 1) {
                session.captureBurst(requests, new CameraCaptureSession.CaptureCallback() {
                    @Override
                    public void onCaptureFailed(CameraCaptureSession s, CaptureRequest r, CaptureFailure f) {
                        Log.w(TAG, "burst frame failed: " + f.getReason());
                    }
                }, handler);
            } else {
                session.capture(requests.get(0), captureCallback, handler);
            }
        } catch (Throwable t) {
            // some devices reject captureBurst on a session with mixed surfaces: fall back to a loop
            try {
                for (CaptureRequest r : requests) session.capture(r, captureCallback, handler);
            } catch (Throwable t2) {
                capturing = false;
                listener.onCameraError("Burst capture failed");
            }
        }
    }

    private final ImageReader.OnImageAvailableListener onJpeg = new ImageReader.OnImageAvailableListener() {
        @Override
        public void onImageAvailable(ImageReader reader) {
            Image image = null;
            try {
                image = reader.acquireNextImage();
                if (image == null) return;
                ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                byte[] data = new byte[buffer.remaining()];
                buffer.get(data);
                synchronized (burst) {
                    burst.add(data);
                    burstGet++;
                }
                listener.onCaptureProgress(burstGet, burstExpected);
                if (burstGet >= burstExpected) {
                    finishCapture();
                }
            } catch (Throwable t) {
                Log.w(TAG, "jpeg read", t);
            } finally {
                if (image != null) image.close();
            }
        }
    };

    private final ImageReader.OnImageAvailableListener onRaw = new ImageReader.OnImageAvailableListener() {
        @Override
        public void onImageAvailable(ImageReader reader) {
            Image image = null;
            try {
                image = reader.acquireNextImage();
                if (image == null) return;
                pendingRawW = image.getWidth();
                pendingRawH = image.getHeight();
                pendingRawTs = image.getTimestamp();
                java.nio.ByteBuffer b = image.getPlanes()[0].getBuffer();
                byte[] data = new byte[b.remaining()];
                b.get(data);
                pendingRaw = data;
            } catch (Throwable t) {
                Log.w(TAG, "raw read", t);
            } finally {
                if (image != null) image.close();
            }
        }
    };

    private final ImageReader.OnImageAvailableListener onAnalysis = new ImageReader.OnImageAvailableListener() {
        @Override
        public void onImageAvailable(ImageReader reader) {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;
                long now = System.currentTimeMillis();
                if (now - lastAnalysisNs < 120) return;     // ~8 fps is plenty for scene analysis
                lastAnalysisNs = now;
                Image.Plane y = image.getPlanes()[0];
                ByteBuffer buf = y.getBuffer();
                int w = image.getWidth(), h = image.getHeight();
                int rowStride = y.getRowStride();
                byte[] luma = new byte[w * h];
                if (rowStride == w) {
                    buf.get(luma);
                } else {
                    byte[] row = new byte[rowStride];
                    for (int i = 0; i < h; i++) {
                        buf.position(i * rowStride);
                        int len = Math.min(rowStride, buf.remaining());
                        buf.get(row, 0, len);
                        System.arraycopy(row, 0, luma, i * w, w);
                    }
                }
                listener.onAnalysisFrame(luma, w, h, image.getTimestamp());
            } catch (Throwable t) {
                Log.w(TAG, "analysis", t);
            } finally {
                if (image != null) image.close();
            }
        }
    };

    private void finishCapture() {
        List<byte[]> out;
        synchronized (burst) {
            out = new ArrayList<byte[]>(burst);
            burst.clear();
        }
        RawFrame raw = null;
        if (pendingRaw != null && rawSize != null && rawResult != null) {
            raw = new RawFrame();
            raw.data = pendingRaw;
            raw.width = pendingRawW;
            raw.height = pendingRawH;
            raw.format = ImageFormat.RAW_SENSOR;
            raw.timestamp = pendingRawTs;
            raw.iso = lastIso;
            raw.exposureNs = lastExposureNs;
        }
        pendingRaw = null;
        capturing = false;
        listener.onPhotoCaptured(out, raw, lastIso, lastExposureNs, flashFired);
    }

    /**
     * Writes a real .dng from the RAW_SENSOR buffer using the platform DngCreator, together with the
     * capture result of the very same frame (which is what carries the black level, white balance and
     * noise profile metadata that makes the DNG usable by a raw developer).
     */
    public boolean writeRawDng(RawFrame frame, File out) {
        if (frame == null || chars == null || rawResult == null) return false;
        OutputStream os = null;
        try {
            DngCreator creator = new DngCreator(chars, rawResult);
            creator.setOrientation(displayRotationToExif());
            os = new FileOutputStream(out);
            creator.writeByteBuffer(os, new Size(frame.width, frame.height),
                    java.nio.ByteBuffer.wrap(frame.data), frame.timestamp);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "writeRawDng", t);
            return false;
        } finally {
            try {
                if (os != null) os.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private int displayRotationToExif() {
        int rot = exifDegrees();
        switch (rot) {
            case 90:
                return android.media.ExifInterface.ORIENTATION_ROTATE_90;
            case 180:
                return android.media.ExifInterface.ORIENTATION_ROTATE_180;
            case 270:
                return android.media.ExifInterface.ORIENTATION_ROTATE_270;
            default:
                return android.media.ExifInterface.ORIENTATION_NORMAL;
        }
    }

    private TotalCaptureResult lastResult;
    private TotalCaptureResult rawResult;
    private static final Object RAW_TAG = new Object();

    private final CameraCaptureSession.CaptureCallback captureCallback = new CameraCaptureSession.CaptureCallback() {
        @Override
        public void onCaptureCompleted(CameraCaptureSession s, CaptureRequest request, TotalCaptureResult result) {
            lastResult = result;
            if (rawReader != null && RAW_TAG.equals(request.getTag())) {
                rawResult = result;
            }
            Integer iso = result.get(CaptureResult.SENSOR_SENSITIVITY);
            Long exp = result.get(CaptureResult.SENSOR_EXPOSURE_TIME);
            if (iso != null) lastIso = iso;
            if (exp != null) lastExposureNs = exp;
            Integer af = result.get(CaptureResult.CONTROL_AF_STATE);
            if (af != null) {
                boolean locked = af == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED
                        || af == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED;
                boolean active = af == CaptureResult.CONTROL_AF_STATE_ACTIVE_SCAN
                        || af == CaptureResult.CONTROL_AF_STATE_PASSIVE_SCAN;
                listener.onFocusState(locked, active);
            }
            listener.onManualState(result);
        }
    };

    // ------------------------------------------------------------------ video

    /** Starts recording. Slow motion uses a constrained high speed session when available. */
    public void startVideo(final VideoConfig cfg) {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (session != null) {
                        session.close();
                        session = null;
                    }
                    releaseReaders();
                    if (previewSurface == null && previewTexture != null) {
                        previewTexture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
                        previewSurface = new Surface(previewTexture);
                    }
                    recorder = new MediaRecorder();
                    if (cfg.audio) recorder.setAudioSource(MediaRecorder.AudioSource.CAMCORDER);
                    recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
                    recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                    recorder.setVideoSize(cfg.width, cfg.height);
                    recorder.setVideoFrameRate(cfg.fps);
                    if (cfg.slowMotion) {
                        recorder.setVideoEncodingBitRate(Math.min(120_000_000, cfg.width * cfg.height * 8));
                    } else {
                        recorder.setVideoEncodingBitRate(Math.min(80_000_000, cfg.width * cfg.height * 6));
                    }
                    recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
                    if (cfg.audio) {
                        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                        recorder.setAudioEncodingBitRate(128000);
                        recorder.setAudioSamplingRate(48000);
                    }
                    if (cfg.timeLapse) {
                        recorder.setCaptureRate(Math.max(0.5f, cfg.timeLapseRate));
                        recorder.setVideoFrameRate(30);
                    }
                    recorder.setOrientationHint(exifDegrees());
                    videoFile = cfg.output;
                    recorder.setOutputFile(videoFile.getAbsolutePath());
                    recorder.prepare();
                    Surface recorderSurface = recorder.getSurface();
                    if (cfg.slowMotion) {
                        startHighSpeedSession(recorderSurface, cfg);
                    } else {
                        startNormalVideoSession(recorderSurface, cfg);
                    }
                } catch (Throwable t) {
                    Log.e(TAG, "startVideo", t);
                    releaseRecorder();
                    listener.onVideoStopped(null, false, "Cannot start recording: " + t.getClass().getSimpleName());
                }
            }
        });
    }

    private void startNormalVideoSession(final Surface recorderSurface, final VideoConfig cfg) throws CameraAccessException {
        List<Surface> surfaces = new ArrayList<Surface>();
        surfaces.add(recorderSurface);
        if (previewSurface != null) surfaces.add(previewSurface);
        device.createCaptureSession(surfaces, new CameraCaptureSession.StateCallback() {
            @Override
            public void onConfigured(CameraCaptureSession s) {
                session = s;
                try {
                    CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                    b.addTarget(recorderSurface);
                    if (previewSurface != null) b.addTarget(previewSurface);
                    applyTo(b, false);
                    if (cfg.stabilize) {
                        if (caps != null && caps.eisSupported) {
                            b.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                                    CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON);
                            videoStabilization = true;
                        }
                        if (caps != null && caps.oisSupported) {
                            b.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
                                    CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON);
                            opticalStabilization = true;
                        }
                    }
                    b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, pickFpsRange(cfg.fps));
                    session.setRepeatingRequest(b.build(), captureCallback, handler);
                    recorder.start();
                    recording = true;
                    recordStart = System.currentTimeMillis();
                    listener.onVideoStarted();
                } catch (Throwable t) {
                    Log.e(TAG, "video session", t);
                    releaseRecorder();
                    listener.onVideoStopped(null, false, "Recording failed to start");
                }
            }

            @Override
            public void onConfigureFailed(CameraCaptureSession s) {
                releaseRecorder();
                listener.onVideoStopped(null, false, "Recording session rejected by the camera");
            }
        }, handler);
    }

    private void startHighSpeedSession(final Surface recorderSurface, final VideoConfig cfg) {
        try {
            List<Surface> surfaces = new ArrayList<Surface>();
            surfaces.add(recorderSurface);
            if (previewSurface != null) surfaces.add(previewSurface);
            device.createConstrainedHighSpeedCaptureSession(surfaces,
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession s) {
                            highSpeedSession = (CameraConstrainedHighSpeedCaptureSession) s;
                            try {
                                CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                                b.addTarget(recorderSurface);
                                if (previewSurface != null) b.addTarget(previewSurface);
                                applyTo(b, false);
                                b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                                        new Range<Integer>(cfg.fps, cfg.fps));
                                List<CaptureRequest> list = highSpeedSession.createHighSpeedRequestList(b.build());
                                highSpeedSession.setRepeatingBurst(list, captureCallback, handler);
                                recorder.start();
                                recording = true;
                                recordStart = System.currentTimeMillis();
                                listener.onVideoStarted();
                            } catch (Throwable t) {
                                releaseRecorder();
                                listener.onVideoStopped(null, false, "Slow motion start failed");
                            }
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession s) {
                            releaseRecorder();
                            listener.onSlowMotionUnsupported("This device refuses the high speed session");
                        }
                    }, handler);
        } catch (Throwable t) {
            releaseRecorder();
            listener.onSlowMotionUnsupported("High speed capture is not available on this camera");
        }
    }

    private Range<Integer> pickFpsRange(int wanted) {
        try {
            android.util.Range<Integer>[] ranges = chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
            if (ranges == null) return new Range<Integer>(30, 30);
            Range<Integer> best = ranges[0];
            int bestScore = Integer.MAX_VALUE;
            for (Range<Integer> r : ranges) {
                int score = Math.abs(r.getUpper() - wanted) * 10 + Math.abs(r.getLower() - Math.min(30, wanted));
                if (score < bestScore) {
                    bestScore = score;
                    best = r;
                }
            }
            return best;
        } catch (Throwable t) {
            return new Range<Integer>(30, 30);
        }
    }

    public void stopVideo() {
        if (handler == null) return;
        handler.post(new Runnable() {
            @Override
            public void run() {
                File file = videoFile;
                try {
                    if (recording && recorder != null) {
                        recorder.stop();
                    }
                    recording = false;
                    listener.onVideoStopped(file, file != null && file.length() > 0, null);
                } catch (Throwable t) {
                    recording = false;
                    if (file != null) file.delete();
                    listener.onVideoStopped(null, false, "Recording stopped with an error");
                } finally {
                    releaseRecorder();
                    recreateSession();
                }
            }
        });
    }

    private void releaseRecorder() {
        recording = false;
        if (recorder != null) {
            try {
                recorder.reset();
                recorder.release();
            } catch (Throwable ignored) {
            }
            recorder = null;
        }
    }

    // ------------------------------------------------------------------ shutdown

    public void close() {
        if (handler != null) {
            handler.post(new Runnable() {
                @Override
                public void run() {
                    closeInternal();
                    listener.onCameraClosed();
                }
            });
        }
    }

    private void closeInternal() {
        try {
            if (highSpeedSession != null) {
                highSpeedSession.close();
                highSpeedSession = null;
            }
            if (session != null) {
                session.close();
                session = null;
            }
            if (device != null) {
                device.close();
                device = null;
            }
            releaseReaders();
            if (previewSurface != null) {
                previewSurface.release();
                previewSurface = null;
            }
        } catch (Throwable t) {
            Log.w(TAG, "close", t);
        }
    }

    public void closeAll() {
        close();
        if (torchCallback != null && manager != null) {
            try {
                manager.unregisterTorchCallback(torchCallback);
            } catch (Throwable ignored) {
            }
        }
        if (handler != null) handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (thread != null) {
                    thread.quitSafely();
                    thread = null;
                    handler = null;
                }
            }
        }, 120);
    }

    public float opticalMaxZoom() {
        float max = 1f;
        if (caps != null) {
            for (Capabilities.Lens l : caps.lenses) max = Math.max(max, l.zoomFactor);
        }
        return max;
    }

    public boolean isVideoStabilizationActive() {
        return videoStabilization || opticalStabilization;
    }

    public String stabilizationLabel() {
        StringBuilder sb = new StringBuilder();
        if (opticalStabilization) sb.append("OIS");
        if (videoStabilization) sb.append(sb.length() > 0 ? " + EIS" : "EIS");
        return sb.length() == 0 ? "off" : sb.toString();
    }

    public interface ThermalListener {
        void onThermal(int status);
    }

    /** Registers a thermal status listener (API 29+) so the AI budget can adapt on the fly. */
    public void registerThermal(final ThermalListener l) {
        if (Build.VERSION.SDK_INT < 29) return;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            final android.os.Handler h = handler;
            java.util.concurrent.Executor exec = new java.util.concurrent.Executor() {
                @Override
                public void execute(Runnable command) {
                    h.post(command);
                }
            };
            pm.addThermalStatusListener(exec, new PowerManager.OnThermalStatusChangedListener() {
                @Override
                public void onThermalStatusChanged(int status) {
                    l.onThermal(status);
                }
            });
        } catch (Throwable ignored) {
        }
    }

    public static int thermalSevere() {
        return Build.VERSION.SDK_INT >= 29 ? PowerManager.THERMAL_STATUS_SEVERE : 3;
    }
}
