#pragma once

#ifdef _WIN32

#include "Common.h"
#include "Theme.h"
#include <windows.h>

struct KeyGeom {
    RECT rc {};
    int  midi = 0;
    bool black = false;
};

class PianoKeyboard {
public:
    void layout(RECT pianoArea);

    int  hitTest(int x, int y) const; // midi or -1
    const KeyGeom* key(int midi) const;

    void draw(HDC hdc, const Theme& th, const uint8_t visual[128],
              float pressAmt[88], int practiceMidi, int hoverMidi,
              bool showLabels, bool showCompKeys, const int keyMap[256],
              int octave, float scale);

    RECT area() const { return area_; }

    static void vkLabel(int vk, wchar_t* out, int n);

private:
    RECT area_ {};
    KeyGeom keys_[88] {};
    int whiteW_ = 16;
    int blackW_ = 10;
};

#endif
