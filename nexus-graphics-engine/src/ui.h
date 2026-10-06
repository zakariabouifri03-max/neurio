// Immediate-mode UI drawn into an RGBA8 (0xAABBGGRR) surface, blitted via GDI.
#pragma once
#include "common.h"
#include "text.h"

namespace UI {

struct Ctx {
    unsigned int* pix;
    TextCtx tc;
    int w, h;
    int mx, my;
    bool down;
    int dragId;       // currently dragging slider id
    float dragOff;
    int comboOpen;    // open combo id
    int focusBtn;
};

void Theme(Ctx* c);                    // sets palette defaults (no-op, colors are globals)
void Begin(Ctx* c, unsigned int* pix, int w, int h, int mx, int my, bool down);
bool InRectPub(int mx, int my, int x, int y, int w, int h);

void Fill(Ctx* c, int x, int y, int w, int h, unsigned int col);
void RectBorder(Ctx* c, int x, int y, int w, int h, unsigned int col);
void Panel(Ctx* c, int x, int y, int w, int h, const char* title);
void GroupTitle(Ctx* c, const char* t, int x, int y, int w);
void Label_(Ctx* c, const char* s, int x, int y, unsigned int col);
void LabelR(Ctx* c, const char* s, int x, int y, int w, unsigned int col);
bool Button(Ctx* c, const char* label, int x, int y, int w, int h, int id);
bool ButtonIcon(Ctx* c, const char* glyph, int x, int y, int s, int id); // small square button
void Slider(Ctx* c, const char* label, int* val, int x, int y, int w, int h, int id, int minV, int maxV);
void SliderBar(Ctx* c, int* val, int x, int y, int w, int h, int id, int minV, int maxV);
void Check(Ctx* c, const char* label, int* val, int x, int y);
int  Combo(Ctx* c, const char* label, int sel, const char** items, int n,
           int x, int y, int w, int id);
void ListItem(Ctx* c, int x, int y, int w, int h, const char* l1, const char* l2,
              bool sel, int hotId, bool* clicked);
int  Scrollbar(Ctx* c, int scroll, int maxScroll, int x, int y, int h, int id);
void ProgressBar(Ctx* c, int x, int y, int w, int h, double frac, unsigned int col);

// palette
extern unsigned int COL_BG, COL_PANEL, COL_PANEL2, COL_BORDER, COL_TEXT, COL_DIM;
extern unsigned int COL_ACCENT, COL_GOOD, COL_WARN, COL_BAD, COL_TRACK;

} // namespace UI
