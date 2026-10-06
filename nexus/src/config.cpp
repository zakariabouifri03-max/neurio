// NEXUS GRAPHICS ENGINE - settings, presets, profiles implementation
#include "stdafx.h"
#include "config.h"
#include "shlobj.h"

// ---------------------------------------------------------------- presets
// Every preset changes REAL pipeline parameters (thresholds, blend weights,
// radii, iterations). Nothing here is cosmetic-only.
void ApplyPreset(FrameParams& fp, int preset, float master) {
    fp.master = master;
    const float m = master;
    auto sc = [&](float v) { return v * (0.15f + 0.85f * m); }; // scale strength with master
    switch (preset) {
    case P_LOW_ENHANCEMENT:
        fp.temporalLevel = Q_LOW; fp.aaLevel = Q_LOW; fp.aoLevel = Q_OFF;
        fp.artifactLevel = Q_LOW; fp.sceneLevel = Q_OFF;
        fp.detailBoost = 0.30f * m; fp.sharpen = 0.12f * m;
        fp.fineDetail = 0.25f; fp.textureClarity = 0.25f; fp.edgeDetail = 0.22f;
        fp.localContrast = 0.15f; fp.distantDetail = 0.15f;
        fp.shadowQuality = 0.25f; fp.shadowDetail = 0.20f; fp.shadowStability = 0.40f; fp.shadowSoftness = 0.40f; fp.contactShadow = 0.15f;
        fp.lightingQuality = 0.20f; fp.lightDetail = 0.15f; fp.exposure = 1.0f; fp.dynamicRange = 0.20f;
        fp.reflectionStrength = 0.15f; fp.reflectionStabilize = 0.25f;
        fp.vegetation = 0.20f; fp.particles = 0.15f; fp.water = 0.15f; fp.characterProtect = 0.40f;
        fp.denoise = 0.20f; fp.deband = 0.25f;
        break;
    case P_QUALITY:
        fp.temporalLevel = Q_MEDIUM; fp.aaLevel = Q_MEDIUM; fp.aoLevel = Q_LOW;
        fp.artifactLevel = Q_MEDIUM; fp.sceneLevel = Q_MEDIUM;
        fp.detailBoost = 0.60f * m; fp.sharpen = 0.25f * m;
        fp.fineDetail = 0.45f; fp.textureClarity = 0.45f; fp.edgeDetail = 0.40f;
        fp.localContrast = 0.35f; fp.distantDetail = 0.35f;
        fp.shadowQuality = 0.45f; fp.shadowDetail = 0.35f; fp.shadowStability = 0.55f; fp.shadowSoftness = 0.50f; fp.contactShadow = 0.35f;
        fp.lightingQuality = 0.40f; fp.lightDetail = 0.35f; fp.exposure = 1.0f; fp.dynamicRange = 0.35f;
        fp.reflectionStrength = 0.30f; fp.reflectionStabilize = 0.45f;
        fp.vegetation = 0.35f; fp.particles = 0.30f; fp.water = 0.30f; fp.characterProtect = 0.50f;
        fp.denoise = 0.30f; fp.deband = 0.35f;
        break;
    case P_ULTRA:
        fp.temporalLevel = Q_HIGH; fp.aaLevel = Q_HIGH; fp.aoLevel = Q_MEDIUM;
        fp.artifactLevel = Q_MEDIUM; fp.sceneLevel = Q_HIGH;
        fp.detailBoost = 0.80f * m; fp.sharpen = 0.35f * m;
        fp.fineDetail = 0.55f; fp.textureClarity = 0.55f; fp.edgeDetail = 0.50f;
        fp.localContrast = 0.45f; fp.distantDetail = 0.50f;
        fp.shadowQuality = 0.60f; fp.shadowDetail = 0.50f; fp.shadowStability = 0.60f; fp.shadowSoftness = 0.50f; fp.contactShadow = 0.50f;
        fp.lightingQuality = 0.55f; fp.lightDetail = 0.50f; fp.exposure = 1.0f; fp.dynamicRange = 0.45f;
        fp.reflectionStrength = 0.45f; fp.reflectionStabilize = 0.55f;
        fp.vegetation = 0.55f; fp.particles = 0.50f; fp.water = 0.45f; fp.characterProtect = 0.55f;
        fp.denoise = 0.35f; fp.deband = 0.45f;
        break;
    case P_EXTREME:
        fp.temporalLevel = Q_EXTREME; fp.aaLevel = Q_EXTREME; fp.aoLevel = Q_EXTREME;
        fp.artifactLevel = Q_HIGH; fp.sceneLevel = Q_EXTREME;
        fp.detailBoost = 1.00f * m; fp.sharpen = 0.55f * m;
        fp.fineDetail = 0.75f; fp.textureClarity = 0.75f; fp.edgeDetail = 0.70f;
        fp.localContrast = 0.60f; fp.distantDetail = 0.70f;
        fp.shadowQuality = 0.80f; fp.shadowDetail = 0.70f; fp.shadowStability = 0.70f; fp.shadowSoftness = 0.55f; fp.contactShadow = 0.70f;
        fp.lightingQuality = 0.75f; fp.lightDetail = 0.70f; fp.exposure = 1.0f; fp.dynamicRange = 0.60f;
        fp.reflectionStrength = 0.65f; fp.reflectionStabilize = 0.65f;
        fp.vegetation = 0.80f; fp.particles = 0.70f; fp.water = 0.65f; fp.characterProtect = 0.60f;
        fp.denoise = 0.45f; fp.deband = 0.60f;
        break;
    case P_REALISTIC:
        fp.temporalLevel = Q_HIGH; fp.aaLevel = Q_ULTRA; fp.aoLevel = Q_LOW;
        fp.artifactLevel = Q_MEDIUM; fp.sceneLevel = Q_MEDIUM;
        fp.detailBoost = 0.55f * m; fp.sharpen = 0.20f * m;
        fp.fineDetail = 0.40f; fp.textureClarity = 0.45f; fp.edgeDetail = 0.40f;
        fp.localContrast = 0.30f; fp.distantDetail = 0.40f;
        fp.shadowQuality = 0.45f; fp.shadowDetail = 0.40f; fp.shadowStability = 0.65f; fp.shadowSoftness = 0.60f; fp.contactShadow = 0.35f;
        fp.lightingQuality = 0.40f; fp.lightDetail = 0.35f; fp.exposure = 1.0f; fp.dynamicRange = 0.30f;
        fp.reflectionStrength = 0.30f; fp.reflectionStabilize = 0.55f;
        fp.vegetation = 0.40f; fp.particles = 0.35f; fp.water = 0.35f; fp.characterProtect = 0.65f;
        fp.denoise = 0.30f; fp.deband = 0.40f;
        fp.brightness = 1.0f; fp.contrast = 1.02f; fp.saturation = 1.0f; fp.gamma = 1.0f; fp.temperature = 0.0f; fp.hdrAmount = 0.15f;
        break;
    case P_CINEMATIC:
        fp.temporalLevel = Q_ULTRA; fp.aaLevel = Q_ULTRA; fp.aoLevel = Q_ULTRA;
        fp.artifactLevel = Q_HIGH; fp.sceneLevel = Q_HIGH;
        fp.detailBoost = 0.70f * m; fp.sharpen = 0.28f * m;
        fp.fineDetail = 0.50f; fp.textureClarity = 0.55f; fp.edgeDetail = 0.45f;
        fp.localContrast = 0.55f; fp.distantDetail = 0.45f;
        fp.shadowQuality = 0.70f; fp.shadowDetail = 0.55f; fp.shadowStability = 0.60f; fp.shadowSoftness = 0.55f; fp.contactShadow = 0.55f;
        fp.lightingQuality = 0.65f; fp.lightDetail = 0.55f; fp.exposure = 1.0f; fp.dynamicRange = 0.65f;
        fp.reflectionStrength = 0.50f; fp.reflectionStabilize = 0.55f;
        fp.vegetation = 0.50f; fp.particles = 0.45f; fp.water = 0.50f; fp.characterProtect = 0.55f;
        fp.denoise = 0.40f; fp.deband = 0.50f;
        fp.brightness = 1.0f; fp.contrast = 1.10f; fp.saturation = 1.04f; fp.gamma = 0.97f; fp.temperature = -0.10f; fp.hdrAmount = 0.45f;
        fp.shadows = 0.62f; fp.highlights = 0.55f;
        break;
    case P_MAX_GRAPHICS:
        fp.temporalLevel = Q_ULTRA; fp.aaLevel = Q_ULTRA; fp.aoLevel = Q_ULTRA;
        fp.artifactLevel = Q_HIGH; fp.sceneLevel = Q_ULTRA;
        fp.detailBoost = 0.92f * m; fp.sharpen = 0.40f * m;
        fp.fineDetail = 0.68f; fp.textureClarity = 0.68f; fp.edgeDetail = 0.62f;
        fp.localContrast = 0.52f; fp.distantDetail = 0.62f;
        fp.shadowQuality = 0.72f; fp.shadowDetail = 0.62f; fp.shadowStability = 0.65f; fp.shadowSoftness = 0.52f; fp.contactShadow = 0.60f;
        fp.lightingQuality = 0.65f; fp.lightDetail = 0.58f; fp.exposure = 1.0f; fp.dynamicRange = 0.50f;
        fp.reflectionStrength = 0.55f; fp.reflectionStabilize = 0.60f;
        fp.vegetation = 0.68f; fp.particles = 0.60f; fp.water = 0.55f; fp.characterProtect = 0.60f;
        fp.denoise = 0.40f; fp.deband = 0.55f;
        break;
    case P_CUSTOM:
    default:
        break; // keep user's values
    }
    // master slider scales the numeric strengths (levels stay user-chosen)
    fp.detailBoost = sc(fp.detailBoost / (0.15f + 0.85f * m) * (0.15f + 0.85f * m)); // already scaled
}

void ApplyColorPreset(FrameParams& fp, int preset) {
    switch (preset) {
    case C_NATURAL:
        fp.brightness = 1.0f; fp.contrast = 1.03f; fp.saturation = 1.02f; fp.gamma = 1.0f;
        fp.temperature = 0.0f; fp.highlights = 0.45f; fp.shadows = 0.45f; fp.hdrAmount = 0.20f; break;
    case C_CINEMATIC:
        fp.brightness = 1.0f; fp.contrast = 1.12f; fp.saturation = 1.05f; fp.gamma = 0.97f;
        fp.temperature = -0.12f; fp.highlights = 0.60f; fp.shadows = 0.62f; fp.hdrAmount = 0.45f; break;
    case C_VIVID:
        fp.brightness = 1.02f; fp.contrast = 1.08f; fp.saturation = 1.14f; fp.gamma = 1.0f;
        fp.temperature = 0.05f; fp.highlights = 0.45f; fp.shadows = 0.40f; fp.hdrAmount = 0.35f; break;
    case C_REALISTIC:
        fp.brightness = 1.0f; fp.contrast = 1.0f; fp.saturation = 1.0f; fp.gamma = 1.0f;
        fp.temperature = 0.0f; fp.highlights = 0.35f; fp.shadows = 0.35f; fp.hdrAmount = 0.10f; break;
    case C_COMPETITIVE:
        fp.brightness = 1.06f; fp.contrast = 1.06f; fp.saturation = 0.98f; fp.gamma = 1.10f;
        fp.temperature = 0.0f; fp.highlights = 0.20f; fp.shadows = 0.75f; fp.hdrAmount = 0.0f; break;
    default: break;
    }
}

// ---------------------------------------------------------------- INI core
struct IniKv { std::string key, val; };
struct IniSec { std::string name; std::vector<IniKv> kv; };

static void IniParse(const std::string& text, std::vector<IniSec>& out) {
    out.clear();
    IniSec cur; cur.name = "";
    size_t pos = 0;
    while (pos <= text.size()) {
        size_t eol = text.find('\n', pos);
        if (eol == std::string::npos) eol = text.size();
        std::string line = text.substr(pos, eol - pos);
        pos = eol + 1;
        // strip \r, comments
        if (!line.empty() && line.back() == '\r') line.pop_back();
        size_t c = line.find_first_of(";#");
        if (c != std::string::npos) line = line.substr(0, c);
        // trim
        size_t b = line.find_first_not_of(" \t");
        if (b == std::string::npos) continue;
        size_t e2 = line.find_last_not_of(" \t");
        line = line.substr(b, e2 - b + 1);
        if (line.empty()) continue;
        if (line[0] == '[' && line.back() == ']') {
            if (!cur.name.empty() || !cur.kv.empty()) out.push_back(cur);
            cur.name = line.substr(1, line.size() - 2); cur.kv.clear();
            continue;
        }
        size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        IniKv kv;
        kv.key = line.substr(0, eq);
        kv.val = line.substr(eq + 1);
        auto trim = [](std::string& s) {
            size_t b2 = s.find_first_not_of(" \t"); size_t e3 = s.find_last_not_of(" \t");
            s = (b2 == std::string::npos) ? std::string() : s.substr(b2, e3 - b2 + 1);
        };
        trim(kv.key); trim(kv.val);
        cur.kv.push_back(kv);
    }
    if (!cur.name.empty() || !cur.kv.empty()) out.push_back(cur);
}

static std::string IniBuild(const std::vector<IniSec>& secs) {
    std::string s;
    for (auto& sec : secs) {
        if (!sec.name.empty()) s += "[" + sec.name + "]\n";
        for (auto& kv : sec.kv) s += kv.key + "=" + kv.val + "\n";
        s += "\n";
    }
    return s;
}

// Tiny helpers used by serializers below
namespace iniio {
    static std::string Find(const std::vector<IniSec>& secs, const char* sec, const char* key, const std::string& def) {
        for (auto& s : secs) if (_stricmp(s.name.c_str(), sec) == 0)
            for (auto& kv : s.kv) if (_stricmp(kv.key.c_str(), key) == 0) return kv.val;
        return def;
    }
    static float GetF(const std::vector<IniSec>& s, const char* sec, const char* k, float def) {
        std::string v = Find(s, sec, k, ""); if (v.empty()) return def;
        return (float)atof(v.c_str());
    }
    static int GetI(const std::vector<IniSec>& s, const char* sec, const char* k, int def) {
        std::string v = Find(s, sec, k, ""); if (v.empty()) return def;
        return atoi(v.c_str());
    }
    static bool GetB(const std::vector<IniSec>& s, const char* sec, const char* k, bool def) {
        std::string v = Find(s, sec, k, ""); if (v.empty()) return def;
        return v == "1" || _stricmp(v.c_str(), "true") == 0;
    }
}

// ---------------------------------------------------------------- profile ini
static void FpToSec(std::vector<IniSec>& secs, const FrameParams& fp, bool colorOnly = false) {
    IniSec* cs = nullptr; IniSec* ps = nullptr;
    for (auto& s : secs) { if (s.name == "color") cs = &s; if (s.name == "params") ps = &s; }
    auto put = [](IniSec& s, const char* k, float v) {
        char b[64]; _snprintf_s(b, sizeof(b), _TRUNCATE, "%.4f", v);
        for (auto& kv : s.kv) if (kv.key == k) { kv.val = b; return; }
        s.kv.push_back({ k, b });
    };
    if (!cs) { secs.push_back({ "color",{} }); cs = &secs.back(); }
    if (!ps && !colorOnly) { secs.push_back({ "params",{} }); ps = &secs.back(); }
    put(*cs, "brightness", fp.brightness); put(*cs, "contrast", fp.contrast);
    put(*cs, "saturation", fp.saturation); put(*cs, "highlights", fp.highlights);
    put(*cs, "shadows", fp.shadows); put(*cs, "gamma", fp.gamma);
    put(*cs, "temperature", fp.temperature); put(*cs, "hdrAmount", fp.hdrAmount);
    if (ps) {
        put(*ps, "detailBoost", fp.detailBoost); put(*ps, "sharpen", fp.sharpen);
        put(*ps, "fineDetail", fp.fineDetail); put(*ps, "textureClarity", fp.textureClarity);
        put(*ps, "edgeDetail", fp.edgeDetail); put(*ps, "localContrast", fp.localContrast);
        put(*ps, "distantDetail", fp.distantDetail);
        put(*ps, "shadowQuality", fp.shadowQuality); put(*ps, "shadowDetail", fp.shadowDetail);
        put(*ps, "shadowStability", fp.shadowStability); put(*ps, "shadowSoftness", fp.shadowSoftness); put(*ps, "contactShadow", fp.contactShadow);
        put(*ps, "lightingQuality", fp.lightingQuality); put(*ps, "lightDetail", fp.lightDetail);
        put(*ps, "exposure", fp.exposure); put(*ps, "dynamicRange", fp.dynamicRange);
        put(*ps, "reflectionStrength", fp.reflectionStrength); put(*ps, "reflectionStabilize", fp.reflectionStabilize);
        put(*ps, "vegetation", fp.vegetation); put(*ps, "particles", fp.particles);
        put(*ps, "water", fp.water); put(*ps, "characterProtect", fp.characterProtect);
        put(*ps, "denoise", fp.denoise); put(*ps, "deband", fp.deband);
    }
}

std::string ProfileToIni(const GameProfile& gp) {
    std::vector<IniSec> secs;
    IniSec g; g.name = "game";
    g.kv.push_back({ "exeName", gp.exeName });
    g.kv.push_back({ "exePath", gp.exePath });
    g.kv.push_back({ "displayName", gp.displayName });
    g.kv.push_back({ "notes", gp.notes });
    g.kv.push_back({ "inW", std::to_string(gp.inW) });
    g.kv.push_back({ "inH", std::to_string(gp.inH) });
    g.kv.push_back({ "outW", std::to_string(gp.outW) });
    g.kv.push_back({ "outH", std::to_string(gp.outH) });
    g.kv.push_back({ "preset", std::to_string(gp.preset) });
    g.kv.push_back({ "colorPreset", std::to_string(gp.colorPreset) });
    g.kv.push_back({ "autoActivate", gp.autoActivate ? "1" : "0" });
    secs.push_back(g);
    IniSec lv; lv.name = "levels";
    lv.kv.push_back({ "temporal", std::to_string(gp.params.temporalLevel) });
    lv.kv.push_back({ "aa", std::to_string(gp.params.aaLevel) });
    lv.kv.push_back({ "ao", std::to_string(gp.params.aoLevel) });
    lv.kv.push_back({ "artifact", std::to_string(gp.params.artifactLevel) });
    lv.kv.push_back({ "scene", std::to_string(gp.params.sceneLevel) });
    lv.kv.push_back({ "hdrOutput", gp.params.hdrOutput ? "1" : "0" });
    secs.push_back(lv);
    FpToSec(secs, gp.params);
    return IniBuild(secs);
}

void ProfileFromIni(const std::string& ini, GameProfile& gp) {
    std::vector<IniSec> secs; IniParse(ini, secs);
    using namespace iniio;
    gp.exeName = Find(secs, "game", "exeName", "");
    gp.exePath = Find(secs, "game", "exePath", "");
    gp.displayName = Find(secs, "game", "displayName", gp.exeName);
    gp.notes = Find(secs, "game", "notes", "");
    gp.inW = GetI(secs, "game", "inW", 1280); gp.inH = GetI(secs, "game", "inH", 720);
    gp.outW = GetI(secs, "game", "outW", 1920); gp.outH = GetI(secs, "game", "outH", 1080);
    gp.preset = GetI(secs, "game", "preset", P_MAX_GRAPHICS);
    gp.colorPreset = GetI(secs, "game", "colorPreset", C_NATURAL);
    gp.autoActivate = GetB(secs, "game", "autoActivate", true);
    gp.params.temporalLevel = GetI(secs, "levels", "temporal", Q_HIGH);
    gp.params.aaLevel = GetI(secs, "levels", "aa", Q_ULTRA);
    gp.params.aoLevel = GetI(secs, "levels", "ao", Q_ULTRA);
    gp.params.artifactLevel = GetI(secs, "levels", "artifact", Q_HIGH);
    gp.params.sceneLevel = GetI(secs, "levels", "scene", Q_ULTRA);
    gp.params.hdrOutput = GetB(secs, "levels", "hdrOutput", false);
    // numeric params
    gp.params.brightness = GetF(secs, "color", "brightness", 1.0f);
    gp.params.contrast = GetF(secs, "color", "contrast", 1.04f);
    gp.params.saturation = GetF(secs, "color", "saturation", 1.02f);
    gp.params.highlights = GetF(secs, "color", "highlights", 0.5f);
    gp.params.shadows = GetF(secs, "color", "shadows", 0.5f);
    gp.params.gamma = GetF(secs, "color", "gamma", 1.0f);
    gp.params.temperature = GetF(secs, "color", "temperature", 0.0f);
    gp.params.hdrAmount = GetF(secs, "color", "hdrAmount", 0.2f);
    gp.params.detailBoost = GetF(secs, "params", "detailBoost", 0.85f);
    gp.params.sharpen = GetF(secs, "params", "sharpen", 0.35f);
    gp.params.fineDetail = GetF(secs, "params", "fineDetail", 0.55f);
    gp.params.textureClarity = GetF(secs, "params", "textureClarity", 0.55f);
    gp.params.edgeDetail = GetF(secs, "params", "edgeDetail", 0.5f);
    gp.params.localContrast = GetF(secs, "params", "localContrast", 0.45f);
    gp.params.distantDetail = GetF(secs, "params", "distantDetail", 0.55f);
    gp.params.shadowQuality = GetF(secs, "params", "shadowQuality", 0.6f);
    gp.params.shadowDetail = GetF(secs, "params", "shadowDetail", 0.5f);
    gp.params.shadowStability = GetF(secs, "params", "shadowStability", 0.6f);
    gp.params.shadowSoftness = GetF(secs, "params", "shadowSoftness", 0.5f);
    gp.params.contactShadow = GetF(secs, "params", "contactShadow", 0.5f);
    gp.params.lightingQuality = GetF(secs, "params", "lightingQuality", 0.55f);
    gp.params.lightDetail = GetF(secs, "params", "lightDetail", 0.5f);
    gp.params.exposure = GetF(secs, "params", "exposure", 1.0f);
    gp.params.dynamicRange = GetF(secs, "params", "dynamicRange", 0.45f);
    gp.params.reflectionStrength = GetF(secs, "params", "reflectionStrength", 0.45f);
    gp.params.reflectionStabilize = GetF(secs, "params", "reflectionStabilize", 0.55f);
    gp.params.vegetation = GetF(secs, "params", "vegetation", 0.55f);
    gp.params.particles = GetF(secs, "params", "particles", 0.5f);
    gp.params.water = GetF(secs, "params", "water", 0.45f);
    gp.params.characterProtect = GetF(secs, "params", "characterProtect", 0.55f);
    gp.params.denoise = GetF(secs, "params", "denoise", 0.35f);
    gp.params.deband = GetF(secs, "params", "deband", 0.45f);
    gp.valid = !gp.exeName.empty();
}

// ---------------------------------------------------------------- app settings
std::wstring NgeAppDataDir() {
    wchar_t* p = nullptr;
    std::wstring base;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &p))) {
        base = p; CoTaskMemFree(p);
    } else base = L".";
    std::wstring dir = base + L"\\NexusGraphicsEngine";
    CreateDirectoryW(dir.c_str(), nullptr);
    CreateDirectoryW((dir + L"\\profiles").c_str(), nullptr);
    CreateDirectoryW((dir + L"\\logs").c_str(), nullptr);
    return dir;
}
std::wstring NgeProfilesDir() { return NgeAppDataDir() + L"\\profiles"; }
std::wstring NgeLogDir() { return NgeAppDataDir() + L"\\logs"; }

std::string SafeFileStem(const std::string& name) {
    std::string s;
    for (char c : name) {
        bool ok = isalnum((unsigned char)c) || c == '_' || c == '-' || c == '.' || c == ' ';
        s += ok ? (char)tolower((unsigned char)c) : '_';
    }
    if (s.empty()) s = "game";
    return s;
}

static std::string ReadFileUtf8(const std::wstring& path) {
    FILE* f = nullptr; _wfopen_s(&f, path.c_str(), L"rb");
    if (!f) return "";
    std::string out; char buf[8192]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) out.append(buf, n);
    fclose(f);
    if (out.size() >= 3 && (unsigned char)out[0] == 0xEF && (unsigned char)out[1] == 0xBB && (unsigned char)out[2] == 0xBF)
        out.erase(0, 3);
    return out;
}
static bool WriteFileUtf8(const std::wstring& path, const std::string& data) {
    FILE* f = nullptr; _wfopen_s(&f, path.c_str(), L"wb");
    if (!f) return false;
    fwrite(data.data(), 1, data.size(), f);
    fclose(f);
    return true;
}

bool SaveAppSettings(const AppSettings& s) {
    std::string ini;
    ini += "[app]\n";
    auto b = [](bool v) { return v ? "1" : "0"; };
    ini += Fmt("showHud=%s\n", b(s.showHud));
    ini += Fmt("hudScale=%.2f\n", s.hudScale);
    ini += Fmt("hudAutoPos=%s\n", b(s.hudAutoPos));
    ini += Fmt("hudX=%.3f\nhudY=%.3f\n", s.hudX, s.hudY);
    ini += Fmt("autoOptimize=%s\n", b(s.enableAutoOptimize));
    ini += Fmt("targetFps=%d\n", s.targetFps);
    ini += Fmt("autoDetect=%s\n", b(s.autoDetectGames));
    ini += Fmt("captureMode=%d\n", s.captureMode);
    ini += Fmt("vsyncOverlay=%s\n", b(s.vsyncOverlay));
    ini += Fmt("launchMinimized=%s\n", b(s.launchMinimized));
    ini += Fmt("startWithWindows=%s\n", b(s.startWithWindows));
    ini += Fmt("lastPreset=%d\nlastColorPreset=%d\n", s.lastPreset, s.lastColorPreset);
    ini += Fmt("lastProfileId=%s\n", s.lastProfileId);
    ini += Fmt("firstRun=%s\n", b(s.firstRun));
    return WriteFileUtf8(NgeAppDataDir() + L"\\settings.ini", ini);
}

bool LoadAppSettings(AppSettings& s) {
    std::vector<IniSec> secs; IniParse(ReadFileUtf8(NgeAppDataDir() + L"\\settings.ini"), secs);
    using namespace iniio;
    s.showHud = GetB(secs, "app", "showHud", true);
    s.hudScale = GetF(secs, "app", "hudScale", 1.0f);
    s.hudAutoPos = GetB(secs, "app", "hudAutoPos", true);
    s.hudX = GetF(secs, "app", "hudX", 0.02f); s.hudY = GetF(secs, "app", "hudY", 0.02f);
    s.enableAutoOptimize = GetB(secs, "app", "autoOptimize", false);
    s.targetFps = GetI(secs, "app", "targetFps", 60);
    s.autoDetectGames = GetB(secs, "app", "autoDetect", true);
    s.captureMode = GetI(secs, "app", "captureMode", 0);
    s.vsyncOverlay = GetB(secs, "app", "vsyncOverlay", false);
    s.launchMinimized = GetB(secs, "app", "launchMinimized", false);
    s.startWithWindows = GetB(secs, "app", "startWithWindows", false);
    s.lastPreset = GetI(secs, "app", "lastPreset", P_MAX_GRAPHICS);
    s.lastColorPreset = GetI(secs, "app", "lastColorPreset", C_NATURAL);
    std::string lp = Find(secs, "app", "lastProfileId", "");
    strncpy_s(s.lastProfileId, lp.c_str(), sizeof(s.lastProfileId) - 1);
    s.firstRun = GetB(secs, "app", "firstRun", true);
    return true;
}

// ---------------------------------------------------------------- profile store
std::vector<GameProfile> LoadAllProfiles() {
    std::vector<GameProfile> out;
    WIN32_FIND_DATAW fd;
    std::wstring dir = NgeProfilesDir() + L"\\*.ini";
    HANDLE h = FindFirstFileW(dir.c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
            std::wstring full = NgeProfilesDir() + L"\\" + fd.cFileName;
            GameProfile gp;
            ProfileFromIni(ReadFileUtf8(full), gp);
            if (gp.valid) {
                std::wstring stem(fd.cFileName); stem = stem.substr(0, stem.size() - 4);
                gp.id = WideToUtf8(stem);
                if (gp.displayName.empty()) gp.displayName = gp.exeName;
                out.push_back(gp);
            }
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    std::sort(out.begin(), out.end(), [](const GameProfile& a, const GameProfile& b) { return _stricmp(a.displayName.c_str(), b.displayName.c_str()) < 0; });
    return out;
}

bool SaveProfile(const GameProfile& gp) {
    std::string stem = gp.id.empty() ? SafeFileStem(gp.exeName) : gp.id;
    return WriteFileUtf8(NgeProfilesDir() + L"\\" + Utf8ToWide(stem) + L".ini", ProfileToIni(gp));
}

bool DeleteProfile(const std::string& id) {
    std::wstring p = NgeProfilesDir() + L"\\" + Utf8ToWide(id) + L".ini";
    return DeleteFileW(p.c_str()) == TRUE;
}

GameProfile MakeProfileFromExe(const std::wstring& exePath) {
    GameProfile gp;
    std::wstring name = exePath.substr(exePath.find_last_of(L"\\/") + 1);
    gp.exeName = WideToUtf8(name);
    for (auto& c : gp.exeName) c = (char)tolower((unsigned char)c);
    gp.exePath = WideToUtf8(exePath);
    gp.displayName = WideToUtf8(name.substr(0, name.find_last_of(L".")));
    // sensible defaults: assume the game renders 720p-1080p; user can correct
    gp.inW = 1280; gp.inH = 720; gp.outW = 1920; gp.outH = 1080;
    gp.preset = P_MAX_GRAPHICS; gp.colorPreset = C_NATURAL;
    ApplyPreset(gp.params, gp.preset, 1.0f);
    gp.id = SafeFileStem(gp.exeName);
    gp.valid = true;
    return gp;
}
