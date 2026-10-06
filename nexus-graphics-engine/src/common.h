// NEXUS GRAPHICS ENGINE - common definitions
#pragma once
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <psapi.h>
#include <pdh.h>
#include <dwmapi.h>
#include <commdlg.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>

#ifndef MAKEINTRESOURCE
#define MAKEINTRESOURCE MAKEINTRESOURCEW
#endif
#define NEXUS_VERSION "1.0.0"
#define NEXUS_APP_L   L"NexusGraphicsEngine"

// ---------------------------------------------------------------- logging
#define MAX_LOG_LINES 160
typedef struct { char text[160]; double t; int level; } LogLine;
extern LogLine g_log[MAX_LOG_LINES];
extern int g_logHead, g_logCount;
extern CRITICAL_SECTION g_logCs;

void NLog(const char* fmt, ...);
void NLogSys(const char* what);   // appends last-error code

// ---------------------------------------------------------------- utils
static float clampf_(float v, float a, float b){ return v < a ? a : (v > b ? b : v); }
static int clampi_(int v, int a, int b){ return v < a ? a : (v > b ? b : v); }
static double NowMs_(void){
    static LARGE_INTEGER fq = {0};
    LARGE_INTEGER c;
    if (!fq.QuadPart) QueryPerformanceFrequency(&fq);
    QueryPerformanceCounter(&c);
    return (double)c.QuadPart * 1000.0 / (double)fq.QuadPart;
}
static int StrLen_(const char* s){ int n = 0; while (s && s[n]) n++; return n; }
static void StrCpyN_(char* d, int n, const char* s){
    if (!n) return; int i = 0;
    while (i < n - 1 && s && s[i]) d[i++] = s[i];
    d[i] = 0;
}
static void StrCatN_(char* d, int n, const char* s){
    if (!n) return; int i = 0; while (i < n - 1 && d[i]) i++;
    int j = 0;
    while (i < n - 1 && s && s[j]) d[i++] = s[j++];
    d[i] = 0;
}
static void WToUtf8_(char* out, int n, const wchar_t* in){
    if (!in || n <= 0) { if (n) out[0] = 0; return; }
    int k = WideCharToMultiByte(CP_UTF8, 0, in, -1, out, n, 0, 0);
    if (k > n) k = n;
    if (k > 0) WideCharToMultiByte(CP_UTF8, 0, in, -1, out, k, 0, 0);
    if (n) out[n-1] = 0;
}
static void Utf8ToW_(wchar_t* out, int n, const char* in){
    if (!in || n <= 0) { if (n) out[0] = 0; return; }
    int k = MultiByteToWideChar(CP_UTF8, 0, in, -1, out, n);
    if (k > n) k = n;
    if (k > 0) MultiByteToWideChar(CP_UTF8, 0, in, -1, out, k);
    if (n) out[n-1] = 0;
}

static double AppTimeMs_(void) // wall clock (ms since boot-ish, for display)
{ return NowMs_(); }

// ---------------------------------------------------------------- settings model
// Enhancement levels used by grouped controls: OFF LOW MED HIGH ULTRA EXTREME
#define NLEVEL_OFF 0
#define NLEVEL_LOW 1
#define NLEVEL_MED 2
#define NLEVEL_HIGH 3
#define NLEVEL_ULTRA 4
#define NLEVEL_EXTREME 5

typedef enum {
    PRESET_LOW = 0,
    PRESET_QUALITY,
    PRESET_ULTRA,
    PRESET_EXTREME,
    PRESET_REALISTIC,
    PRESET_CINEMATIC,
    PRESET_MAXGRAPHICS,
    PRESET_CUSTOM,
    PRESET_COUNT
} Preset;

typedef enum {
    CP_NATURAL = 0,
    CP_CINEMATIC,
    CP_VIVID,
    CP_REALISTIC,
    CP_COMPETITIVE,
    CP_CUSTOM,
    COLOR_PRESET_COUNT
} ColorPreset;

typedef struct {
    Preset preset;

    int master;             // 0..100 master graphics slider

    int outW, outH;         // output resolution (0 = native passthrough)

    int superRes;           // 0 off, 1 on (reconstruction upscaler)
    int temporal;           // 0..5 temporal reconstruction level
    int temporalHistory;    // 0..100 history strength
    int motionComp;         // 0..100 motion gating strength
    int aa;                 // 0..5 anti-aliasing level
    int texture;            // 0..5 texture clarity level

    int shadowQuality;      // 0..100
    int shadowDetail;
    int shadowStability;
    int shadowSoftness;
    int shadowContact;

    int lightQuality;       // 0..100
    int lightLocalContrast;
    int lightDetail;
    int lightExposure;      // 0..100 (50 = neutral)
    int lightDynRange;

    int ao;                 // 0..5
    int reflection;         // 0..100
    int detail;             // 0..100 global detail boost
    int distant;            // 0..100
    int lod;                // 0..100 LOD transition smoothing
    int vegetation;         // 0..100
    int character;          // 0..100 character quality (portrait-region detail)
    int particles;          // 0..100
    int water;              // 0..100

    int iqSharp;            // 0..100
    int iqFineDetail;
    int iqTextureClarity;
    int iqEdgeDetail;
    int iqLocalContrast;
    int iqDenoise;
    int iqArtifact;         // artifact reduction (debanding)

    int cBright;            // 0..100 (50 neutral)
    int cContrast;
    int cSat;
    int cHighlights;
    int cShadows;
    int cGamma;             // (50 neutral)
    int cTemp;              // (50 neutral, warm<-cold)
    ColorPreset colorPreset;
    int hdr;                // 0..100 internal HDR pipeline strength
    int hdrOutput;          // 0/1 extended color space output (only if supported)
} NexusSettings;

// Master slider response: 0 -> 0.0 (original), 50 -> 0.60 (strong), 100 -> 1.0 (max)
static float MasterFactor_(int master){
    float x = (float)clampi_(master, 0, 100) / 100.0f;
    return 1.4f * x - 0.4f * x * x;
}
static float Lvl5_(int l){ return (float)clampi_(l, 0, 5) / 5.0f; }

void SettingsDefault(NexusSettings* s);
void SettingsApplyPreset(NexusSettings* s, Preset p);   // keeps master, outW/H, color user values where sensible
void SettingsApplyColorPreset(NexusSettings* s, ColorPreset p);
const char* PresetName_(Preset p);
const char* ColorPresetName_(ColorPreset p);

// ---------------------------------------------------------------- JSON (minimal)
typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_OBJ, J_ARR } JKind;
typedef struct JVal JVal;
struct JVal {
    JKind kind;
    int b;
    double num;
    char str[256];
    JVal* child;          // first child (OBJ/ARR)
    JVal* next;           // next sibling
    char key[64];         // key when child of OBJ
};
JVal* JVNew(JKind k, const char* key);
JVal* JVObjPutNum(JVal* o, const char* k, double v);
JVal* JVObjPutStr(JVal* o, const char* k, const char* v);
JVal* JVObjPutInt(JVal* o, const char* k, int v);
JVal* JVObjPutBool(JVal* o, const char* k, int v);
JVal* JVFind(JVal* o, const char* k);
double JVNum(JVal* o, const char* k, double dflt);
int JVInt(JVal* o, const char* k, int dflt);
const char* JVStr(JVal* o, const char* k, const char* dflt);
JVal* JVParse(const char* text, int len);
void JVFree(JVal* v);
int JVDump(JVal* v, char* out, int outLen, int indent);

// ---------------------------------------------------------------- profiling / files
void SettingsToJson_(NexusSettings* s, JVal* o);        // o must be J_OBJ
void SettingsFromJson_(NexusSettings* s, JVal* o);
int AppDataPath_(wchar_t* out, int n);                  // %APPDATA%\NexusGraphicsEngine (chars incl nul)
int WriteFileW_(const wchar_t* path, const char* data, int len);
char* ReadFileAlloc_(const wchar_t* path, int* len);    // malloc'd utf8, or NULL
void FreeAlloc_(void* p);
