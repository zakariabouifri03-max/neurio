// NEXUS GRAPHICS ENGINE - application shell.
// Main window (UI) + topmost click-through overlay (enhanced output) +
// engine / capture / stats / watcher threads.
#include "app.h"
#include "bmp.h"
#include "json.h"
#include <stdlib.h>
#include <stdio.h>
#include <shlobj.h>

App g_app;

// ---------------------------------------------------------------- small utils
static void SetStatus_(const char* fmt, ...){
    char buf[220];
    va_list ap; va_start(ap, fmt);
    _vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    StrCpyN_(g_app.statusMsg, sizeof g_app.statusMsg, buf);
    g_app.statusT = NowMs_();
}

static void SaveMainSettings_(void);
static void LoadMainSettings_(void);

static void SaveMainSettings_(void){
    wchar_t path[512];
    int bl = AppDataPath_(path, 320);
    if (!bl) return;
    lstrcatW(path, L"\\settings.json");
    JVal* o = JVNew(J_OBJ, 0);
    SettingsToJson_(&g_app.settings, o);
    JVObjPutInt(o, "fpsTarget", g_app.fpsTarget);
    JVal* games = JVNew(J_ARR, "games");
    for (int i = 0; i < g_app.nGames; i++){
        JVal* g = JVNew(J_OBJ, 0);
        JVObjPutStr(g, "name", g_app.games[i].name);
        JVObjPutStr(g, "exe", g_app.games[i].exe);
        JVAdd(games, g);
    }
    JVAdd(o, games);
    char buf[16384];
    int n = JVDump(o, buf, sizeof buf, 0);
    JVFree(o);
    if (n > 0) WriteFileW_(path, buf, n);
}

static void LoadMainSettings_(void){
    wchar_t path[512];
    int bl = AppDataPath_(path, 320);
    if (!bl) return;
    lstrcatW(path, L"\\settings.json");
    int len = 0;
    char* data = ReadFileAlloc_(path, &len);
    if (!data) return;
    JVal* o = JVParse(data, len);
    free(data);
    if (!o) return;
    NexusSettings s;
    SettingsDefault(&s);
    SettingsFromJson_(&s, o);
    g_app.settings = s;
    g_app.fpsTarget = JVInt(o, "fpsTarget", 0);
    JVal* games = JVFind(o, "games");
    if (games && games->kind == J_ARR){
        g_app.nGames = 0;
        for (JVal* g = games->child; g && g_app.nGames < MAX_GAMES; g = g->next){
            StrCpyN_(g_app.games[g_app.nGames].name, 80, JVStr(g, "name", ""));
            StrCpyN_(g_app.games[g_app.nGames].exe, 260, JVStr(g, "exe", ""));
            if (g_app.games[g_app.nGames].exe[0]) g_app.nGames++;
        }
    }
    JVFree(o);
}

static void ExeName_(const char* exe, char* out, int n){
    const char* s = exe;
    const char* p = exe;
    while (*s){ if (*s == '\\' || *s == '/') p = s + 1; s++; }
    char tmp[260];
    StrCpyN_(tmp, sizeof tmp, p);
    char* dot = tmp; while (*dot && *dot != '.') dot++;
    if (*dot) *dot = 0;
    StrCpyN_(out, n, tmp[0] ? tmp : "game");
}

static int ExeMatch_(const char* a, const char* b){
    if (!a || !b || !a[0] || !b[0]) return 0;
    for (const char* pa = a; *pa; pa++)
        if ((*pa >= 'A' && *pa <= 'Z') || (*pa >= 'a' && *pa <= 'z'))
            if (tolower((unsigned char)*pa) != tolower((unsigned char)b[pa - a]))
                return 0;
    (void)b;
    return 1;
}

// ---------------------------------------------------------------- selection helpers
static void SelectGameByExe_(const char* exe){
    for (int i = 0; i < g_app.nGames; i++)
        if (ExeMatch_(g_app.games[i].exe, exe)){
            g_app.selGame = i;
            if (ProfileLoad(g_app.games[i].name, &g_app.settings)){
                NLog("Loaded profile for %s", g_app.games[i].name);
            }
            SetStatus_("Selected: %s", g_app.games[i].name);
            return;
        }
    if (g_app.nGames < MAX_GAMES){
        int i = g_app.nGames++;
        ExeName_(exe, g_app.games[i].name, 80);
        StrCpyN_(g_app.games[i].exe, 260, exe);
        g_app.selGame = i;
        SaveMainSettings_();
        SetStatus_("Added game: %s", g_app.games[i].name);
    }
}

// ---------------------------------------------------------------- session
void App::StartSession_(int selftestMode){
    if (session) return;
    selftest = selftestMode;
    int w, h, x, y;
    if (selftestMode){
        static const int sw[3] = { 1280, 1920, 2560 };
        static const int sh[3] = { 720, 1080, 1440 };
        w = sw[selftestRes]; h = sh[selftestRes];
        RECT mr; SystemParametersInfo(SPI_GETWORKAREA, 0, &mr, 0);
        x = mr.left + (mr.right - mr.left - w) / 2;
        y = mr.top + (mr.bottom - mr.top - h) / 2;
        StrCpyN_(targetName, sizeof targetName, "SELF-TEST");
        targetExe[0] = 0;
        targetW = w; targetH = h;
        SetStatus_("Self-test running at %dx%d", w, h);
    } else {
        if (selGame < 0 || selGame >= nGames){ SetStatus_("Select a game first"); return; }
        GameEntry g = games[selGame];
        targetWnd = 0; targetPid = 0;
        // 1) find a live window whose exe matches
        WinInfo arr[64];
        int n = EnumGameWindows_(arr, 64);
        for (int i = 0; i < n; i++)
            if (ExeMatch_(arr[i].exe, g.exe)){
                targetWnd = arr[i].h;
                targetPid = arr[i].pid;
                break;
            }
        if (!targetWnd){
            // 2) any process with that exe
            ProcInfo pr[512];
            int pn = EnumProcesses_(pr, 512);
            for (int i = 0; i < pn; i++){
                if (ExeMatch_(pr[i].exe, g.exe)){
                    if (FindWindowForPid_(pr[i].pid, &targetWnd)){
                        targetPid = pr[i].pid;
                        break;
                    }
                }
            }
        }
        if (!targetWnd){
            SetStatus_("No live window for %s - start the game, then press Start again", g.name);
            NLog("Start failed: no live window for %s", g.exe);
            return;
        }
        RECT r;
        if (!GetWindowRect(targetWnd, &r)){ SetStatus_("Cannot read game window rect"); return; }
        x = r.left; y = r.top; w = r.right - r.left; h = r.bottom - r.top;
        StrCpyN_(targetName, sizeof targetName, g.name);
        StrCpyN_(targetExe, sizeof targetExe, g.exe);
        targetW = w; targetH = h;
        SetStatus_("Enhancing %s (%dx%d)", g.name, w, h);
        NLog("Session start: %s pid=%lu window %dx%d at %d,%d", g.name, (unsigned long)targetPid, w, h, x, y);
    }
    if (engine.ResizeSwap(w, h))
        SetStatus_("Overlay resize failed: %s", engine.LastError());
    SetWindowPos(hwndOverlay, HWND_TOPMOST, x, y, w, h, SWP_SHOWWINDOW | SWP_NOACTIVATE);
    if (!selftestMode){
        capture.Start(engine.Dev(), engine.Factory(), targetWnd);
        NLog("Capture started for target window");
    }
    session = 1;
    beforeAfter = 0;
    split = -1;
    masterCeil = settings.master;
    SaveMainSettings_();
    if (!selftestMode && selGame >= 0 && selGame < nGames)
        ProfileSave(games[selGame].name, targetExe, targetW, targetH, &settings);
}

void App::StopSession_(int byUser){
    if (!session) return;
    session = 0;
    capture.Stop();
    if (hCapture) WaitForSingleObject(hCapture, 800);
    if (!selftest)
        SetStatus_(byUser ? "Enhancement stopped" : "Stopped: game window closed");
    else
        SetStatus_("Self-test stopped");
    selftest = 0;
    beforeAfter = 0;
    split = -1;
    ShowWindow(hwndOverlay, SW_HIDE);
    if (selGame >= 0 && selGame < nGames && targetExe[0])
        ProfileSave(games[selGame].name, targetExe, targetW, targetH, &settings);
    SaveMainSettings_();
}

// ---------------------------------------------------------------- window proc
LRESULT CALLBACK AppWinProc_(HWND h, UINT m, WPARAM w, LPARAM l){
    App* a = &g_app;
    if (h == a->hwndOverlay){
        switch (m){
        case WM_CLOSE: ShowWindow(h, SW_HIDE); return 0;
        case WM_DESTROY: PostMessage(a->hwnd, WM_APP, 2, 0); return 0;
        }
        return DefWindowProcW(h, m, w, l);
    }
    switch (m){
    case WM_CREATE:
        return 0;
    case WM_LBUTTONDOWN:
        a->mouseDown = true;
        a->mouseX = LOWORD(l); a->mouseY = HIWORD(l);
        return 0;
    case WM_LBUTTONUP:
        a->mouseDown = false;
        return 0;
    case WM_MOUSEMOVE:
        a->mouseX = LOWORD(l); a->mouseY = HIWORD(l);
        return 0;
    case WM_MOUSEWHEEL:
        a->wheelDir = GET_WHEEL_DELTA_WPARAM(w) > 0 ? 1 : -1;
        a->wheelPulse = 1;
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        BeginPaint(h, &ps);
        a->Frame_();
        EndPaint(h, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        return 1;
    case WM_GETMINMAXINFO: {
        MINMAXINFO* mmi = (MINMAXINFO*)l;
        mmi->ptMinTrackSize.x = 1100;
        mmi->ptMinTrackSize.y = 640;
        return 0;
    }
    case WM_CLOSE:
        a->running = 0;
        PostQuitMessage(0);
        return 0;
    case WM_APP:
        if (w == 2) { a->running = 0; PostQuitMessage(0); }
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

// ---------------------------------------------------------------- UI drawing
static void DrawTitle_(UI::Ctx* c);
static void DrawNav_(UI::Ctx* c);
static void DrawStatusBar_(UI::Ctx* c);
static void Page_Game_(UI::Ctx* c);
static void Page_Graphics_(UI::Ctx* c);
static void Page_Color_(UI::Ctx* c);
static void Page_Perf_(UI::Ctx* c);
static void Page_System_(UI::Ctx* c);

void App::Frame_(){
    // keep UI responsive: repaint at ~60fps while no input
    InvalidateRect(hwnd, 0, FALSE);
    UI::Ctx ui;
    UI::Begin(&ui, uiPix, winW, winH, mouseX, mouseY, mouseDown);
    UI::Fill(&ui, 0, 0, winW, winH, UI::COL_BG);
    DrawTitle_(&ui);
    DrawNav_(&ui);
    switch (page){
    case 0: Page_Game_(&ui); break;
    case 1: Page_Graphics_(&ui); break;
    case 2: Page_Color_(&ui); break;
    case 3: Page_Perf_(&ui); break;
    default: Page_System_(&ui); break;
    }
    DrawStatusBar_(&ui);

    HDC dc = GetDC(hwnd);
    StretchDIBits(dc, 0, 0, winW, winH, 0, 0, winW, winH, uiPix, &bmi, DIB_RGB_COLORS, SRCCOPY);
    ReleaseDC(hwnd, dc);
    if (wheelPulse) wheelPulse = 0;
}

static void DrawTitle_(UI::Ctx* c){
    UI::Fill(c, 0, 0, g_app.winW, 46, UI::COL_PANEL);
    UI::Fill(c, 0, 46, g_app.winW, 1, UI::COL_BORDER);
    TextCtx tc = { 0, 0, 0 };
    tc.buf = g_app.uiPix; tc.w = g_app.winW; tc.h = g_app.winH;
    TextDraw(&tc, "NEXUS", 14, 8, UI::COL_ACCENT, Font2P_());
    TextDraw(&tc, "GRAPHICS ENGINE", 14 + TextWidth_("NEXUS", Font2P_()) + 10, 14,
             UI::COL_TEXT, Font1P_());
    TextDraw(&tc, NEXUS_VERSION, 14 + TextWidth_("NEXUS", Font2P_()) + 10 + TextWidth_("GRAPHICS ENGINE", Font1P_()) + 12,
             16, UI::COL_DIM, Font1P_());
    // status pill
    const char* st = "IDLE";
    unsigned int col = UI::COL_DIM;
    if (g_app.session){
        if (g_app.selftest){ st = "SELF-TEST"; col = UI::COL_WARN; }
        else { st = "ENHANCING"; col = UI::COL_GOOD; }
    }
    int sw2 = TextWidth_(st, Font1P_()) + 26;
    int sx = g_app.winW - 90 - sw2;
    UI::Fill(c, sx, 12, sw2, 22, 0x30101418);
    UI::RectBorder(c, sx, 12, sw2, 22, col);
    UI::Fill(c, sx + 10, 19, 7, 7, col);
    UI::Label_(c, st, sx + 24, 16, col);
    // close
    bool hot = UI::InRectPub(c->mx, c->my, g_app.winW - 64, 10, 40, 26);
    UI::Fill(c, g_app.winW - 64, 10, 40, 26, hot ? UI::COL_BAD : UI::COL_PANEL2);
    UI::RectBorder(c, g_app.winW - 64, 10, 40, 26, hot ? UI::COL_BAD : UI::COL_BORDER);
    UI::Label_(c, "x", g_app.winW - 48, 14, hot ? 0xFF101418 : UI::COL_DIM);
    if (hot && c->down){
        g_app.running = 0;
        PostQuitMessage(0);
    }
}

static void DrawNav_(UI::Ctx* c){
    static const char* pages[] = { "Game", "Graphics", "Color", "Performance", "System" };
    UI::Fill(c, 0, 47, 186, g_app.winH - 47 - 26, UI::COL_PANEL);
    UI::Fill(c, 186, 47, 1, g_app.winH - 47 - 26, UI::COL_BORDER);
    for (int i = 0; i < 5; i++){
        int y = 62 + i * 44;
        bool sel = g_app.page == i;
        bool hot = UI::InRectPub(c->mx, c->my, 8, y, 170, 36);
        if (sel || hot) UI::Fill(c, 8, y, 170, 36, UI::COL_PANEL2);
        if (hot || sel)
            UI::RectBorder(c, 8, y, 170, 36, sel ? UI::COL_ACCENT : UI::COL_BORDER);
        UI::Label_(c, pages[i], 22, y + 11, sel ? UI::COL_TEXT : UI::COL_DIM);
        if (hot && c->down) g_app.page = i;
    }
    UI::Label_(c, "NEXUS v" NEXUS_VERSION, 22, g_app.winH - 52, UI::COL_DIM);
}

static void DrawStatusBar_(UI::Ctx* c){
    UI::Fill(c, 0, g_app.winH - 26, g_app.winW, 26, UI::COL_PANEL);
    UI::Fill(c, 0, g_app.winH - 26, g_app.winW, 1, UI::COL_BORDER);
    UI::Label_(c, g_app.statusMsg, 10, g_app.winH - 18, UI::COL_DIM);
    const char* hk = "CTRL+F9 before/after   F10 split view   F11 overlay   F12 screenshot";
    UI::LabelR(c, hk, 10, g_app.winH - 18, g_app.winW - 20, UI::COL_DIM);
}

// ================================================================ PAGE: GAME
static void Page_Game_(UI::Ctx* c){
    App* a = &g_app;
    int x0 = 200, y0 = 58;
    int x1 = 720;   // right column
    int cw1 = 506, cw2 = 506;

    // detected games
    UI::Panel(c, x0, y0, cw1, 268, "Detected Games (auto)");
    {
        WinInfo arr[64]; int n = 0;
        EnterCriticalSection(&a->winCs);
        n = a->nWindows;
        memcpy(arr, a->windows, sizeof arr[0] * n);
        LeaveCriticalSection(&a->winCs);
        int top = y0 + 30, rowH = 30, rows = 7;
        for (int i = 0; i < rows && i < n; i++){
            int y = top + i * rowH;
            bool hot = UI::InRectPub(c->mx, c->my, x0 + 8, y, cw1 - 16, rowH - 2);
            UI::Fill(c, x0 + 8, y, cw1 - 16, rowH - 2, hot ? UI::COL_PANEL2 : 0x00000000);
            UI::Label_(c, arr[i].title, x0 + 14, y + 2, hot ? UI::COL_TEXT : UI::COL_DIM);
            UI::Label_(c, arr[i].exe, x0 + 14, y + 13, UI::COL_DIM);
            char tmp[64];
            snprintf(tmp, sizeof tmp, "%dx%d", arr[i].w, arr[i].hh);
            UI::LabelR(c, tmp, x0 + 14, y + 7, 90, UI::COL_DIM);
            // use button
            int bx = x0 + cw1 - 96, by = y + 2;
            bool bh = UI::InRectPub(c->mx, c->my, bx, by, 84, 20);
            UI::Fill(c, bx, by, 84, 20, bh ? UI::COL_PANEL2 : UI::COL_TRACK);
            UI::RectBorder(c, bx, by, 84, 20, bh ? UI::COL_ACCENT : UI::COL_BORDER);
            UI::Label_(c, "Use", bx + 30, by + 3, UI::COL_TEXT);
            if (bh && c->down){
                SelectGameByExe_(arr[i].exe);
                SetStatus_("Target: %s", arr[i].title);
            }
        }
        if (n == 0)
            UI::Label_(c, "No game windows detected yet.", x0 + 14, top + 4, UI::COL_DIM);
    }

    // add manually
    UI::Panel(c, x0, y0 + 280, cw1, 92, "Add Game Manually");
    {
        int bx = x0 + 12, by = y0 + 280 + 36;
        bool bh = UI::InRectPub(c->mx, c->my, bx, by, 150, 34);
        UI::Fill(c, bx, by, 150, 34, bh ? UI::COL_PANEL2 : UI::COL_PANEL);
        UI::RectBorder(c, bx, by, 150, 34, bh ? UI::COL_ACCENT : UI::COL_BORDER);
        UI::Label_(c, "Browse .exe", bx + 26, by + 10, UI::COL_TEXT);
        if (bh && c->down){
            wchar_t file[MAX_PATH * 2] = {0};
            wchar_t path[MAX_PATH * 4] = {0};
            OPENFILENAMEW ofn;
            ZeroMemory(&ofn, sizeof ofn);
            ofn.lStructSize = sizeof ofn;
            ofn.hwndOwner = a->hwnd;
            ofn.lpstrFilter = L"Executables (*.exe)\0*.exe\0All files\0*.*\0";
            ofn.lpstrFile = path;
            ofn.nMaxFile = (DWORD)sizeof path / 2;
            ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
            if (GetOpenFileNameW(&ofn)){
                char exeUtf[520];
                WToUtf8_(exeUtf, sizeof exeUtf, path);
                SelectGameByExe_(exeUtf);
            }
        }
        UI::Label_(c, "Pick the game's executable. A profile is created automatically.",
                   bx + 164, by + 6, UI::COL_DIM);
        UI::Label_(c, "Profiles are stored in %APPDATA%\\NexusGraphicsEngine.",
                   bx + 164, by + 22, UI::COL_DIM);
    }

    // my games
    UI::Panel(c, x0, y0 + 384, cw1, 250, "My Games (profiles)");
    {
        int top = y0 + 384 + 30, rowH = 34;
        int rows = (a->nGames < 6 ? a->nGames : 6);
        for (int i = 0; i < rows; i++){
            int y = top + i * rowH;
            bool sel = a->selGame == i;
            bool hot = UI::InRectPub(c->mx, c->my, x0 + 8, y, cw1 - 16, rowH - 4);
            UI::Fill(c, x0 + 8, y, cw1 - 16, rowH - 4, sel ? UI::COL_PANEL2 : (hot ? UI::COL_PANEL2 : 0));
            if (sel) UI::RectBorder(c, x0 + 8, y, cw1 - 16, rowH - 4, UI::COL_ACCENT);
            UI::Label_(c, a->games[i].name, x0 + 16, y + 3, sel ? UI::COL_TEXT : UI::COL_DIM);
            UI::Label_(c, a->games[i].exe, x0 + 16, y + 17, UI::COL_DIM);
            // select
            int bx = x0 + cw1 - 190, by = y + 6;
            bool bh = UI::InRectPub(c->mx, c->my, bx, by, 84, 20);
            UI::Fill(c, bx, by, 84, 20, bh ? UI::COL_PANEL2 : UI::COL_TRACK);
            UI::RectBorder(c, bx, by, 84, 20, bh ? UI::COL_ACCENT : UI::COL_BORDER);
            UI::Label_(c, "Select", bx + 22, by + 3, UI::COL_TEXT);
            if (bh && c->down){
                a->selGame = i;
                if (ProfileLoad(a->games[i].name, &a->settings)){
                    SetStatus_("Loaded profile: %s", a->games[i].name);
                    NLog("Profile loaded for %s", a->games[i].name);
                }
            }
            // remove
            int rx = x0 + cw1 - 96, ry = y + 6;
            bool rh = UI::InRectPub(c->mx, c->my, rx, ry, 84, 20);
            UI::Fill(c, rx, ry, 84, 20, rh ? UI::COL_PANEL2 : UI::COL_TRACK);
            UI::RectBorder(c, rx, ry, 84, 20, rh ? UI::COL_BAD : UI::COL_BORDER);
            UI::Label_(c, "Remove", rx + 22, ry + 3, rh ? UI::COL_BAD : UI::COL_DIM);
            if (rh && c->down){
                for (int j = i; j < a->nGames - 1; j++) a->games[j] = a->games[j + 1];
                a->nGames--;
                if (a->selGame >= a->nGames) a->selGame = a->nGames - 1;
                SaveMainSettings_();
            }
        }
        if (a->nGames == 0)
            UI::Label_(c, "No games registered yet.", x0 + 16, top + 4, UI::COL_DIM);
    }

    // right column: output + preset + session
    UI::Panel(c, x1, y0, cw2, 128, "Output");
    {
        static const char* resNames[] = { "Native (passthrough)", "1080p (1920x1080)",
                                          "1440p (2560x1440)", "4K (3840x2160)" };
        int sel = 0;
        if (a->settings.outW == 1920) sel = 1;
        else if (a->settings.outW == 2560) sel = 2;
        else if (a->settings.outW == 3840) sel = 3;
        int ch = UI::Combo(c, "Output resolution", sel, resNames, 4, x1 + 12, y0 + 36, cw2 - 24, 101);
        if (ch >= 0){
            static const int ow[4] = { 0, 1920, 2560, 3840 };
            static const int oh[4] = { 0, 1080, 1440, 2160 };
            EnterCriticalSection(&a->cs);
            a->settings.outW = ow[ch]; a->settings.outH = oh[ch];
            LeaveCriticalSection(&a->cs);
            SaveMainSettings_();
        }
        char in[80];
        if (a->session && !a->selftest)
            snprintf(in, sizeof in, "Input: %dx%d (auto-detected)", a->targetW, a->targetH);
        else
            snprintf(in, sizeof in, "Input: auto-detected from the game window");
        UI::Label_(c, in, x1 + 12, y0 + 70, UI::COL_DIM);
        UI::Label_(c, "The pipeline renders at the output resolution and presents it over the game.",
                   x1 + 12, y0 + 86, UI::COL_DIM);
    }

    UI::Panel(c, x1, y0 + 140, cw2, 118, "Preset & Master");
    {
        int ch = UI::Combo(c, "Preset", a->settings.preset, NULL, 0, x1 + 12, y0 + 140 + 32, cw2 - 24, 102);
        (void)ch;
        // manual preset row (8 small buttons)
        static const char* pn[PRESET_COUNT] = { "LOW", "QUALITY", "ULTRA", "EXTREME",
                                                "REALISTIC", "CINEMATIC", "MAX", "CUSTOM" };
        for (int i = 0; i < PRESET_COUNT; i++){
            int bw = 56, bx = x1 + 12 + i * (bw + 4), by = y0 + 140 + 62;
            bool sel = a->settings.preset == i;
            bool hot = UI::InRectPub(c->mx, c->my, bx, by, bw, 24);
            UI::Fill(c, bx, by, bw, 24, sel ? UI::COL_ACCENT : (hot ? UI::COL_PANEL2 : UI::COL_TRACK));
            UI::RectBorder(c, bx, by, bw, 24, sel ? UI::COL_ACCENT : UI::COL_BORDER);
            UI::Label_(c, pn[i], bx + (bw - TextWidth_(pn[i], Font1P_())) / 2, by + 5,
                       sel ? 0xFF101418 : UI::COL_DIM);
            if (hot && c->down){
                EnterCriticalSection(&a->cs);
                SettingsApplyPreset(&a->settings, (Preset)i);
                LeaveCriticalSection(&a->cs);
                SaveMainSettings_();
                SetStatus_("Preset: %s", PresetName_((Preset)i));
            }
        }
    }

    // master slider big
    UI::Panel(c, x1, y0 + 270, cw2, 84, "Master Graphics");
    {
        UI::Slider(c, "MASTER", &a->settings.master, x1 + 12, y0 + 270 + 34, cw2 - 24, 30, 103, 0, 100);
        char t[80];
        snprintf(t, sizeof t, "%d%% - %s", a->settings.master,
                 a->settings.master == 0 ? "original passthrough" : "all features scaled");
        UI::Label_(c, t, x1 + 12, y0 + 270 + 62, UI::COL_DIM);
    }

    // session panel
    UI::Panel(c, x1, y0 + 366, cw2, 268, "Session");
    {
        int y = y0 + 366 + 34;
        if (a->selGame >= 0 && a->selGame < a->nGames){
            UI::Label_(c, a->games[a->selGame].name, x1 + 12, y, UI::COL_TEXT);
            UI::Label_(c, a->games[a->selGame].exe, x1 + 12, y + 16, UI::COL_DIM);
            y += 44;
        } else {
            UI::Label_(c, "No game selected.", x1 + 12, y, UI::COL_DIM);
            y += 24;
        }
        if (a->session){
            UI::Fill(c, x1 + 12, y, 200, 40, UI::COL_TRACK);
            UI::RectBorder(c, x1 + 12, y, 200, 40, UI::COL_BAD);
            UI::Label_(c, "STOP", x1 + 88, y + 12, UI::COL_BAD);
            if (UI::InRectPub(c->mx, c->my, x1 + 12, y, 200, 40) && c->down)
                a->StopSession_(1);
            UI::Label_(c, a->session ? a->targetName : "", x1 + 224, y + 6, UI::COL_GOOD);
            if (a->estats.fps > 0.5) {
                char t[80];
                snprintf(t, sizeof t, "FPS %.0f   GPU %.1f ms", a->estats.fps, a->estats.procMs);
                UI::Label_(c, t, x1 + 224, y + 22, UI::COL_GOOD);
            }
        } else {
            UI::Fill(c, x1 + 12, y, 200, 40, UI::COL_TRACK);
            UI::RectBorder(c, x1 + 12, y, 200, 40, UI::COL_GOOD);
            UI::Label_(c, "START", x1 + 84, y + 12, UI::COL_GOOD);
            if (UI::InRectPub(c->mx, c->my, x1 + 12, y, 200, 40) && c->down)
                a->StartSession_(0);
            UI::Label_(c, "Captures the game's rendered output in real time and",
                       x1 + 224, y + 4, UI::COL_DIM);
            UI::Label_(c, "presents the enhanced frame over the game window.",
                       x1 + 224, y + 20, UI::COL_DIM);
        }
        y += 56;
        // selftest
        char lab[64];
        snprintf(lab, sizeof lab, "Self-test: %s", a->selftest ? "RUNNING" : "off");
        bool sh = UI::InRectPub(c->mx, c->my, x1 + 12, y, 120, 24);
        UI::Fill(c, x1 + 12, y, 120, 24, sh ? UI::COL_PANEL2 : UI::COL_TRACK);
        UI::RectBorder(c, x1 + 12, y, 120, 24, sh ? UI::COL_ACCENT : UI::COL_BORDER);
        UI::Label_(c, a->selftest ? "Stop test" : "Run self-test", x1 + 22, y + 5, UI::COL_TEXT);
        if (sh && c->down){
            if (a->selftest) a->StopSession_(1);
            else a->StartSession_(1);
        }
        static const char* stRes[] = { "1280x720", "1920x1080", "2560x1440" };
        int cr = UI::Combo(c, "Test input", a->selftestRes, stRes, 3, x1 + 144, y, 150, 104);
        if (cr >= 0) a->selftestRes = cr;
        UI::Label_(c, "Synthetic scene pushed through the full pipeline. Use it to verify",
                   x1 + 12, y + 30, UI::COL_DIM);
        UI::Label_(c, "the enhancement output without a running game.",
                   x1 + 12, y + 46, UI::COL_DIM);
    }
}

// ================================================================ PAGE: GRAPHICS
static void LvlRow_(UI::Ctx* c, const char* label, int* val, int* on, int x, int y, int w, int id, int minV, int maxV){
    UI::Check(c, label, on, x, y + 2);
    if (*on && val)
        UI::Slider(c, "", val, x + TextWidth_(label, Font1P_()) + 26, y, w - TextWidth_(label, Font1P_()) - 26, 22, id, minV, maxV);
}
// checkbox feature: val==0 -> no level slider; syncs a derived on/off back to a real field
#define CHK_ROW(c, label, field, on, x, y, w, id, dv) do {         int _o = (field) > 0;         LvlRow_((c), (label), 0, &_o, (x), (y), (w), (id), 0, 1);         if (_o && !(field)) (field) = (dv);         if (!_o) (field) = 0;     } while (0)

static void Page_Graphics_(UI::Ctx* c){
    App* a = &g_app;
    int x0 = 200, y0 = 58;
    int colW = 500;
    int x1 = x0 + colW + 16;
    int viewH = a->winH - y0 - 40;
    int maxScroll = 0; // computed by content height
    int scroll = a->uiScroll[1];

    // wheel
    if (a->wheelPulse){
        // handled globally in Frame_
    }

    int ly; // local y = y0 + 12 - scroll

#define CY(off) (y0 + 12 + (off) - scroll)

    // ---- column 1
    UI::Panel(c, x0, y0, colW, 96, "Super-Resolution & Temporal");
    {
        int y = CY(16);
        CHK_ROW(c, "Super Resolution", a->settings.superRes, on, x0 + 12, y, colW - 24, 201, 1);
        UI::Label_(c, "Reconstruction upscaler. Output res set on the Game page.",
                   x0 + 12, y + 22, UI::COL_DIM);
        y += 40;
        int onT = a->settings.temporal > 0 ? 1 : 0;
        LvlRow_(c, "Temporal Reconstruct", &a->settings.temporal, &onT, x0 + 12, y, colW - 24, 202, 0, 5);
        if (onT && a->settings.temporal == 0) a->settings.temporal = 2;
        if (!onT) a->settings.temporal = 0;
        if (onT){
            UI::Slider(c, "History", &a->settings.temporalHistory, x0 + 12, y + 24, colW - 24, 22, 203, 0, 100);
            UI::Slider(c, "Motion gating", &a->settings.motionComp, x0 + 12, y + 50, colW - 24, 22, 204, 0, 100);
        }
    }
    UI::Panel(c, x0, CY(104), colW, 76, "Anti-Aliasing");
    {
        int y = CY(120);
        int on = a->settings.aa > 0 ? 1 : 0;
        LvlRow_(c, "AA (edge + blend)", &a->settings.aa, &on, x0 + 12, y, colW - 24, 205, 0, 5);
        if (on && a->settings.aa == 0) a->settings.aa = 2;
        if (!on) a->settings.aa = 0;
        UI::Label_(c, "Spatial edge detection + temporal edge blend. No ML upscaler.",
                   x0 + 12, y + 22, UI::COL_DIM);
    }
    UI::Panel(c, x0, CY(188), colW, 76, "Texture Quality");
    {
        int y = CY(204);
        int on = a->settings.texture > 0 ? 1 : 0;
        LvlRow_(c, "Texture clarity", &a->settings.texture, &on, x0 + 12, y, colW - 24, 206, 0, 5);
        if (on && a->settings.texture == 0) a->settings.texture = 2;
        if (!on) a->settings.texture = 0;
        UI::Label_(c, "Frequency-aware sharpening with edge guard - natural, no ringing.",
                   x0 + 12, y + 22, UI::COL_DIM);
    }
    UI::Panel(c, x0, CY(272), colW, 190, "Shadow Enhancer");
    {
        int y = CY(288);
        int on = 0;
        CHK_ROW(c, "Smart shadows", a->settings.shadowQuality, on, x0 + 12, y, colW - 24, 207, 50);
        if (a->settings.shadowQuality > 0){
            UI::Slider(c, "Quality", &a->settings.shadowQuality, x0 + 12, y + 24, colW - 24, 22, 208, 0, 100);
            UI::Slider(c, "Detail", &a->settings.shadowDetail, x0 + 12, y + 50, colW - 24, 22, 209, 0, 100);
            UI::Slider(c, "Stability", &a->settings.shadowStability, x0 + 12, y + 76, colW - 24, 22, 210, 0, 100);
            UI::Slider(c, "Softness", &a->settings.shadowSoftness, x0 + 12, y + 102, colW - 24, 22, 211, 0, 100);
            UI::Slider(c, "Contact", &a->settings.shadowContact, x0 + 12, y + 128, colW - 24, 22, 212, 0, 100);
        }
    }
    UI::Panel(c, x0, CY(470), colW, 164, "Lighting Enhancer");
    {
        int y = CY(486);
        int on = 0;
        CHK_ROW(c, "Lighting", a->settings.lightQuality, on, x0 + 12, y, colW - 24, 213, 50);
        if (a->settings.lightQuality > 0){
            UI::Slider(c, "Exposure", &a->settings.lightExposure, x0 + 12, y + 24, colW - 24, 22, 214, 0, 100);
            UI::Slider(c, "Local contrast", &a->settings.lightLocalContrast, x0 + 12, y + 50, colW - 24, 22, 215, 0, 100);
            UI::Slider(c, "Light detail", &a->settings.lightDetail, x0 + 12, y + 76, colW - 24, 22, 216, 0, 100);
            UI::Slider(c, "Dynamic range", &a->settings.lightDynRange, x0 + 12, y + 102, colW - 24, 22, 217, 0, 100);
            UI::Slider(c, "Quality", &a->settings.lightQuality, x0 + 12, y + 128, colW - 24, 22, 218, 0, 100);
        }
    }

    // ---- column 2
    UI::Panel(c, x1, y0, colW, 96, "Ambient Occlusion");
    {
        int y = CY(16);
        int on = a->settings.ao > 0 ? 1 : 0;
        LvlRow_(c, "Screen-space AO", &a->settings.ao, &on, x1 + 12, y, colW - 24, 219, 0, 5);
        if (on && a->settings.ao == 0) a->settings.ao = 2;
        if (!on) a->settings.ao = 0;
        UI::Label_(c, "Multi-scale HBAO-style with horizon search. Halo-averse.",
                   x1 + 12, y + 22, UI::COL_DIM);
    }
    UI::Panel(c, x1, CY(104), colW, 76, "Reflection Stabilizer");
    {
        int y = CY(120);
        int on = 0;
        CHK_ROW(c, "Reflections", a->settings.reflection, on, x1 + 12, y, colW - 24, 220, 40);
        if (a->settings.reflection > 0)
            UI::Slider(c, "Stability", &a->settings.reflection, x1 + 12, y + 24, colW - 24, 22, 221, 0, 100);
    }
    UI::Panel(c, x1, CY(188), colW, 96, "Global Detail Boost");
    {
        int y = CY(204);
        int on = 0;
        CHK_ROW(c, "Detail boost", a->settings.detail, on, x1 + 12, y, colW - 24, 222, 40);
        if (a->settings.detail > 0)
            UI::Slider(c, "Amount", &a->settings.detail, x1 + 12, y + 24, colW - 24, 22, 223, 0, 100);
    }
    UI::Panel(c, x1, CY(292), colW, 76, "Long-Distance Detail");
    {
        int y = CY(308);
        int on = 0;
        CHK_ROW(c, "Distant detail", a->settings.distant, on, x1 + 12, y, colW - 24, 224, 40);
        if (a->settings.distant > 0)
            UI::Slider(c, "Amount", &a->settings.distant, x1 + 12, y + 24, colW - 24, 22, 225, 0, 100);
    }
    UI::Panel(c, x1, CY(376), colW, 76, "LOD Smoothing");
    {
        int y = CY(392);
        int on = 0;
        CHK_ROW(c, "LOD transitions", a->settings.lod, on, x1 + 12, y, colW - 24, 226, 40);
        if (a->settings.lod > 0)
            UI::Slider(c, "Smoothing", &a->settings.lod, x1 + 12, y + 24, colW - 24, 22, 227, 0, 100);
    }
    UI::Panel(c, x1, CY(460), colW, 96, "Vegetation");
    {
        int y = CY(476);
        int on = 0;
        CHK_ROW(c, "Vegetation density", a->settings.vegetation, on, x1 + 12, y, colW - 24, 228, 40);
        if (a->settings.vegetation > 0)
            UI::Slider(c, "Amount", &a->settings.vegetation, x1 + 12, y + 24, colW - 24, 22, 229, 0, 100);
    }
    UI::Panel(c, x1, CY(564), colW, 96, "Character Quality");
    {
        int y = CY(580);
        int on = 0;
        CHK_ROW(c, "Character detail", a->settings.character, on, x1 + 12, y, colW - 24, 230, 40);
        if (a->settings.character > 0)
            UI::Slider(c, "Amount", &a->settings.character, x1 + 12, y + 24, colW - 24, 22, 231, 0, 100);
    }
    UI::Panel(c, x1, CY(668), colW, 96, "Particles");
    {
        int y = CY(684);
        int on = 0;
        CHK_ROW(c, "Particle clarity", a->settings.particles, on, x1 + 12, y, colW - 24, 232, 40);
        if (a->settings.particles > 0)
            UI::Slider(c, "Amount", &a->settings.particles, x1 + 12, y + 24, colW - 24, 22, 233, 0, 100);
    }
    UI::Panel(c, x1, CY(772), colW, 96, "Water");
    {
        int y = CY(788);
        int on = 0;
        CHK_ROW(c, "Water quality", a->settings.water, on, x1 + 12, y, colW - 24, 234, 40);
        if (a->settings.water > 0)
            UI::Slider(c, "Amount", &a->settings.water, x1 + 12, y + 24, colW - 24, 22, 235, 0, 100);
    }

    // scrollbar for this page
    maxScroll = 900 - viewH;
    if (maxScroll < 0) maxScroll = 0;
    int ds = UI::Scrollbar(c, scroll, maxScroll, a->winW - 14, y0 + 8, viewH - 16, 1);
    a->uiScroll[1] = scroll + ds;

#undef CY
}

// ================================================================ PAGE: COLOR
static void Page_Color_(UI::Ctx* c){
    App* a = &g_app;
    int x0 = 200, y0 = 58, colW = 500;
    int x1 = x0 + colW + 16;

    UI::Panel(c, x0, y0, colW, 90, "Color Preset");
    {
        static const char* cn[COLOR_PRESET_COUNT] = { "Natural", "Cinematic", "Vivid",
                                                      "Realistic", "Competitive", "Custom" };
        for (int i = 0; i < COLOR_PRESET_COUNT; i++){
            int bw = 76, bx = x0 + 12 + i * (bw + 4), by = y0 + 34;
            bool sel = a->settings.colorPreset == i;
            bool hot = UI::InRectPub(c->mx, c->my, bx, by, bw, 24);
            UI::Fill(c, bx, by, bw, 24, sel ? UI::COL_ACCENT : (hot ? UI::COL_PANEL2 : UI::COL_TRACK));
            UI::RectBorder(c, bx, by, bw, 24, sel ? UI::COL_ACCENT : UI::COL_BORDER);
            UI::Label_(c, cn[i], bx + (bw - TextWidth_(cn[i], Font1P_())) / 2, by + 5,
                       sel ? 0xFF101418 : UI::COL_DIM);
            if (hot && c->down){
                EnterCriticalSection(&a->cs);
                SettingsApplyColorPreset(&a->settings, (ColorPreset)i);
                LeaveCriticalSection(&a->cs);
                SaveMainSettings_();
            }
        }
        UI::Label_(c, "Defaults never oversaturate. Vivid is the strongest and still bounded.",
                   x0 + 12, y0 + 66, UI::COL_DIM);
    }

    UI::Panel(c, x0, y0 + 102, colW, 330, "Image & Color Controls");
    {
        int y = y0 + 102 + 34, row = 26;
        UI::Slider(c, "Brightness", &a->settings.cBright, x0 + 12, y, colW - 24, row, 301, 0, 100); y += row + 4;
        UI::Slider(c, "Contrast", &a->settings.cContrast, x0 + 12, y, colW - 24, row, 302, 0, 100); y += row + 4;
        UI::Slider(c, "Saturation", &a->settings.cSat, x0 + 12, y, colW - 24, row, 303, 0, 100); y += row + 4;
        UI::Slider(c, "Highlights", &a->settings.cHighlights, x0 + 12, y, colW - 24, row, 304, 0, 100); y += row + 4;
        UI::Slider(c, "Shadows", &a->settings.cShadows, x0 + 12, y, colW - 24, row, 305, 0, 100); y += row + 4;
        UI::Slider(c, "Gamma", &a->settings.cGamma, x0 + 12, y, colW - 24, row, 306, 0, 100); y += row + 4;
        UI::Slider(c, "Temperature", &a->settings.cTemp, x0 + 12, y, colW - 24, row, 307, 0, 100); y += row + 4;
        UI::Slider(c, "HDR pipeline", &a->settings.hdr, x0 + 12, y, colW - 24, row, 308, 0, 100); y += row + 6;
        UI::Label_(c, "Neutral = 50. Values move the tone curve gently (clamped, no clipping by default).",
                   x0 + 12, y, UI::COL_DIM);
    }

    UI::Panel(c, x0, y0 + 444, colW, 84, "HDR / Display");
    {
        int y = y0 + 444 + 34;
        int on = a->hdrOutput;
        bool sup = a->hdrSupported;
        if (!sup){
            UI::Label_(c, "Extended color space: NOT supported on this display/driver - disabled.",
                       x0 + 12, y, UI::COL_WARN);
            UI::Label_(c, "Nexus never enables unsupported HDR modes. SDR output stays in sRGB range.",
                       x0 + 12, y + 18, UI::COL_DIM);
        } else {
            UI::Check(c, "Extended color space output (if HDR display detected)", &on, x0 + 12, y);
            UI::Label_(c, "Output is flagged to the display via the DXGI color space API.",
                       x0 + 12, y + 20, UI::COL_DIM);
        }
    }

    // image quality
    UI::Panel(c, x1, y0, colW, 460, "Image Quality Engine");
    {
        int y = y0 + 34, row = 28;
        UI::GroupTitle(c, "Detail", x1 + 12, y, colW); y += 24;
        UI::Slider(c, "Sharpness", &a->settings.iqSharp, x1 + 12, y, colW - 24, 22, 401, 0, 100); y += row;
        UI::Slider(c, "Fine detail", &a->settings.iqFineDetail, x1 + 12, y, colW - 24, 22, 402, 0, 100); y += row;
        UI::Slider(c, "Texture clarity", &a->settings.iqTextureClarity, x1 + 12, y, colW - 24, 22, 403, 0, 100); y += row;
        UI::Slider(c, "Edge detail", &a->settings.iqEdgeDetail, x1 + 12, y, colW - 24, 22, 404, 0, 100); y += row;
        UI::Slider(c, "Local contrast", &a->settings.iqLocalContrast, x1 + 12, y, colW - 24, 22, 405, 0, 100); y += row + 6;
        UI::GroupTitle(c, "Stability", x1 + 12, y, colW); y += 24;
        UI::Slider(c, "Denoise", &a->settings.iqDenoise, x1 + 12, y, colW - 24, 22, 406, 0, 100); y += row;
        UI::Slider(c, "Artifact reduction", &a->settings.iqArtifact, x1 + 12, y, colW - 24, 22, 407, 0, 100); y += row + 8;
        UI::Label_(c, "All runs on the real pipeline. 0 = untouched by that pass.",
                   x1 + 12, y, UI::COL_DIM);
    }

    UI::Panel(c, x1, y0 + 472, colW, 84, "How it works");
    {
        UI::Label_(c, "The image is processed in linear light on the GPU: sRGB decode,",
                   x1 + 12, y0 + 472 + 32, UI::COL_DIM);
        UI::Label_(c, "enhancement passes, tone curve, then re-encoded. No pixel is faked.",
                   x1 + 12, y0 + 472 + 48, UI::COL_DIM);
        UI::Label_(c, "Use CTRL+F9 to compare original vs enhanced in real time.",
                   x1 + 12, y0 + 472 + 64, UI::COL_ACCENT);
    }
}

// ================================================================ PAGE: PERFORMANCE
static void Metric_(UI::Ctx* c, const char* label, const char* value, unsigned int col,
                    int x, int y, int w){
    UI::Label_(c, label, x, y, UI::COL_DIM);
    UI::LabelR(c, value, x, y, w, col);
}

static void Page_Perf_(UI::Ctx* c){
    App* a = &g_app;
    int x0 = 200, y0 = 58, colW = 500;
    int x1 = x0 + colW + 16;

    UI::Panel(c, x0, y0, colW, 420, "Real-Time Performance (measured)");
    {
        int y = y0 + 36, x = x0 + 14, w = colW - 28;
        char v[64];
        if (a->session && a->estats.fps > 0.5){
            unsigned int col = a->estats.fps >= 55 ? UI::COL_GOOD : (a->estats.fps >= 28 ? UI::COL_WARN : UI::COL_BAD);
            snprintf(v, sizeof v, "%.0f", a->estats.fps);
            Metric_(c, "FPS (overlay)", v, col, x, y, w); y += 26;
            snprintf(v, sizeof v, "%.1f ms", a->estats.frameMs);
            Metric_(c, "Frame time", v, UI::COL_TEXT, x, y, w); y += 26;
            snprintf(v, sizeof v, "%.2f ms", a->estats.procMs);
            Metric_(c, "GPU processing", v, a->estats.procMs < 8 ? UI::COL_GOOD : UI::COL_WARN, x, y, w); y += 26;
            snprintf(v, sizeof v, "%.1f ms", a->estats.latencyMs);
            Metric_(c, "Capture to display", v, a->estats.latencyMs < 40 ? UI::COL_GOOD : UI::COL_WARN, x, y, w); y += 26;
            snprintf(v, sizeof v, "%d", a->estats.dropped);
            Metric_(c, "Dropped frames", v, a->estats.dropped > 10 ? UI::COL_WARN : UI::COL_TEXT, x, y, w); y += 26;
            snprintf(v, sizeof v, "%d", a->estats.frames);
            Metric_(c, "Frames processed", v, UI::COL_TEXT, x, y, w); y += 26;
            snprintf(v, sizeof v, "%dx%d", a->targetW, a->targetH);
            Metric_(c, "Source resolution", v, UI::COL_TEXT, x, y, w); y += 26;
            snprintf(v, sizeof v, "%dx%d", a->estats.outW, a->estats.outH);
            Metric_(c, "Output resolution", v, UI::COL_TEXT, x, y, w); y += 26;
            if (a->capture.FpsEstimate() > 0.5)
                snprintf(v, sizeof v, "%.0f", a->capture.FpsEstimate());
            else snprintf(v, sizeof v, "-");
            Metric_(c, "Captured stream FPS", v, UI::COL_TEXT, x, y, w); y += 30;
        } else {
            UI::Label_(c, "Start a session (Game page) or the self-test to see live numbers.",
                       x, y, UI::COL_DIM);
            UI::Label_(c, "All values above are real measurements: GPU queries, QPC timers,",
                       x, y + 20, UI::COL_DIM);
            UI::Label_(c, "and PDH performance counters. Nothing is simulated.",
                       x, y + 36, UI::COL_DIM);
            y += 60;
        }
        // system counters
        if (a->pstats.gpuOk)
            snprintf(v, sizeof v, "%.0f %%", a->pstats.gpuPct);
        else snprintf(v, sizeof v, "n/a");
        Metric_(c, "GPU utilization (PDH)", v, a->pstats.gpuOk ? UI::COL_TEXT : UI::COL_DIM, x, y, w); y += 26;
        snprintf(v, sizeof v, "%.0f %%", a->pstats.cpuPct);
        Metric_(c, "CPU utilization", v, a->pstats.cpuPct > 80 ? UI::COL_WARN : UI::COL_TEXT, x, y, w); y += 26;
        UI::Label_(c, "Counters: \\GPU Engine(_Total)\\Utilization Percentage,",
                   x, y + 4, UI::COL_DIM);
        UI::Label_(c, "\\GPU Process Memory(*)\\Dedicated Usage, GetSystemTimes().",
                   x, y + 18, UI::COL_DIM);
    }

    UI::Panel(c, x1, y0, colW, 200, "Auto-Optimization by Target FPS");
    {
        int y = y0 + 36;
        static const char* tf[] = { "Off", "30", "60", "90", "120", "144" };
        int sel = 0;
        if (a->fpsTarget == 30) sel = 1;
        else if (a->fpsTarget == 60) sel = 2;
        else if (a->fpsTarget == 90) sel = 3;
        else if (a->fpsTarget == 120) sel = 4;
        else if (a->fpsTarget == 144) sel = 5;
        int ch = UI::Combo(c, "Target FPS", sel, tf, 6, x1 + 12, y, colW - 24, 501);
        if (ch >= 0){
            static const int vals[6] = { 0, 30, 60, 90, 120, 144 };
            a->fpsTarget = vals[ch];
            SaveMainSettings_();
        }
        UI::Label_(c, "While a session runs, Nexus watches the measured FPS and",
                   x1 + 12, y + 32, UI::COL_DIM);
        UI::Label_(c, "steps the MASTER slider up or down until the target is met.",
                   x1 + 12, y + 48, UI::COL_DIM);
        UI::Label_(c, "It never fakes a number: if the target is unreachable, master",
                   x1 + 12, y + 64, UI::COL_DIM);
        UI::Label_(c, "settles at 0 (original image, full speed).",
                   x1 + 12, y + 80, UI::COL_DIM);
        char t[90];
        snprintf(t, sizeof t, "Master: %d   Ceiling: %d   FPS: %.0f",
                 a->settings.master, a->masterCeil, a->estats.fps);
        UI::Label_(c, t, x1 + 12, y + 104, UI::COL_TEXT);
    }

    UI::Panel(c, x1, y0 + 212, colW, 208, "Hardware Recommendation");
    {
        int y = y0 + 212 + 34;
        char t[200];
        UI::Label_(c, a->hw.gpu, x1 + 12, y, UI::COL_TEXT); y += 18;
        int rec = 60;
        const char* advice = "balanced";
        if (a->hw.vramMB >= 8192 && a->hw.ramMB >= 16384){ rec = 120; advice = "high - 1440p/4K output viable"; }
        else if (a->hw.vramMB >= 4096){ rec = 90; advice = "good - 1080p/1440p output"; }
        else { rec = 60; advice = "integrated/low-end - 1080p output, master ~60"; }
        snprintf(t, sizeof t, "Recommended target: %d FPS  (%s)", rec, advice);
        UI::Label_(c, t, x1 + 12, y, UI::COL_ACCENT); y += 18;
        snprintf(t, sizeof t, "Display: %dx%d @ %.0f Hz, %d monitor(s)",
                 a->hw.monW, a->hw.monH, a->hw.refresh, a->hw.nMonitors);
        UI::Label_(c, t, x1 + 12, y, UI::COL_DIM); y += 16;
        UI::Label_(c, "Memory:", x1 + 12, y, UI::COL_DIM);
        snprintf(t, sizeof t, "%d MB VRAM / %d MB RAM", a->hw.vramMB, a->hw.ramMB);
        UI::Label_(c, t, x1 + 150, y, UI::COL_DIM); y += 16;
        UI::Label_(c, "Pipeline: D3D11 pixel shaders (23 passes), linear light.",
                   x1 + 12, y, UI::COL_DIM); y += 14;
        UI::Label_(c, "Vulkan/DirectML ONNX upscalers: API detected, not enabled",
                   x1 + 12, y, UI::COL_DIM); y += 14;
        UI::Label_(c, "in this build - see System page for API status.",
                   x1 + 12, y, UI::COL_DIM);
    }
}

// ================================================================ PAGE: SYSTEM
static void Page_System_(UI::Ctx* c){
    App* a = &g_app;
    int x0 = 200, y0 = 58, colW = 500;
    int x1 = x0 + colW + 16;

    UI::Panel(c, x0, y0, colW, 250, "Detected Hardware");
    {
        int y = y0 + 34;
        char t[220];
        UI::Label_(c, "GPU", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hw.gpu, x0 + 70, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "VRAM", x0 + 12, y, UI::COL_DIM);
        snprintf(t, sizeof t, "%d MB", a->hw.vramMB);
        UI::Label_(c, t, x0 + 70, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "CPU", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hw.cpu, x0 + 70, y, UI::COL_TEXT); y += 18;
        snprintf(t, sizeof t, "%d MB system RAM", a->hw.ramMB);
        UI::Label_(c, t, x0 + 70, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "Monitor", x0 + 12, y, UI::COL_DIM);
        snprintf(t, sizeof t, "%dx%d @ %.0f Hz", a->hw.monW, a->hw.monH, a->hw.refresh);
        UI::Label_(c, t, x0 + 70, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "DX11", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, "active (pipeline)", x0 + 70, y, UI::COL_GOOD); y += 18;
        UI::Label_(c, "DX12", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hw.dx12 ? "runtime present" : "not detected", x0 + 70, y,
                   a->hw.dx12 ? UI::COL_TEXT : UI::COL_DIM); y += 18;
        UI::Label_(c, "Vulkan", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hw.vulkan ? "loader present" : "not detected", x0 + 70, y,
                   a->hw.vulkan ? UI::COL_TEXT : UI::COL_DIM); y += 18;
        UI::Label_(c, "DirectML", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hw.directml ? "runtime present" : "not detected", x0 + 70, y,
                   a->hw.directml ? UI::COL_TEXT : UI::COL_DIM); y += 18;
        UI::Label_(c, "CUDA/ONNX", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, (a->hw.cuda ? "CUDA present" : "") + 1, x0 + 70, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "HDR", x0 + 12, y, UI::COL_DIM);
        UI::Label_(c, a->hdrSupported ? "extended color space supported" : "not supported on this display",
                   x0 + 70, y, a->hdrSupported ? UI::COL_GOOD : UI::COL_DIM);
    }

    UI::Panel(c, x0, y0 + 262, colW, 120, "Hotkeys");
    {
        int y = y0 + 262 + 34;
        UI::Label_(c, "CTRL+F9   Toggle original / enhanced (before-after)", x0 + 12, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "F10       Toggle split view (draggable divider)", x0 + 12, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "F11       Show / hide the overlay", x0 + 12, y, UI::COL_TEXT); y += 18;
        UI::Label_(c, "F12       Save screenshot of the enhanced frame", x0 + 12, y, UI::COL_TEXT);
    }

    UI::Panel(c, x0, y0 + 394, colW, 210, "About / Honest Scope");
    {
        int y = y0 + 394 + 32;
        UI::Label_(c, "Nexus is a real-time post-processing enhancer: it captures the",
                   x0 + 12, y, UI::COL_DIM); y += 16;
        UI::Label_(c, "game's presented frames with DXGI Desktop Duplication, runs a 23-pass",
                   x0 + 12, y, UI::COL_DIM); y += 16;
        UI::Label_(c, "D3D11 GPU pipeline, and presents the enhanced frame over the game.",
                   x0 + 12, y, UI::COL_DIM); y += 16;
        UI::Label_(c, "It does NOT raise native geometry, shadow-map resolution or RT",
                   x0 + 12, y, UI::COL_WARN); y += 16;
        UI::Label_(c, "quality - no game memory is read, no anti-cheat is touched, no game",
                   x0 + 12, y, UI::COL_WARN); y += 16;
        UI::Label_(c, "files are modified. Works offline. Nothing here is simulated.",
                   x0 + 12, y, UI::COL_DIM);
    }

    // log
    UI::Panel(c, x1, y0, colW, 604, "Log");
    {
        int y = y0 + 32, h = 560;
        int start = g_logCount > 26 ? g_logCount - 26 : 0;
        for (int i = start; i < g_logCount && y < y0 + 32 + h; i++){
            int idx = (g_logHead - g_logCount + i + 2 * MAX_LOG_LINES) % MAX_LOG_LINES;
            char t[170];
            snprintf(t, sizeof t, "%s", g_log[idx].text);
            UI::Label_(c, t, x1 + 12, y, UI::COL_DIM);
            y += 16;
        }
        if (g_logCount == 0) UI::Label_(c, "(empty)", x1 + 12, y, UI::COL_DIM);
    }
}

// ---------------------------------------------------------------- HUD
void App::RenderHud_(void){
    TextCtx tc = { hud, 512, 320 };
    TextBegin(&tc, 0x00000000);
    // panel
    TextPanel(&tc, 4, 4, 420, 170, 0xCC101418);
    char t[120];
    const char* gname = selftest ? "SELF-TEST" : (targetName[0] ? targetName : "no target");
    TextDraw(&tc, "NEXUS", 14, 12, 0xFF4DA3FF, Font2P_());
    TextDraw(&tc, gname, 14 + TextWidth_("NEXUS", Font2P_()) + 8, 20, 0xFFE9EDF5, Font1P_());
    EnterCriticalSection(&cs);
    int master = settings.master;
    Preset preset = settings.preset;
    int outW = settings.outW, outH = settings.outH;
    LeaveCriticalSection(&cs);
    snprintf(t, sizeof t, "%s   MASTER %d", PresetName_(preset), master);
    TextDraw(&tc, t, 14, 44, 0xFF8B94A7, Font1P_());
    if (session && !selftest)
        snprintf(t, sizeof t, "%dx%d  ->  %dx%d", targetW, targetH, outW ? outW : targetW, outW ? outH : targetH);
    else
        snprintf(t, sizeof t, "in/out:  self-test");
    TextDraw(&tc, t, 14, 62, 0xFF8B94A7, Font1P_());
    if (estats.fps > 0.5){
        snprintf(t, sizeof t, "FPS %.0f   GPU %.2f ms   LAT %.1f ms",
                 estats.fps, estats.procMs, estats.latencyMs);
        TextDraw(&tc, t, 14, 80, estats.fps >= 55 ? 0xFF43D07A : 0xFFFFB84C, Font1P_());
    }
    char lvl[200];
    {
        EnterCriticalSection(&cs);
        snprintf(lvl, sizeof lvl,
                 "SR %d  TEMP %d  AA %d  SHAD %d  LIT %d  AO %d  DET %d  H2O %d",
                 settings.superRes ? 1 : 0, settings.temporal, settings.aa,
                 settings.shadowQuality ? 1 : 0, settings.lightQuality ? 1 : 0,
                 settings.ao, settings.detail, settings.water ? 1 : 0);
        LeaveCriticalSection(&cs);
    }
    TextDraw(&tc, lvl, 14, 98, 0xFF8B94A7, Font1P_());
    char cmp[64];
    if (beforeAfter) snprintf(cmp, sizeof cmp, "SHOWING: ORIGINAL (CTRL+F9)");
    else if (split >= 0) snprintf(cmp, sizeof cmp, "SPLIT VIEW (F10)");
    else snprintf(cmp, sizeof cmp, "SHOWING: ENHANCED");
    TextDraw(&tc, cmp, 14, 116, beforeAfter ? 0xFFFFB84C : 0xFF43D07A, Font1P_());
    if (fpsTarget) {
        snprintf(cmp, sizeof cmp, "TARGET %.0f FPS", (double)fpsTarget);
        TextDraw(&tc, cmp, 14, 134, 0xFF4DA3FF, Font1P_());
    }
    TextDraw(&tc, "NEXUS GRAPHICS ENGINE v" NEXUS_VERSION "  -  real-time GPU pipeline",
             14, 156, 0xFF555E70, Font1P_());

    EnterCriticalSection(&hudCs);
    memcpy(hud, hud, 0); // (no-op guard)
    LeaveCriticalSection(&hudCs);
}

// ---------------------------------------------------------------- threads
DWORD WINAPI EngineThread_(LPVOID lp){
    App* a = (App*)lp;
    int frameNo = 0;
    while (a->running){
        // build request
        NexusSettings s;
        EnterCriticalSection(&a->cs);
        s = a->settings;
        LeaveCriticalSection(&a->cs);
        Engine::FrameReq rq;
        memset(&rq, 0, sizeof rq);
        rq.s = s;
        if (a->selftest && a->session){
            rq.srcMode = 2;
        } else if (a->session){
            FrameSource fs;
            if (a->capture.GetLatest(&fs)){
                rq.srcMode = 1;
                rq.src = fs;
            } else rq.srcMode = 0;
        } else rq.srcMode = 0;
        rq.beforeAfter = a->beforeAfter;
        rq.split = a->split;
        rq.hudW = 512; rq.hudH = 320;
        rq.hdrOutput = a->hdrOutput && a->hdrSupported;
        static const int stW[3] = { 1280, 1920, 2560 };
        static const int stH[3] = { 720, 1080, 1440 };
        int sr = a->selftestRes < 0 ? 0 : (a->selftestRes > 2 ? 2 : a->selftestRes);
        rq.selftestW = stW[sr];
        rq.selftestH = stH[sr];
        a->engine.SetRequest(&rq);
        if (!a->engine.Tick()){
            Sleep(60);
            if (!a->engine.Alive()){
                NLog("Engine dead - stop session");
                a->StopSession_(0);
            }
            continue;
        }
        frameNo++;
        // preview every 15 frames
        if (frameNo % 15 == 0 && a->session){
            EnterCriticalSection(&a->prevCs);
            a->engine.ReadPreview(a->prevE, a->prevO, 160, 90, &a->prevOk);
            LeaveCriticalSection(&a->prevCs);
        }
        // HUD upload every 6 frames
        if (frameNo % 6 == 0 && a->session){
            unsigned int hud[512 * 320];
            EnterCriticalSection(&a->hudCs);
            memcpy(hud, a->hud, sizeof hud);
            LeaveCriticalSection(&a->hudCs);
            a->engine.UpdateHud(hud, 512, 320);
        }
        // screenshot request
        if (a->shotReq){
            a->shotReq = 0;
            static unsigned int* shotBuf = 0;
            static size_t shotCap = 0;
            size_t need = (size_t)4096 * 4096;
            if (shotCap < need){
                free(shotBuf);
                shotBuf = (unsigned int*)malloc(need * 4);
                shotCap = shotBuf ? need : 0;
            }
            if (shotBuf){
                int w = 0, h = 0;
                if (a->engine.ReadFull(shotBuf, &w, &h)){
                    wchar_t path[600];
                    wchar_t base[320];
                    if (AppDataPath_(base, 320)){
                        lstrcpynW(path, base, 320);
                        lstrcatW(path, L"\\screenshots");
                        CreateDirectoryW(path, 0);
                        wchar_t full[700];
                        SYSTEMTIME st;
                        GetLocalTime(&st);
                        char fname[80];
                        snprintf(fname, sizeof fname, "nexus_%04d%02d%02d_%02d%02d%02d.bmp",
                                 st.wYear, st.wMonth, st.wDay,
                                 st.wHour, st.wMinute, st.wSecond);
                        lstrcpynW(full, path, 512);
                        lstrcatW(full, L"\\");
                        wchar_t nameW[90] = {0};
                        Utf8ToW_(nameW, 90, fname);
                        lstrcatW(full, nameW);
                        if (WriteBmp_(full, w, h, shotBuf)){
                            SetStatus_("Screenshot saved (%dx%d)", w, h);
                            NLog("Screenshot saved %dx%d", w, h);
                        }
                    }
                }
            }
        }
        Sleep(1);
    }
    return 0;
}

DWORD WINAPI CaptureThread_(LPVOID lp){
    App* a = (App*)lp;
    while (a->running){
        a->capture.Run();
        Sleep(50);
    }
    return 0;
}

DWORD WINAPI StatsThread_(LPVOID lp){
    App* a = (App*)lp;
    while (a->running){
        Sleep(500);
        a->pstats = a->perf.Sample();
        a->engine.GetStats(&a->estats);
        // auto-tune
        if (a->fpsTarget > 0 && a->session && !a->selftest && a->estats.fps > 1.0){
            double fps = a->estats.fps;
            int newMaster = a->settings.master;
            if (fps < a->fpsTarget * 0.92 && newMaster > 0)
                newMaster = newMaster - 2 < 0 ? 0 : newMaster - 2;
            else if (fps > a->fpsTarget * 1.15 && newMaster < a->masterCeil)
                newMaster = newMaster + 1 > a->masterCeil ? a->masterCeil : newMaster + 1;
            if (newMaster != a->settings.master){
                EnterCriticalSection(&a->cs);
                a->settings.master = newMaster;
                LeaveCriticalSection(&a->cs);
                SetStatus_("Auto-optimize: master -> %d (measured %.0f FPS, target %d)",
                           newMaster, fps, a->fpsTarget);
                NLog("Auto-optimize: master=%d fps=%.0f target=%d", newMaster, fps, a->fpsTarget);
                SaveMainSettings_();
            }
        }
        // update HUD
        a->RenderHud_();
    }
    return 0;
}

DWORD WINAPI WatcherThread_(LPVOID lp){
    App* a = (App*)lp;
    while (a->running){
        Sleep(2000);
        // refresh detected windows
        WinInfo arr[64];
        int n = EnumGameWindows_(arr, 64);
        EnterCriticalSection(&a->winCs);
        a->nWindows = n;
        if (n) memcpy(a->windows, arr, sizeof arr[0] * (size_t)n);
        LeaveCriticalSection(&a->winCs);
        // keep overlay glued to the game window
        if (a->session && !a->selftest && a->targetWnd && IsWindow(a->targetWnd)){
            RECT r;
            if (GetWindowRect(a->targetWnd, &r)){
                int w = r.right - r.left, h = r.bottom - r.top;
                RECT or2;
                GetWindowRect(a->hwndOverlay, &or2);
                if (w != a->targetW || h != a->targetH ||
                    or2.left != r.left || or2.top != r.top){
                    a->targetW = w; a->targetH = h;
                    SetWindowPos(a->hwndOverlay, HWND_TOPMOST, r.left, r.top, w, h,
                                 SWP_NOACTIVATE);
                    a->resizeReq = 1;
                    // crop for capture (monitor-relative)
                    HMONITOR mon = MonitorFromRect(&r, MONITOR_DEFAULTTONEAREST);
                    MONITORINFO mi; mi.cbSize = sizeof mi;
                    if (mon && GetMonitorInfoW(mon, &mi))
                        a->capture.SetCrop(r.left - mi.rcMonitor.left,
                                           r.top - mi.rcMonitor.top, w, h);
                }
            }
        }
        // watch for game close
        if (a->session && !a->selftest &&
            (!a->targetWnd || !IsWindow(a->targetWnd) || !ProcessAlive_(a->targetPid))){
            NLog("Target window/process gone - stopping session");
            a->StopSession_(0);
        }
    }
    return 0;
}

// ---------------------------------------------------------------- main
static void Hotkeys_(App* a){
    int k9 = (GetAsyncKeyState(VK_F9) & 0x8000) && (GetKeyState(VK_CONTROL) & 0x8000);
    if (k9 && !a->hkF9Prev){
        a->beforeAfter = !a->beforeAfter;
        a->split = -1;
        SetStatus_(a->beforeAfter ? "Showing ORIGINAL" : "Showing ENHANCED");
    }
    a->hkF9Prev = k9;
    int k10 = GetAsyncKeyState(VK_F10) & 0x8000;
    if (k10 && !a->hkF10Prev){
        a->split = (a->split >= 0) ? -1 : 500;
        a->beforeAfter = 0;
        SetStatus_(a->split >= 0 ? "Split view ON (F10 off)" : "Split view OFF");
    }
    a->hkF10Prev = k10;
    int k11 = GetAsyncKeyState(VK_F11) & 0x8000;
    if (k11 && !a->hkF11Prev){
        if (a->session){
            if (IsWindowVisible(a->hwndOverlay)) ShowWindow(a->hwndOverlay, SW_HIDE);
            else ShowWindow(a->hwndOverlay, SW_SHOWNOACTIVATE);
        }
    }
    a->hkF11Prev = k11;
    int k12 = GetAsyncKeyState(VK_F12) & 0x8000;
    if (k12 && !a->hkF12Prev) a->shotReq = 1;
    a->hkF12Prev = k12;
}

static void ResizeToClient_(HWND h, int cw, int ch){
    RECT rc = { 0, 0, cw, ch };
    AdjustWindowRect(&rc, GetWindowLongW(h, GWL_STYLE) & 0x02FFFFFF, FALSE);
    SetWindowPos(h, 0, 0, 0, rc.right - rc.left, rc.bottom - rc.top,
                 SWP_NOMOVE | SWP_NOZORDER);
}

int AppMain_(int argc, char** argv){
    typedef int (WINAPI *DpiFn)(HANDLE);
    DpiFn dpiFn = (DpiFn)GetProcAddress(GetModuleHandleW(L"user32"), "SetProcessDpiAwarenessContext");
    if (dpiFn) dpiFn((HANDLE)-4); // PER_MONITOR_AWARE_V2
    for (int i = 1; i < argc; i++){
        if (!strcmp(argv[i], "--verbose")) g_app.verbose = true;
    }

    InitializeCriticalSection(&g_app.cs);
    InitializeCriticalSection(&g_app.winCs);
    InitializeCriticalSection(&g_app.prevCs);
    InitializeCriticalSection(&g_app.hudCs);

    SettingsDefault(&g_app.settings);
    LoadMainSettings_();

    // window classes
    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof wc);
    wc.cbSize = sizeof wc;
    wc.lpfnWndProc = AppWinProc_;
    wc.hInstance = GetModuleHandleW(0);
    wc.hCursor = LoadCursorW(0, MAKEINTRESOURCEW(32512));
    wc.lpszClassName = L"NexusMain";
    RegisterClassExW(&wc);
    WNDCLASSEXW wo;
    ZeroMemory(&wo, sizeof wo);
    wo.cbSize = sizeof wo;
    wo.lpfnWndProc = AppWinProc_;
    wo.hInstance = GetModuleHandleW(0);
    wo.lpszClassName = L"NexusOverlay";
    RegisterClassExW(&wo);

    g_app.hwnd = CreateWindowExW(0, L"NexusMain", L"Nexus Graphics Engine",
                                 WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU |
                                 WS_MINIMIZEBOX | WS_THICKFRAME,
                                 CW_USEDEFAULT, CW_USEDEFAULT, 1280, 860,
                                 0, 0, GetModuleHandleW(0), 0);
    if (!g_app.hwnd){ NLog("main window failed"); return 1; }
    g_app.hwndOverlay = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW,
                                        L"NexusOverlay", L"NexusOverlay", WS_POPUP,
                                        0, 0, 1280, 720, 0, 0, GetModuleHandleW(0), 0);
    if (!g_app.hwndOverlay){ NLog("overlay window failed"); return 1; }
    ResizeToClient_(g_app.hwnd, 1240, 800);
    RECT rc;
    GetClientRect(g_app.hwnd, &rc);
    g_app.winW = rc.right;
    g_app.winH = rc.bottom;

    // UI backbuffer
    ZeroMemory(&g_app.bmi, sizeof g_app.bmi);
    g_app.bmi.bmiHeader.biSize = sizeof g_app.bmi.bmiHeader;
    g_app.bmi.bmiHeader.biWidth = g_app.winW;
    g_app.bmi.bmiHeader.biHeight = -g_app.winH;
    g_app.bmi.bmiHeader.biPlanes = 1;
    g_app.bmi.bmiHeader.biBitCount = 32;
    g_app.bmi.bmiHeader.biCompression = BI_RGB;
    g_app.uiDc = CreateCompatibleDC(0);
    g_app.uiPix = 0;
    g_app.uiBmp = CreateDIBSection(0, &g_app.bmi, DIB_RGB_COLORS, (void**)&g_app.uiPix, 0, 0);
    if (!g_app.uiPix){ NLog("DIB allocation failed"); return 3; }
    SelectObject(g_app.uiDc, g_app.uiBmp);

    // engine
    if (g_app.engine.Init(g_app.hwndOverlay, 1280, 720)){
        NLog("Engine init failed: %s", g_app.engine.LastError());
        MessageBoxW(0, L"Could not initialize the D3D11 engine. "
                     L"This application requires a D3D11-capable GPU or WARP.",
                    L"Nexus Graphics Engine", MB_ICONERROR);
        return 2;
    }
    g_app.hdrSupported = g_app.engine.HdrColorSpaceSupported() ? 1 : 0;
    NLog("HDR extended color space: %s", g_app.hdrSupported ? "supported" : "not supported");

    // hardware detection (needs focus window = main)
    g_app.hw = DetectHardware(g_app.engine.Factory(), g_app.engine.Dev(), g_app.hwnd);
    NLog("HW: %s | %d MB VRAM | %d MB RAM | %dx%d@%.0fHz",
         g_app.hw.gpu, g_app.hw.vramMB, g_app.hw.ramMB,
         g_app.hw.monW, g_app.hw.monH, g_app.hw.refresh);

    g_app.perf.Start();
    g_app.running = 1;

    g_app.hEngine = CreateThread(0, 0, EngineThread_, &g_app, 0, 0);
    g_app.hCapture = CreateThread(0, 0, CaptureThread_, &g_app, 0, 0);
    g_app.hStats = CreateThread(0, 0, StatsThread_, &g_app, 0, 0);
    g_app.hWatcher = CreateThread(0, 0, WatcherThread_, &g_app, 0, 0);

    ShowWindow(g_app.hwnd, SW_SHOW);
    UpdateWindow(g_app.hwnd);
    SetStatus_("Ready - select a game, choose MAX, then Start");

    // message loop
    MSG msg;
    bool quit = false;
    while (!quit){
        if (PeekMessageW(&msg, 0, 0, 0, PM_REMOVE)){
            if (msg.message == WM_QUIT){ quit = true; break; }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Hotkeys_(&g_app);
        // wheel scroll -> current page
        if (g_app.wheelPulse && g_app.page == 1){
            int maxScroll = 900 - (g_app.winH - 58 - 40);
            if (maxScroll < 0) maxScroll = 0;
            int ns = g_app.uiScroll[1] - g_app.wheelDir * 60;
            if (ns < 0) ns = 0;
            if (ns > maxScroll) ns = maxScroll;
            g_app.uiScroll[1] = ns;
        }
        Sleep(8);
    }

    // shutdown
    g_app.running = 0;
    g_app.StopSession_(1);
    if (g_app.hEngine) WaitForSingleObject(g_app.hEngine, 1500);
    if (g_app.hCapture) WaitForSingleObject(g_app.hCapture, 1500);
    if (g_app.hStats) WaitForSingleObject(g_app.hStats, 1500);
    if (g_app.hWatcher) WaitForSingleObject(g_app.hWatcher, 1500);
    g_app.engine.Shutdown();
    g_app.perf.Stop();
    SaveMainSettings_();
    if (g_app.uiBmp) DeleteObject(g_app.uiBmp);
    if (g_app.uiDc) DeleteDC(g_app.uiDc);
    DestroyWindow(g_app.hwndOverlay);
    DestroyWindow(g_app.hwnd);
    return 0;
}
