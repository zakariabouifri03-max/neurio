#ifdef _WIN32

#include "App.h"

#include <commdlg.h>
#include <dwmapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <cstdio>
#include <cmath>

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

enum UiId {
    ID_NONE = 0,
    ID_INST, ID_OCTDN, ID_OCTUP, ID_VOL, ID_MUTE, ID_GEAR,
    ID_REC, ID_STOP, ID_PLAY, ID_OPEN, ID_SAVE,
    ID_SUS, ID_METRO, ID_BPMDN, ID_BPMUP, ID_PRAC,
    ID_PRAC_TEXT,
    ID_INST_ITEM = 80, // +0..3
    ID_S_AUDIO = 200, ID_S_SR, ID_S_BUF, ID_S_MIDI,
    ID_S_THEME, ID_S_SCALE, ID_S_VEL, ID_S_LAB, ID_S_COMP,
    ID_S_APPLY, ID_S_RESETMAP, ID_S_CLOSE, ID_S_DEFVEL,
    ID_S_AUDIO_ITEM = 300,
    ID_S_MIDI_ITEM  = 400,
    ID_S_SR_ITEM    = 500,
    ID_S_BUF_ITEM   = 520,
};

static App* g_app = nullptr;

App& App::instance() {
    static App a;
    return a;
}

static int px(float s, int v) { return (int)(v * s + 0.5f); }

static bool hit(const RECT& r, int x, int y) {
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

static RECT inset(RECT r, int dx, int dy) {
    r.left += dx; r.right -= dx; r.top += dy; r.bottom -= dy;
    return r;
}

static void fillR(HDC hdc, RECT r, COLORREF c) {
    HBRUSH b = CreateSolidBrush(c);
    FillRect(hdc, &r, b);
    DeleteObject(b);
}

static void roundR(HDC hdc, RECT r, COLORREF c, int rad) {
    HBRUSH b = CreateSolidBrush(c);
    HPEN p = CreatePen(PS_SOLID, 1, c);
    HGDIOBJ ob = SelectObject(hdc, b);
    HGDIOBJ op = SelectObject(hdc, p);
    RoundRect(hdc, r.left, r.top, r.right, r.bottom, rad, rad);
    SelectObject(hdc, ob);
    SelectObject(hdc, op);
    DeleteObject(b);
    DeleteObject(p);
}

static void roundStroke(HDC hdc, RECT r, COLORREF fill, COLORREF stroke, int rad, int w) {
    HBRUSH b = CreateSolidBrush(fill);
    HPEN p = CreatePen(PS_SOLID, w, stroke);
    HGDIOBJ ob = SelectObject(hdc, b);
    HGDIOBJ op = SelectObject(hdc, p);
    RoundRect(hdc, r.left, r.top, r.right, r.bottom, rad, rad);
    SelectObject(hdc, ob);
    SelectObject(hdc, op);
    DeleteObject(b);
    DeleteObject(p);
}

static void textR(HDC hdc, RECT r, const wchar_t* s, COLORREF c, UINT fmt) {
    SetTextColor(hdc, c);
    SetBkMode(hdc, TRANSPARENT);
    DrawTextW(hdc, s, -1, &r, fmt | DT_SINGLELINE | DT_NOPREFIX);
}

static HFONT mkFont(int px, int weight) {
    return CreateFontW(-px, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET,
                       0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
}

static void drawBtn(HDC hdc, RECT r, const wchar_t* label, const Theme& th,
                    bool hot, bool down, bool lit, bool danger, float s) {
    COLORREF fill = th.panelAlt;
    COLORREF fg = th.text;
    if (lit) {
        fill = danger ? th.danger : th.accent;
        fg = danger ? RGB(255, 255, 255) : RGB(28, 22, 8);
    } else if (down) {
        fill = th.stroke;
    } else if (hot) {
        fill = lerpColor(th.panelAlt, th.accent, 0.18f);
    }
    roundR(hdc, r, fill, px(s, 8));
    textR(hdc, r, label, fg, DT_CENTER | DT_VCENTER);
}

static void drawToggle(HDC hdc, RECT r, const wchar_t* label, bool on,
                       const Theme& th, bool hot, float s) {
    drawBtn(hdc, r, label, th, hot, false, on, false, s);
}

int App::run(HINSTANCE hInst, int nCmdShow) {
    g_app = this;
    hInst_ = hInst;
    loadSettings();
    theme_ = makeTheme(cfg_.data.theme != 0);

    if (!createMain(hInst, nCmdShow))
        return 1;

    std::wstring err;
    audioOk_ = startAudio(err);
    if (!audioOk_) {
        MessageBoxW(hwnd_, err.c_str(), L"Piano Pro", MB_OK | MB_ICONWARNING);
    }

    engine_.setInstrument(cfg_.data.instrument);
    engine_.setMasterGain(cfg_.data.volumePct / 100.0f);
    engine_.setMuted(cfg_.data.muted);
    engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
    if (cfg_.data.sustain) setSustain(true);

    midi_.setNoteCallback([this](int n, int v, bool on) {
        if (on) pressNote(n, v, SRC_MIDI);
        else releaseNote(n, SRC_MIDI);
    });
    midi_.setSustainCallback([this](bool on) { setSustain(on); });
    midi_.setDisconnectCallback([this] {
        statusMsg_ = L"MIDI device disconnected.";
        statusUntil_ = wallTimeMs() + 4000;
        if (hwnd_) PostMessageW(hwnd_, WM_USER + 2, 0, 0);
    });

    if (!cfg_.data.midiDevice.empty()) {
        auto devs = midi_.enumerate();
        for (auto& d : devs) {
            if (d.name == cfg_.data.midiDevice) {
                std::wstring e;
                midi_.open(d.index, e);
                break;
            }
        }
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    saveSettings();
    audio_.stop();
    midi_.close();
    return (int)msg.wParam;
}

bool App::createMain(HINSTANCE hInst, int nCmdShow) {
    WNDCLASSEXW wc {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc = wndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    wc.lpszClassName = L"PianoProMain";
    wc.hIcon = LoadIcon(nullptr, IDI_APPLICATION);
    wc.hIconSm = wc.hIcon;
    RegisterClassExW(&wc);

    WNDCLASSEXW ws = wc;
    ws.lpfnWndProc = settingsProc;
    ws.lpszClassName = L"PianoProSettings";
    RegisterClassExW(&ws);

    int x = cfg_.data.winX, y = cfg_.data.winY, w = cfg_.data.winW, h = cfg_.data.winH;
    if (w < 900) w = 1280;
    if (h < 560) h = 760;
    DWORD pos = (x == AppSettings::CW_USEDEFAULT_SENTINEL) ? (DWORD)CW_USEDEFAULT : 0;
    hwnd_ = CreateWindowExW(0, L"PianoProMain", L"Piano Pro",
                            WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                            pos ? CW_USEDEFAULT : x,
                            pos ? CW_USEDEFAULT : y,
                            w, h, nullptr, nullptr, hInst, this);
    if (!hwnd_) return false;
    {
        wchar_t ipath[MAX_PATH];
        GetModuleFileNameW(nullptr, ipath, MAX_PATH);
        PathRemoveFileSpecW(ipath);
        PathAppendW(ipath, L"assets\\icons\\pianopro.ico");
        HICON hi = (HICON)LoadImageW(nullptr, ipath, IMAGE_ICON, 0, 0,
                                     LR_LOADFROMFILE | LR_DEFAULTSIZE);
        if (hi) {
            SendMessageW(hwnd_, WM_SETICON, ICON_BIG, (LPARAM)hi);
            SendMessageW(hwnd_, WM_SETICON, ICON_SMALL, (LPARAM)hi);
        }
    }
    applyThemeToWindow(hwnd_);
    ShowWindow(hwnd_, nCmdShow);
    UpdateWindow(hwnd_);
    timer_ = SetTimer(hwnd_, 1, 16, nullptr);
    return true;
}

void App::applyThemeToWindow(HWND h) {
    BOOL dark = theme_.light ? FALSE : TRUE;
    DwmSetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
}

LRESULT CALLBACK App::wndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_NCCREATE) {
        auto* cs = (CREATESTRUCTW*)l;
        SetWindowLongPtrW(h, GWLP_USERDATA, (LONG_PTR)cs->lpCreateParams);
    }
    App* self = (App*)GetWindowLongPtrW(h, GWLP_USERDATA);
    if (self) return self->handle(h, m, w, l);
    return DefWindowProcW(h, m, w, l);
}

LRESULT CALLBACK App::settingsProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    App* self = g_app;
    if (self) return self->handleSettings(h, m, w, l);
    return DefWindowProcW(h, m, w, l);
}

void App::computeLayout() {
    GetClientRect(hwnd_, &rcClient_);
    dpi_ = 96;
    {
        using FnDpi = UINT (WINAPI*)(HWND);
        static FnDpi getDpi = nullptr;
        static bool tried = false;
        if (!tried) {
            tried = true;
            HMODULE user = GetModuleHandleW(L"user32.dll");
            if (user) getDpi = (FnDpi)GetProcAddress(user, "GetDpiForWindow");
        }
        if (getDpi) {
            UINT d = getDpi(hwnd_);
            if (d > 0) dpi_ = (int)d;
        }
    }
    scale_ = (dpi_ / 96.0f) * (cfg_.data.uiScale / 100.0f);
    const float S = scale_;
    const int W = rcClient_.right, H = rcClient_.bottom;
    const int topH = px(S, 64);
    const int stH  = px(S, 34);
    const int botH = px(S, 78);
    rcTop_    = { 0, 0, W, topH };
    rcStatus_ = { 0, topH, W, topH + stH };
    rcBottom_ = { 0, H - botH, W, H };
    rcPiano_  = { 0, rcStatus_.bottom, W, rcBottom_.top };

    int x = px(S, 16);
    int cy = (topH - px(S, 36)) / 2;
    rcLogo_ = { x, cy, x + px(S, 150), cy + px(S, 36) };
    x = rcLogo_.right + px(S, 12);
    rcInst_ = { x, cy, x + px(S, 170), cy + px(S, 36) };
    x = rcInst_.right + px(S, 16);
    rcOctDn_ = { x, cy, x + px(S, 36), cy + px(S, 36) };
    rcOct_   = { rcOctDn_.right, cy, rcOctDn_.right + px(S, 86), cy + px(S, 36) };
    rcOctUp_ = { rcOct_.right, cy, rcOct_.right + px(S, 36), cy + px(S, 36) };
    x = rcOctUp_.right + px(S, 16);
    rcVol_ = { x, cy, x + px(S, 160), cy + px(S, 36) };
    rcMute_ = { rcVol_.right + px(S, 8), cy, rcVol_.right + px(S, 70), cy + px(S, 36) };
    rcGear_ = { W - px(S, 120), cy, W - px(S, 16), cy + px(S, 36) };

    rcNote_ = { px(S, 16), rcStatus_.top, px(S, 220), rcStatus_.bottom };
    rcMidi_ = { px(S, 230), rcStatus_.top, px(S, 520), rcStatus_.bottom };
    rcInfo_ = { px(S, 530), rcStatus_.top, W - px(S, 16), rcStatus_.bottom };

    int by = rcBottom_.top + px(S, 16);
    int bh = px(S, 46);
    x = px(S, 16);
    auto place = [&](RECT& r, int wdt) {
        r = { x, by, x + wdt, by + bh };
        x += wdt + px(S, 8);
    };
    place(rcRec_, px(S, 100));
    place(rcStop_, px(S, 80));
    place(rcPlay_, px(S, 80));
    place(rcOpen_, px(S, 80));
    place(rcSave_, px(S, 80));
    x += px(S, 12);
    place(rcSus_, px(S, 100));
    place(rcMetro_, px(S, 110));
    place(rcBpmDn_, px(S, 32));
    place(rcBpm_, px(S, 56));
    // fix bpm rect after bpmDn
    rcBpm_ = { rcBpmDn_.right, by, rcBpmDn_.right + px(S, 56), by + bh };
    rcBpmUp_ = { rcBpm_.right, by, rcBpm_.right + px(S, 32), by + bh };
    x = rcBpmUp_.right + px(S, 12);
    place(rcPrac_, px(S, 100));

    kbd_.layout(inset(rcPiano_, px(S, 12), px(S, 8)));
}

int App::midiFromVk(int vk) const {
    if (vk < 0 || vk > 255) return -1;
    int off = cfg_.data.keyMap[vk];
    if (off < 0) return -1;
    int midi = 12 * (cfg_.data.octave + 1) + off;
    if (midi < kMinNote || midi > kMaxNote) return -1;
    return midi;
}

float App::mouseVelocity(int midi, int y) const {
    if (!cfg_.data.velocityFromMouse) return cfg_.data.defaultVelocity / 127.0f;
    const KeyGeom* g = kbd_.key(midi);
    if (!g) return 0.8f;
    const int h = g->rc.bottom - g->rc.top;
    if (h <= 1) return 0.8f;
    float t = (float)(y - g->rc.top) / (float)h;
    t = clampf(t, 0.0f, 1.0f);
    return 0.25f + 0.75f * t;
}

void App::pressNote(int midi, int vel127, int source) {
    if (midi < kMinNote || midi > kMaxNote) return;
    vel127 = clampi(vel127, 1, 127);
    holdCount_[midi] += 1;
    engine_.noteOn(midi, vel127 / 127.0f);
    lastNote_ = midi;
    if (rec_.isRecording() && source != SRC_PLAY)
        rec_.recordNoteOn(midi, vel127);
    if (practiceOn_ && source != SRC_PLAY)
        practiceAdvance(midi);
}

void App::releaseNote(int midi, int /*source*/) {
    if (midi < 0 || midi > 127) return;
    if (holdCount_[midi] <= 0) return;
    holdCount_[midi] -= 1;
    if (holdCount_[midi] == 0) {
        engine_.noteOff(midi);
        if (rec_.isRecording())
            rec_.recordNoteOff(midi, 0);
    }
}

void App::releaseSource(int /*source*/) {
    // Used for mouse: release the current mouse note
}

void App::releaseAllComputerKeys() {
    for (int vk = 0; vk < 256; ++vk) {
        if (!keyDown_[vk]) continue;
        keyDown_[vk] = false;
        int m = midiFromVk(vk);
        if (m >= 0) releaseNote(m, SRC_KBD);
    }
    if (mouseNote_ >= 0) {
        releaseNote(mouseNote_, SRC_MOUSE);
        mouseNote_ = -1;
        mouseDown_ = false;
    }
}

void App::setOctave(int oct) {
    oct = clampi(oct, kMinOctave, kMaxOctave);
    // Releasing computer keys that would go out of range
    releaseAllComputerKeys();
    cfg_.data.octave = oct;
}

void App::setSustain(bool on) {
    const bool prev = engine_.sustain();
    engine_.setSustain(on);
    if (rec_.isRecording() && prev != on)
        rec_.recordSustain(on);
}

void App::toggleSustain() {
    cfg_.data.sustain = !cfg_.data.sustain;
    setSustain(cfg_.data.sustain || spaceSustain_);
}

void App::applyInstrument(int id) {
    id = clampi(id, 0, 3);
    cfg_.data.instrument = id;
    engine_.setInstrument(id);
}

void App::applyVolume() {
    engine_.setMasterGain(cfg_.data.volumePct / 100.0f);
    engine_.setMuted(cfg_.data.muted);
}

bool App::startAudio(std::wstring& err) {
    audio_.setRenderCallback([this](float* s, int n) {
        // Playback events sample-accurate-ish at buffer granularity
        if (rec_.isPlaying()) {
            RecEvent ev[48];
            int ne = rec_.dequeueDue(rec_.elapsedMs(), ev, 48);
            for (int i = 0; i < ne; ++i) {
                uint8_t st = ev[i].status & 0xF0;
                if (st == 0x90) pressNote(ev[i].data1, ev[i].data2, SRC_PLAY);
                else if (st == 0x80) releaseNote(ev[i].data1, SRC_PLAY);
                else if (st == 0xB0 && ev[i].data1 == 64)
                    engine_.setSustain(ev[i].data2 >= 64);
            }
        }
        engine_.process(s, n);
    });
    engine_.setSampleRate((double)cfg_.data.sampleRate);
    bool ok = audio_.start(cfg_.data.audioDevice, cfg_.data.sampleRate, cfg_.data.bufferSize, err);
    if (ok)
        engine_.setSampleRate((double)audio_.sampleRate());
    return ok;
}

void App::startRecord() {
    if (rec_.isPlaying()) {
        rec_.stopPlayback();
        engine_.panic();
        memset(holdCount_, 0, sizeof(holdCount_));
    }
    rec_.start();
    rec_.recordProgram(instrumentMidiProgram(cfg_.data.instrument));
    rec_.recordSustain(cfg_.data.sustain);
    statusMsg_ = L"Recording...";
    statusUntil_ = 0;
}

void App::stopTransport() {
    if (rec_.isRecording()) rec_.stop();
    if (rec_.isPlaying()) {
        rec_.stopPlayback();
        engine_.panic();
        memset(holdCount_, 0, sizeof(holdCount_));
        engine_.setSustain(cfg_.data.sustain);
    }
}

void App::startPlay() {
    if (rec_.isRecording()) rec_.stop();
    if (rec_.empty()) {
        statusMsg_ = L"Nothing to play. Record a performance first.";
        statusUntil_ = wallTimeMs() + 3000;
        return;
    }
    engine_.panic();
    memset(holdCount_, 0, sizeof(holdCount_));
    rec_.startPlayback();
}

static bool fileDlg(HWND owner, bool save, std::wstring& path) {
    wchar_t file[MAX_PATH];
    if (save)
        wcsncpy(file, L"My_Piano_Song.mid", MAX_PATH);
    else
        file[0] = 0;
    OPENFILENAMEW ofn {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = L"MIDI files (*.mid)\0*.mid;*.midi\0All files\0*.*\0";
    ofn.lpstrFile = file;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrDefExt = L"mid";
    ofn.Flags = OFN_EXPLORER | OFN_OVERWRITEPROMPT | OFN_HIDEREADONLY | OFN_NOCHANGEDIR;
    BOOL ok = save ? GetSaveFileNameW(&ofn) : GetOpenFileNameW(&ofn);
    if (!ok) return false;
    path = file;
    return true;
}

void App::saveMidi() {
    if (rec_.empty()) {
        statusMsg_ = L"Nothing to save. Record a performance first.";
        statusUntil_ = wallTimeMs() + 3000;
        return;
    }
    std::wstring path;
    if (!fileDlg(hwnd_, true, path)) return;
    std::wstring err;
    if (!rec_.saveMidi(path, instrumentMidiProgram(cfg_.data.instrument), err)) {
        MessageBoxW(hwnd_, err.c_str(), L"Piano Pro", MB_OK | MB_ICONERROR);
        return;
    }
    statusMsg_ = L"Saved MIDI file.";
    statusUntil_ = wallTimeMs() + 3000;
}

void App::openMidi() {
    std::wstring path;
    if (!fileDlg(hwnd_, false, path)) return;
    std::wstring err;
    if (!rec_.loadMidi(path, err)) {
        MessageBoxW(hwnd_, err.c_str(), L"Piano Pro", MB_OK | MB_ICONERROR);
        return;
    }
    statusMsg_ = L"Loaded MIDI file. Press Play.";
    statusUntil_ = wallTimeMs() + 4000;
}

bool App::parsePractice(const std::wstring& text) {
    practiceSeq_.clear();
    std::string u;
    u.reserve(text.size());
    for (wchar_t c : text) {
        if (c < 128) u.push_back((char)c);
        else u.push_back(' ');
    }
    size_t i = 0;
    while (i < u.size()) {
        while (i < u.size() && (u[i] == ' ' || u[i] == '\t' || u[i] == ',' || u[i] == '>' || u[i] == '-' || u[i] == '\n')) ++i;
        if (i >= u.size()) break;
        size_t j = i;
        while (j < u.size() && u[j] != ' ' && u[j] != '\t' && u[j] != ',' && u[j] != '>' && u[j] != '\n') ++j;
        std::string tok = u.substr(i, j - i);
        int n = parseNoteName(tok.c_str());
        if (n >= 0) practiceSeq_.push_back(n);
        i = j;
    }
    practiceIdx_ = 0;
    return !practiceSeq_.empty();
}

void App::practiceAdvance(int midi) {
    if (!practiceOn_ || practiceSeq_.empty()) return;
    if (practiceIdx_ < (int)practiceSeq_.size() && midi == practiceSeq_[practiceIdx_]) {
        ++practiceIdx_;
        if (practiceIdx_ >= (int)practiceSeq_.size()) {
            statusMsg_ = L"Practice complete.";
            statusUntil_ = wallTimeMs() + 3000;
            practiceOn_ = false;
        }
    }
}

std::wstring App::appDataDir() const {
    wchar_t path[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, path)))
        return L".";
    PathAppendW(path, L"PianoPro");
    CreateDirectoryW(path, nullptr);
    return path;
}

std::wstring App::settingsPath() const {
    std::wstring d = appDataDir();
    wchar_t p[MAX_PATH];
    wcsncpy(p, d.c_str(), MAX_PATH);
    PathAppendW(p, L"settings.ini");
    return p;
}

void App::loadSettings() {
    cfg_.load(settingsPath());
}

void App::saveSettings() {
    if (hwnd_) {
        RECT wr;
        GetWindowRect(hwnd_, &wr);
        cfg_.data.winX = wr.left;
        cfg_.data.winY = wr.top;
        cfg_.data.winW = wr.right - wr.left;
        cfg_.data.winH = wr.bottom - wr.top;
    }
    cfg_.save(settingsPath());
}

void App::refreshDeviceLists() {
    audioDevs_ = audio_.enumerate();
    midiDevs_ = midi_.enumerate();
    setAudioSel_ = 0;
    for (int i = 0; i < (int)audioDevs_.size(); ++i) {
        if (audioDevs_[i].id == cfg_.data.audioDevice ||
            (cfg_.data.audioDevice.empty() && audioDevs_[i].isDefault)) {
            setAudioSel_ = i + 1; // 0 = default
            break;
        }
    }
    if (cfg_.data.audioDevice.empty()) setAudioSel_ = 0;
    setMidiSel_ = 0;
    for (int i = 0; i < (int)midiDevs_.size(); ++i) {
        if (midiDevs_[i].name == cfg_.data.midiDevice)
            setMidiSel_ = i + 1;
    }
    static const int srs[] = { 44100, 48000, 96000 };
    setSrSel_ = 0;
    for (int i = 0; i < 3; ++i) if (srs[i] == cfg_.data.sampleRate) setSrSel_ = i;
    static const int bufs[] = { 128, 256, 512, 1024 };
    setBufSel_ = 1;
    for (int i = 0; i < 4; ++i) if (bufs[i] == cfg_.data.bufferSize) setBufSel_ = i;
    setTheme_ = cfg_.data.theme;
    setScale_ = cfg_.data.uiScale;
    setVelMouse_ = cfg_.data.velocityFromMouse;
    setLabels_ = cfg_.data.showKeyLabels;
    setCompKeys_ = cfg_.data.showComputerKeys;
    setDefVel_ = cfg_.data.defaultVelocity;
}

void App::openSettings() {
    refreshDeviceLists();
    comboOpen_ = 0;
    if (hwndSet_ && IsWindow(hwndSet_)) {
        ShowWindow(hwndSet_, SW_SHOW);
        SetForegroundWindow(hwndSet_);
        InvalidateRect(hwndSet_, nullptr, FALSE);
        return;
    }
    hwndSet_ = CreateWindowExW(WS_EX_DLGMODALFRAME, L"PianoProSettings", L"Settings — Piano Pro",
                               WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                               CW_USEDEFAULT, CW_USEDEFAULT, px(scale_, 560), px(scale_, 700),
                               hwnd_, nullptr, hInst_, nullptr);
    applyThemeToWindow(hwndSet_);
    ShowWindow(hwndSet_, SW_SHOW);
}

void App::applySettingsFromUi() {
    static const int srs[] = { 44100, 48000, 96000 };
    static const int bufs[] = { 128, 256, 512, 1024 };
    cfg_.data.sampleRate = srs[clampi(setSrSel_, 0, 2)];
    cfg_.data.bufferSize = bufs[clampi(setBufSel_, 0, 3)];
    if (setAudioSel_ <= 0) cfg_.data.audioDevice.clear();
    else if (setAudioSel_ - 1 < (int)audioDevs_.size())
        cfg_.data.audioDevice = audioDevs_[setAudioSel_ - 1].id;
    cfg_.data.theme = setTheme_;
    cfg_.data.uiScale = setScale_;
    cfg_.data.velocityFromMouse = setVelMouse_;
    cfg_.data.showKeyLabels = setLabels_;
    cfg_.data.showComputerKeys = setCompKeys_;
    cfg_.data.defaultVelocity = clampi(setDefVel_, 1, 127);
    theme_ = makeTheme(cfg_.data.theme != 0);
    applyThemeToWindow(hwnd_);
    if (hwndSet_) applyThemeToWindow(hwndSet_);

    std::wstring err;
    audioOk_ = startAudio(err);
    if (!audioOk_)
        MessageBoxW(hwndSet_ ? hwndSet_ : hwnd_, err.c_str(), L"Piano Pro", MB_OK | MB_ICONWARNING);

    std::wstring merr;
    midi_.close();
    if (setMidiSel_ > 0 && setMidiSel_ - 1 < (int)midiDevs_.size()) {
        if (midi_.open(midiDevs_[setMidiSel_ - 1].index, merr))
            cfg_.data.midiDevice = midiDevs_[setMidiSel_ - 1].name;
        else
            MessageBoxW(hwndSet_ ? hwndSet_ : hwnd_, merr.c_str(), L"Piano Pro", MB_OK | MB_ICONWARNING);
    } else {
        cfg_.data.midiDevice.clear();
    }
    engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
    saveSettings();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::tick() {
    engine_.copyVisual(visual_);
    for (int i = 0; i < 88; ++i) {
        float target = visual_[kMinNote + i] ? 1.0f : 0.0f;
        float a = pressAmt_[i];
        float k = 0.35f;
        pressAmt_[i] = a + (target - a) * k;
        if (fabsf(pressAmt_[i] - target) < 0.005f) pressAmt_[i] = target;
    }
    if (statusUntil_ && wallTimeMs() > statusUntil_)
        statusMsg_.clear();
    if (wasPlaying_ && !rec_.isPlaying()) {
        engine_.panic();
        memset(holdCount_, 0, sizeof(holdCount_));
        engine_.setSustain(cfg_.data.sustain || spaceSustain_);
    }
    wasPlaying_ = rec_.isPlaying();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

static const wchar_t* comboLabelInst(int id) { return instrumentName(id); }

void App::paint(HWND, HDC hdcScreen) {
    computeLayout();
    const int W = rcClient_.right, H = rcClient_.bottom;
    if (W <= 0 || H <= 0) return;
    HDC hdc = CreateCompatibleDC(hdcScreen);
    HBITMAP bmp = CreateCompatibleBitmap(hdcScreen, W, H);
    HGDIOBJ oldBmp = SelectObject(hdc, bmp);

    const Theme& th = theme_;
    const float S = scale_;
    fillR(hdc, rcClient_, th.bg);
    fillR(hdc, rcTop_, th.topBar);
    fillR(hdc, rcStatus_, th.panel);
    fillR(hdc, rcBottom_, th.panel);

    HFONT fTitle = mkFont(px(S, 18), FW_SEMIBOLD);
    HFONT fBody  = mkFont(px(S, 13), FW_NORMAL);
    HFONT fSmall = mkFont(px(S, 11), FW_NORMAL);
    HFONT fBtn   = mkFont(px(S, 13), FW_SEMIBOLD);
    HGDIOBJ oldF = SelectObject(hdc, fTitle);

    // Logo
    textR(hdc, rcLogo_, L"Piano Pro", th.accent, DT_LEFT | DT_VCENTER);

    SelectObject(hdc, fBtn);
    // Instrument combo
    {
        bool hot = hoverId_ == ID_INST;
        roundStroke(hdc, rcInst_, hot ? th.panelAlt : th.panel, th.stroke, px(S, 8), 1);
        wchar_t buf[64];
        swprintf(buf, 64, L"%s   ▾", instrumentName(cfg_.data.instrument));
        textR(hdc, inset(rcInst_, px(S, 10), 0), buf, th.text, DT_LEFT | DT_VCENTER);
    }
    drawBtn(hdc, rcOctDn_, L"−", th, hoverId_ == ID_OCTDN, activeId_ == ID_OCTDN, false, false, S);
    {
        wchar_t buf[32];
        swprintf(buf, 32, L"Octave %d", cfg_.data.octave);
        textR(hdc, rcOct_, buf, th.text, DT_CENTER | DT_VCENTER);
    }
    drawBtn(hdc, rcOctUp_, L"+", th, hoverId_ == ID_OCTUP, activeId_ == ID_OCTUP, false, false, S);

    // Volume slider
    {
        RECT r = rcVol_;
        textR(hdc, RECT{ r.left, r.top, r.left + px(S, 28), r.bottom }, L"Vol", th.textDim, DT_LEFT | DT_VCENTER);
        RECT track { r.left + px(S, 32), (r.top + r.bottom) / 2 - 2, r.right, (r.top + r.bottom) / 2 + 2 };
        roundR(hdc, track, th.stroke, 2);
        float t = cfg_.data.muted ? 0 : cfg_.data.volumePct / 100.0f;
        RECT fill = track;
        fill.right = track.left + (int)((track.right - track.left) * t);
        roundR(hdc, fill, th.accent, 2);
        int kx = fill.right;
        RECT knob { kx - px(S, 7), (r.top + r.bottom) / 2 - px(S, 7), kx + px(S, 7), (r.top + r.bottom) / 2 + px(S, 7) };
        roundR(hdc, knob, th.accent2, px(S, 8));
    }
    drawToggle(hdc, rcMute_, cfg_.data.muted ? L"Muted" : L"Mute", cfg_.data.muted, th, hoverId_ == ID_MUTE, S);
    drawBtn(hdc, rcGear_, L"Settings", th, hoverId_ == ID_GEAR, activeId_ == ID_GEAR, false, false, S);

    // Status
    SelectObject(hdc, fSmall);
    {
        wchar_t buf[64];
        if (lastNote_ >= 0) {
            wchar_t nn[8];
            noteNameW(lastNote_, nn, 8);
            swprintf(buf, 64, L"CURRENT NOTE   %s", nn);
        } else {
            swprintf(buf, 64, L"CURRENT NOTE   —");
        }
        textR(hdc, rcNote_, buf, th.text, DT_LEFT | DT_VCENTER);
    }
    {
        wchar_t buf[128];
        if (midi_.isOpen())
            swprintf(buf, 128, L"MIDI   %s", midi_.name().c_str());
        else
            swprintf(buf, 128, L"MIDI   No Device");
        textR(hdc, rcMidi_, buf, th.textDim, DT_LEFT | DT_VCENTER);
    }
    {
        wchar_t buf[256] = L"";
        if (rec_.isRecording()) {
            uint32_t ms = rec_.elapsedMs();
            swprintf(buf, 256, L"Recording...  %02u:%02u.%u",
                     (ms / 60000), (ms / 1000) % 60, (ms / 100) % 10);
            textR(hdc, rcInfo_, buf, th.danger, DT_RIGHT | DT_VCENTER);
        } else if (rec_.isPlaying()) {
            uint32_t ms = rec_.elapsedMs();
            uint32_t tot = rec_.lengthMs();
            swprintf(buf, 256, L"Playing  %02u:%02u  /  %02u:%02u",
                     (ms / 60000), (ms / 1000) % 60, (tot / 60000), (tot / 1000) % 60);
            textR(hdc, rcInfo_, buf, th.ok, DT_RIGHT | DT_VCENTER);
        } else if (practiceOn_ && practiceIdx_ < (int)practiceSeq_.size()) {
            wchar_t nn[8];
            noteNameW(practiceSeq_[practiceIdx_], nn, 8);
            swprintf(buf, 256, L"Next Note: %s     (%d / %d)", nn, practiceIdx_ + 1, (int)practiceSeq_.size());
            textR(hdc, rcInfo_, buf, th.practice, DT_RIGHT | DT_VCENTER);
        } else if (!statusMsg_.empty()) {
            textR(hdc, rcInfo_, statusMsg_.c_str(), th.accent, DT_RIGHT | DT_VCENTER);
        } else {
            swprintf(buf, 256, L"%s    %d voices    %d Hz",
                     audio_.currentDeviceName().empty() ? L"No audio" : audio_.currentDeviceName().c_str(),
                     engine_.activeVoices(), audio_.sampleRate());
            textR(hdc, rcInfo_, buf, th.textDim, DT_RIGHT | DT_VCENTER);
        }
    }

    // Piano
    int pracMidi = (practiceOn_ && practiceIdx_ < (int)practiceSeq_.size()) ? practiceSeq_[practiceIdx_] : -1;
    kbd_.draw(hdc, th, visual_, pressAmt_, pracMidi, hoverMidi_,
              cfg_.data.showKeyLabels, cfg_.data.showComputerKeys,
              cfg_.data.keyMap, cfg_.data.octave, S);

    // Bottom buttons
    SelectObject(hdc, fBtn);
    drawBtn(hdc, rcRec_, L"●  Record", th, hoverId_ == ID_REC, false, rec_.isRecording(), true, S);
    drawBtn(hdc, rcStop_, L"Stop", th, hoverId_ == ID_STOP, activeId_ == ID_STOP, false, false, S);
    drawBtn(hdc, rcPlay_, L"▶  Play", th, hoverId_ == ID_PLAY, false, rec_.isPlaying(), false, S);
    drawBtn(hdc, rcOpen_, L"Open", th, hoverId_ == ID_OPEN, activeId_ == ID_OPEN, false, false, S);
    drawBtn(hdc, rcSave_, L"Save", th, hoverId_ == ID_SAVE, activeId_ == ID_SAVE, false, false, S);
    drawToggle(hdc, rcSus_, L"Sustain", cfg_.data.sustain, th, hoverId_ == ID_SUS, S);
    drawToggle(hdc, rcMetro_, L"Metronome", cfg_.data.metroOn, th, hoverId_ == ID_METRO, S);
    drawBtn(hdc, rcBpmDn_, L"−", th, hoverId_ == ID_BPMDN, false, false, false, S);
    {
        wchar_t buf[16];
        swprintf(buf, 16, L"%d", cfg_.data.metroBpm);
        textR(hdc, rcBpm_, buf, th.text, DT_CENTER | DT_VCENTER);
    }
    drawBtn(hdc, rcBpmUp_, L"+", th, hoverId_ == ID_BPMUP, false, false, false, S);
    drawToggle(hdc, rcPrac_, L"Practice", practiceOn_, th, hoverId_ == ID_PRAC, S);

    // Practice text field
    if (practiceOn_) {
        RECT pr { rcPrac_.right + px(S, 8), rcPrac_.top, rcClient_.right - px(S, 16), rcPrac_.bottom };
        roundStroke(hdc, pr, th.bg, practiceFocus_ ? th.accent : th.stroke, px(S, 8), 1);
        RECT tr = inset(pr, px(S, 8), 0);
        const wchar_t* show = practiceText_.empty() ? L"Type notes: C4 E4 G4 C5" : practiceText_.c_str();
        textR(hdc, tr, show, practiceText_.empty() ? th.textDim : th.text, DT_LEFT | DT_VCENTER);
    }

    // Instrument dropdown
    if (comboOpen_ == 1) {
        RECT box { rcInst_.left, rcInst_.bottom + 4, rcInst_.right, rcInst_.bottom + 4 + px(S, 36) * 4 };
        roundStroke(hdc, box, th.panel, th.stroke, px(S, 8), 1);
        for (int i = 0; i < 4; ++i) {
            RECT ir { box.left, box.top + i * px(S, 36), box.right, box.top + (i + 1) * px(S, 36) };
            bool sel = (i == cfg_.data.instrument);
            if (sel) fillR(hdc, ir, th.panelAlt);
            textR(hdc, inset(ir, px(S, 10), 0), instrumentName(i), sel ? th.accent : th.text, DT_LEFT | DT_VCENTER);
        }
    }

    SelectObject(hdc, oldF);
    DeleteObject(fTitle);
    DeleteObject(fBody);
    DeleteObject(fSmall);
    DeleteObject(fBtn);

    BitBlt(hdcScreen, 0, 0, W, H, hdc, 0, 0, SRCCOPY);
    SelectObject(hdc, oldBmp);
    DeleteObject(bmp);
    DeleteDC(hdc);
}

static int hitIdMain(App* /*self*/, int x, int y,
                     const RECT& inst, const RECT& od, const RECT& ou,
                     const RECT& vol, const RECT& mute, const RECT& gear,
                     const RECT& rec, const RECT& stop, const RECT& play,
                     const RECT& open, const RECT& save, const RECT& sus,
                     const RECT& metro, const RECT& bdn, const RECT& bup,
                     const RECT& prac) {
    if (hit(inst, x, y)) return ID_INST;
    if (hit(od, x, y)) return ID_OCTDN;
    if (hit(ou, x, y)) return ID_OCTUP;
    if (hit(vol, x, y)) return ID_VOL;
    if (hit(mute, x, y)) return ID_MUTE;
    if (hit(gear, x, y)) return ID_GEAR;
    if (hit(rec, x, y)) return ID_REC;
    if (hit(stop, x, y)) return ID_STOP;
    if (hit(play, x, y)) return ID_PLAY;
    if (hit(open, x, y)) return ID_OPEN;
    if (hit(save, x, y)) return ID_SAVE;
    if (hit(sus, x, y)) return ID_SUS;
    if (hit(metro, x, y)) return ID_METRO;
    if (hit(bdn, x, y)) return ID_BPMDN;
    if (hit(bup, x, y)) return ID_BPMUP;
    if (hit(prac, x, y)) return ID_PRAC;
    return ID_NONE;
}

LRESULT App::handle(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_DESTROY:
        KillTimer(h, 1);
        saveSettings();
        PostQuitMessage(0);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(h, &ps);
        paint(h, hdc);
        EndPaint(h, &ps);
        return 0;
    }
    case WM_SIZE:
        computeLayout();
        InvalidateRect(h, nullptr, FALSE);
        return 0;
    case WM_GETMINMAXINFO: {
        auto* mm = (MINMAXINFO*)l;
        mm->ptMinTrackSize.x = 980;
        mm->ptMinTrackSize.y = 560;
        return 0;
    }
    case WM_TIMER:
        tick();
        return 0;
    case WM_USER + 2:
        InvalidateRect(h, nullptr, FALSE);
        return 0;
    case WM_MOUSEMOVE: {
        int x = (short)LOWORD(l), y = (short)HIWORD(l);
        computeLayout();
        hoverId_ = hitIdMain(this, x, y, rcInst_, rcOctDn_, rcOctUp_, rcVol_, rcMute_, rcGear_,
                             rcRec_, rcStop_, rcPlay_, rcOpen_, rcSave_, rcSus_,
                             rcMetro_, rcBpmDn_, rcBpmUp_, rcPrac_);
        int hm = kbd_.hitTest(x, y);
        hoverMidi_ = hm;
        if (mouseDown_ && mouseNote_ >= 0 && hm >= 0 && hm != mouseNote_) {
            releaseNote(mouseNote_, SRC_MOUSE);
            int vel = (int)(mouseVelocity(hm, y) * 127);
            pressNote(hm, vel, SRC_MOUSE);
            mouseNote_ = hm;
        }
        if (activeId_ == ID_VOL) {
            RECT r = rcVol_;
            int left = r.left + px(scale_, 32);
            int right = r.right;
            float t = (float)(x - left) / (float)(right - left);
            cfg_.data.volumePct = clampi((int)(t * 100 + 0.5f), 0, 100);
            if (cfg_.data.volumePct > 0) cfg_.data.muted = false;
            applyVolume();
        }
        TRACKMOUSEEVENT tme { sizeof(tme), TME_LEAVE, h, 0 };
        TrackMouseEvent(&tme);
        return 0;
    }
    case WM_MOUSELEAVE:
        hoverId_ = 0;
        hoverMidi_ = -1;
        return 0;
    case WM_LBUTTONDOWN: {
        int x = (short)LOWORD(l), y = (short)HIWORD(l);
        computeLayout();
        SetCapture(h);
        practiceFocus_ = false;

        if (comboOpen_ == 1) {
            RECT box { rcInst_.left, rcInst_.bottom + 4, rcInst_.right, rcInst_.bottom + 4 + px(scale_, 36) * 4 };
            if (hit(box, x, y)) {
                int i = (y - box.top) / px(scale_, 36);
                if (i >= 0 && i < 4) applyInstrument(i);
            }
            comboOpen_ = 0;
            return 0;
        }

        int id = hitIdMain(this, x, y, rcInst_, rcOctDn_, rcOctUp_, rcVol_, rcMute_, rcGear_,
                           rcRec_, rcStop_, rcPlay_, rcOpen_, rcSave_, rcSus_,
                           rcMetro_, rcBpmDn_, rcBpmUp_, rcPrac_);
        activeId_ = id;
        if (id == ID_INST) { comboOpen_ = 1; return 0; }
        if (id == ID_OCTDN) { setOctave(cfg_.data.octave - 1); return 0; }
        if (id == ID_OCTUP) { setOctave(cfg_.data.octave + 1); return 0; }
        if (id == ID_VOL) {
            RECT r = rcVol_;
            int left = r.left + px(scale_, 32);
            int right = r.right;
            float t = (float)(x - left) / (float)(right - left);
            cfg_.data.volumePct = clampi((int)(t * 100 + 0.5f), 0, 100);
            cfg_.data.muted = false;
            applyVolume();
            return 0;
        }
        if (id == ID_MUTE) { cfg_.data.muted = !cfg_.data.muted; applyVolume(); return 0; }
        if (id == ID_GEAR) { openSettings(); return 0; }
        if (id == ID_REC) { startRecord(); return 0; }
        if (id == ID_STOP) { stopTransport(); return 0; }
        if (id == ID_PLAY) { startPlay(); return 0; }
        if (id == ID_OPEN) { openMidi(); return 0; }
        if (id == ID_SAVE) { saveMidi(); return 0; }
        if (id == ID_SUS) { toggleSustain(); return 0; }
        if (id == ID_METRO) {
            cfg_.data.metroOn = !cfg_.data.metroOn;
            engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
            engine_.metronomeReset();
            return 0;
        }
        if (id == ID_BPMDN) {
            cfg_.data.metroBpm = clampi(cfg_.data.metroBpm - 1, 40, 240);
            engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
            return 0;
        }
        if (id == ID_BPMUP) {
            cfg_.data.metroBpm = clampi(cfg_.data.metroBpm + 1, 40, 240);
            engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
            return 0;
        }
        if (id == ID_PRAC) {
            if (!practiceOn_) {
                if (!parsePractice(practiceText_)) {
                    practiceText_ = L"C4 E4 G4 C5";
                    parsePractice(practiceText_);
                }
                practiceOn_ = true;
                practiceIdx_ = 0;
            } else {
                practiceOn_ = false;
            }
            return 0;
        }
        if (practiceOn_) {
            RECT pr { rcPrac_.right + px(scale_, 8), rcPrac_.top, rcClient_.right - px(scale_, 16), rcPrac_.bottom };
            if (hit(pr, x, y)) {
                practiceFocus_ = true;
                return 0;
            }
        }

        int midi = kbd_.hitTest(x, y);
        if (midi >= 0) {
            if (waitingBind_ && remapArmedVk_ >= 0) {
                int base = 12 * (cfg_.data.octave + 1);
                cfg_.data.keyMap[remapArmedVk_] = midi - base;
                waitingBind_ = false;
                remapArmedVk_ = -1;
                statusMsg_ = L"Key remapped.";
                statusUntil_ = wallTimeMs() + 2000;
                return 0;
            }
            mouseDown_ = true;
            mouseNote_ = midi;
            int vel = (int)(mouseVelocity(midi, y) * 127);
            pressNote(midi, vel, SRC_MOUSE);
        }
        return 0;
    }
    case WM_LBUTTONUP: {
        ReleaseCapture();
        activeId_ = 0;
        if (mouseNote_ >= 0) {
            releaseNote(mouseNote_, SRC_MOUSE);
            mouseNote_ = -1;
        }
        mouseDown_ = false;
        return 0;
    }
    case WM_MOUSEWHEEL: {
        int delta = GET_WHEEL_DELTA_WPARAM(w);
        cfg_.data.volumePct = clampi(cfg_.data.volumePct + (delta > 0 ? 2 : -2), 0, 100);
        if (cfg_.data.volumePct > 0) cfg_.data.muted = false;
        applyVolume();
        return 0;
    }
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN: {
        const int vk = (int)w;
        const bool repeat = (l & (1 << 30)) != 0;
        if (practiceFocus_) {
            if (vk == VK_ESCAPE) { practiceFocus_ = false; return 0; }
            if (vk == VK_BACK) {
                if (!practiceText_.empty()) practiceText_.pop_back();
                parsePractice(practiceText_);
                practiceIdx_ = 0;
                return 0;
            }
            if (vk == VK_RETURN) {
                parsePractice(practiceText_);
                practiceIdx_ = 0;
                practiceFocus_ = false;
                return 0;
            }
            return 0;
        }
        if (vk == VK_ESCAPE) {
            comboOpen_ = 0;
            engine_.panic();
            memset(holdCount_, 0, sizeof(holdCount_));
            memset(keyDown_, 0, sizeof(keyDown_));
            mouseNote_ = -1;
            return 0;
        }
        if (vk == VK_SPACE) {
            if (!repeat) {
                spaceSustain_ = true;
                setSustain(true);
            }
            return 0;
        }
        if (vk == 'Z' && !repeat) { setOctave(cfg_.data.octave - 1); return 0; }
        if (vk == 'X' && !repeat) { setOctave(cfg_.data.octave + 1); return 0; }
        if (repeat) return 0;
        if (vk >= 0 && vk < 256 && !keyDown_[vk]) {
            int midi = midiFromVk(vk);
            if (midi >= 0) {
                keyDown_[vk] = true;
                pressNote(midi, cfg_.data.defaultVelocity, SRC_KBD);
            }
        }
        return 0;
    }
    case WM_CHAR:
        if (practiceFocus_) {
            wchar_t c = (wchar_t)w;
            if (c >= 32 && c != 127) {
                practiceText_.push_back(c);
                parsePractice(practiceText_);
                practiceIdx_ = 0;
            }
            return 0;
        }
        return 0;
    case WM_KEYUP:
    case WM_SYSKEYUP: {
        const int vk = (int)w;
        if (vk == VK_SPACE) {
            spaceSustain_ = false;
            setSustain(cfg_.data.sustain);
            return 0;
        }
        if (vk >= 0 && vk < 256 && keyDown_[vk]) {
            keyDown_[vk] = false;
            int midi = midiFromVk(vk);
            if (midi >= 0) releaseNote(midi, SRC_KBD);
        }
        return 0;
    }
    case WM_KILLFOCUS:
        releaseAllComputerKeys();
        if (cfg_.data.sustain && !rec_.isPlaying()) {
            // keep sustain if button is latched; only space is momentary if not toggled
        }
        return 0;
    default:
        return DefWindowProcW(h, m, w, l);
    }
}

// ---------------- Settings window ----------------

static RECT srect(int x, int y, int w, int h) { return RECT{ x, y, x + w, y + h }; }

void App::computeSettingsLayout(int W, int H) {
    const float S = scale_;
    int y = px(S, 16);
    y += px(S, 32); // Audio header
    setL_.audio = srect(px(S, 170), y, px(S, 350), px(S, 32));
    y += px(S, 42);
    setL_.sr  = srect(px(S, 170), y, px(S, 160), px(S, 32));
    setL_.buf = srect(px(S, 420), y, px(S, 100), px(S, 32));
    y += px(S, 50);
    y += px(S, 32); // MIDI header
    setL_.midi = srect(px(S, 170), y, px(S, 350), px(S, 32));
    y += px(S, 50);
    y += px(S, 32); // Piano header
    setL_.vel = srect(px(S, 20), y, px(S, 320), px(S, 28));
    y += px(S, 32);
    setL_.lab  = srect(px(S, 20), y, px(S, 220), px(S, 28));
    setL_.comp = srect(px(S, 260), y, px(S, 240), px(S, 28));
    y += px(S, 40);
    setL_.defvel = srect(px(S, 200), y, px(S, 280), px(S, 28));
    y += px(S, 40);
    setL_.reset = srect(px(S, 20), y, px(S, 180), px(S, 32));
    y += px(S, 56);
    setL_.metroVol = srect(px(S, 200), y, px(S, 280), px(S, 28));
    y += px(S, 56);
    y += px(S, 32); // Interface header
    setL_.dark  = srect(px(S, 20), y, px(S, 110), px(S, 32));
    setL_.light = srect(px(S, 140), y, px(S, 110), px(S, 32));
    setL_.s100  = srect(px(S, 280), y, px(S, 70), px(S, 32));
    setL_.s125  = srect(px(S, 356), y, px(S, 70), px(S, 32));
    setL_.s150  = srect(px(S, 432), y, px(S, 70), px(S, 32));
    int by = H - px(S, 70);
    setL_.close = srect(W - px(S, 250), by, px(S, 110), px(S, 40));
    setL_.apply = srect(W - px(S, 130), by, px(S, 110), px(S, 40));
    int ih = px(S, 28);
    int na = 1 + (int)audioDevs_.size(); if (na > 12) na = 12;
    setL_.dropAudio = { setL_.audio.left, setL_.audio.bottom, setL_.audio.right, setL_.audio.bottom + ih * na };
    int nm = 1 + (int)midiDevs_.size(); if (nm > 12) nm = 12;
    setL_.dropMidi = { setL_.midi.left, setL_.midi.bottom, setL_.midi.right, setL_.midi.bottom + ih * nm };
}

void App::paintSettings(HDC hdcScreen) {
    RECT rc;
    GetClientRect(hwndSet_, &rc);
    const int W = rc.right, H = rc.bottom;
    computeSettingsLayout(W, H);
    HDC hdc = CreateCompatibleDC(hdcScreen);
    HBITMAP bmp = CreateCompatibleBitmap(hdcScreen, W, H);
    HGDIOBJ oldBmp = SelectObject(hdc, bmp);
    const Theme& th = theme_;
    const float S = scale_;
    fillR(hdc, rc, th.bg);

    HFONT fH = mkFont(px(S, 16), FW_SEMIBOLD);
    HFONT fB = mkFont(px(S, 13), FW_NORMAL);
    HGDIOBJ oldF = SelectObject(hdc, fH);

    auto section = [&](int y, const wchar_t* title) {
        RECT r { px(S, 20), y, W - px(S, 20), y + px(S, 24) };
        textR(hdc, r, title, th.accent, DT_LEFT | DT_VCENTER);
    };
    auto label = [&](RECT r, const wchar_t* t) {
        SelectObject(hdc, fB);
        textR(hdc, r, t, th.textDim, DT_LEFT | DT_VCENTER);
    };
    auto combo = [&](RECT r, const wchar_t* t, bool hot) {
        roundStroke(hdc, r, th.panel, hot ? th.accent : th.stroke, px(S, 8), 1);
        SelectObject(hdc, fB);
        wchar_t buf[160];
        swprintf(buf, 160, L"%s   ▾", t);
        textR(hdc, inset(r, px(S, 10), 0), buf, th.text, DT_LEFT | DT_VCENTER);
    };
    auto chk = [&](RECT r, const wchar_t* t, bool on) {
        RECT box { r.left, r.top + 6, r.left + px(S, 18), r.top + 6 + px(S, 18) };
        roundStroke(hdc, box, on ? th.accent : th.panel, th.stroke, 4, 1);
        if (on) textR(hdc, box, L"✓", RGB(28, 22, 8), DT_CENTER | DT_VCENTER);
        RECT tr { box.right + 8, r.top, r.right, r.bottom };
        SelectObject(hdc, fB);
        textR(hdc, tr, t, th.text, DT_LEFT | DT_VCENTER);
    };

    int y = px(S, 16);
    SelectObject(hdc, fH);
    section(y, L"Audio"); y += px(S, 32);
    label(srect(px(S, 20), y, px(S, 140), px(S, 32)), L"Output device");
    {
        const wchar_t* name = L"System default";
        if (setAudioSel_ > 0 && setAudioSel_ - 1 < (int)audioDevs_.size())
            name = audioDevs_[setAudioSel_ - 1].name.c_str();
        combo(setL_.audio, name, comboOpen_ == 2);
    }
    y += px(S, 42);
    label(srect(px(S, 20), y, px(S, 140), px(S, 32)), L"Sample rate");
    {
        static const wchar_t* srs[] = { L"44100 Hz", L"48000 Hz", L"96000 Hz" };
        combo(setL_.sr, srs[clampi(setSrSel_, 0, 2)], comboOpen_ == 3);
    }
    label(srect(px(S, 340), y, px(S, 80), px(S, 32)), L"Buffer");
    {
        static const wchar_t* bs[] = { L"128", L"256", L"512", L"1024" };
        combo(setL_.buf, bs[clampi(setBufSel_, 0, 3)], comboOpen_ == 4);
    }
    y += px(S, 50);
    SelectObject(hdc, fH);
    section(y, L"MIDI"); y += px(S, 32);
    label(srect(px(S, 20), y, px(S, 140), px(S, 32)), L"MIDI input");
    {
        const wchar_t* name = L"No Device";
        if (setMidiSel_ > 0 && setMidiSel_ - 1 < (int)midiDevs_.size())
            name = midiDevs_[setMidiSel_ - 1].name.c_str();
        combo(setL_.midi, name, comboOpen_ == 5);
    }
    y += px(S, 50);
    SelectObject(hdc, fH);
    section(y, L"Piano"); y += px(S, 32);
    chk(setL_.vel, L"Mouse velocity (press lower = louder)", setVelMouse_);
    y += px(S, 32);
    chk(setL_.lab, L"Show note labels", setLabels_);
    chk(setL_.comp, L"Show computer keys", setCompKeys_);
    y += px(S, 40);
    label(srect(px(S, 20), y, px(S, 180), px(S, 28)), L"Default key velocity");
    {
        RECT tr = setL_.defvel;
        tr.top += 12; tr.bottom = tr.top + 4;
        roundR(hdc, tr, th.stroke, 2);
        RECT fl = tr;
        fl.right = tr.left + (int)((tr.right - tr.left) * (setDefVel_ / 127.0f));
        roundR(hdc, fl, th.accent, 2);
        wchar_t b[16];
        swprintf(b, 16, L"%d", setDefVel_);
        textR(hdc, srect(px(S, 490), setL_.defvel.top, px(S, 40), px(S, 28)), b, th.text, DT_LEFT | DT_VCENTER);
    }
    y += px(S, 40);
    drawBtn(hdc, setL_.reset, L"Reset key mapping", th, false, false, false, false, S);
    SelectObject(hdc, fB);
    textR(hdc, srect(px(S, 210), y, px(S, 320), px(S, 32)),
          L"A W S E D F T G Y H U J   ·   Z/X octave   ·   Space sustain",
          th.textDim, DT_LEFT | DT_VCENTER);

    label(srect(px(S, 20), setL_.metroVol.top, px(S, 180), px(S, 28)), L"Metronome volume");
    {
        RECT tr = setL_.metroVol;
        tr.top += 12; tr.bottom = tr.top + 4;
        roundR(hdc, tr, th.stroke, 2);
        RECT fl = tr;
        fl.right = tr.left + (int)((tr.right - tr.left) * (cfg_.data.metroVol / 100.0f));
        roundR(hdc, fl, th.accent, 2);
        wchar_t b[16];
        swprintf(b, 16, L"%d", cfg_.data.metroVol);
        textR(hdc, srect(px(S, 490), setL_.metroVol.top, px(S, 40), px(S, 28)), b, th.text, DT_LEFT | DT_VCENTER);
    }

    SelectObject(hdc, fH);
    section(setL_.dark.top - px(S, 28), L"Interface");
    drawToggle(hdc, setL_.dark, L"Dark", setTheme_ == 0, th, false, S);
    drawToggle(hdc, setL_.light, L"Light", setTheme_ == 1, th, false, S);
    drawToggle(hdc, setL_.s100, L"100%", setScale_ == 100, th, false, S);
    drawToggle(hdc, setL_.s125, L"125%", setScale_ == 125, th, false, S);
    drawToggle(hdc, setL_.s150, L"150%", setScale_ == 150, th, false, S);

    drawBtn(hdc, setL_.close, L"Close", th, false, false, false, false, S);
    drawBtn(hdc, setL_.apply, L"Apply", th, false, false, true, false, S);

    // Open combo lists
    auto drop = [&](int cx, int cy, int cw, const std::vector<std::wstring>& items, int sel) {
        int ih = px(S, 28);
        int n = (int)items.size();
        if (n > 12) n = 12;
        RECT box { cx, cy, cx + cw, cy + ih * n };
        roundStroke(hdc, box, th.panel, th.stroke, 8, 1);
        for (int i = 0; i < n; ++i) {
            RECT ir { box.left, box.top + i * ih, box.right, box.top + (i + 1) * ih };
            if (i == sel) fillR(hdc, ir, th.panelAlt);
            textR(hdc, inset(ir, 8, 0), items[i].c_str(), i == sel ? th.accent : th.text, DT_LEFT | DT_VCENTER);
        }
    };
    if (comboOpen_ == 2) {
        std::vector<std::wstring> items;
        items.push_back(L"System default");
        for (auto& d : audioDevs_) items.push_back(d.name);
        drop(setL_.dropAudio.left, setL_.dropAudio.top, setL_.dropAudio.right - setL_.dropAudio.left, items, setAudioSel_);
    }
    if (comboOpen_ == 5) {
        std::vector<std::wstring> items;
        items.push_back(L"No Device");
        for (auto& d : midiDevs_) items.push_back(d.name);
        drop(setL_.dropMidi.left, setL_.dropMidi.top, setL_.dropMidi.right - setL_.dropMidi.left, items, setMidiSel_);
    }

    SelectObject(hdc, oldF);
    DeleteObject(fH);
    DeleteObject(fB);
    BitBlt(hdcScreen, 0, 0, W, H, hdc, 0, 0, SRCCOPY);
    SelectObject(hdc, oldBmp);
    DeleteObject(bmp);
    DeleteDC(hdc);
}

LRESULT App::handleSettings(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_DESTROY:
        hwndSet_ = nullptr;
        comboOpen_ = 0;
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(h, &ps);
        paintSettings(hdc);
        EndPaint(h, &ps);
        return 0;
    }
    case WM_LBUTTONDOWN: {
        int x = (short)LOWORD(l), y = (short)HIWORD(l);
        RECT rc; GetClientRect(h, &rc);
        computeSettingsLayout(rc.right, rc.bottom);
        const float S = scale_;
        int ih = px(S, 28);

        if (comboOpen_ == 2) {
            if (hit(setL_.dropAudio, x, y)) {
                setAudioSel_ = (y - setL_.dropAudio.top) / ih;
                comboOpen_ = 0;
                InvalidateRect(h, nullptr, FALSE);
                return 0;
            }
            comboOpen_ = 0;
        }
        if (comboOpen_ == 5) {
            if (hit(setL_.dropMidi, x, y)) {
                setMidiSel_ = (y - setL_.dropMidi.top) / ih;
                comboOpen_ = 0;
                InvalidateRect(h, nullptr, FALSE);
                return 0;
            }
            comboOpen_ = 0;
        }

        if (hit(setL_.audio, x, y)) { comboOpen_ = 2; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.sr, x, y)) { setSrSel_ = (setSrSel_ + 1) % 3; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.buf, x, y)) { setBufSel_ = (setBufSel_ + 1) % 4; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.midi, x, y)) { comboOpen_ = 5; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.vel, x, y)) { setVelMouse_ = !setVelMouse_; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.lab, x, y)) { setLabels_ = !setLabels_; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.comp, x, y)) { setCompKeys_ = !setCompKeys_; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.defvel, x, y)) {
            float t = (float)(x - setL_.defvel.left) / (float)(setL_.defvel.right - setL_.defvel.left);
            setDefVel_ = clampi((int)(t * 127), 1, 127);
            InvalidateRect(h, nullptr, FALSE); return 0;
        }
        if (hit(setL_.metroVol, x, y)) {
            float t = (float)(x - setL_.metroVol.left) / (float)(setL_.metroVol.right - setL_.metroVol.left);
            cfg_.data.metroVol = clampi((int)(t * 100), 0, 100);
            engine_.setMetronome(cfg_.data.metroOn, (float)cfg_.data.metroBpm, cfg_.data.metroVol / 100.0f);
            InvalidateRect(h, nullptr, FALSE); return 0;
        }
        if (hit(setL_.reset, x, y)) {
            cfg_.data.resetKeyMap();
            statusMsg_ = L"Keyboard mapping reset.";
            statusUntil_ = wallTimeMs() + 2500;
            InvalidateRect(h, nullptr, FALSE);
            return 0;
        }
        if (hit(setL_.dark, x, y)) { setTheme_ = 0; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.light, x, y)) { setTheme_ = 1; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.s100, x, y)) { setScale_ = 100; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.s125, x, y)) { setScale_ = 125; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.s150, x, y)) { setScale_ = 150; InvalidateRect(h, nullptr, FALSE); return 0; }
        if (hit(setL_.apply, x, y)) {
            applySettingsFromUi();
            InvalidateRect(h, nullptr, FALSE);
            InvalidateRect(hwnd_, nullptr, FALSE);
            return 0;
        }
        if (hit(setL_.close, x, y)) {
            DestroyWindow(h);
            return 0;
        }
        InvalidateRect(h, nullptr, FALSE);
        return 0;
    }
    default:
        return DefWindowProcW(h, m, w, l);
    }
}

#endif
