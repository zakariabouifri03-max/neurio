#include "ui.h"
#include <string.h>
#include <stdio.h>

namespace UI {

unsigned int COL_BG = 0xF414171D;
unsigned int COL_PANEL = 0xF41B2029;
unsigned int COL_PANEL2 = 0xF4232936;
unsigned int COL_BORDER = 0x6639404E;
unsigned int COL_TEXT = 0xFFE9EDF5;
unsigned int COL_DIM = 0xFF8B94A7;
unsigned int COL_ACCENT = 0xFF4DA3FF;
unsigned int COL_GOOD = 0xFF43D07A;
unsigned int COL_WARN = 0xFFFFB84C;
unsigned int COL_BAD = 0xFFFF6B5E;
unsigned int COL_TRACK = 0xF4101319;

void Theme(Ctx* c){ (void)c; }

bool InRectPub(int mx, int my, int x, int y, int w, int h){
    return mx >= x && mx < x + w && my >= y && my < y + h;
}
#define InRect InRectPub

void Begin(Ctx* c, unsigned int* pix, int w, int h, int mx, int my, bool down){
    c->pix = pix; c->w = w; c->h = h;
    c->tc.buf = pix; c->tc.w = w; c->tc.h = h;
    c->mx = mx; c->my = my; c->down = down;
    c->dragId = -1; c->dragOff = 0;
}

void Fill(Ctx* c, int x, int y, int w, int h, unsigned int col){
    if (x < 0){ w += x; x = 0; }
    if (y < 0){ h += y; y = 0; }
    if (x >= c->w || y >= c->h || w <= 0 || h <= 0) return;
    if (x + w > c->w) w = c->w - x;
    if (y + h > c->h) h = c->h - y;
    for (int r = 0; r < h; r++){
        unsigned int* row = c->pix + (size_t)(y + r) * c->w + x;
        for (int i = 0; i < w; i++) row[i] = col;
    }
}

void RectBorder(Ctx* c, int x, int y, int w, int h, unsigned int col){
    Fill(c, x, y, w, 1, col);
    Fill(c, x, y + h - 1, w, 1, col);
    Fill(c, x, y, 1, h, col);
    Fill(c, x + w - 1, y, 1, h, col);
}

void Panel(Ctx* c, int x, int y, int w, int h, const char* title){
    Fill(c, x, y, w, h, COL_PANEL);
    RectBorder(c, x, y, w, h, COL_BORDER);
    if (title){
        Fill(c, x + 1, y + 1, w - 2, 24, COL_PANEL2);
        Label_(c, title, x + 8, y + 5, COL_TEXT);
        Fill(c, x + 1, y + 25, w - 2, 1, COL_BORDER);
    }
}

void GroupTitle(Ctx* c, const char* t, int x, int y, int w){
    (void)w;
    Label_(c, t, x, y, COL_ACCENT);
    Fill(c, x, y + 18, 46, 1, COL_ACCENT);
}

void Label_(Ctx* c, const char* s, int x, int y, unsigned int col){
    TextDraw(&c->tc, s, x, y, col, Font1P_());
}

void LabelR(Ctx* c, const char* s, int x, int y, int w, unsigned int col){
    int tw = TextWidth_(s, Font1P_());
    Label_(c, s, x + w - tw, y, col);
}

bool Button(Ctx* c, const char* label, int x, int y, int w, int h, int id){
    (void)id;
    bool hot = InRect(c->mx, c->my, x, y, w, h);
    bool click = hot && c->down;
    Fill(c, x, y, w, h, hot ? COL_PANEL2 : COL_PANEL);
    RectBorder(c, x, y, w, h, hot ? COL_ACCENT : COL_BORDER);
    int tw = TextWidth_(label, Font1P_());
    Label_(c, label, x + (w - tw) / 2, y + (h - 14) / 2, hot ? COL_TEXT : COL_DIM);
    return click;
}

bool ButtonIcon(Ctx* c, const char* glyph, int x, int y, int s, int id){
    return Button(c, glyph, x, y, s, s, id);
}

void SliderBar(Ctx* c, int* val, int x, int y, int w, int h, int id, int minV, int maxV){
    int trackX = x, trackW = w - 36;
    int ty = y + h / 2 - 2;
    bool hot = InRect(c->mx, c->my, x, y, w, h);
    if (hot && c->down && c->dragId != id){
        c->dragId = id;
        c->dragOff = 0;
    }
    if (c->dragId == id){
        float t = (float)(c->mx - trackX) / (float)trackW;
        if (t < 0) t = 0; if (t > 1) t = 1;
        int v = minV + (int)(t * (maxV - minV) + 0.5f);
        if (v < minV) v = minV;
        if (v > maxV) v = maxV;
        *val = v;
    }
    int cur = *val;
    if (cur < minV) cur = minV;
    if (cur > maxV) cur = maxV;
    float t = (maxV > minV) ? (float)(cur - minV) / (float)(maxV - minV) : 0;
    Fill(c, trackX, ty, trackW, 4, COL_TRACK);
    Fill(c, trackX, ty, (int)(t * trackW + 0.5f), 4, COL_ACCENT);
    int kx = trackX + (int)(t * trackW);
    Fill(c, kx - 3, ty - 3, 7, 10, hot || c->dragId == id ? COL_TEXT : COL_ACCENT);
    char tmp[32];
    snprintf(tmp, sizeof tmp, "%d", *val);
    LabelR(c, tmp, trackX, y + h / 2 - 7, 32, COL_DIM);
}

void Slider(Ctx* c, const char* label, int* val, int x, int y, int w, int h, int id,
            int minV, int maxV){
    Label_(c, label, x, y + h / 2 - 7, COL_TEXT);
    int lw = TextWidth_(label, Font1P_()) + 12;
    SliderBar(c, val, x + lw, y, w - lw, h, id, minV, maxV);
}

void Check(Ctx* c, const char* label, int* val, int x, int y){
    bool hot = InRect(c->mx, c->my, x, y, TextWidth_(label, Font1P_()) + 24, 18);
    if (hot && c->down) *val = !*val;
    Fill(c, x, y + 1, 13, 13, *val ? COL_ACCENT : COL_TRACK);
    RectBorder(c, x, y + 1, 13, 13, *val ? COL_ACCENT : COL_BORDER);
    if (*val)
        Label_(c, "x", x + 4, y + 0, 0xFF101418);
    Label_(c, label, x + 20, y, hot ? COL_TEXT : COL_DIM);
}

int Combo(Ctx* c, const char* label, int sel, const char** items, int n,
          int x, int y, int w, int id){
    bool hot = InRect(c->mx, c->my, x, y, w, 22);
    if (hot && c->down){
        c->comboOpen = (c->comboOpen == id) ? -1 : id;
        return -1;
    }
    char tmp[160];
    if (sel >= 0 && sel < n) strncpy(tmp, items[sel], sizeof tmp - 1);
    else tmp[0] = 0;
    tmp[sizeof tmp - 1] = 0;
    Fill(c, x, y, w, 22, COL_TRACK);
    RectBorder(c, x, y, w, 22, hot ? COL_ACCENT : COL_BORDER);
    Label_(c, label, x + 6, y + 4, COL_TEXT);
    LabelR(c, tmp, x + 6, y + 4, w - 12, COL_DIM);
    Label_(c, "v", x + w - 16, y + 4, COL_DIM);
    int chosen = -1;
    if (c->comboOpen == id){
        int ox = x, oy = y + 23;
        Fill(c, ox, oy, w, n * 22, COL_PANEL2);
        RectBorder(c, ox, oy, w, n * 22, COL_ACCENT);
        for (int i = 0; i < n; i++){
            bool ih = InRect(c->mx, c->my, ox, oy + i * 22, w, 22);
            if (ih) Fill(c, ox, oy + i * 22, w, 22, COL_PANEL);
            if (i == sel) Fill(c, ox, oy + i * 22, 2, 22, COL_ACCENT);
            Label_(c, items[i], ox + 10, oy + i * 22 + 4, COL_TEXT);
            if (ih && c->down){
                chosen = i;
                c->comboOpen = -1;
            }
        }
    }
    return chosen;
}

void ListItem(Ctx* c, int x, int y, int w, int h, const char* l1, const char* l2,
              bool sel, int hotId, bool* clicked){
    (void)hotId;
    bool hot = InRect(c->mx, c->my, x, y, w, h);
    if (hot && c->down) *clicked = true;
    Fill(c, x, y, w, h, sel ? COL_PANEL2 : COL_PANEL);
    RectBorder(c, x, y, w, h, sel ? COL_ACCENT : COL_BORDER);
    Label_(c, l1, x + 8, y + 3, sel ? COL_TEXT : COL_DIM);
    if (l2 && l2[0]) Label_(c, l2, x + 8, y + 19, COL_DIM);
}

int Scrollbar(Ctx* c, int scroll, int maxScroll, int x, int y, int h, int id){
    (void)id;
    if (maxScroll <= 0) return 0;
    Fill(c, x, y, 6, h, COL_TRACK);
    int thumbH = (int)((double)h * (double)(h) / (double)(h + maxScroll));
    if (thumbH < 20) thumbH = 20;
    int thumbY = y + (int)((double)scroll / (double)maxScroll * (h - thumbH));
    Fill(c, x, thumbY, 6, thumbH, COL_DIM);
    int delta = 0;
    if (InRect(c->mx, c->my, x - 4, y, 14, h) && c->down){
        int rows = (h - thumbH) > 0 ? (h - thumbH) : 1;
        int row = (c->my - y) * (maxScroll + h) / rows - (maxScroll + h) / 2;
        int ns = scroll + row;
        if (ns < 0) ns = 0;
        if (ns > maxScroll) ns = maxScroll;
        delta = ns - scroll;
        if (delta) scroll += delta;
    }
    return delta;
}

void ProgressBar(Ctx* c, int x, int y, int w, int h, double frac, unsigned int col){
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    Fill(c, x, y, w, h, COL_TRACK);
    Fill(c, x, y, (int)(frac * w + 0.5), h, col);
}

} // namespace UI
