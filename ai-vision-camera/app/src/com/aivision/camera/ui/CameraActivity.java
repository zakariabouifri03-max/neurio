package com.aivision.camera.ui;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.aivision.camera.App;
import com.aivision.camera.ai.EngineBridge;
import com.aivision.camera.ai.Panorama;
import com.aivision.camera.ai.core.AiPipeline;
import com.aivision.camera.ai.core.Img;
import com.aivision.camera.ai.core.Scene;
import com.aivision.camera.ai.core.Stats;
import com.aivision.camera.ai.core.Tier;
import com.aivision.camera.camera.CameraController;
import com.aivision.camera.camera.Capabilities;
import com.aivision.camera.gallery.GalleryActivity;
import com.aivision.camera.media.MediaLibrary;
import com.aivision.camera.media.VideoEnhancer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The camera itself.
 *
 * <p>Everything on screen is wired to real hardware and the real engine: the preview is the camera's
 * SurfaceTexture, the analysis frames feed the live scene model, the shutter triggers a real Camera2
 * burst, the AI buttons run the on-device computational photography pipeline over that burst, and the
 * before/after sheet shows the measured result. Capability claims (resolution, zoom, 4K) come from
 * {@link Capabilities} and are labelled as upscaled whenever they are.
 */
public class CameraActivity extends Activity implements CameraController.Listener,
        PreviewOverlay.Listener, ProPanel.Listener, ResultView.Listener {

    private static final int REQ_PERMS = 0x51;
    private static final int MODE_PHOTO = 0, MODE_VIDEO = 1, MODE_PRO = 2, MODE_NIGHT = 3, MODE_AI = 4;
    private static final int SUB_NORMAL = 0, SUB_SLOWMO = 1, SUB_TIMELAPSE = 2;

    private FrameLayout root;
    private TextureView texture;
    private PreviewOverlay overlay;
    private ProPanel proPanel;
    private ProgressOverlay progress;
    private ResultView resultView;
    private LinearLayout bottomBar, aiSheet, videoRow;
    private TextView modeLabel, outputChip, timerChip, resolutionChip;
    private IconButton shutter, galleryBtn, switchBtn, flashBtn, torchBtn, gridBtn, settingsBtn, infoBtn,
            hdrBtn, aiEnhanceBtn, aiUltraBtn, timerBtn, panoBtn, docBtn, macroBtn, portraitBtn,
            subNormalBtn, subSlowBtn, subLapseBtn, rawBtn;

    private CameraController controller;
    private MediaLibrary library;
    private Capabilities caps;

    private int mode = MODE_PHOTO;
    private int videoSub = SUB_NORMAL;
    private int flashMode = CaptureRequest.FLASH_MODE_OFF;
    private int timerSeconds = 0;
    private boolean torch;
    private boolean frontFacing;
    private boolean aiEnhance = true;
    private boolean aiUltra;
    private boolean hdrAuto = true;
    private boolean hdrForce;
    private boolean portraitMode, docMode, macroMode, panoMode;
    private float zoom = 1f;
    private int outputTarget = 0;   // 0 = native, 1 = up to 2K, 2 = up to 4K (AI enhanced when upscaled)

    private CameraController.Manual manual = new CameraController.Manual();
    private List<byte[]> lastBurst = new ArrayList<byte[]>();
    private byte[] lastRefJpeg;
    private File lastRawFile;
    private Bitmap lastBefore, lastEnhanced;
    private String lastReportJson;
    private String lastOutputLabel = "";
    private final AtomicBoolean aiCancel = new AtomicBoolean(false);
    private boolean processing;
    private long lastAnalysisMs;
    private float panoRoll;
    private Panorama panorama;
    private File recordingFile;
    private boolean recording;
    private boolean pendingSave;
    private int capturedFrames;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<Capabilities.VideoMode> videoModes = new ArrayList<Capabilities.VideoMode>();
    private int videoModeIndex;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setBackgroundDrawableResource(android.R.color.black);
        App.get();
        library = new MediaLibrary(this);
        controller = new CameraController(this, this);
        buildUi();
        applyPrefs();
        if (hasCameraPermission()) {
            startPreviewWhenReady();
        } else {
            requestPermissions(new String[]{Manifest.permission.CAMERA,
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_PERMS) {
            if (hasCameraPermission()) {
                startPreviewWhenReady();
            } else {
                new AlertDialog.Builder(this)
                        .setTitle("Camera permission needed")
                        .setMessage(getString(com.aivision.camera.R.string.permission_needed))
                        .setPositiveButton("Retry", new android.content.DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(android.content.DialogInterface dialog, int which) {
                                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMS);
                            }
                        })
                        .setNegativeButton("Close", new android.content.DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(android.content.DialogInterface dialog, int which) {
                                finish();
                            }
                        })
                        .show();
            }
        }
    }

    private boolean hasCameraPermission() {
        return checkPermission(Manifest.permission.CAMERA, android.os.Process.myPid(),
                android.os.Process.myUid()) == PackageManager.PERMISSION_GRANTED;
    }

    private void startPreviewWhenReady() {
        if (texture.isAvailable()) {
            openCamera();
        } else {
            texture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override
                public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
                    openCamera();
                }

                @Override
                public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {
                    if (caps != null) openCamera();
                }

                @Override
                public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
                    return true;
                }

                @Override
                public void onSurfaceTextureUpdated(SurfaceTexture st) {
                }
            });
        }
    }

    private void openCamera() {
        SurfaceTexture st = texture.getSurfaceTexture();
        if (st == null) return;
        controller.setDisplayRotation(displayRotation());
        controller.open(controller.pickCamera(frontFacing), st, texture.getWidth(), texture.getHeight());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasCameraPermission() && caps != null && !processing) openCamera();
        if (overlay != null) {
            overlay.showGrid(App.get().prefs().getBoolean("grid", false));
            overlay.showHistogram(App.get().prefs().getBoolean("histogram", true));
            overlay.showLevel(App.get().prefs().getBoolean("level", true));
        }
    }

    @Override
    protected void onPause() {
        if (recording) controller.stopVideo();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        aiCancel.set(true);
        controller.closeAll();
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration cfg) {
        super.onConfigurationChanged(cfg);
        controller.setDisplayRotation(displayRotation());
        if (caps != null) openCamera();
    }

    private int displayRotation() {
        int r = getWindowManager().getDefaultDisplay().getRotation();
        return r == Surface.ROTATION_90 ? 90 : (r == Surface.ROTATION_180 ? 180 : (r == Surface.ROTATION_270 ? 270 : 0));
    }

    // ------------------------------------------------------------------ ui

    private float d() {
        return getResources().getDisplayMetrics().density;
    }

    private void buildUi() {
        root = new FrameLayout(this);
        texture = new TextureView(this);
        root.addView(texture, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        overlay = new PreviewOverlay(this);
        overlay.setListener(this);
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildTopBar(), topParams());

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackgroundColor(0x99090B0E);
        bottom.setPadding(0, 0, 0, Math.round(d() * 6));

        proPanel = new ProPanel(this);
        proPanel.setListener(this);
        proPanel.setVisibility(View.GONE);
        bottom.addView(proPanel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        bottom.addView(buildAiSheet());
        bottom.addView(buildVideoRow());
        bottom.addView(buildModeBar());
        bottom.addView(buildAiRow());
        bottom.addView(buildShutterRow());

        FrameLayout.LayoutParams bParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        bParams.gravity = Gravity.BOTTOM;
        root.addView(bottom, bParams);
        bottomBar = bottom;

        progress = new ProgressOverlay(this);
        progress.setCancelListener(new ProgressOverlay.CancelListener() {
            @Override
            public void onCancelRequested() {
                aiCancel.set(true);
                progress.setIndeterminate("Cancelling");
            }
        });
        root.addView(progress, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        resultView = new ResultView(this);
        resultView.setListener(this);
        root.addView(resultView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    private FrameLayout.LayoutParams topParams() {
        FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        p.gravity = Gravity.TOP;
        return p;
    }

    private View buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0x66090B0E);
        bar.setPadding(Math.round(d() * 4), Math.round(d() * 20), Math.round(d() * 4), Math.round(d() * 4));

        flashBtn = new IconButton(this).icon(Icons.FLASH_OFF).label("FLASH").iconSize(19f);
        flashBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                cycleFlash();
            }
        });
        bar.addView(flashBtn);

        torchBtn = new IconButton(this).icon(Icons.TORCH).label("TORCH").iconSize(19f);
        torchBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                torch = !torch;
                torchBtn.setSelectedState(torch);
                controller.setTorch(torch);
                if (torch && mode == MODE_VIDEO) flashMode = CaptureRequest.FLASH_MODE_OFF;
            }
        });
        bar.addView(torchBtn);

        hdrBtn = new IconButton(this).icon(Icons.HDR).label("HDR").iconSize(19f);
        hdrBtn.setSelectedState(true);
        hdrBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hdrForce = !hdrForce;
                hdrBtn.setSelectedState(hdrForce);
                toast(hdrForce ? "HDR fusion always on" : "HDR fusion decided by the scene model");
            }
        });
        bar.addView(hdrBtn);

        timerBtn = new IconButton(this).icon(Icons.TIMER).label("TIMER").iconSize(19f);
        timerBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                timerSeconds = timerSeconds == 0 ? 3 : (timerSeconds == 3 ? 10 : 0);
                timerBtn.badge(timerSeconds == 0 ? null : timerSeconds + "s");
                toast(timerSeconds == 0 ? "Timer off" : "Timer " + timerSeconds + " s");
            }
        });
        bar.addView(timerBtn);

        gridBtn = new IconButton(this).icon(Icons.GRID).label("GRID").iconSize(19f);
        gridBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                boolean on = !overlay.gridOn();
                overlay.showGrid(on);
                gridBtn.setSelectedState(on);
                App.get().prefs().edit().putBoolean("grid", on).apply();
            }
        });
        bar.addView(gridBtn);

        View spacer = new View(this);
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

        outputChip = new TextView(this);
        outputChip.setTextColor(0xFFF2F2F2);
        outputChip.setTextSize(10.5f);
        outputChip.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        outputChip.setPadding(Math.round(d() * 10), Math.round(d() * 8), Math.round(d() * 10), Math.round(d() * 8));
        outputChip.setBackgroundColor(0x33FFFFFF);
        outputChip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                outputTarget = (outputTarget + 1) % 3;
                refreshChips();
                toast(outputTarget == 0 ? "Output: sensor resolution"
                        : (outputTarget == 1 ? "Output: up to 2K (AI enhanced if upscaled)"
                        : "Output: up to 4K (AI enhanced if the sensor cannot do 4K)"));
            }
        });
        bar.addView(outputChip);

        infoBtn = new IconButton(this).icon(Icons.INFO).iconSize(19f).style(IconButton.STYLE_PLAIN);
        infoBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showCapabilities();
            }
        });
        bar.addView(infoBtn);

        settingsBtn = new IconButton(this).icon(Icons.SETTINGS).iconSize(19f).style(IconButton.STYLE_PLAIN);
        settingsBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                SettingsDialog.show(CameraActivity.this, caps, new SettingsDialog.OnChange() {
                    @Override
                    public void onSettingsChanged() {
                        applyPrefs();
                    }
                });
            }
        });
        bar.addView(settingsBtn);
        return bar;
    }

    private View buildAiSheet() {
        aiSheet = new LinearLayout(this);
        aiSheet.setOrientation(LinearLayout.HORIZONTAL);
        aiSheet.setGravity(Gravity.CENTER);
        aiSheet.setPadding(0, Math.round(d() * 2), 0, Math.round(d() * 2));

        portraitBtn = sheetButton(Icons.PORTRAIT, "PORTRAIT");
        portraitBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                portraitMode = !portraitMode;
                portraitBtn.setSelectedState(portraitMode);
                toast(portraitMode ? "Portrait: background separation from the real face detection" : "Portrait off");
            }
        });
        aiSheet.addView(portraitBtn);

        docBtn = sheetButton(Icons.DOC, "DOCUMENT");
        docBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                docMode = !docMode;
                docBtn.setSelectedState(docMode);
                toast(docMode ? "Document: page detection and rectification" : "Document off");
            }
        });
        aiSheet.addView(docBtn);

        panoBtn = sheetButton(Icons.PANORAMA, "PANORAMA");
        panoBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                panoMode = !panoMode;
                panoBtn.setSelectedState(panoMode);
                if (panoMode) {
                    if (mode == MODE_VIDEO) setMode(MODE_PHOTO);
                    panorama = new Panorama(Math.min(10, Math.max(4, App.get().tier().maxBurstFrames)));
                    overlay.setHint("Press the shutter, then sweep slowly - press again to finish");
                } else {
                    panorama = null;
                    overlay.setHint("");
                }
            }
        });
        aiSheet.addView(panoBtn);

        macroBtn = sheetButton(Icons.MACRO, "MACRO");
        macroBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                macroMode = !macroMode;
                macroBtn.setSelectedState(macroMode);
                if (macroMode) {
                    manual.enabled = true;
                    manual.autoFocus = false;
                    manual.focusDiopters = caps == null ? 10f : Math.max(0.5f, caps.minFocusDistance);
                    controller.setManual(manual);
                    proPanel.setManual(manual);
                    overlay.setHint("Macro: hold the subject about "
                            + Math.round(100f / Math.max(0.5f, manual.focusDiopters)) + " cm away");
                } else {
                    manual.autoFocus = true;
                    manual.enabled = false;
                    controller.setManual(manual);
                    proPanel.setManual(manual);
                    overlay.setHint("");
                }
            }
        });
        aiSheet.addView(macroBtn);
        return aiSheet;
    }

    private IconButton sheetButton(String icon, String label) {
        IconButton b = new IconButton(this).icon(icon).label(label).iconSize(18f).labelUnder(true);
        b.style(IconButton.STYLE_GHOST);
        b.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return b;
    }

    private View buildVideoRow() {
        videoRow = new LinearLayout(this);
        videoRow.setOrientation(LinearLayout.HORIZONTAL);
        videoRow.setGravity(Gravity.CENTER);
        videoRow.setVisibility(View.GONE);

        resolutionChip = new TextView(this);
        resolutionChip.setTextColor(0xFFF2F2F2);
        resolutionChip.setTextSize(10.5f);
        resolutionChip.setPadding(Math.round(d() * 10), Math.round(d() * 6), Math.round(d() * 10), Math.round(d() * 6));
        resolutionChip.setBackgroundColor(0x33FFFFFF);
        resolutionChip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (videoModes.isEmpty()) return;
                videoModeIndex = (videoModeIndex + 1) % videoModes.size();
                refreshChips();
            }
        });
        videoRow.addView(resolutionChip);

        subNormalBtn = sheetButton(Icons.VIDEO, "NORMAL");
        subNormalBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                videoSub = SUB_NORMAL;
                refreshChips();
            }
        });
        subSlowBtn = sheetButton(Icons.SPEED, "SLOW-MO");
        subSlowBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (caps != null && caps.highSpeedSizes.isEmpty()) {
                    toast("This camera does not expose a high speed capture size");
                    return;
                }
                videoSub = SUB_SLOWMO;
                refreshChips();
            }
        });
        subLapseBtn = sheetButton(Icons.TIMELAPSE, "TIME-LAPSE");
        subLapseBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                videoSub = SUB_TIMELAPSE;
                refreshChips();
            }
        });
        videoRow.addView(subNormalBtn);
        videoRow.addView(subSlowBtn);
        videoRow.addView(subLapseBtn);
        return videoRow;
    }

    private View buildModeBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        String[] names = {"PHOTO", "VIDEO", "PRO", "NIGHT", "AI"};
        for (int i = 0; i < names.length; i++) {
            final int m = i;
            modeLabel = new TextView(this);
            modeLabel.setText(names[i]);
            modeLabel.setGravity(Gravity.CENTER);
            modeLabel.setPadding(0, Math.round(d() * 12), 0, Math.round(d() * 12));
            modeLabel.setTextSize(11.5f);
            modeLabel.setLetterSpacing(0.12f);
            modeLabel.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            modeLabel.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    setMode(m);
                }
            });
            bar.addView(modeLabel, lp);
        }
        return bar;
    }

    private View buildAiRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(0, Math.round(d() * 2), 0, Math.round(d() * 2));

        aiEnhanceBtn = new IconButton(this).icon(Icons.ENHANCE).label("AI ENHANCE").iconSize(22f);
        aiEnhanceBtn.style(IconButton.STYLE_GHOST);
        aiEnhanceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                aiEnhance = !aiEnhance;
                aiEnhanceBtn.setSelectedState(aiEnhance);
                aiEnhanceBtn.setPulsing(aiEnhance && !aiUltra);
                toast(aiEnhance ? "AI Enhance on: multi frame detail, noise and colour recovery"
                        : "AI Enhance off: saving the raw camera frame");
            }
        });
        row.addView(aiEnhanceBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        aiUltraBtn = new IconButton(this).icon(Icons.ULTRA).label("AI ULTRA").iconSize(22f);
        aiUltraBtn.style(IconButton.STYLE_GHOST);
        aiUltraBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                aiUltra = !aiUltra;
                if (aiUltra) aiEnhance = true;
                aiUltraBtn.setSelectedState(aiUltra);
                aiEnhanceBtn.setSelectedState(aiEnhance);
                aiEnhanceBtn.setPulsing(aiEnhance && !aiUltra);
                toast(aiUltra ? "AI Ultra on: multi frame super resolution up to "
                        + App.get().tier().maxUltraScale + "x at this device tier"
                        : "AI Ultra off");
            }
        });
        row.addView(aiUltraBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        rawBtn = new IconButton(this).icon(Icons.RAW).label("RAW").iconSize(22f);
        rawBtn.style(IconButton.STYLE_GHOST);
        rawBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (caps != null && !caps.rawSupported) {
                    toast("This camera does not provide RAW capture");
                    return;
                }
                boolean on = !rawBtn.selectedState();
                rawBtn.setSelectedState(on);
                App.get().prefs().edit().putBoolean("keep_raw", on).apply();
                toast(on ? "RAW (DNG) will be saved alongside the JPEG" : "RAW off");
            }
        });
        row.addView(rawBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    private View buildShutterRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(Math.round(d() * 12), Math.round(d() * 4), Math.round(d() * 12), Math.round(d() * 8));

        galleryBtn = new IconButton(this).icon(Icons.GALLERY).iconSize(24f).style(IconButton.STYLE_GHOST);
        galleryBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(CameraActivity.this, GalleryActivity.class));
            }
        });
        row.addView(galleryBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        switchBtn = new IconButton(this).icon(Icons.SWITCH).iconSize(24f).style(IconButton.STYLE_GHOST);
        switchBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                frontFacing = !frontFacing;
                aiUltra = false;
                aiUltraBtn.setSelectedState(false);
                openCamera();
            }
        });
        row.addView(switchBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        shutter = new IconButton(this).icon(Icons.SHUTTER).iconSize(46f).style(IconButton.STYLE_FILLED)
                .colors(0xFF101214, 0xFFFFFFFF, 0xFFFFC24B);
        shutter.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onShutter();
            }
        });
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.6f);
        row.addView(shutter, sp);

        TextView spacer2 = new TextView(this);
        row.addView(spacer2, new LinearLayout.LayoutParams(0, 1, 1f));

        IconButton panoFinish = new IconButton(this).icon(Icons.CHECK).label("FINISH").iconSize(22f);
        panoFinish.style(IconButton.STYLE_GHOST);
        panoFinish.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finishPanorama();
            }
        });
        row.addView(panoFinish, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    // ------------------------------------------------------------------ state

    private void setMode(int m) {
        mode = m;
        boolean video = m == MODE_VIDEO;
        overlay.showGrid(overlay.gridOn());
        proPanel.setVisibility(m == MODE_PRO ? View.VISIBLE : View.GONE);
        videoRow.setVisibility(video ? View.VISIBLE : View.GONE);
        aiSheet.setVisibility(video ? View.GONE : View.VISIBLE);
        shutter.icon(video ? (recording ? Icons.STOP : Icons.RECORD) : Icons.SHUTTER);
        if (m == MODE_NIGHT) {
            hdrForce = true;
            hdrBtn.setSelectedState(true);
            overlay.setHint("Night mode: the burst is stacked to cut noise, handheld");
        } else if (m == MODE_AI) {
            aiEnhance = true;
            overlay.setHint("");
        } else if (m == MODE_PRO) {
            overlay.setHint("");
        } else if (m == MODE_PHOTO) {
            overlay.setHint("");
        }
        if (video) {
            manual.enabled = false;
            controller.setManual(manual);
        }
        updateModeColors();
        refreshChips();
    }

    private void updateModeColors() {
        LinearLayout bar = (LinearLayout) bottomBar.getChildAt(3);
        for (int i = 0; i < bar.getChildCount(); i++) {
            TextView t = (TextView) bar.getChildAt(i);
            boolean active = i == mode;
            t.setTextColor(active ? 0xFFFFC24B : 0x99FFFFFF);
            t.setBackgroundColor(active ? 0x1AFFC24B : Color.TRANSPARENT);
        }
    }

    private void applyPrefs() {
        SharedPreferences p = App.get().prefs();
        overlay.showGrid(p.getBoolean("grid", false));
        overlay.showHistogram(p.getBoolean("histogram", true));
        overlay.showLevel(p.getBoolean("level", true));
        gridBtn.setSelectedState(overlay.gridOn());
        if (rawBtn != null) rawBtn.setSelectedState(p.getBoolean("keep_raw", false));
        if (caps != null) {
            controller.setRawEnabled(p.getBoolean("keep_raw", false) && caps.rawSupported);
        }
    }

    private void refreshChips() {
        String out;
        if (caps == null) {
            out = "READING CAMERA";
        } else if (outputTarget == 0) {
            int longEdge = caps.maxJpeg == null ? 0 : Math.max(caps.maxJpeg.getWidth(), caps.maxJpeg.getHeight());
            out = "SENSOR " + (longEdge > 0 ? Capabilities.resLabel(longEdge) : "?")
                    + (caps.rawSupported ? " - RAW" : "");
        } else if (outputTarget == 1) {
            out = "OUTPUT 2K" + (caps.native2k() ? " native" : " - AI enhanced");
        } else {
            out = "OUTPUT 4K" + (caps.nativeUhd() ? " native" : " - AI ENHANCED (upscaled)");
        }
        outputChip.setText(out);

        if (!videoModes.isEmpty()) {
            Capabilities.VideoMode vm = videoModes.get(Math.min(videoModeIndex, videoModes.size() - 1));
            resolutionChip.setText(vm.label + (vm.aiUpscale ? "  [upscaled]" : ""));
        } else if (caps != null) {
            resolutionChip.setText("Video: reading modes");
        }
        subNormalBtn.setSelectedState(videoSub == SUB_NORMAL);
        subSlowBtn.setSelectedState(videoSub == SUB_SLOWMO);
        subLapseBtn.setSelectedState(videoSub == SUB_TIMELAPSE);

        if (aiEnhanceBtn != null) {
            aiEnhanceBtn.setSelectedState(aiEnhance);
            aiEnhanceBtn.setPulsing(aiEnhance && !aiUltra);
            aiUltraBtn.setSelectedState(aiUltra);
        }
    }

    private void cycleFlash() {
        if (flashMode == CaptureRequest.FLASH_MODE_OFF) {
            flashMode = CaptureRequest.FLASH_MODE_SINGLE;
            flashBtn.icon(Icons.FLASH_ON).setSelectedState(true);
        } else if (flashMode == CaptureRequest.FLASH_MODE_SINGLE) {
            flashMode = CaptureRequest.FLASH_MODE_TORCH;
            flashBtn.icon(Icons.FLASH_AUTO).setSelectedState(true);
            torch = true;
            controller.setTorch(true);
        } else {
            flashMode = CaptureRequest.FLASH_MODE_OFF;
            flashBtn.icon(Icons.FLASH_OFF).setSelectedState(false);
            torch = false;
            torchBtn.setSelectedState(false);
            controller.setTorch(false);
        }
        controller.setFlashMode(flashMode);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private void showCapabilities() {
        if (caps == null) {
            toast("Camera still opening");
            return;
        }
        String msg = caps.describe()
                + "\n\nDetected device tier: " + App.get().tier().label
                + "\nAI working resolution: " + App.get().tier().workingLongEdge + " px"
                + "\nMax burst for AI: " + App.get().tier().maxBurstFrames + " frames"
                + "\n\n" + App.get().profiler().summary();
        new AlertDialog.Builder(this).setTitle("Camera capabilities").setMessage(msg)
                .setPositiveButton("Close", null).show();
    }

    // ------------------------------------------------------------------ capture

    private void onShutter() {
        if (processing) return;
        if (mode == MODE_VIDEO) {
            if (recording) stopRecording();
            else startRecording();
            return;
        }
        if (panoMode && panorama != null && panorama.count() > 0) {
            // second press while a sweep is running finishes it
            finishPanorama();
            return;
        }
        if (panoMode) {
            panorama = new Panorama(Math.min(10, Math.max(4, App.get().tier().maxBurstFrames)));
        }
        capturedFrames = 0;
        long delay = timerSeconds * 1000L;
        if (delay > 0) countdown(timerSeconds);
        int frames = burstFrames();
        boolean rawToo = App.get().prefs().getBoolean("keep_raw", false) && caps != null && caps.rawSupported
                && !panoMode;
        controller.setRawEnabled(rawToo);
        controller.capturePhoto(panoMode ? 1 : frames, rawToo, delay);
    }

    private void countdown(final int seconds) {
        if (seconds <= 0) return;
        overlay.setHint(String.valueOf(seconds));
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                countdown(seconds - 1);
            }
        }, 1000);
    }

    private int burstFrames() {
        Tier tier = App.get().tier();
        int want = App.get().prefs().getInt("frames", Math.min(6, tier.maxBurstFrames));
        if (mode == MODE_NIGHT) want = Math.max(want, Math.min(tier.maxBurstFrames, 8));
        if (mode == MODE_AI && aiEnhance) want = Math.max(want, Math.min(tier.maxBurstFrames, 8));
        if (aiUltra) want = Math.max(want, Math.min(tier.maxBurstFrames, 10));
        if (docMode || mode == MODE_PRO) want = Math.min(want, 3);
        if (!aiEnhance && !aiUltra && mode != MODE_NIGHT) want = 1;
        return Math.max(1, Math.min(tier.maxBurstFrames, want));
    }

    private AiPipeline.Settings buildSettings(boolean ultraPass) {
        Tier tier = App.get().tier();
        AiPipeline.Settings st = new AiPipeline.Settings();
        st.tier = tier;
        st.enhance = aiEnhance || ultraPass;
        st.useBurst = true;
        st.requestedFrames = burstFrames();
        st.nightMode = mode == MODE_NIGHT;
        st.hdr = hdrForce || hdrAuto;
        st.portrait = portraitMode;
        st.docScan = docMode;
        st.binaryDoc = docMode && App.get().prefs().getBoolean("doc_binary", false);
        st.ultra = aiUltra || ultraPass || outputTarget == 2;
        st.ultraScale = outputTarget == 2 ? Math.max(2, tier.maxUltraScale)
                : (aiUltra ? Math.max(2, tier.maxUltraScale) : 2);
        st.strength = App.get().prefs().getFloat("ai_strength", 1f);
        st.exposureCompensation = manual.evCompensation;
        st.keepFullResolution = App.get().prefs().getBoolean("keep_full", true);
        st.workingLongEdge = tier.workingLongEdge;
        if (outputTarget == 1) st.maxOutputLongEdge = 2560;
        else if (outputTarget == 2) st.maxOutputLongEdge = caps != null && caps.nativeUhd() ? 0 : 3840;
        else st.maxOutputLongEdge = 0;
        st.note = mode == MODE_NIGHT ? "night" : (docMode ? "document" : "");
        return st;
    }

    // ------------------------------------------------------------------ CameraController.Listener

    @Override
    public void onCameraOpened(Capabilities c) {
        caps = c;
        overlay.setCapabilities(c);
        proPanel.setCaps(c);
        proPanel.setRawAvailable(c.rawSupported);
        videoModes.clear();
        videoModes.addAll(c.videoModes());
        videoModeIndex = 0;
        for (int i = 0; i < videoModes.size(); i++) {
            if (videoModes.get(i).width >= 1920 && !videoModes.get(i).highSpeed) videoModeIndex = i;
        }
        controller.setFlashMode(flashMode);
        applyPrefs();
        refreshChips();
        overlay.setAiChip("AI " + App.get().tier().label + " - " + App.get().profiler().getAiThreads() + " threads", aiEnhance);
        if (!c.rawSupported && App.get().prefs().getBoolean("keep_raw", false)) {
            toast("RAW saved preference ignored: this camera has no RAW stream");
        }
    }

    @Override
    public void onCameraClosed() {
    }

    @Override
    public void onCameraError(String message) {
        toast(message);
    }

    @Override
    public void onPreviewSizeChosen(final Size size, final int sensorOrientation, final boolean front,
                                    final int displayRotation) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                frontFacing = front;
                overlay.setFrontFacing(front);
                fitPreview(size, sensorOrientation, front, displayRotation);
            }
        });
    }

    /**
     * Fits the preview stream into the TextureView without distortion. This is the canonical Camera2
     * transform: scale the buffer to cover the view, then rotate by the sensor orientation.
     */
    private void fitPreview(Size size, int sensorOrientation, boolean front, int displayRotation) {
        if (texture == null || size == null) return;
        int viewW = texture.getWidth(), viewH = texture.getHeight();
        if (viewW == 0 || viewH == 0) return;
        final int rotation = sensorOrientation / 90;
        Matrix matrix = new Matrix();
        RectF viewRect = new RectF(0, 0, viewW, viewH);
        RectF bufferRect = new RectF(0, 0, size.getHeight(), size.getWidth());
        float centerX = viewRect.centerX(), centerY = viewRect.centerY();
        if (rotation == 1 || rotation == 3) {
            bufferRect.offset(centerX - bufferRect.centerX(), centerY - bufferRect.centerY());
            matrix.setRectToRect(viewRect, bufferRect, Matrix.ScaleToFit.FILL);
            float scale = Math.max(viewH / (float) size.getHeight(), viewW / (float) size.getWidth());
            matrix.postScale(scale, scale, centerX, centerY);
            matrix.postRotate(90 * (rotation - 2), centerX, centerY);
        } else if (rotation == 2) {
            matrix.postRotate(180, centerX, centerY);
        } else {
            matrix.setRectToRect(viewRect, new RectF(0, 0, size.getWidth(), size.getHeight()),
                    Matrix.ScaleToFit.FILL);
        }
        texture.setTransform(matrix);
    }

    @Override
    public void onPhotoCaptured(List<byte[]> jpegs, CameraController.RawFrame raw, int iso,
                                long exposureNs, boolean flashFired) {
        if (jpegs == null || jpegs.isEmpty()) {
            toast("Capture returned no frames");
            return;
        }
        lastBurst = new ArrayList<byte[]>(jpegs);
        lastRefJpeg = jpegs.get(0);
        capturedFrames = jpegs.size();
        if (raw != null) {
            final CameraController.RawFrame rf = raw;
            final File dng = library.newRawFile();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    if (controller.writeRawDng(rf, dng)) {
                        library.publish(dng, false);
                        lastRawFile = dng;
                    }
                }
            }, "dng-writer").start();
        }
        if (panoMode) {
            addPanoramaFrame(jpegs.get(0));
            return;
        }
        if (!aiEnhance && !aiUltra && mode != MODE_NIGHT) {
            saveStraight(jpegs.get(0));
            return;
        }
        runAi(lastBurst, buildSettings(false), "AI ENHANCE");
    }

    @Override
    public void onCaptureProgress(int captured, int total) {
        overlay.setAiChip("Capturing " + captured + "/" + total + " frames", true);
    }

    @Override
    public void onAnalysisFrame(byte[] luma, int width, int height, long timestampNs) {
        long now = System.currentTimeMillis();
        if (now - lastAnalysisMs < 650 || luma == null) return;
        lastAnalysisMs = now;
        final byte[] copy = new byte[luma.length];
        System.arraycopy(luma, 0, copy, 0, luma.length);
        final int w = width, h = height;
        App.get().aiExecutor().execute(new Runnable() {
            @Override
            public void run() {
                final EngineBridge.LiveScene ls = EngineBridge.analyzePreview(copy, w, h);
                if (ls.scene == null || ls.stats == null) return;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        overlay.setSceneBadge(ls.badge + (ls.scene.textDetected ? " - text" : "")
                                + (ls.scene.faceDetected ? " - face" : ""));
                        overlay.setStats(ls.stats);
                        overlay.setAiChip("AI " + App.get().tier().label.toUpperCase()
                                + " | " + ls.scene.type.aiLabel, aiEnhance);
                        onSceneMeasured(ls);
                    }
                });
            }
        });
    }

    /** The scene model decides things that used to be guesswork: HDR, night stitching, stabilisation. */
    private void onSceneMeasured(EngineBridge.LiveScene ls) {
        Stats s = ls.stats;
        boolean needHdr = !hdrForce && (s.highlightClip > 0.02f && s.shadowClip > 0.06f);
        hdrAuto = needHdr;
        if (needHdr && !hdrBtn.selectedState()) hdrBtn.setSelectedState(true);
        if (zoom >= 3f && !aiEnhance && !aiUltra) {
            aiEnhance = true;
            aiEnhanceBtn.setSelectedState(true);
            aiEnhanceBtn.setPulsing(true);
            toast("AI enhancement auto enabled for high zoom");
        }
        if (macroMode && caps != null && s.sharpness < 0.02f) {
            overlay.setHint("Macro: try moving closer, the frame looks soft");
        }
    }

    @Override
    public void onZoomChanged(float z, boolean digitalZone) {
        zoom = z;
        overlay.setZoom(z, digitalZone);
        if (digitalZone) {
            overlay.setAiChip("AI zoom " + String.format(java.util.Locale.US, "%.1fx", z)
                    + " - " + App.get().tier().label, true);
        }
    }

    @Override
    public void onManualState(CaptureResult result) {
        if (mode == MODE_PRO) proPanel.updateLive(result);
    }

    @Override
    public void onFocusState(boolean locked, boolean active) {
        if (locked) overlay.setHint(active ? "Focus locked" : "");
    }

    @Override
    public void onVideoStarted() {
        recording = true;
        shutter.icon(Icons.STOP);
        overlay.setRecording(true, frontFacing);
        toast("Recording - AI enhancement is applied when you stop");
    }

    @Override
    public void onVideoStopped(File file, boolean ok, String message) {
        recording = false;
        shutter.icon(Icons.RECORD);
        overlay.setRecording(false, frontFacing);
        if (!ok) {
            toast("Recording failed: " + message);
            return;
        }
        recordingFile = file;
        final File f = file;
        if (aiEnhance || aiUltra) {
            new AlertDialog.Builder(this)
                    .setTitle("Enhance this video?")
                    .setMessage("AI Vision Camera can run the on-device engine over every frame and re-encode "
                            + "at up to 4K. This takes time proportional to the length of the clip and never "
                            + "claims a resolution the sensor cannot reach: an upscale is labelled as AI Enhanced.")
                    .setPositiveButton("Enhance", new android.content.DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(android.content.DialogInterface dlg, int which) {
                            enhanceVideo(f);
                        }
                    })
                    .setNegativeButton("Keep original", new android.content.DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(android.content.DialogInterface dlg, int which) {
                            toast("Saved " + f.getName());
                        }
                    })
                    .show();
        } else {
            toast("Saved " + f.getName());
        }
    }

    @Override
    public void onSlowMotionUnsupported(String reason) {
        toast("Slow motion unavailable: " + reason);
        videoSub = SUB_NORMAL;
        refreshChips();
    }

    // ------------------------------------------------------------------ PreviewOverlay.Listener

    @Override
    public void onTapFocus(float x, float y) {
        controller.tapToFocus(x, y);
    }

    @Override
    public void onZoomGesture(float newZoom, boolean fromPill) {
        controller.setZoom(newZoom);
        if (newZoom > 3f && !aiEnhance) {
            aiEnhance = true;
            aiEnhanceBtn.setSelectedState(true);
            toast("AI enhancement auto enabled above 3x");
        }
    }

    @Override
    public void onLensSelected(String lensId, String label) {
        if (lensId != null) {
            controller.switchLens(lensId);
            toast("Switched to " + label + " lens");
        } else {
            float z = PreviewOverlay.parseLabel(label);
            if (z > 0) controller.setZoom(z);
        }
    }

    @Override
    public void onExposureSwipe(float deltaEv) {
        manual.evCompensation = deltaEv;
        if (!argsHasManual()) {
            // exposure compensation works with the device's own auto exposure: nothing else to enable
            manual.enabled = false;
        }
        controller.setManual(manual);
        proPanel.setManual(manual);
    }

    private boolean argsHasManual() {
        return !manual.autoIso || !manual.autoShutter || !manual.autoFocus || !manual.autoWb;
    }

    @Override
    public void onLongPressLock(float x, float y) {
        manual.autoIso = false;
        manual.autoShutter = false;
        manual.autoFocus = false;
        manual.autoWb = false;
        controller.setManual(manual);
        controller.setLock3A(true, true, true);
        toast("AE / AF / AWB locked - tap again to release");
    }

    // ------------------------------------------------------------------ ProPanel.Listener

    @Override
    public void onManualChanged(CameraController.Manual m) {
        manual = m;
        controller.setManual(m);
        controller.setLock3A(!m.autoIso || !m.autoShutter, !m.autoFocus, !m.autoWb);
    }

    @Override
    public void onRawToggled(boolean raw) {
        if (caps != null && !caps.rawSupported) {
            toast("No RAW stream on this camera");
            return;
        }
        App.get().prefs().edit().putBoolean("keep_raw", raw).apply();
        controller.setRawEnabled(raw);
        if (rawBtn != null) rawBtn.setSelectedState(raw);
    }

    // ------------------------------------------------------------------ ai run

    private void runAi(List<byte[]> burst, final AiPipeline.Settings settings, String title) {
        processing = true;
        aiCancel.set(false);
        progress.show(title, settings.tier.label + " tier - " + burst.size() + " frames");
        final EngineBridge.Request req = new EngineBridge.Request();
        req.jpegs = new ArrayList<byte[]>(burst);
        req.settings = settings;
        req.keepBefore = true;
        req.detectFaces = App.get().prefs().getBoolean("faces", true);
        int tierEdge = App.get().tier().workingLongEdge + 1400;
        req.donorEdgeCap = Math.min(4096, outputTarget == 1 ? Math.min(2816, tierEdge) : tierEdge);
        req.orientationDegrees = 0;
        req.mirror = false;
        final long t0 = System.currentTimeMillis();
        App.get().aiExecutor().execute(new Runnable() {
            @Override
            public void run() {
                final EngineBridge.Result res = EngineBridge.process(req, new AiPipeline.Progress() {
                    @Override
                    public void onStage(final String name, final float fraction) {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                progress.setProgress(fraction, name);
                                overlay.setAiChip("AI: " + name, true);
                            }
                        });
                    }
                }, new AiPipeline.Cancel() {
                    @Override
                    public boolean isCancelled() {
                        return aiCancel.get();
                    }
                });
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        processing = false;
                        progress.hide();
                        if (res.enhanced == null) {
                            toast(res.error == null ? "AI could not finish - saving the original frame" : res.error);
                            saveStraight(lastRefJpeg);
                            return;
                        }
                        lastEnhanced = res.enhanced;
                        lastBefore = res.before;
                        lastReportJson = EngineBridge.toJson(res.report,
                                res.report == null ? "" : res.report.outputLabel(), res.report != null && res.report.upscaled);
                        String label = res.report == null ? "" : res.report.outputLabel();
                        lastOutputLabel = label;
                        String sub = (res.report == null ? "" : res.report.describe());
                        if (res.report != null && res.report.aiEnhanced4k) {
                            sub = getString(com.aivision.camera.R.string.not_native_4k,
                                    Capabilities.resLabel(res.report.nativeLongEdge));
                        }
                        boolean canUltra = res.report != null && !res.report.upscaled
                                && res.report.outputLongEdge < App.get().tier().workingLongEdge;
                        resultView.show(res.before, res.enhanced, "AI ENHANCED - " + label, sub,
                                lastReportJson, canUltra, lastRawFile != null && lastRawFile.exists());
                    }
                });
            }
        });
    }

    /**
     * Saves a captured frame untouched. When AI is off this is the exact JPEG the sensor produced -
     * no recompression, no invented detail - and it doubles as the fallback when the engine cannot
     * finish, so a shot is never lost.
     */
    private void saveStraight(byte[] jpeg) {
        if (jpeg == null) return;
        File out = library.newPhotoFile(".jpg");
        if (library.saveBytes(jpeg, out) == null) {
            toast("Could not write to the gallery");
            return;
        }
        library.saveOriginal(out.getName(), jpeg);
        if (caps != null) {
            library.putReport(out.getName(), "{\"mode\":\"capture\",\"ai\":false,\"outputLabel\":\""
                    + (caps.maxJpeg == null ? "sensor" : Capabilities.resLabel(
                    Math.max(caps.maxJpeg.getWidth(), caps.maxJpeg.getHeight()))) + "\"}");
        }
        toast("Saved " + out.getName());
        library.trimCache();
    }

    // ------------------------------------------------------------------ panorama

    private void addPanoramaFrame(byte[] jpeg) {
        final byte[] data = jpeg;
        processing = true;
        progress.show("Panorama", "Aligning frame " + (panorama.count() + 1));
        App.get().aiExecutor().execute(new Runnable() {
            @Override
            public void run() {
                Bitmap bmp = EngineBridge.decodeScaled(data, 1600);
                final boolean added;
                if (bmp == null) {
                    added = false;
                } else {
                    Img img = EngineBridge.toImg(bmp);
                    bmp.recycle();
                    added = panorama.add(img);
                }
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        processing = false;
                        progress.hide();
                        overlay.setHint(panorama.status());
                        overlay.setAiChip("Panorama " + panorama.count() + " frames", true);
                        if (panorama.isFull()) {
                            finishPanorama();
                        } else if (!added) {
                            toast(panorama.status());
                        }
                    }
                });
            }
        });
    }

    private void finishPanorama() {
        if (panorama == null || panorama.count() < 2) {
            toast("Sweep at least two frames before finishing");
            return;
        }
        final Panorama p = panorama;
        processing = true;
        progress.show("Panorama", "Blending " + p.count() + " frames");
        App.get().aiExecutor().execute(new Runnable() {
            @Override
            public void run() {
                Img stitched = p.finish();
                Bitmap out = null;
                if (stitched != null) {
                    AiPipeline.Settings st = buildSettings(false);
                    st.useBurst = false;
                    st.hdr = false;
                    st.nightMode = false;
                    st.ultra = false;
                    AiPipeline.Result res = AiPipeline.process(new Img[]{stitched}, null, st, null, null);
                    out = EngineBridge.toBitmap(res != null && res.image != null ? res.image : stitched);
                }
                final Bitmap result = out;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        processing = false;
                        progress.hide();
                        panoMode = false;
                        panoBtn.setSelectedState(false);
                        panorama = null;
                        overlay.setHint("");
                        if (result == null) {
                            toast("Panorama stitching failed");
                            return;
                        }
                        lastEnhanced = result;
                        lastBefore = null;
                        lastReportJson = EngineBridge.toJson(null, "Panorama " + p.count() + " frames", false);
                        resultView.show(null, result, "PANORAMA",
                                p.count() + " frames stitched on device - " + result.getWidth() + "x"
                                        + result.getHeight(), lastReportJson, false, false);
                    }
                });
            }
        });
    }

    // ------------------------------------------------------------------ video

    private void startRecording() {
        Capabilities.VideoMode vm = null;
        if (!videoModes.isEmpty()) {
            vm = videoModes.get(Math.min(videoModeIndex, videoModes.size() - 1));
            if (vm.highSpeed && videoSub != SUB_SLOWMO) {
                vm = null;
                for (Capabilities.VideoMode m : videoModes) {
                    if (!m.highSpeed) {
                        vm = m;
                        break;
                    }
                }
            }
        }
        CameraController.VideoConfig cfg = new CameraController.VideoConfig();
        if (vm != null && videoSub == SUB_SLOWMO && vm.highSpeed) {
            cfg.width = vm.width;
            cfg.height = vm.height;
            cfg.fps = vm.fps;
            cfg.slowMotion = true;
            cfg.audio = false;
        } else if (vm != null) {
            cfg.width = vm.width;
            cfg.height = vm.height;
            cfg.fps = Math.max(24, Math.min(60, vm.fps));
        } else {
            cfg.width = 1920;
            cfg.height = 1080;
            cfg.fps = 30;
        }
        cfg.timeLapse = videoSub == SUB_TIMELAPSE;
        cfg.timeLapseRate = 1f;
        cfg.stabilize = App.get().prefs().getBoolean("stabilize", true);
        cfg.aiUpscaleLabel = outputTarget == 2;
        cfg.output = library.newVideoFile();
        cfg.audio = cfg.audio && checkPermission(Manifest.permission.RECORD_AUDIO, android.os.Process.myPid(),
                android.os.Process.myUid()) == PackageManager.PERMISSION_GRANTED;
        recordingFile = cfg.output;
        controller.startVideo(cfg);
    }

    private void stopRecording() {
        controller.stopVideo();
    }

    private void enhanceVideo(final File in) {
        final File out = library.newExportFile();
        aiCancel.set(false);
        progress.show("AI video", "Preparing the encoder");
        progress.setCancellable(true);
        final VideoEnhancer.Config cfg = new VideoEnhancer.Config();
        cfg.tier = App.get().tier();
        cfg.targetLongEdge = outputTarget == 2 ? 3840 : (outputTarget == 1 ? 2560 : 0);
        if (cfg.targetLongEdge == 0) cfg.targetLongEdge = App.get().tier().maxUltraScale >= 2 ? 2560 : 1920;
        cfg.workingLongEdge = 960;
        cfg.ultra = aiUltra || outputTarget > 0;
        cfg.withAudio = true;
        App.get().aiExecutor().execute(new Runnable() {
            @Override
            public void run() {
                VideoEnhancer.enhance(in, out, cfg, new VideoEnhancer.Progress() {
                    @Override
                    public void onProgress(final float fraction, final String stage) {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                progress.setProgress(fraction, stage);
                            }
                        });
                    }
                }, new VideoEnhancer.Done() {
                    @Override
                    public void onDone(final File output, final String label, final String error) {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                progress.hide();
                                progress.setCancellable(true);
                                if (output == null) {
                                    toast(error == null ? "AI video could not run on this device - original kept"
                                            : "AI video failed (" + error + ") - original kept");
                                    return;
                                }
                                library.publish(output, true);
                                toast("Saved " + output.getName() + (label == null ? "" : "  " + label));
                            }
                        });
                    }
                }, aiCancel);
            }
        });
    }

    // ------------------------------------------------------------------ ResultView.Listener

    @Override
    public void onSave() {
        if (lastEnhanced == null) return;
        final File out = library.newPhotoFile(".jpg");
        Bitmap bmp = lastEnhanced;
        if (App.get().prefs().getBoolean("watermark", false)) {
            bmp = EngineBridge.watermark(bmp, "AI Vision Camera");
        }
        library.saveJpeg(bmp, out, 95);
        library.saveOriginal(out.getName(), lastRefJpeg);
        String json = lastReportJson;
        if (json != null) library.putReport(out.getName(), json);
        galleryBtn.badge(out.getName().endsWith(".jpg") ? "AI" : null);
        resultView.hide();
        lastEnhanced = null;
        lastBefore = null;
        toast("Saved " + lastOutputLabel + " - " + out.getName());
    }

    @Override
    public void onDiscard() {
        resultView.hide();
        lastEnhanced = null;
        lastBefore = null;
        toast("Shot discarded");
    }

    @Override
    public void onUltra() {
        if (lastBurst.isEmpty()) return;
        resultView.hide();
        AiPipeline.Settings st = buildSettings(true);
        st.ultra = true;
        st.enhance = true;
        st.ultraScale = Math.max(2, App.get().tier().maxUltraScale);
        st.maxOutputLongEdge = caps != null && caps.nativeUhd() ? 0 : 3840;
        runAi(lastBurst, st, "AI ULTRA");
    }

    @Override
    public void onShare() {
        if (lastEnhanced == null) return;
        try {
            File dir = library.outputDir(false);
            File f = new File(dir, "AIV_share_" + MediaLibrary.stamp() + ".jpg");
            library.saveJpeg(lastEnhanced, f, 95);
            Uri uri = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("image/jpeg");
            i.putExtra(Intent.EXTRA_STREAM, Uri.fromFile(f));
            i.putExtra(Intent.EXTRA_TEXT, lastOutputLabel);
            startActivity(Intent.createChooser(i, "Share with"));
        } catch (Throwable t) {
            toast("Cannot share: " + t.getMessage());
        }
    }

    @Override
    public void onOpenGallery() {
        startActivity(new Intent(this, GalleryActivity.class));
    }

    // ------------------------------------------------------------------ keys

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (!recording) onShutter();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
