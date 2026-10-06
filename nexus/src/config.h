// NEXUS GRAPHICS ENGINE - settings, presets, profiles
#pragma once
#include <string>
#include <vector>
#include "stdafx.h"

// Quality level shared by many modules
enum QLevel {
    Q_OFF = 0, Q_LOW = 1, Q_MEDIUM = 2, Q_HIGH = 3, Q_ULTRA = 4, Q_EXTREME = 5,
    Q_COUNT = 6
};
inline const char* QName(int q) {
    static const char* names[Q_COUNT] = { "OFF","LOW","MEDIUM","HIGH","ULTRA","EXTREME" };
    return (q >= 0 && q < Q_COUNT) ? names[q] : "?";
}

// --------------------------------------------------------------- FrameParams
// Everything the GPU pipeline needs. Copy-safe snapshot handed to engine thread.
struct FrameParams {
    // pipeline toggles
    int   temporalLevel = Q_HIGH;       // temporal reconstruction
    int   aaLevel = Q_ULTRA;            // anti-aliasing
    int   aoLevel = Q_HIGH;             // ambient occlusion enhancer
    int   artifactLevel = Q_MEDIUM;     // denoise / deband
    int   sceneLevel = Q_HIGH;          // vegetation/particles/water pass
    float detailBoost = 0.85f;          // global detail 0..1 (master per-game detail)
    float sharpen = 0.35f;              // CAS-style 0..1
    // image quality sliders
    float fineDetail = 0.55f;
    float textureClarity = 0.55f;
    float edgeDetail = 0.50f;
    float localContrast = 0.45f;
    float distantDetail = 0.55f;
    float shadowQuality = 0.60f;
    float shadowDetail = 0.50f;
    float shadowStability = 0.60f;
    float shadowSoftness = 0.50f;
    float contactShadow = 0.50f;
    float lightingQuality = 0.55f;
    float lightDetail = 0.50f;
    float exposure = 1.0f;
    float dynamicRange = 0.45f;
    float reflectionStrength = 0.45f;
    float reflectionStabilize = 0.55f;
    float vegetation = 0.55f;
    float particles = 0.50f;
    float water = 0.45f;
    float characterProtect = 0.55f;
    float denoise = 0.35f;
    float deband = 0.45f;
    // color engine
    float brightness = 1.0f;
    float contrast = 1.04f;
    float saturation = 1.02f;
    float highlights = 0.5f;            // 0..1 highlight rolloff amount
    float shadows = 0.5f;               // 0..1 shadow lift amount
    float gamma = 1.0f;
    float temperature = 0.0f;           // -1..1
    float hdrAmount = 0.0f;             // 0..1 soft filmic shoulder (SDR-safe "HDR-like")
    bool  hdrOutput = false;            // scRGB FP16 output when desktop HDR active
    // compare / bypass
    int   viewMode = 0;                 // 0=enhanced 1=original(bypass) 2=split
    float splitX = 0.5f;                // split position 0..1
    // master
    float master = 1.0f;                // master graphics slider 0..1 scales strengths
};

// --------------------------------------------------------------- Quality presets
enum Preset {
    P_LOW_ENHANCEMENT = 0, P_QUALITY, P_ULTRA, P_EXTREME, P_REALISTIC, P_CINEMATIC, P_MAX_GRAPHICS, P_CUSTOM, P_COUNT
};
inline const char* PresetName(int p) {
    static const char* n[P_COUNT] = { "LOW ENHANCEMENT","QUALITY","ULTRA","EXTREME","REALISTIC","CINEMATIC","MAX GRAPHICS","CUSTOM" };
    return (p >= 0 && p < P_COUNT) ? n[p] : "?";
}
void ApplyPreset(FrameParams& fp, int preset, float master);

// Color presets
enum ColorPreset { C_NATURAL = 0, C_CINEMATIC, C_VIVID, C_REALISTIC, C_COMPETITIVE, C_CUSTOM, C_COUNT };
inline const char* ColorPresetName(int p) {
    static const char* n[C_COUNT] = { "Natural","Cinematic","Vivid","Realistic","Competitive","Custom" };
    return (p >= 0 && p < C_COUNT) ? n[p] : "?";
}
void ApplyColorPreset(FrameParams& fp, int preset);

// --------------------------------------------------------------- Game profile
struct GameProfile {
    std::string id;             // ini filename stem
    std::string exeName;        // "efootball.exe"
    std::string exePath;        // full path (optional)
    std::string displayName;    // "eFootball"
    std::string notes;
    int inW = 1280, inH = 720;      // input (game render) resolution
    int outW = 1920, outH = 1080;   // output resolution
    int preset = P_MAX_GRAPHICS;
    int colorPreset = C_NATURAL;
    FrameParams params;
    bool autoActivate = true;   // attach automatically when window appears
    bool valid = false;
};

// INI serialization (UTF-8)
std::string ProfileToIni(const GameProfile& gp);
void        ProfileFromIni(const std::string& ini, GameProfile& gp);

// App settings
struct AppSettings {
    bool  showHud = true;
    float hudScale = 1.0f;
    bool  hudAutoPos = true;
    float hudX = 0.02f, hudY = 0.02f;   // normalized offsets inside output rect
    bool  enableAutoOptimize = false;
    int   targetFps = 60;
    bool  autoDetectGames = true;
    int   captureMode = 0;              // 0 = window region (recommended), 1 = full monitor
    bool  vsyncOverlay = false;
    bool  hdrWanted = false;            // user wants HDR output (only used if desktop HDR active)
    bool  launchMinimized = false;
    bool  startWithWindows = false;
    int   lastPreset = P_MAX_GRAPHICS;
    int   lastColorPreset = C_NATURAL;
    char  lastProfileId[128] = "";
    bool  firstRun = true;
};

bool  SaveAppSettings(const AppSettings& s);
bool  LoadAppSettings(AppSettings& s);
std::string SafeFileStem(const std::string& name);

// Profile store
std::vector<GameProfile> LoadAllProfiles();
bool  SaveProfile(const GameProfile& gp);
bool  DeleteProfile(const std::string& id);
GameProfile MakeProfileFromExe(const std::wstring& exePath);
