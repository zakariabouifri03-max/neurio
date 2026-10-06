// NEXUS GRAPHICS ENGINE - in-game HUD overlay (always-on-top, excluded from capture)
#pragma once
#include "stdafx.h"
#include "engine.h"

class HudWindow {
public:
    bool Create();
    void Destroy();
    void SetVisible(bool v);
    bool Visible() const { return visible_; }
    // call each UI frame; re-renders at ~6Hz using real engine measurements
    void Tick(const FrameParams& params, const AppSettings& app);
    void Nudge(); // flash "ORIGINAL"/"SPLIT" banner (hotkey feedback)
private:
    void Render(const FrameParams& params, const AppSettings& app);
    HWND hwnd_ = nullptr;
    bool visible_ = true;
    uint32_t lastRender_ = 0;
    uint32_t nudgeUntil_ = 0;
    int w_ = 420, h_ = 340;
    ULONG_PTR gdipToken_ = 0;
};
