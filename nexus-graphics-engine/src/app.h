// NEXUS GRAPHICS ENGINE - application: window, threads, hotkeys, UI.
#pragma once
#include "common.h"
#include "engine.h"
#include "capture.h"
#include "platform.h"
#include "ui.h"
#include "text.h"

#define MAX_GAMES 32

struct GameEntry {
    char name[80];
    char exe[260];
    int inW, inH;
};

struct App {
    // window
    HINSTANCE hInst;
    HWND hwnd;
    HWND hwndOverlay;
    int winW, winH;
    bool verbose;
    int hdrSupported;
    int masterCeil;
    volatile long shotReq;
    volatile long resizeReq;
    int wheelPulse;

    // subsystems
    Engine engine;
    Capture capture;
    PerfMon perf;

    // threads
    HANDLE hEngine;
    HANDLE hCapture;
    HANDLE hStats;
    HANDLE hWatcher;
    HANDLE hDone;
    volatile long running;

    // settings (protected by cs)
    NexusSettings settings;
    CRITICAL_SECTION cs;

    // registered games (persisted to settings.json)
    GameEntry games[MAX_GAMES];
    int nGames;
    int selGame;

    // detected windows (watcher updates; UI reads a snapshot)
    CRITICAL_SECTION winCs;
    WinInfo windows[64];
    int nWindows;
    double lastWinScan;

    // session
    int session;            // 0 idle, 1 active
    HWND targetWnd;
    DWORD targetPid;
    char targetName[120];
    char targetExe[260];
    int targetW, targetH;

    // comparison
    int beforeAfter;        // 0 enhanced, 1 original (CTRL+F9)
    int split;              // -1 off, else 0..1000
    int overlayShown;       // overlay window visible
    int selftest;           // selftest session flag
    int selftestRes;        // 0 720p 1 1080p 2 1440p
    int hdrOutput;          // extended color space (only if supported)

    // stats snapshots
    EngineStats estats;
    PerfSample pstats;
    double lastStatsT;
    double autoTuneT;
    int fpsTarget;          // 0 off, else 30/60/90/120/144

    // preview thumbnails (stats thread)
    unsigned int prevE[160 * 90];
    unsigned int prevO[160 * 90];
    bool prevOk;
    CRITICAL_SECTION prevCs;

    // HUD
    unsigned int hud[512 * 320];
    CRITICAL_SECTION hudCs;

    // hardware
    HwInfo hw;

    // engine request
    Engine::FrameReq req;

    // UI state
    int page;
    int mouseX, mouseY;
    bool mouseDown;
    bool mouseWheel; int wheelDir;
    int uiScroll[6];
    unsigned int* uiPix;
    HDC uiDc;
    HBITMAP uiBmp;
    BITMAPINFO bmi;

    // hotkey edge state
    int hkF9Prev, hkF10Prev, hkF11Prev, hkF12Prev;

    // misc
    char statusMsg[200];
    double statusT;
    int lastFocusT;

    // UI
    void Frame_();
    void StartSession_(int selftestMode);
    void StopSession_(int byUser);
    void RenderHud_();
};

extern App g_app;

int AppMain_(int argc, char** argv);
LRESULT CALLBACK AppWinProc_(HWND, UINT, WPARAM, LPARAM);
DWORD WINAPI EngineThread_(LPVOID);
DWORD WINAPI CaptureThread_(LPVOID);
DWORD WINAPI StatsThread_(LPVOID);
DWORD WINAPI WatcherThread_(LPVOID);
