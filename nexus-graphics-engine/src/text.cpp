#include "text.h"
#include <stdarg.h>
#include "font.h"

FontDef Font1_(void){ FontDef f = { NEXUS_FONT1_W, NEXUS_FONT1_H, FONT1_PX, FONT1_ADV }; return f; }
FontDef Font2_(void){ FontDef f = { NEXUS_FONT2_W, NEXUS_FONT2_H, FONT2_PX, FONT2_ADV }; return f; }
static FontDef g_font1 = { NEXUS_FONT1_W, NEXUS_FONT1_H, FONT1_PX, FONT1_ADV };
static FontDef g_font2 = { NEXUS_FONT2_W, NEXUS_FONT2_H, FONT2_PX, FONT2_ADV };
const FontDef* Font1P_(void){ return &g_font1; }
const FontDef* Font2P_(void){ return &g_font2; }

static int ch_ok_(unsigned char c){ return c >= NEXUS_FONT_FIRST && c <= NEXUS_FONT_LAST; }

void TextBegin(TextCtx* t, unsigned int bg){
    for (int i = 0; i < t->w * t->h; i++) t->buf[i] = bg;
}

void TextPanel(TextCtx* t, int x, int y, int w, int h, unsigned int bg){
    for (int r = y; r < y + h; r++){
        if (r < 0 || r >= t->h) continue;
        for (int c = x; c < x + w; c++){
            if (c < 0 || c >= t->w) continue;
            t->buf[r * t->w + c] = bg;
        }
    }
}

int TextWidth_(const char* s, const FontDef* f){
    int w = 0;
    for (const char* p = s; *p; p++){
        unsigned char c = (unsigned char)*p;
        if (ch_ok_((unsigned char)c)) w += f->adv[c - NEXUS_FONT_FIRST];
        else w += f->w;
    }
    return w;
}

static void blit_glyph(TextCtx* t, const FontDef* f, int x, int y, int gi, unsigned int color){
    unsigned int r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255, a = (color >> 24) & 255;
    const unsigned char* gp = f->px + (size_t)gi * f->h * f->w;
    for (int ry = 0; ry < f->h; ry++){
        int py = y + ry;
        if (py < 0 || py >= t->h) continue;
        for (int px_ = 0; px_ < f->w; px_++){
            int cx = x + px_;
            if (cx < 0 || cx >= t->w) continue;
            unsigned char ga = gp[ry * f->w + px_];
            if (!ga) continue;
            size_t i = (size_t)py * t->w + cx;
            unsigned int d = t->buf[i];
            // source-over with premultiplied gray alpha
            int sa = (int)ga * (int)a / 255;
            int dr = (int)(d & 255), dg = (int)((d >> 8) & 255), db = (int)((d >> 16) & 255), da = (int)((d >> 24) & 255);
            int orr = (int)((long)r * sa + dr * (255 - sa)) / 255;
            int og =  (int)((long)g * sa + dg * (255 - sa)) / 255;
            int ob =  (int)((long)b * sa + db * (255 - sa)) / 255;
            int oa = (int)((long)sa + da * (255 - sa)) / 255;
            t->buf[i] = (unsigned int)(((oa & 255) << 24) | ((ob & 255) << 16) | ((og & 255) << 8) | (orr & 255));
        }
    }
}

void TextDraw(TextCtx* t, const char* s, int x, int y, unsigned int color, const FontDef* f){
    int cx = x;
    for (const char* p = s; *p; p++){
        unsigned char c = (unsigned char)*p;
        if (!ch_ok_(c)){ cx += f->w; continue; }
        if (c == '\n'){ cx = x; y += f->h + 2; continue; }
        blit_glyph(t, f, cx, y, (int)(c - NEXUS_FONT_FIRST), color);
        cx += f->adv[c - NEXUS_FONT_FIRST];
    }
}

void TextFmt(TextCtx* t, int x, int y, unsigned int color, const FontDef* f, const char* fmt, ...){
    char buf[512];
    va_list ap; va_start(ap, fmt);
    _vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    TextDraw(t, buf, x, y, color, f);
}
