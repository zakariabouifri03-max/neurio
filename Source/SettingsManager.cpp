#include "SettingsManager.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

AppSettings::AppSettings() {
    resetKeyMap();
}

void AppSettings::resetKeyMap() {
    for (int i = 0; i < 256; ++i) keyMap[i] = -1;
    // Home-row piano (C major starting at current octave)
    auto set = [&](int vk, int off) { if (vk >= 0 && vk < 256) keyMap[vk] = off; };
    set('A', 0);   // C
    set('W', 1);   // C#
    set('S', 2);   // D
    set('E', 3);   // D#
    set('D', 4);   // E
    set('F', 5);   // F
    set('T', 6);   // F#
    set('G', 7);   // G
    set('Y', 8);   // G#
    set('H', 9);   // A
    set('U', 10);  // A#
    set('J', 11);  // B
    set('K', 12);  // C
    set('O', 13);  // C#
    set('L', 14);  // D
    set('P', 15);  // D#
    set(0xBA, 16); // ;  E   VK_OEM_1
    set(0xDE, 17); // '  F   VK_OEM_7
}

static std::string toUtf8(const std::wstring& w) {
    std::string s;
    s.reserve(w.size());
    for (wchar_t c : w) {
        unsigned int u = (unsigned int)c;
        if (u < 0x80) s.push_back((char)u);
        else if (u < 0x800) {
            s.push_back((char)(0xC0 | (u >> 6)));
            s.push_back((char)(0x80 | (u & 0x3F)));
        } else {
            s.push_back((char)(0xE0 | (u >> 12)));
            s.push_back((char)(0x80 | ((u >> 6) & 0x3F)));
            s.push_back((char)(0x80 | (u & 0x3F)));
        }
    }
    return s;
}

static std::wstring fromUtf8(const std::string& s) {
    std::wstring w;
    w.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        unsigned char c = (unsigned char)s[i];
        if (c < 0x80) { w.push_back((wchar_t)c); ++i; }
        else if ((c & 0xE0) == 0xC0 && i + 1 < s.size()) {
            unsigned int u = ((c & 0x1F) << 6) | ((unsigned char)s[i + 1] & 0x3F);
            w.push_back((wchar_t)u);
            i += 2;
        } else if ((c & 0xF0) == 0xE0 && i + 2 < s.size()) {
            unsigned int u = ((c & 0x0F) << 12) | (((unsigned char)s[i + 1] & 0x3F) << 6) | ((unsigned char)s[i + 2] & 0x3F);
            w.push_back((wchar_t)u);
            i += 3;
        } else {
            ++i;
        }
    }
    return w;
}

static std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
    return s.substr(a, b - a);
}

bool SettingsManager::load(const std::wstring& path) {
#ifdef _WIN32
    FILE* f = _wfopen(path.c_str(), L"rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz < 0 || sz > 1024 * 1024) { fclose(f); return false; }
    std::string content((size_t)sz, '\0');
    if (sz) fread(content.data(), 1, (size_t)sz, f);
    fclose(f);
#else
    std::ifstream in(toUtf8(path));
    if (!in) return false;
    std::stringstream ss;
    ss << in.rdbuf();
    std::string content = ss.str();
#endif

    std::string section;
    std::map<std::string, std::string> kv;
    auto key = [&](const char* k) -> std::string {
        auto it = kv.find(std::string(k));
        return it == kv.end() ? std::string() : it->second;
    };
    auto asInt = [&](const char* k, int def) {
        std::string v = key(k);
        if (v.empty()) return def;
        return atoi(v.c_str());
    };

    std::string curSec;
    auto flush = [&]() {};
    (void)flush;

    std::istringstream ls(content);
    std::string line;
    auto apply = [&]() {
        if (curSec == "Audio") {
            data.audioDevice = fromUtf8(key("Device"));
            data.sampleRate = asInt("SampleRate", data.sampleRate);
            data.bufferSize = asInt("BufferSize", data.bufferSize);
            data.volumePct = clampi(asInt("Volume", data.volumePct), 0, 100);
            data.muted = asInt("Muted", data.muted ? 1 : 0) != 0;
        } else if (curSec == "Midi") {
            data.midiDevice = fromUtf8(key("Device"));
        } else if (curSec == "Piano") {
            data.instrument = clampi(asInt("Instrument", data.instrument), 0, 3);
            data.octave = clampi(asInt("Octave", data.octave), kMinOctave, kMaxOctave);
            data.sustain = asInt("Sustain", 0) != 0;
            data.velocityFromMouse = asInt("VelocityFromMouse", 1) != 0;
            data.defaultVelocity = clampi(asInt("DefaultVelocity", data.defaultVelocity), 1, 127);
        } else if (curSec == "Interface") {
            data.theme = clampi(asInt("Theme", data.theme), 0, 1);
            data.uiScale = asInt("Scale", data.uiScale);
            if (data.uiScale != 100 && data.uiScale != 125 && data.uiScale != 150)
                data.uiScale = 100;
            data.showKeyLabels = asInt("KeyLabels", 1) != 0;
            data.showComputerKeys = asInt("ComputerKeys", 1) != 0;
        } else if (curSec == "Metronome") {
            data.metroOn = asInt("Enabled", 0) != 0;
            data.metroBpm = clampi(asInt("BPM", data.metroBpm), 40, 240);
            data.metroVol = clampi(asInt("Volume", data.metroVol), 0, 100);
        } else if (curSec == "Window") {
            data.winX = asInt("X", data.winX);
            data.winY = asInt("Y", data.winY);
            data.winW = asInt("W", data.winW);
            data.winH = asInt("H", data.winH);
        } else if (curSec == "Keyboard") {
            std::string map = key("Map");
            if (!map.empty()) {
                data.resetKeyMap();
                for (int i = 0; i < 256; ++i) data.keyMap[i] = -1;
                // format: vk:offset,vk:offset
                size_t i = 0;
                while (i < map.size()) {
                    int vk = 0, off = 0;
                    bool neg = false;
                    while (i < map.size() && map[i] != ':' && map[i] != ',') {
                        if (map[i] >= '0' && map[i] <= '9') vk = vk * 10 + (map[i] - '0');
                        ++i;
                    }
                    if (i < map.size() && map[i] == ':') ++i;
                    if (i < map.size() && map[i] == '-') { neg = true; ++i; }
                    while (i < map.size() && map[i] != ',') {
                        if (map[i] >= '0' && map[i] <= '9') off = off * 10 + (map[i] - '0');
                        ++i;
                    }
                    if (neg) off = -off;
                    if (vk >= 0 && vk < 256) data.keyMap[vk] = off;
                    if (i < map.size() && map[i] == ',') ++i;
                }
            }
        }
        kv.clear();
    };

    while (std::getline(ls, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#' || line[0] == ';') continue;
        if (line.front() == '[' && line.back() == ']') {
            apply();
            curSec = line.substr(1, line.size() - 2);
            continue;
        }
        auto eq = line.find('=');
        if (eq == std::string::npos) continue;
        kv[trim(line.substr(0, eq))] = trim(line.substr(eq + 1));
    }
    apply();
    return true;
}

bool SettingsManager::save(const std::wstring& path) const {
    std::ostringstream o;
    o << "[Audio]\n";
    o << "Device=" << toUtf8(data.audioDevice) << "\n";
    o << "SampleRate=" << data.sampleRate << "\n";
    o << "BufferSize=" << data.bufferSize << "\n";
    o << "Volume=" << data.volumePct << "\n";
    o << "Muted=" << (data.muted ? 1 : 0) << "\n";
    o << "\n[Midi]\n";
    o << "Device=" << toUtf8(data.midiDevice) << "\n";
    o << "\n[Piano]\n";
    o << "Instrument=" << data.instrument << "\n";
    o << "Octave=" << data.octave << "\n";
    o << "Sustain=" << (data.sustain ? 1 : 0) << "\n";
    o << "VelocityFromMouse=" << (data.velocityFromMouse ? 1 : 0) << "\n";
    o << "DefaultVelocity=" << data.defaultVelocity << "\n";
    o << "\n[Keyboard]\nMap=";
    bool first = true;
    for (int i = 0; i < 256; ++i) {
        if (data.keyMap[i] >= 0) {
            if (!first) o << ",";
            first = false;
            o << i << ":" << data.keyMap[i];
        }
    }
    o << "\n\n[Interface]\n";
    o << "Theme=" << data.theme << "\n";
    o << "Scale=" << data.uiScale << "\n";
    o << "KeyLabels=" << (data.showKeyLabels ? 1 : 0) << "\n";
    o << "ComputerKeys=" << (data.showComputerKeys ? 1 : 0) << "\n";
    o << "\n[Metronome]\n";
    o << "Enabled=" << (data.metroOn ? 1 : 0) << "\n";
    o << "BPM=" << data.metroBpm << "\n";
    o << "Volume=" << data.metroVol << "\n";
    o << "\n[Window]\n";
    o << "X=" << data.winX << "\n";
    o << "Y=" << data.winY << "\n";
    o << "W=" << data.winW << "\n";
    o << "H=" << data.winH << "\n";

    std::string s = o.str();
#ifdef _WIN32
    FILE* f = _wfopen(path.c_str(), L"wb");
    if (!f) return false;
    fwrite(s.data(), 1, s.size(), f);
    fclose(f);
    return true;
#else
    std::ofstream out(toUtf8(path), std::ios::binary);
    if (!out) return false;
    out << s;
    return true;
#endif
}
