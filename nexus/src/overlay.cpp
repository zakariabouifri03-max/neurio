// NEXUS GRAPHICS ENGINE - HUD overlay implementation (GDI+ layered window)
#include "stdafx.h"
#include "overlay.h"
#include "hwinfo.h"
#include <gdiplus.h>
#include "config.h"

static HudWindow* g_hud = nullptr;

static LRESULT CALLBACK HudWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_NCHITTEST:
        // click-through unless the user enabled overlay interaction
        return HTTRANSPARENT;
    case WM_DESTROY:
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

bool HudWindow::Create() {
    WNDCLASSEXW wc = { sizeof(wc) };
    wc.lpfnWndProc = HudWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"NexusHudWnd";
    RegisterClassExW(&wc);
    hwnd_ = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
        L"NexusHudWnd", L"", WS_POPUP, 0, 0, w_, h_, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!hwnd_) return false;
    g_hud = this;
    Gdiplus::GdiplusStartupInput si;
    if (Gdiplus::GdiplusStartup(&gdipToken_, &si, nullptr) != Gdiplus::Ok) gdipToken_ = 0;
    // exclude from capture (Win10 2004+)
    HMODULE u32 = GetModuleHandleW(L"user32.dll");
    if (u32) {
        typedef BOOL(WINAPI* PFN_SWDA)(HWND, DWORD);
        PFN_SWDA swda = (PFN_SWDA)GetProcAddress(u32, "SetWindowDisplayAffinity");
        if (swda) swda(hwnd_, 0x00000011);
    }
    ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    return true;
}

void HudWindow::Destroy() {
    if (hwnd_) { DestroyWindow(hwnd_); hwnd_ = nullptr; }
    if (gdipToken_) { Gdiplus::GdiplusShutdown(gdipToken_); gdipToken_ = 0; }
}

void HudWindow::SetVisible(bool v) {
    visible_ = v;
    if (hwnd_) ShowWindow(hwnd_, v ? SW_SHOWNOACTIVATE : SW_HIDE);
}

void HudWindow::Nudge() { nudgeUntil_ = GetTickCount() + 1800; }

static void QualityLabelFromFloat(float v, char* out, size_t n) {
    if (v <= 0.01f) strcpy_s(out, n, "OFF");
    else if (v < 0.3f) strcpy_s(out, n, "LOW");
    else if (v < 0.5f) strcpy_s(out, n, "MEDIUM");
    else if (v < 0.7f) strcpy_s(out, n, "HIGH");
    else if (v < 0.88f) strcpy_s(out, n, "ULTRA");
    else strcpy_s(out, n, "EXTREME");
}

void HudWindow::Tick(const FrameParams& params, const AppSettings& app) {
    if (!hwnd_) return;
    int wantW = (int)(420 * app.hudScale);
    if (wantW != w_) { w_ = wantW; }
    uint32_t now = GetTickCount();
    bool nudgeActive = now < nudgeUntil_;
    if (!nudgeActive && now - lastRender_ < 160) return;
    lastRender_ = now;
    Render(params, app);
}

void HudWindow::Render(const FrameParams& params, const AppSettings& app) {
    if (!gdipToken_) return;
    Engine::Get().Snapshot([&](EngineStats& st) {
        // size the window to content
        int rows = 12;
        int hh = 54 + rows * 22 + 14;
        if (hh != h_) { h_ = hh; SetWindowPos(hwnd_, nullptr, 0, 0, w_, h_, SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER); }
        HDC hdcScreen = GetDC(nullptr);
        HDC hdcMem = CreateCompatibleDC(hdcScreen);
        BITMAPINFO bmi = {};
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bmi.bmiHeader.biWidth = w_;
        bmi.bmiHeader.biHeight = -h_;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;
        void* bits = nullptr;
        HBITMAP dib = CreateDIBSection(hdcScreen, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
        HGDIOBJ old = SelectObject(hdcMem, dib);
        Gdiplus::Graphics g(hdcMem);
        g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        g.SetTextRenderingHint(Gdiplus::TextRenderingHintAntiAliasGridFit);

        // panel
        Gdiplus::GraphicsPath path;
        int rad = 14;
        Gdiplus::Rect r(0, 0, w_ - 1, h_ - 1);
        path.AddArc(r.X, r.Y, rad, rad, 180, 90);
        path.AddArc(r.X + r.Width - rad, r.Y, rad, rad, 270, 90);
        path.AddArc(r.X + r.Width - rad, r.Y + r.Height - rad, rad, rad, 0, 90);
        path.AddArc(r.X, r.Y + r.Height - rad, rad, rad, 90, 90);
        path.CloseFigure();
        Gdiplus::SolidBrush bg(Gdiplus::Color(216, 10, 14, 18));
        g.FillPath(&bg, &path);
        Gdiplus::Pen border(Gdiplus::Color(120, 0, 220, 210), 1.6f);
        g.DrawPath(&border, &path);

        const Gdiplus::Color cTitle(255, 0, 235, 225);
        const Gdiplus::Color cText(235, 225, 232, 240);
        const Gdiplus::Color cDim(200, 150, 158, 168);
        const Gdiplus::Color cAccent(255, 0, 230, 180);
        const Gdiplus::Color cWarn(255, 255, 170, 60);

        float hudScale = app.hudScale > 0.1f ? app.hudScale : 1.0f;
        Gdiplus::Font titleFont(L"Segoe UI", 14.5f * hudScale, Gdiplus::FontStyleBold);
        Gdiplus::Font f(L"Segoe UI", 11.0f * hudScale, Gdiplus::FontStyleRegular);
        Gdiplus::Font fb(L"Segoe UI", 11.0f * hudScale, Gdiplus::FontStyleBold);

        struct Row {
            Gdiplus::Graphics& g; Gdiplus::Font& f; int y;
            Row(Gdiplus::Graphics& gg, Gdiplus::Font& ff, int yy) : g(gg), f(ff), y(yy) {}
            int draw(const wchar_t* k, const wchar_t* v, const Gdiplus::Color& vc, int yy = -1) {
                if (yy >= 0) y = yy;
                Gdiplus::SolidBrush kb(Gdiplus::Color(200, 150, 158, 168));
                Gdiplus::SolidBrush vb(vc);
                g.DrawString(k, -1, &f, Gdiplus::PointF(16, (float)y), &kb);
                g.DrawString(v, -1, &f, Gdiplus::PointF(172, (float)y), &vb);
                y += 22;
                return y;
            }
        } row(g, f, 46);
        wchar_t buf[192];

        { Gdiplus::SolidBrush tbr(cTitle); g.DrawString(L"NEXUS GRAPHICS ENGINE", -1, &titleFont, Gdiplus::PointF(16, 12), &tbr); }

        int y = 46;

        // banner for compare modes / nudges
        const wchar_t* banner = nullptr;
        Gdiplus::Color bannerCol = cWarn;
        if (params.viewMode == 1) banner = L"ORIGINAL (CTRL+F9 to return)";
        else if (params.viewMode == 2) banner = L"SPLIT VIEW - drag line (interaction mode)";
        if (GetTickCount() < nudgeUntil_) banner = params.viewMode == 0 ? L"NEXUS ENHANCED" : banner;
        if (banner) {
            Gdiplus::SolidBrush bb(Gdiplus::Color(90, bannerCol.GetR(), bannerCol.GetG(), bannerCol.GetB()));
            g.FillRectangle(&bb, 10, y - 3, w_ - 20, 24);
            Gdiplus::SolidBrush tb(bannerCol);
            g.DrawString(banner, -1, &fb, Gdiplus::PointF(16, (float)y), &tb);
            y += 28;
        }
        row.y = y;

        MultiByteToWideChar(CP_UTF8, 0, st.gameName[0] ? st.gameName : "-", -1, buf, 128);
        row.y = row.draw(L"Game:", buf, cText);
        {
            char preset[48];
            strncpy_s(preset, PresetName(app.lastPreset), _TRUNCATE);
            MultiByteToWideChar(CP_UTF8, 0, st.active ? preset : "-", -1, buf, 128);
            row.y = row.draw(L"Graphics Enhancement:", buf, cAccent);
        }
        _snwprintf_s(buf, _TRUNCATE, L"%u x %u", st.inW, st.inH);
        row.y = row.draw(L"Input:", buf, cText);
        _snwprintf_s(buf, _TRUNCATE, L"%u x %u", st.outW, st.outH);
        row.y = row.draw(L"Output:", buf, cText);
        {
            char lb[16]; QualityLabelFromFloat(params.textureClarity, lb, sizeof(lb));
            MultiByteToWideChar(CP_UTF8, 0, lb, -1, buf, 128);
            row.y = row.draw(L"Texture Enhancement:", buf, cText);
        }
        MultiByteToWideChar(CP_UTF8, 0, QName(params.aaLevel), -1, buf, 128);
        row.y = row.draw(L"AA:", buf, cText);
        {
            char lb[16]; QualityLabelFromFloat(params.lightingQuality, lb, sizeof(lb));
            MultiByteToWideChar(CP_UTF8, 0, lb, -1, buf, 128);
            row.y = row.draw(L"Lighting:", buf, cText);
        }
        MultiByteToWideChar(CP_UTF8, 0, QName(params.aoLevel), -1, buf, 128);
        row.y = row.draw(L"AO:", buf, cText);
        _snwprintf_s(buf, _TRUNCATE, L"%.0f%%", params.detailBoost * 100.0f);
        row.y = row.draw(L"Detail:", buf, cText);
        _snwprintf_s(buf, _TRUNCATE, L"%.0f", st.fps);
        row.y = row.draw(L"FPS:", buf, cText);
        _snwprintf_s(buf, _TRUNCATE, L"%.1f ms (GPU)", st.gpuMs);
        row.y = row.draw(L"Processing:", buf, cText);

        // status footer
        {
            wchar_t wstatus[192];
            MultiByteToWideChar(CP_UTF8, 0, st.status, -1, wstatus, 192);
            Gdiplus::SolidBrush sb(st.active ? cAccent : cDim);
            g.DrawString(wstatus, -1, &f, Gdiplus::PointF(16, (float)(h_ - 26)), &sb);
        }

        // present (anchored to the enhancement output window)
        POINT ptSrc = { 0, 0 };
        POINT ptPos = { 0, 0 };
        ptPos.x = (int)st.outX; ptPos.y = (int)st.outY;
        SIZE size = { w_, h_ };
        BLENDFUNCTION bf = { AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
        UpdateLayeredWindow(hwnd_, hdcScreen, &ptPos, &size, hdcMem, &ptSrc, 0, &bf, ULW_ALPHA);
        SelectObject(hdcMem, old);
        DeleteObject(dib);
        DeleteDC(hdcMem);
        ReleaseDC(nullptr, hdcScreen);
    });
}
