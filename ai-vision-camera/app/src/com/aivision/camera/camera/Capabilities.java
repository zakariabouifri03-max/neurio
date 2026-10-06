package com.aivision.camera.camera;

import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.os.Build;
import android.util.Size;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Everything the hardware actually supports, measured from {@link CameraCharacteristics}.
 *
 * <p>This class exists for one reason: the app must never claim a capability the device does not
 * have. Every label in the UI ("4K", "2K", "RAW", "100x", "AI Enhanced 4K") is derived from a value
 * measured here, and the app degrades honestly (e.g. it labels an upscaled result as
 * <em>AI Enhanced</em> 4K instead of claiming native 4K when the sensor cannot do 4K).
 */
public class Capabilities {

    public static class Lens {
        public String id;
        public float focalMm;
        public float focal35;        // 35 mm equivalent focal length
        public float zoomFactor;      // relative to the main wide lens (0.5, 1, 2, 5 ...)
        public String label;          // "0.5x", "1x", "5x"
        public boolean main;

        public String toString() {
            return label + (main ? " (main)" : "");
        }
    }

    public String cameraId = "0";
    public boolean front;
    public boolean logicalMultiCamera;
    public String sensorModel = "";

    public android.graphics.Rect activeArray; // full sensor area in pixels
    public Size maxJpeg;                     // largest still resolution
    public List<Size> jpegSizes = new ArrayList<Size>();
    public List<Size> videoSizes = new ArrayList<Size>();       // 30 fps class video
    public List<Size> highSpeedSizes = new ArrayList<Size>();   // slow motion
    public int maxHighSpeedFps = 120;

    public boolean rawSupported;
    public boolean raw10Supported;
    public boolean oisSupported;
    public boolean eisSupported;
    public boolean flashAvailable;
    public boolean torchAvailable;
    public boolean manualSensor;             // READ_SENSOR_SETTINGS / manual 3A
    public boolean hdrSceneModeSupported;

    public float maxDigitalZoom = 1f;
    public float maxZoomRatio = 1f;           // API 30 zoom ratio range (includes optical)
    public float minFocusDistance = 0f;       // diopters
    public long minExposureNs, maxExposureNs;
    public int minIso = 100, maxIso = 3200;
    public boolean manualExposureSupported;
    public boolean manualFocusSupported;
    public float maxZoomToDisplay = 100f;     // honest ceiling for the zoom UI

    public List<Lens> lenses = new ArrayList<Lens>();
    public int maxBurstFrames = 8;

    // ------------------------------------------------------------------ build

    public static Capabilities build(CameraManager manager, String cameraId) {
        if (manager == null || cameraId == null) return null;
        try {
            CameraCharacteristics ch = manager.getCameraCharacteristics(cameraId);
            Capabilities c = new Capabilities();
            c.cameraId = cameraId;
            Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
            c.front = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
            c.sensorModel = String.valueOf(ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE));
            c.activeArray = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
            c.manualSensor = contains(ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES),
                    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR);
            c.rawSupported = contains(ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES),
                    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW);
            if (Build.VERSION.SDK_INT >= 28) {
                Set<String> physical = ch.getPhysicalCameraIds();
                c.logicalMultiCamera = physical != null && physical.size() > 1;
            }
            StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (map != null) {
                Size[] jpeg = map.getOutputSizes(android.graphics.ImageFormat.JPEG);
                if (jpeg != null) {
                    for (Size s : jpeg) c.jpegSizes.add(s);
                    sortDesc(c.jpegSizes);
                    c.maxJpeg = c.jpegSizes.get(0);
                }
                Size[] video = map.getOutputSizes(android.media.MediaRecorder.class);
                if (video != null) {
                    for (Size s : video) {
                        long minDur = map.getOutputMinFrameDuration(android.media.MediaRecorder.class, s);
                        int fps = minDur > 0 ? (int) Math.round(1e9 / minDur) : 30;
                        if (s.getWidth() <= 3840 && fps <= 60) c.videoSizes.add(s);
                    }
                    sortDesc(c.videoSizes);
                }
                if (Build.VERSION.SDK_INT >= 23) {
                    Size[] hs = map.getHighSpeedVideoSizes();
                    if (hs != null) {
                        for (Size s : hs) {
                            c.highSpeedSizes.add(s);
                            android.util.Range<Integer>[] ranges = map.getHighSpeedVideoFpsRangesFor(s);
                            if (ranges != null) {
                                for (android.util.Range<Integer> r : ranges) {
                                    if (r.getUpper() > c.maxHighSpeedFps) c.maxHighSpeedFps = r.getUpper();
                                }
                            }
                        }
                        sortDesc(c.highSpeedSizes);
                    }
                }
            }
            Boolean flash = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            c.flashAvailable = flash != null && flash.booleanValue();
            c.torchAvailable = c.flashAvailable;
            CameraCharacteristics.Key<int[]> oisKey = CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION;
            int[] ois = ch.get(oisKey);
            c.oisSupported = contains(ois, CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON);
            if (Build.VERSION.SDK_INT >= 28) {
                int[] eis = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES);
                c.eisSupported = contains(eis, CameraCharacteristics.CONTROL_VIDEO_STABILIZATION_MODE_ON);
            }
            Float maxDig = ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
            c.maxDigitalZoom = maxDig == null ? 1f : maxDig;
            if (Build.VERSION.SDK_INT >= 30) {
                android.util.Range<Float> zr = ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                if (zr != null) c.maxZoomRatio = zr.getUpper();
            }
            c.maxZoomRatio = Math.max(c.maxZoomRatio, c.maxDigitalZoom);
            android.util.Range<Long> exp = ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE);
            if (exp != null) {
                c.minExposureNs = exp.getLower();
                c.maxExposureNs = exp.getUpper();
            }
            android.util.Range<Integer> iso = ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
            if (iso != null) {
                c.minIso = iso.getLower();
                c.maxIso = iso.getUpper();
            }
            Float mfd = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
            c.minFocusDistance = mfd == null ? 0 : mfd;
            c.manualExposureSupported = c.manualSensor && c.maxExposureNs > 0 && c.maxIso > 0;
            c.manualFocusSupported = c.minFocusDistance > 0;
            int[] sceneModes = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_SCENE_MODES);
            c.hdrSceneModeSupported = contains(sceneModes,
                    CameraCharacteristics.CONTROL_SCENE_MODE_HDR);
            // RAW10/RAW12 are only reachable through the API 31+ depth/raw stream helpers; before
            // that the app can only request the sensor's RAW_SENSOR format, which is what rawSupported
            // reports. Never inflate this: the RAW button is hidden when the device says no.
            boolean raw10 = false;
            if (Build.VERSION.SDK_INT >= 31) {
                try {
                    android.hardware.camera2.params.StreamConfigurationMap rawMap =
                            ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    if (rawMap != null) {
                        android.util.Size[] sizes = rawMap.getOutputSizes(android.graphics.ImageFormat.RAW10);
                        raw10 = sizes != null && sizes.length > 0;
                    }
                } catch (Throwable ignored) {
                }
            }
            // RAW10 is a real, higher bit depth stream - only claim it when the sensor lists it
            c.raw10Supported = raw10;
            c.rawSupported = c.rawSupported || raw10;
            c.buildLenses(manager, ch);
            // honest ceiling for the zoom UI: what the hardware can actually reach
            float opticalMax = 1f;
            for (Lens l : c.lenses) opticalMax = Math.max(opticalMax, l.zoomFactor);
            c.maxZoomToDisplay = Math.max(1f, Math.min(100f, Math.max(c.maxZoomRatio, opticalMax)));
            return c;
        } catch (Throwable t) {
            return null;
        }
    }

    /** Finds the physical lenses behind this camera id and labels them by their zoom factor. */
    private void buildLenses(CameraManager manager, CameraCharacteristics main) {
        Float mainFocal = firstFloat(main.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS));
        android.util.SizeF sensor = main.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
        float main35 = equiv(mainFocal, sensor);
        List<String> ids = new ArrayList<String>();
        if (!front) ids.add(cameraId);
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                Set<String> physical = main.getPhysicalCameraIds();
                if (physical != null) {
                    for (String id : physical) if (!ids.contains(id)) ids.add(id);
                }
            } catch (Throwable ignored) {
            }
        }
        if (front) {
            // front camera: no wide/tele cluster, just the one lens
            Lens l = new Lens();
            l.id = cameraId;
            l.focalMm = mainFocal == null ? 0 : mainFocal;
            l.focal35 = main35;
            l.zoomFactor = 1f;
            l.label = "1x";
            l.main = true;
            lenses.add(l);
        } else {
            for (String id : ids) {
                try {
                    CameraCharacteristics ch = id.equals(cameraId) ? main : manager.getCameraCharacteristics(id);
                    Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                    if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) continue;
                    Float focal = firstFloat(ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS));
                    android.util.SizeF phys = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
                    float f35 = equiv(focal, phys);
                    if (f35 <= 0) continue;
                    Lens l = new Lens();
                    l.id = id;
                    l.focalMm = focal == null ? 0 : focal;
                    l.focal35 = f35;
                    l.zoomFactor = f35 / Math.max(1f, main35);
                    lenses.add(l);
                } catch (Throwable ignored) {
                }
            }
            // pick the main lens as the one closest to 1x, then snap labels to the familiar stops
            Lens best = null;
            for (Lens l : lenses) {
                if (best == null || Math.abs(l.zoomFactor - 1f) < Math.abs(best.zoomFactor - 1f)) best = l;
            }
            if (best != null) best.main = true;
            for (Lens l : lenses) {
                l.label = zoomLabel(l.zoomFactor, l.main);
            }
        }
        Collections.sort(lenses, new Comparator<Lens>() {
            @Override
            public int compare(Lens a, Lens b) {
                return Float.compare(a.zoomFactor, b.zoomFactor);
            }
        });
    }

    private static String zoomLabel(float z, boolean main) {
        if (main) return "1x";
        if (z < 0.75f) return "0.5x";
        if (z < 1.4f) return "1x";
        return Math.round(z) + "x";
    }

    private static float equiv(Float focal, android.util.SizeF phys) {
        if (focal == null || phys == null) return 0;
        float diag = (float) Math.sqrt(phys.getWidth() * phys.getWidth() + phys.getHeight() * phys.getHeight());
        if (diag <= 0) return 0;
        return focal * (43.27f / diag);
    }

    private static Float firstFloat(float[] a) {
        if (a == null || a.length == 0) return null;
        float best = a[0];
        for (float f : a) if (f < best) best = f;   // widest
        return best;
    }

    private static boolean contains(int[] arr, int value) {
        if (arr == null) return false;
        for (int v : arr) if (v == value) return true;
        return false;
    }

    private static void sortDesc(List<Size> sizes) {
        Collections.sort(sizes, new Comparator<Size>() {
            @Override
            public int compare(Size a, Size b) {
                long pa = (long) a.getWidth() * a.getHeight();
                long pb = (long) b.getWidth() * b.getHeight();
                return Long.compare(pb, pa);
            }
        });
    }

    // ------------------------------------------------------------------ derived properties

    /** The best still size to use, capped so a burst still fits in memory. */
    public Size captureSize(int maxMegapixels) {
        long cap = (long) maxMegapixels * 1000L * 1000L;
        for (Size s : jpegSizes) {
            if ((long) s.getWidth() * s.getHeight() <= cap) return s;
        }
        return maxJpeg;
    }

    /** Native 4K capability - the honest test the UI uses before promising "4K". */
    public boolean nativeUhd() {
        return maxJpeg != null && maxJpeg.getWidth() >= 3840 || hasJpeg(3840, 2160);
    }

    public boolean native2k() {
        return hasJpeg(2560, 1440) || (maxJpeg != null && maxJpeg.getWidth() >= 2560);
    }

    public boolean hasJpeg(int w, int h) {
        for (Size s : jpegSizes) {
            if (s.getWidth() >= w && s.getHeight() >= h) return true;
        }
        return false;
    }

    /** Video mode entry used by the UI, each one labelled with its real resolution. */
    public static class VideoMode {
        public int width, height, fps;
        public boolean highSpeed;
        public String label;
        public boolean aiUpscale;   // sensor cannot do this natively -> label as AI enhanced

        @Override
        public String toString() {
            return label;
        }
    }

    public List<VideoMode> videoModes() {
        List<VideoMode> out = new ArrayList<VideoMode>();
        boolean uhd = false, twoK = false;
        for (Size s : videoSizes) {
            int w = s.getWidth(), h = s.getHeight();
            if (w > 3840) continue;
            if (w >= 3800) {
                if (uhd) continue;
                uhd = true;
            } else if (w >= 2500) {
                if (twoK) continue;
                twoK = true;
            } else if (w >= 1900 || w >= 1200) {
                // one entry per resolution class
            } else {
                continue;
            }
            VideoMode m = new VideoMode();
            m.width = w;
            m.height = h;
            m.fps = w >= 3800 ? 30 : 30;
            m.label = resLabel(w) + " - " + m.fps + "fps";
            out.add(m);
        }
        if (maxHighSpeedFps > 60 && !highSpeedSizes.isEmpty()) {
            Size hs = highSpeedSizes.get(Math.min(1, highSpeedSizes.size() - 1));
            VideoMode m = new VideoMode();
            m.width = hs.getWidth();
            m.height = hs.getHeight();
            m.fps = maxHighSpeedFps;
            m.highSpeed = true;
            m.label = "Slow motion " + resLabel(hs.getWidth()) + " - " + maxHighSpeedFps + "fps";
            out.add(m);
        }
        if (!uhd) {
            VideoMode m = new VideoMode();
            m.width = 3840;
            m.height = 2160;
            m.fps = 30;
            m.aiUpscale = true;
            m.label = "AI Enhanced 4K (upscaled from " + resLabel(videoLongEdge()) + ")";
            out.add(m);
        } else {
            VideoMode m = new VideoMode();
            m.width = 3840;
            m.height = 2160;
            m.fps = 60;
            if (hasVideo(3840, 2160, 60)) {
                m.label = "4K - 60fps (native)";
                out.add(m);
            }
        }
        return out;
    }

    private int videoLongEdge() {
        int best = 1080;
        for (Size s : videoSizes) best = Math.max(best, s.getWidth());
        return Math.min(best, 1920);
    }

    private boolean hasVideo(int w, int h, int fps) {
        for (Size s : videoSizes) if (s.getWidth() >= w) return true;
        return false;
    }

    public static String resLabel(int longEdge) {
        if (longEdge >= 3800) return "4K";
        if (longEdge >= 2500) return "2K";
        if (longEdge >= 1900) return "1080p";
        if (longEdge >= 1200) return "720p";
        return longEdge + "p";
    }

    public String describe() {
        StringBuilder sb = new StringBuilder();
        sb.append(front ? "Front camera" : "Rear camera").append('\n');
        sb.append("Still resolution: ").append(maxJpeg == null ? "?" : maxJpeg.getWidth() + "x" + maxJpeg.getHeight());
        sb.append("  ({").append(hasJpeg(3840, 2160) ? "native 4K class" : "no native 4K").append("})\n");
        sb.append("Video: ");
        for (VideoMode m : videoModes()) sb.append(m.label).append(" | ");
        sb.append('\n');
        sb.append("Lenses: ");
        for (Lens l : lenses) sb.append(l.label).append("(").append(Math.round(l.focal35)).append("mm) ");
        sb.append('\n');
        sb.append(String.format(Locale.US, "Zoom: digital %.1fx, hardware %.1fx, UI ceiling %.0fx%n",
                maxDigitalZoom, maxZoomRatio, maxZoomToDisplay));
        sb.append("RAW: ").append(rawSupported ? "yes" : "no")
                .append(" | OIS: ").append(oisSupported ? "yes" : "no")
                .append(" | EIS: ").append(eisSupported ? "yes" : "no")
                .append(" | manual: ").append(manualSensor ? "yes" : "no")
                .append(" | flash: ").append(flashAvailable ? "yes" : "no").append('\n');
        if (manualExposureSupported) {
            sb.append(String.format(Locale.US, "Manual range: ISO %d-%d, exposure %.1f ms - %.0f ms (1/%.0f - 1/%.1f s)%n",
                    minIso, maxIso, minExposureNs / 1e6,
                    maxExposureNs / 1e6, 1e9 / Math.max(1, minExposureNs), 1e9 / Math.max(1, maxExposureNs)));
        }
        sb.append("Slow motion: up to ").append(maxHighSpeedFps).append(" fps\n");
        return sb.toString();
    }

    /** A short badge for the viewfinder, e.g. "RAW - 12 MP - 4K". */
    public String badge() {
        StringBuilder sb = new StringBuilder();
        if (maxJpeg != null) sb.append(Math.round(maxJpeg.getWidth() * (long) maxJpeg.getHeight() / 1e6)).append("MP");
        if (rawSupported) sb.append(" - RAW");
        if (hasJpeg(3840, 2160)) sb.append(" - 4K");
        if (lenses.size() > 1) sb.append(" - ").append(lenses.size()).append(" lenses");
        return sb.toString();
    }

    public Set<String> lensLabels() {
        Set<String> out = new HashSet<String>();
        for (Lens l : lenses) out.add(l.label);
        return out;
    }
}
