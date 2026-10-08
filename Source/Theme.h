#pragma once

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

struct Theme {
    bool light = false;
#ifdef _WIN32
    COLORREF bg, panel, panelAlt, stroke;
    COLORREF text, textDim, accent, accent2;
    COLORREF danger, ok, whiteKey, whiteKeyDown, blackKey, blackKeyDown;
    COLORREF whiteKeyEdge, practice, meter, topBar;
#endif
};

inline Theme makeTheme(bool light) {
    Theme t;
    t.light = light;
#ifdef _WIN32
    if (light) {
        t.bg          = RGB(236, 237, 241);
        t.panel       = RGB(255, 255, 255);
        t.panelAlt    = RGB(245, 246, 248);
        t.stroke      = RGB(210, 214, 222);
        t.text        = RGB(28, 32, 40);
        t.textDim     = RGB(90, 96, 108);
        t.accent      = RGB(184, 140, 20);
        t.accent2     = RGB(212, 175, 55);
        t.danger      = RGB(196, 48, 48);
        t.ok          = RGB(22, 140, 90);
        t.whiteKey    = RGB(250, 248, 242);
        t.whiteKeyDown= RGB(232, 197, 71);
        t.blackKey    = RGB(28, 30, 34);
        t.blackKeyDown= RGB(196, 154, 32);
        t.whiteKeyEdge= RGB(198, 196, 188);
        t.practice    = RGB(32, 140, 190);
        t.meter       = RGB(80, 180, 120);
        t.topBar      = RGB(250, 250, 252);
    } else {
        t.bg          = RGB(16, 18, 24);
        t.panel       = RGB(28, 31, 40);
        t.panelAlt    = RGB(36, 40, 52);
        t.stroke      = RGB(52, 58, 72);
        t.text        = RGB(232, 234, 240);
        t.textDim     = RGB(140, 146, 160);
        t.accent      = RGB(232, 197, 71);
        t.accent2     = RGB(212, 160, 32);
        t.danger      = RGB(226, 70, 70);
        t.ok          = RGB(62, 207, 142);
        t.whiteKey    = RGB(244, 241, 234);
        t.whiteKeyDown= RGB(232, 197, 71);
        t.blackKey    = RGB(18, 18, 20);
        t.blackKeyDown= RGB(201, 162, 39);
        t.whiteKeyEdge= RGB(28, 28, 30);
        t.practice    = RGB(64, 196, 230);
        t.meter       = RGB(62, 207, 142);
        t.topBar      = RGB(22, 24, 32);
    }
#endif
    return t;
}

#ifdef _WIN32
inline COLORREF lerpColor(COLORREF a, COLORREF b, float t) {
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    auto ch = [&](int shift) {
        int ca = (a >> shift) & 255;
        int cb = (b >> shift) & 255;
        return (int)(ca + (cb - ca) * t);
    };
    return RGB(ch(0), ch(8), ch(16));
}
#endif
