// CPU text rasterizer: blits the embedded bitmap font into an RGBA8 buffer.
// Used for the in-game HUD and the main-window preview labels.
#pragma once
#include "common.h"

typedef struct {
    int w, h;               // cell size
    const unsigned char* px;   // 95 * h * w grayscale
    const unsigned char* adv;  // 95 advance widths
} FontDef;

typedef struct {
    unsigned int* buf;      // RGBA, little-endian 0xAABBGGRR
    int w, h;
} TextCtx;

static const FontDef FONT1 = { 10, 14, (const unsigned char*)0, 0 }; // replaced at init
static const FontDef FONT2 = { 20, 28, (const unsigned char*)0, 0 };

FontDef Font1_(void);
FontDef Font2_(void);
const FontDef* Font1P_(void);
const FontDef* Font2P_(void);

void TextBegin(TextCtx* t, unsigned int bg);
void TextPanel(TextCtx* t, int x, int y, int w, int h, unsigned int bg);
int TextWidth_(const char* s, const FontDef* f);
void TextDraw(TextCtx* t, const char* s, int x, int y, unsigned int color, const FontDef* f);
// format + draw
void TextFmt(TextCtx* t, int x, int y, unsigned int color, const FontDef* f, const char* fmt, ...);
