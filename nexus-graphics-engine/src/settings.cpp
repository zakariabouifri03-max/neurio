#include "common.h"
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------- logging
LogLine g_log[MAX_LOG_LINES];
int g_logHead = 0, g_logCount = 0;
CRITICAL_SECTION g_logCs;

static int log_cs_init = 0;
static void LogEnsureCs_(void){
    if (!log_cs_init){ InitializeCriticalSection(&g_logCs); log_cs_init = 1; }
}
void NLog(const char* fmt, ...){
    LogEnsureCs_();
    char buf[200];
    va_list ap; va_start(ap, fmt);
    _vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    EnterCriticalSection(&g_logCs);
    if (g_logCount < MAX_LOG_LINES) g_log[g_logHead].t = NowMs_();
    StrCpyN_(g_log[g_logHead].text, sizeof g_log[0].text, buf);
    g_log[g_logHead].level = 0;
    g_logHead = (g_logHead + 1) % MAX_LOG_LINES;
    if (g_logCount < MAX_LOG_LINES) g_logCount++;
    LeaveCriticalSection(&g_logCs);
}
void NLogSys(const char* what){
    DWORD e = GetLastError();
    NLog("%s: error %lu", what, (unsigned long)e);
}

// ---------------------------------------------------------------- presets
void SettingsDefault(NexusSettings* s){
    memset(s, 0, sizeof *s);
    s->preset = PRESET_QUALITY;
    s->master = 60;
    s->outW = 1920; s->outH = 1080;
    s->superRes = 1;
    s->temporal = 3; s->temporalHistory = 60; s->motionComp = 70;
    s->aa = 3; s->texture = 3;
    s->shadowQuality = 55; s->shadowDetail = 50; s->shadowStability = 55; s->shadowSoftness = 45; s->shadowContact = 50;
    s->lightQuality = 50; s->lightLocalContrast = 45; s->lightDetail = 40; s->lightExposure = 50; s->lightDynRange = 55;
    s->ao = 2; s->reflection = 40; s->detail = 45; s->distant = 45; s->lod = 40;
    s->vegetation = 45; s->character = 45; s->particles = 40; s->water = 40;
    s->iqSharp = 45; s->iqFineDetail = 40; s->iqTextureClarity = 45; s->iqEdgeDetail = 45; s->iqLocalContrast = 45; s->iqDenoise = 30; s->iqArtifact = 40;
    s->cBright = 50; s->cContrast = 50; s->cSat = 50; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 50; s->cTemp = 50;
    s->colorPreset = CP_NATURAL;
    s->hdr = 35; s->hdrOutput = 0;
}

void SettingsApplyPreset(NexusSettings* s, Preset p){
    int keepMaster = s->master, ow = s->outW, oh = s->outH;
    switch (p){
    case PRESET_LOW:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 2; s->temporalHistory = 45; s->motionComp = 60;
        s->aa = 2; s->texture = 1;
        s->shadowQuality = 30; s->shadowDetail = 30; s->shadowStability = 30; s->shadowSoftness = 30; s->shadowContact = 30;
        s->lightQuality = 30; s->lightLocalContrast = 30; s->lightDetail = 20; s->lightExposure = 50; s->lightDynRange = 30;
        s->ao = 1; s->reflection = 20; s->detail = 25; s->distant = 25; s->lod = 20;
        s->vegetation = 25; s->character = 25; s->particles = 25; s->water = 20;
        s->iqSharp = 25; s->iqFineDetail = 20; s->iqTextureClarity = 20; s->iqEdgeDetail = 20; s->iqLocalContrast = 20; s->iqDenoise = 15; s->iqArtifact = 20;
        s->cBright = 50; s->cContrast = 50; s->cSat = 50; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 50; s->cTemp = 50;
        s->hdr = 20; s->colorPreset = CP_NATURAL;
        break;
    case PRESET_QUALITY:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 3; s->temporalHistory = 60; s->motionComp = 70;
        s->aa = 3; s->texture = 3;
        s->shadowQuality = 55; s->shadowDetail = 50; s->shadowStability = 55; s->shadowSoftness = 45; s->shadowContact = 50;
        s->lightQuality = 50; s->lightLocalContrast = 45; s->lightDetail = 40; s->lightExposure = 50; s->lightDynRange = 55;
        s->ao = 2; s->reflection = 40; s->detail = 45; s->distant = 45; s->lod = 40;
        s->vegetation = 45; s->particles = 40; s->water = 40;
        s->iqSharp = 45; s->iqFineDetail = 40; s->iqTextureClarity = 45; s->iqEdgeDetail = 45; s->iqLocalContrast = 45; s->iqDenoise = 30; s->iqArtifact = 40;
        s->cBright = 50; s->cContrast = 50; s->cSat = 50; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 50; s->cTemp = 50;
        s->hdr = 35; s->colorPreset = CP_NATURAL;
        break;
    case PRESET_ULTRA:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 4; s->temporalHistory = 75; s->motionComp = 75;
        s->aa = 4; s->texture = 4;
        s->shadowQuality = 75; s->shadowDetail = 70; s->shadowStability = 70; s->shadowSoftness = 55; s->shadowContact = 70;
        s->lightQuality = 70; s->lightLocalContrast = 65; s->lightDetail = 60; s->lightExposure = 50; s->lightDynRange = 75;
        s->ao = 3; s->reflection = 60; s->detail = 65; s->distant = 65; s->lod = 60;
        s->vegetation = 65; s->character = 65; s->particles = 60; s->water = 60;
        s->iqSharp = 65; s->iqFineDetail = 60; s->iqTextureClarity = 65; s->iqEdgeDetail = 65; s->iqLocalContrast = 60; s->iqDenoise = 40; s->iqArtifact = 55;
        s->cBright = 50; s->cContrast = 52; s->cSat = 53; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 50; s->cTemp = 50;
        s->hdr = 55; s->colorPreset = CP_NATURAL;
        break;
    case PRESET_EXTREME:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 5; s->temporalHistory = 90; s->motionComp = 80;
        s->aa = 5; s->texture = 5;
        s->shadowQuality = 95; s->shadowDetail = 90; s->shadowStability = 80; s->shadowSoftness = 60; s->shadowContact = 90;
        s->lightQuality = 85; s->lightLocalContrast = 80; s->lightDetail = 75; s->lightExposure = 50; s->lightDynRange = 95;
        s->ao = 4; s->reflection = 80; s->detail = 85; s->distant = 85; s->lod = 75;
        s->vegetation = 80; s->character = 80; s->particles = 75; s->water = 75;
        s->iqSharp = 85; s->iqFineDetail = 80; s->iqTextureClarity = 85; s->iqEdgeDetail = 85; s->iqLocalContrast = 75; s->iqDenoise = 50; s->iqArtifact = 70;
        s->cBright = 50; s->cContrast = 55; s->cSat = 56; s->cHighlights = 50; s->cShadows = 52; s->cGamma = 50; s->cTemp = 50;
        s->hdr = 75; s->colorPreset = CP_NATURAL;
        break;
    case PRESET_REALISTIC:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 4; s->temporalHistory = 70; s->motionComp = 80;
        s->aa = 3; s->texture = 3;
        s->shadowQuality = 50; s->shadowDetail = 45; s->shadowStability = 60; s->shadowSoftness = 55; s->shadowContact = 40;
        s->lightQuality = 45; s->lightLocalContrast = 40; s->lightDetail = 35; s->lightExposure = 50; s->lightDynRange = 55;
        s->ao = 2; s->reflection = 35; s->detail = 40; s->distant = 40; s->lod = 45;
        s->vegetation = 40; s->character = 40; s->particles = 35; s->water = 35;
        s->iqSharp = 35; s->iqFineDetail = 35; s->iqTextureClarity = 40; s->iqEdgeDetail = 35; s->iqLocalContrast = 40; s->iqDenoise = 40; s->iqArtifact = 45;
        s->cBright = 50; s->cContrast = 50; s->cSat = 46; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 52; s->cTemp = 50;
        s->hdr = 30; s->colorPreset = CP_REALISTIC;
        break;
    case PRESET_CINEMATIC:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 4; s->temporalHistory = 80; s->motionComp = 75;
        s->aa = 4; s->texture = 3;
        s->shadowQuality = 60; s->shadowDetail = 55; s->shadowStability = 50; s->shadowSoftness = 50; s->shadowContact = 55;
        s->lightQuality = 60; s->lightLocalContrast = 70; s->lightDetail = 55; s->lightExposure = 48; s->lightDynRange = 85;
        s->ao = 3; s->reflection = 45; s->detail = 50; s->distant = 45; s->lod = 40;
        s->vegetation = 45; s->character = 45; s->particles = 50; s->water = 50;
        s->iqSharp = 45; s->iqFineDetail = 45; s->iqTextureClarity = 45; s->iqEdgeDetail = 50; s->iqLocalContrast = 65; s->iqDenoise = 35; s->iqArtifact = 45;
        s->cBright = 48; s->cContrast = 58; s->cSat = 54; s->cHighlights = 45; s->cShadows = 56; s->cGamma = 50; s->cTemp = 45;
        s->hdr = 55; s->colorPreset = CP_CINEMATIC;
        break;
    case PRESET_MAXGRAPHICS:
        memset(s, 0, sizeof *s);
        s->superRes = 1;
        s->temporal = 5; s->temporalHistory = 85; s->motionComp = 80;
        s->aa = 5; s->texture = 5;
        s->shadowQuality = 90; s->shadowDetail = 85; s->shadowStability = 85; s->shadowSoftness = 55; s->shadowContact = 85;
        s->lightQuality = 80; s->lightLocalContrast = 75; s->lightDetail = 70; s->lightExposure = 50; s->lightDynRange = 95;
        s->ao = 4; s->reflection = 75; s->detail = 90; s->distant = 85; s->lod = 70;
        s->vegetation = 75; s->character = 80; s->particles = 70; s->water = 70;
        s->iqSharp = 80; s->iqFineDetail = 75; s->iqTextureClarity = 80; s->iqEdgeDetail = 80; s->iqLocalContrast = 70; s->iqDenoise = 45; s->iqArtifact = 65;
        s->cBright = 50; s->cContrast = 55; s->cSat = 58; s->cHighlights = 50; s->cShadows = 52; s->cGamma = 50; s->cTemp = 50;
        s->hdr = 70; s->colorPreset = CP_VIVID;
        break;
    case PRESET_CUSTOM:
    default:
        s->preset = PRESET_CUSTOM;
        return; // keep all current values
    }
    s->master = keepMaster;
    s->outW = ow; s->outH = oh;
    s->preset = p;
}

void SettingsApplyColorPreset(NexusSettings* s, ColorPreset p){
    switch (p){
    case CP_NATURAL:
        s->cBright = 50; s->cContrast = 50; s->cSat = 50; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 50; s->cTemp = 50;
        break;
    case CP_CINEMATIC:
        s->cBright = 48; s->cContrast = 58; s->cSat = 54; s->cHighlights = 45; s->cShadows = 56; s->cGamma = 50; s->cTemp = 45;
        break;
    case CP_VIVID:
        s->cBright = 50; s->cContrast = 55; s->cSat = 65; s->cHighlights = 48; s->cShadows = 52; s->cGamma = 50; s->cTemp = 50;
        break;
    case CP_REALISTIC:
        s->cBright = 50; s->cContrast = 50; s->cSat = 46; s->cHighlights = 50; s->cShadows = 50; s->cGamma = 52; s->cTemp = 52;
        break;
    case CP_COMPETITIVE:
        s->cBright = 55; s->cContrast = 60; s->cSat = 42; s->cHighlights = 52; s->cShadows = 48; s->cGamma = 50; s->cTemp = 55;
        break;
    case CP_CUSTOM:
    default:
        break;
    }
    s->colorPreset = p;
}

const char* PresetName_(Preset p){
    switch (p){
    case PRESET_LOW: return "LOW ENHANCEMENT";
    case PRESET_QUALITY: return "QUALITY";
    case PRESET_ULTRA: return "ULTRA";
    case PRESET_EXTREME: return "EXTREME";
    case PRESET_REALISTIC: return "REALISTIC";
    case PRESET_CINEMATIC: return "CINEMATIC";
    case PRESET_MAXGRAPHICS: return "MAX GRAPHICS";
    case PRESET_CUSTOM: return "CUSTOM";
    }
    return "CUSTOM";
}
const char* ColorPresetName_(ColorPreset p){
    switch (p){
    case CP_NATURAL: return "Natural";
    case CP_CINEMATIC: return "Cinematic";
    case CP_VIVID: return "Vivid";
    case CP_REALISTIC: return "Realistic";
    case CP_COMPETITIVE: return "Competitive";
    case CP_CUSTOM: return "Custom";
    }
    return "Custom";
}

// ---------------------------------------------------------------- json <-> settings
void SettingsToJson_(NexusSettings* s, JVal* o){
    JVObjPutInt(o, "version", 1);
    JVObjPutInt(o, "preset", (int)s->preset);
    JVObjPutInt(o, "master", s->master);
    JVObjPutInt(o, "outW", s->outW);
    JVObjPutInt(o, "outH", s->outH);
    JVObjPutInt(o, "superRes", s->superRes);
    JVObjPutInt(o, "temporal", s->temporal);
    JVObjPutInt(o, "temporalHistory", s->temporalHistory);
    JVObjPutInt(o, "motionComp", s->motionComp);
    JVObjPutInt(o, "aa", s->aa);
    JVObjPutInt(o, "texture", s->texture);
    JVObjPutInt(o, "shadowQuality", s->shadowQuality);
    JVObjPutInt(o, "shadowDetail", s->shadowDetail);
    JVObjPutInt(o, "shadowStability", s->shadowStability);
    JVObjPutInt(o, "shadowSoftness", s->shadowSoftness);
    JVObjPutInt(o, "shadowContact", s->shadowContact);
    JVObjPutInt(o, "lightQuality", s->lightQuality);
    JVObjPutInt(o, "lightLocalContrast", s->lightLocalContrast);
    JVObjPutInt(o, "lightDetail", s->lightDetail);
    JVObjPutInt(o, "lightExposure", s->lightExposure);
    JVObjPutInt(o, "lightDynRange", s->lightDynRange);
    JVObjPutInt(o, "ao", s->ao);
    JVObjPutInt(o, "reflection", s->reflection);
    JVObjPutInt(o, "detail", s->detail);
    JVObjPutInt(o, "distant", s->distant);
    JVObjPutInt(o, "lod", s->lod);
    JVObjPutInt(o, "vegetation", s->vegetation);
    JVObjPutInt(o, "character", s->character);
    JVObjPutInt(o, "particles", s->particles);
    JVObjPutInt(o, "water", s->water);
    JVObjPutInt(o, "iqSharp", s->iqSharp);
    JVObjPutInt(o, "iqFineDetail", s->iqFineDetail);
    JVObjPutInt(o, "iqTextureClarity", s->iqTextureClarity);
    JVObjPutInt(o, "iqEdgeDetail", s->iqEdgeDetail);
    JVObjPutInt(o, "iqLocalContrast", s->iqLocalContrast);
    JVObjPutInt(o, "iqDenoise", s->iqDenoise);
    JVObjPutInt(o, "iqArtifact", s->iqArtifact);
    JVObjPutInt(o, "cBright", s->cBright);
    JVObjPutInt(o, "cContrast", s->cContrast);
    JVObjPutInt(o, "cSat", s->cSat);
    JVObjPutInt(o, "cHighlights", s->cHighlights);
    JVObjPutInt(o, "cShadows", s->cShadows);
    JVObjPutInt(o, "cGamma", s->cGamma);
    JVObjPutInt(o, "cTemp", s->cTemp);
    JVObjPutInt(o, "colorPreset", (int)s->colorPreset);
    JVObjPutInt(o, "hdr", s->hdr);
    JVObjPutInt(o, "hdrOutput", s->hdrOutput);
}
void SettingsFromJson_(NexusSettings* s, JVal* o){
    if (!o || o->kind != J_OBJ) return;
    s->preset = (Preset)JVInt(o, "preset", (int)s->preset);
    s->master = JVInt(o, "master", s->master);
    s->outW = JVInt(o, "outW", s->outW);
    s->outH = JVInt(o, "outH", s->outH);
    s->superRes = JVInt(o, "superRes", s->superRes);
    s->temporal = JVInt(o, "temporal", s->temporal);
    s->temporalHistory = JVInt(o, "temporalHistory", s->temporalHistory);
    s->motionComp = JVInt(o, "motionComp", s->motionComp);
    s->aa = JVInt(o, "aa", s->aa);
    s->texture = JVInt(o, "texture", s->texture);
    s->shadowQuality = JVInt(o, "shadowQuality", s->shadowQuality);
    s->shadowDetail = JVInt(o, "shadowDetail", s->shadowDetail);
    s->shadowStability = JVInt(o, "shadowStability", s->shadowStability);
    s->shadowSoftness = JVInt(o, "shadowSoftness", s->shadowSoftness);
    s->shadowContact = JVInt(o, "shadowContact", s->shadowContact);
    s->lightQuality = JVInt(o, "lightQuality", s->lightQuality);
    s->lightLocalContrast = JVInt(o, "lightLocalContrast", s->lightLocalContrast);
    s->lightDetail = JVInt(o, "lightDetail", s->lightDetail);
    s->lightExposure = JVInt(o, "lightExposure", s->lightExposure);
    s->lightDynRange = JVInt(o, "lightDynRange", s->lightDynRange);
    s->ao = JVInt(o, "ao", s->ao);
    s->reflection = JVInt(o, "reflection", s->reflection);
    s->detail = JVInt(o, "detail", s->detail);
    s->distant = JVInt(o, "distant", s->distant);
    s->lod = JVInt(o, "lod", s->lod);
    s->vegetation = JVInt(o, "vegetation", s->vegetation);
    s->character = JVInt(o, "character", s->character);
    s->particles = JVInt(o, "particles", s->particles);
    s->water = JVInt(o, "water", s->water);
    s->iqSharp = JVInt(o, "iqSharp", s->iqSharp);
    s->iqFineDetail = JVInt(o, "iqFineDetail", s->iqFineDetail);
    s->iqTextureClarity = JVInt(o, "iqTextureClarity", s->iqTextureClarity);
    s->iqEdgeDetail = JVInt(o, "iqEdgeDetail", s->iqEdgeDetail);
    s->iqLocalContrast = JVInt(o, "iqLocalContrast", s->iqLocalContrast);
    s->iqDenoise = JVInt(o, "iqDenoise", s->iqDenoise);
    s->iqArtifact = JVInt(o, "iqArtifact", s->iqArtifact);
    s->cBright = JVInt(o, "cBright", s->cBright);
    s->cContrast = JVInt(o, "cContrast", s->cContrast);
    s->cSat = JVInt(o, "cSat", s->cSat);
    s->cHighlights = JVInt(o, "cHighlights", s->cHighlights);
    s->cShadows = JVInt(o, "cShadows", s->cShadows);
    s->cGamma = JVInt(o, "cGamma", s->cGamma);
    s->cTemp = JVInt(o, "cTemp", s->cTemp);
    s->colorPreset = (ColorPreset)JVInt(o, "colorPreset", (int)s->colorPreset);
    s->hdr = JVInt(o, "hdr", s->hdr);
    s->hdrOutput = JVInt(o, "hdrOutput", s->hdrOutput);
    s->master = clampi_(s->master, 0, 100);
    s->temporal = clampi_(s->temporal, 0, 5); s->aa = clampi_(s->aa, 0, 5);
    s->texture = clampi_(s->texture, 0, 5); s->ao = clampi_(s->ao, 0, 5);
}

// ---------------------------------------------------------------- files
int AppDataPath_(wchar_t* out, int n){
    if (GetEnvironmentVariableW(L"APPDATA", 0, 0) == 0) return 0;
    int len = GetEnvironmentVariableW(L"APPDATA", out, n - 1);
    if (len == 0 || len >= n - 1) return 0;
    int i = len;
    out[i++] = L'\\';
    const wchar_t* tail = L"NexusGraphicsEngine";
    while (*tail && i < n - 1) out[i++] = *tail++;
    out[i] = 0;
    if (CreateDirectoryW(out, 0) == 0 && GetLastError() != ERROR_ALREADY_EXISTS) return 0;
    return i;
}
int WriteFileW_(const wchar_t* path, const char* data, int len){
    HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    if (h == INVALID_HANDLE_VALUE) return 0;
    DWORD w = 0;
    BOOL ok = WriteFile(h, data, (DWORD)len, &w, 0);
    CloseHandle(h);
    return ok && (int)w == len;
}
char* ReadFileAlloc_(const wchar_t* path, int* len){
    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0);
    if (h == INVALID_HANDLE_VALUE){ if (len) *len = 0; return 0; }
    DWORD sz = GetFileSize(h, 0);
    if (sz == INVALID_FILE_SIZE || sz == 0){ CloseHandle(h); if (len) *len = 0; return 0; }
    char* buf = (char*)malloc((size_t)sz + 1);
    if (!buf){ CloseHandle(h); return 0; }
    DWORD rd = 0;
    if (!ReadFile(h, buf, sz, &rd, 0)){ free(buf); CloseHandle(h); if (len) *len = 0; return 0; }
    buf[rd] = 0;
    CloseHandle(h);
    if (len) *len = (int)rd;
    return buf;
}
void FreeAlloc_(void* p){ free(p); }
