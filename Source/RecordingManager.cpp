#include "RecordingManager.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

uint64_t wallTimeMs() {
    using namespace std::chrono;
    return (uint64_t)duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

static std::string narrowPath(const std::wstring& p) {
    std::string s;
    s.reserve(p.size());
    for (wchar_t c : p) {
        if (c < 128) s.push_back((char)c);
        else s.push_back('?');
    }
    return s;
}

#ifdef _WIN32
static FILE* wfopen_utf16(const std::wstring& p, const wchar_t* mode) {
    return _wfopen(p.c_str(), mode);
}
#endif

void RecordingManager::clear() {
    events_.clear();
    lengthMs_ = 0;
    playIndex_ = 0;
    recording_ = false;
    playing_ = false;
}

void RecordingManager::start() {
    events_.clear();
    lengthMs_ = 0;
    playIndex_ = 0;
    playing_ = false;
    recording_ = true;
    recStartMs_ = wallTimeMs();
}

void RecordingManager::stop() {
    if (recording_) {
        lengthMs_ = nowRecMs();
        recording_ = false;
    }
    playing_ = false;
}

uint32_t RecordingManager::nowRecMs() const {
    uint64_t t = wallTimeMs();
    if (t < recStartMs_) return 0;
    return (uint32_t)(t - recStartMs_);
}

uint32_t RecordingManager::elapsedMs() const {
    if (recording_) return nowRecMs();
    if (playing_) {
        uint64_t t = wallTimeMs();
        uint32_t e = playOffsetMs_ + (uint32_t)(t - playStartMs_);
        return e;
    }
    return 0;
}

void RecordingManager::startPlayback() {
    if (events_.empty()) return;
    recording_ = false;
    playing_ = true;
    playIndex_ = 0;
    playOffsetMs_ = 0;
    playStartMs_ = wallTimeMs();
}

void RecordingManager::stopPlayback() {
    playing_ = false;
    playIndex_ = 0;
}

void RecordingManager::seekPlayback(uint32_t ms) {
    playOffsetMs_ = ms;
    playStartMs_ = wallTimeMs();
    playIndex_ = 0;
    while (playIndex_ < (int)events_.size() && events_[playIndex_].timeMs < ms)
        ++playIndex_;
}

void RecordingManager::resetPlayhead() {
    playIndex_ = 0;
}

void RecordingManager::recordNoteOn(int note, int vel) {
    if (!recording_) return;
    RecEvent e;
    e.timeMs = nowRecMs();
    e.status = 0x90;
    e.data1 = (uint8_t)clampi(note, 0, 127);
    e.data2 = (uint8_t)clampi(vel, 1, 127);
    events_.push_back(e);
}

void RecordingManager::recordNoteOff(int note, int vel) {
    if (!recording_) return;
    RecEvent e;
    e.timeMs = nowRecMs();
    e.status = 0x80;
    e.data1 = (uint8_t)clampi(note, 0, 127);
    e.data2 = (uint8_t)clampi(vel, 0, 127);
    events_.push_back(e);
}

void RecordingManager::recordSustain(bool on) {
    if (!recording_) return;
    RecEvent e;
    e.timeMs = nowRecMs();
    e.status = 0xB0;
    e.data1 = 64;
    e.data2 = on ? 127 : 0;
    events_.push_back(e);
}

void RecordingManager::recordProgram(int program) {
    if (!recording_) return;
    RecEvent e;
    e.timeMs = nowRecMs();
    e.status = 0xC0;
    e.data1 = (uint8_t)clampi(program, 0, 127);
    e.data2 = 0;
    events_.push_back(e);
}

int RecordingManager::dequeueDue(uint32_t nowMs, RecEvent* out, int maxOut) {
    if (!playing_ || !out || maxOut <= 0) return 0;
    int n = 0;
    while (playIndex_ < (int)events_.size() && n < maxOut) {
        if (events_[playIndex_].timeMs > nowMs) break;
        out[n++] = events_[playIndex_++];
    }
    if (playIndex_ >= (int)events_.size() && nowMs >= lengthMs_) {
        playing_ = false;
    }
    return n;
}

static void writeU16BE(std::vector<uint8_t>& d, uint16_t v) {
    d.push_back((uint8_t)(v >> 8));
    d.push_back((uint8_t)(v));
}
static void writeU32BE(std::vector<uint8_t>& d, uint32_t v) {
    d.push_back((uint8_t)(v >> 24));
    d.push_back((uint8_t)(v >> 16));
    d.push_back((uint8_t)(v >> 8));
    d.push_back((uint8_t)(v));
}
static void writeVar(std::vector<uint8_t>& d, uint32_t v) {
    uint8_t buf[5];
    int n = 0;
    buf[n++] = (uint8_t)(v & 0x7f);
    v >>= 7;
    while (v) {
        buf[n++] = (uint8_t)((v & 0x7f) | 0x80);
        v >>= 7;
    }
    while (n) d.push_back(buf[--n]);
}

bool RecordingManager::saveMidi(const std::wstring& path, int instrumentProgram, std::wstring& err) const {
    err.clear();
    const int tpq = 480;
    // 1 tick = 1 ms at tempo 500000 and... wait:
    // us per tick = tempo / tpq. For 1ms/tick: tempo/tpq = 1000, tempo = 480000
    // Use tempo 500000 (120 BPM) and convert ms -> ticks.
    // ticks = ms * tpq / (tempo/1000) = ms * 480 / 500 = ms * 0.96
    // Better: set tempo so 1 tick = 1ms: tempo_us_per_qn = 1000 * tpq = 480000
    const uint32_t tempo = 480000; // 1 tick = 1 ms

    std::vector<uint8_t> trk;
    auto put = [&](uint32_t delta, const uint8_t* msg, int len) {
        writeVar(trk, delta);
        for (int i = 0; i < len; ++i) trk.push_back(msg[i]);
    };

    // Tempo meta
    {
        writeVar(trk, 0);
        trk.push_back(0xFF);
        trk.push_back(0x51);
        trk.push_back(0x03);
        trk.push_back((uint8_t)(tempo >> 16));
        trk.push_back((uint8_t)(tempo >> 8));
        trk.push_back((uint8_t)tempo);
    }
    // Track name
    {
        const char* name = "Piano Pro Performance";
        writeVar(trk, 0);
        trk.push_back(0xFF);
        trk.push_back(0x03);
        trk.push_back((uint8_t)strlen(name));
        for (const char* p = name; *p; ++p) trk.push_back((uint8_t)*p);
    }
    // Program change
    {
        uint8_t msg[2] = { 0xC0, (uint8_t)clampi(instrumentProgram, 0, 127) };
        put(0, msg, 2);
    }

    uint32_t last = 0;
    for (const RecEvent& e : events_) {
        uint32_t t = e.timeMs; // 1 tick = 1 ms
        uint32_t delta = (t >= last) ? (t - last) : 0;
        last = t;
        if ((e.status & 0xF0) == 0xC0) {
            uint8_t msg[2] = { e.status, e.data1 };
            put(delta, msg, 2);
        } else {
            uint8_t msg[3] = { e.status, e.data1, e.data2 };
            put(delta, msg, 3);
        }
    }
    // End of track
    writeVar(trk, 0);
    trk.push_back(0xFF);
    trk.push_back(0x2F);
    trk.push_back(0x00);

    std::vector<uint8_t> file;
    file.insert(file.end(), { 'M','T','h','d' });
    writeU32BE(file, 6);
    writeU16BE(file, 0);     // format 0
    writeU16BE(file, 1);     // 1 track
    writeU16BE(file, (uint16_t)tpq);
    file.insert(file.end(), { 'M','T','r','k' });
    writeU32BE(file, (uint32_t)trk.size());
    file.insert(file.end(), trk.begin(), trk.end());

#ifdef _WIN32
    FILE* f = wfopen_utf16(path, L"wb");
    if (!f) {
        err = L"Could not write MIDI file. Check the path and permissions.";
        return false;
    }
    size_t w = fwrite(file.data(), 1, file.size(), f);
    fclose(f);
    if (w != file.size()) {
        err = L"Failed to write the complete MIDI file.";
        return false;
    }
#else
    std::ofstream f(narrowPath(path), std::ios::binary);
    if (!f) {
        err = L"Could not write MIDI file.";
        return false;
    }
    f.write((const char*)file.data(), (std::streamsize)file.size());
#endif
    return true;
}

static uint16_t rdU16BE(const uint8_t*& p, const uint8_t* end, bool& ok) {
    if (p + 2 > end) { ok = false; return 0; }
    uint16_t v = (uint16_t)((p[0] << 8) | p[1]);
    p += 2;
    return v;
}
static uint32_t rdU32BE(const uint8_t*& p, const uint8_t* end, bool& ok) {
    if (p + 4 > end) { ok = false; return 0; }
    uint32_t v = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
    p += 4;
    return v;
}
static uint32_t rdVar(const uint8_t*& p, const uint8_t* end, bool& ok) {
    uint32_t v = 0;
    for (int i = 0; i < 4; ++i) {
        if (p >= end) { ok = false; return 0; }
        uint8_t b = *p++;
        v = (v << 7) | (uint32_t)(b & 0x7f);
        if ((b & 0x80) == 0) return v;
    }
    ok = false;
    return 0;
}

bool RecordingManager::loadMidi(const std::wstring& path, std::wstring& err) {
    err.clear();
    std::vector<uint8_t> data;
#ifdef _WIN32
    FILE* f = wfopen_utf16(path, L"rb");
    if (!f) {
        err = L"Could not open MIDI file.";
        return false;
    }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz < 8 || sz > 8 * 1024 * 1024) {
        fclose(f);
        err = L"Invalid MIDI file.";
        return false;
    }
    data.resize((size_t)sz);
    if (fread(data.data(), 1, (size_t)sz, f) != (size_t)sz) {
        fclose(f);
        err = L"Failed to read MIDI file.";
        return false;
    }
    fclose(f);
#else
    std::ifstream f(narrowPath(path), std::ios::binary);
    if (!f) {
        err = L"Could not open MIDI file.";
        return false;
    }
    data.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
#endif

    if (data.size() < 14 || memcmp(data.data(), "MThd", 4) != 0) {
        err = L"Not a valid MIDI file (missing MThd).";
        return false;
    }
    bool ok = true;
    const uint8_t* p = data.data();
    const uint8_t* end = p + data.size();
    p += 4;
    uint32_t hdrLen = rdU32BE(p, end, ok);
    uint16_t fmt = rdU16BE(p, end, ok);
    uint16_t ntr = rdU16BE(p, end, ok);
    uint16_t div = rdU16BE(p, end, ok);
    if (!ok || ntr < 1 || ntr > 64 || (fmt > 2)) {
        err = L"Unsupported or corrupt MIDI header.";
        return false;
    }
    if (hdrLen > 6) p += (hdrLen - 6);
    if (div & 0x8000) {
        err = L"SMPTE-timed MIDI files are not supported.";
        return false;
    }
    const int tpq = div ? div : 480;

    std::vector<RecEvent> evs;
    uint32_t maxMs = 0;
    // Default tempo 120 BPM = 500000 us / quarter
    double usPerTick = 500000.0 / (double)tpq;

    for (int t = 0; t < ntr; ++t) {
        if (p + 8 > end) break;
        if (memcmp(p, "MTrk", 4) != 0) {
            // skip unknown chunk
            p += 4;
            uint32_t ln = rdU32BE(p, end, ok);
            if (!ok || p + ln > end) break;
            p += ln;
            --t;
            continue;
        }
        p += 4;
        uint32_t ln = rdU32BE(p, end, ok);
        if (!ok || p + ln > end) {
            err = L"Truncated MIDI track.";
            return false;
        }
        const uint8_t* tp = p;
        const uint8_t* te = p + ln;
        p += ln;
        uint32_t ticks = 0;
        uint8_t running = 0;
        double usPerTickTrack = usPerTick;
        while (tp < te && ok) {
            uint32_t dt = rdVar(tp, te, ok);
            if (!ok) break;
            ticks += dt;
            if (tp >= te) break;
            uint8_t b = *tp;
            uint8_t status;
            if (b & 0x80) {
                status = b;
                ++tp;
                if ((status & 0xF0) != 0xF0) running = status;
            } else {
                if (!running) { ok = false; break; }
                status = running;
            }
            const uint32_t ms = (uint32_t)((ticks * usPerTickTrack) / 1000.0 + 0.5);
            const uint8_t st = (uint8_t)(status & 0xF0);
            if (status == 0xFF) {
                if (tp >= te) break;
                uint8_t type = *tp++;
                uint32_t ml = rdVar(tp, te, ok);
                if (!ok || tp + ml > te) { ok = false; break; }
                if (type == 0x51 && ml == 3) {
                    uint32_t tempo = ((uint32_t)tp[0] << 16) | ((uint32_t)tp[1] << 8) | tp[2];
                    if (tempo > 0) usPerTickTrack = (double)tempo / (double)tpq;
                }
                if (type == 0x2F) { tp += ml; break; }
                tp += ml;
            } else if (status == 0xF0 || status == 0xF7) {
                uint32_t ml = rdVar(tp, te, ok);
                if (!ok || tp + ml > te) { ok = false; break; }
                tp += ml;
            } else if (st == 0xC0 || st == 0xD0) {
                if (tp >= te) { ok = false; break; }
                uint8_t d1 = *tp++;
                RecEvent e { ms, status, d1, 0 };
                if (st == 0xC0) evs.push_back(e);
            } else if (st == 0x80 || st == 0x90 || st == 0xA0 || st == 0xB0 || st == 0xE0) {
                if (tp + 1 >= te) { ok = false; break; }
                uint8_t d1 = *tp++;
                uint8_t d2 = *tp++;
                if (st == 0x90 && d2 == 0) {
                    // note-on vel 0 = note off
                    RecEvent e { ms, (uint8_t)(0x80 | (status & 0x0F)), d1, 0 };
                    evs.push_back(e);
                } else if (st == 0x80 || st == 0x90 || (st == 0xB0 && d1 == 64)) {
                    RecEvent e { ms, status, d1, d2 };
                    evs.push_back(e);
                }
            } else {
                ok = false;
                break;
            }
            if (ms > maxMs) maxMs = ms;
        }
        usPerTick = usPerTickTrack; // last tempo (good enough)
    }

    if (!ok && evs.empty()) {
        err = L"Invalid MIDI file.";
        return false;
    }

    std::sort(evs.begin(), evs.end(), [](const RecEvent& a, const RecEvent& b) {
        return a.timeMs < b.timeMs;
    });
    events_ = std::move(evs);
    lengthMs_ = maxMs;
    playIndex_ = 0;
    recording_ = false;
    playing_ = false;
    return true;
}
