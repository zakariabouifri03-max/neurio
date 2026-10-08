#ifdef _WIN32

#include "PianoKeyboard.h"
#include <cmath>

void PianoKeyboard::layout(RECT pianoArea) {
    area_ = pianoArea;
    const int W = pianoArea.right - pianoArea.left;
    const int H = pianoArea.bottom - pianoArea.top;
    if (W < 10 || H < 10) return;

    const int whites = whiteKeyCount();
    whiteW_ = W / whites;
    if (whiteW_ < 4) whiteW_ = 4;
    blackW_ = (int)(whiteW_ * 0.58);
    if (blackW_ < 3) blackW_ = 3;
    const int blackH = (int)(H * 0.62);

    int wi = 0;
    for (int i = 0; i < 88; ++i) {
        const int midi = kMinNote + i;
        keys_[i].midi = midi;
        keys_[i].black = isBlackKey(midi);
        if (!keys_[i].black) {
            const int x = pianoArea.left + wi * whiteW_;
            keys_[i].rc = { x, pianoArea.top, x + whiteW_ - 1, pianoArea.bottom };
            ++wi;
        }
    }
    // Black keys sit between whites
    for (int i = 0; i < 88; ++i) {
        if (!keys_[i].black) continue;
        const int midi = keys_[i].midi;
        // previous white
        int prevW = -1;
        for (int j = i - 1; j >= 0; --j) {
            if (!keys_[j].black) { prevW = j; break; }
        }
        int xCenter;
        if (prevW >= 0)
            xCenter = keys_[prevW].rc.right;
        else
            xCenter = pianoArea.left + blackW_ / 2;
        const int x = xCenter - blackW_ / 2;
        keys_[i].rc = { x, pianoArea.top, x + blackW_, pianoArea.top + blackH };
    }
}

int PianoKeyboard::hitTest(int x, int y) const {
    // Black keys first
    for (int i = 0; i < 88; ++i) {
        if (!keys_[i].black) continue;
        const RECT& r = keys_[i].rc;
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom)
            return keys_[i].midi;
    }
    for (int i = 0; i < 88; ++i) {
        if (keys_[i].black) continue;
        const RECT& r = keys_[i].rc;
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom)
            return keys_[i].midi;
    }
    return -1;
}

const KeyGeom* PianoKeyboard::key(int midi) const {
    if (midi < kMinNote || midi > kMaxNote) return nullptr;
    return &keys_[midi - kMinNote];
}

void PianoKeyboard::vkLabel(int vk, wchar_t* out, int n) {
    if (!out || n < 2) return;
    out[0] = 0;
    if (vk >= 'A' && vk <= 'Z') {
        out[0] = (wchar_t)vk;
        out[1] = 0;
        return;
    }
    if (vk >= '0' && vk <= '9') {
        out[0] = (wchar_t)vk;
        out[1] = 0;
        return;
    }
    const wchar_t* s = nullptr;
    switch (vk) {
        case 0xBA: s = L";"; break;
        case 0xDE: s = L"'"; break;
        case 0xBC: s = L","; break;
        case 0xBE: s = L"."; break;
        case 0xBF: s = L"/"; break;
        case VK_SPACE: s = L"Spc"; break;
        default: s = L""; break;
    }
    wcsncpy(out, s, n - 1);
    out[n - 1] = 0;
}

static void fillRound(HDC hdc, RECT r, COLORREF c, int rad) {
    HBRUSH br = CreateSolidBrush(c);
    HPEN pen = CreatePen(PS_SOLID, 1, c);
    HGDIOBJ ob = SelectObject(hdc, br);
    HGDIOBJ op = SelectObject(hdc, pen);
    if (rad <= 0) {
        Rectangle(hdc, r.left, r.top, r.right, r.bottom);
    } else {
        RoundRect(hdc, r.left, r.top, r.right, r.bottom, rad, rad);
    }
    SelectObject(hdc, ob);
    SelectObject(hdc, op);
    DeleteObject(br);
    DeleteObject(pen);
}

void PianoKeyboard::draw(HDC hdc, const Theme& th, const uint8_t visual[128],
                         float pressAmt[88], int practiceMidi, int hoverMidi,
                         bool showLabels, bool showCompKeys, const int keyMap[256],
                         int octave, float scale) {
    // Shadow under keyboard
    RECT shadow = area_;
    shadow.top = shadow.bottom - 6;
    fillRound(hdc, shadow, RGB(0, 0, 0), 0);

    const int bodyH = area_.bottom - area_.top;
    const int fontPx = clampi((int)(11 * scale), 9, 16);
    HFONT font = CreateFontW(-fontPx, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0,
                             DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    HFONT fontSm = CreateFontW(-(fontPx - 2), 0, 0, 0, FW_NORMAL, 0, 0, 0,
                               DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    HFONT oldF = (HFONT)SelectObject(hdc, font);
    SetBkMode(hdc, TRANSPARENT);

    // White keys
    for (int i = 0; i < 88; ++i) {
        if (keys_[i].black) continue;
        const int midi = keys_[i].midi;
        const float p = pressAmt[i];
        COLORREF col = lerpColor(th.whiteKey, th.whiteKeyDown, p);
        if (hoverMidi == midi && p < 0.2f)
            col = lerpColor(col, th.accent, 0.12f);
        RECT r = keys_[i].rc;
        // press animation: sink slightly
        r.top += (int)(p * 3);
        fillRound(hdc, r, col, 0);
        // bottom lip
        HPEN pen = CreatePen(PS_SOLID, 1, th.whiteKeyEdge);
        HGDIOBJ op = SelectObject(hdc, pen);
        MoveToEx(hdc, r.left, r.top, nullptr);
        LineTo(hdc, r.left, r.bottom);
        MoveToEx(hdc, r.right - 1, r.top, nullptr);
        LineTo(hdc, r.right - 1, r.bottom);
        SelectObject(hdc, op);
        DeleteObject(pen);

        if (practiceMidi == midi) {
            HPEN pp = CreatePen(PS_SOLID, 3, th.practice);
            HGDIOBJ opp = SelectObject(hdc, GetStockObject(NULL_BRUSH));
            SelectObject(hdc, pp);
            Rectangle(hdc, r.left + 2, r.top + 2, r.right - 2, r.bottom - 2);
            SelectObject(hdc, opp);
            DeleteObject(pp);
        }

        wchar_t label[8];
        noteNameW(midi, label, 8);
        const bool isC = (midi % 12) == 0;
        if (showLabels && (isC || p > 0.5f)) {
            SetTextColor(hdc, p > 0.4f ? RGB(40, 32, 8) : RGB(90, 90, 96));
            RECT tr = r;
            tr.top = r.bottom - (int)(28 * scale);
            DrawTextW(hdc, label, -1, &tr, DT_CENTER | DT_TOP | DT_SINGLELINE);
        }
        if (showCompKeys && keyMap) {
            int foundVk = -1;
            const int base = 12 * (octave + 1);
            const int off = midi - base;
            for (int vk = 0; vk < 256; ++vk) {
                if (keyMap[vk] == off) { foundVk = vk; break; }
            }
            if (foundVk >= 0) {
                wchar_t vkname[8];
                vkLabel(foundVk, vkname, 8);
                SetTextColor(hdc, RGB(150, 140, 90));
                SelectObject(hdc, fontSm);
                RECT tr = r;
                tr.top = r.bottom - (int)(46 * scale);
                DrawTextW(hdc, vkname, -1, &tr, DT_CENTER | DT_TOP | DT_SINGLELINE);
                SelectObject(hdc, font);
            }
        }
        (void)bodyH;
    }

    // Black keys
    for (int i = 0; i < 88; ++i) {
        if (!keys_[i].black) continue;
        const int midi = keys_[i].midi;
        const float p = pressAmt[i];
        COLORREF col = lerpColor(th.blackKey, th.blackKeyDown, p);
        RECT r = keys_[i].rc;
        r.top += (int)(p * 2);
        // 3D black key
        fillRound(hdc, r, col, 4);
        RECT hi = r;
        hi.bottom = r.top + (r.bottom - r.top) / 3;
        fillRound(hdc, hi, lerpColor(col, RGB(70, 70, 74), 0.35f), 4);

        if (practiceMidi == midi) {
            HPEN pp = CreatePen(PS_SOLID, 2, th.practice);
            HGDIOBJ opp = SelectObject(hdc, GetStockObject(NULL_BRUSH));
            SelectObject(hdc, pp);
            RoundRect(hdc, r.left, r.top, r.right, r.bottom, 4, 4);
            SelectObject(hdc, opp);
            DeleteObject(pp);
        }
        if (p > 0.5f && showLabels) {
            wchar_t label[8];
            noteNameW(midi, label, 8);
            SetTextColor(hdc, RGB(40, 32, 8));
            SelectObject(hdc, fontSm);
            RECT tr = r;
            tr.top = r.bottom - (int)(18 * scale);
            DrawTextW(hdc, label, -1, &tr, DT_CENTER | DT_TOP | DT_SINGLELINE);
            SelectObject(hdc, font);
        }
    }

    SelectObject(hdc, oldF);
    DeleteObject(font);
    DeleteObject(fontSm);
}

#endif
