// NEXUS GRAPHICS ENGINE - control panel UI
#pragma once
#include "stdafx.h"
#include "config.h"
#include "engine.h"
#include "hwinfo.h"
#include "perfmon.h"

// global UI-owned state (single source of truth for settings)
extern FrameParams  g_params;
extern AppSettings  g_app;
extern GameProfile  g_activeProfile;
extern int          g_selectedProfile;
extern PerfMon      g_perf;
extern int          g_masterPct;
extern struct ID3D11ShaderResourceView* g_logoSrv;
extern int          g_logoW, g_logoH;

namespace ui {
    bool Init(HWND hwnd, class ID3D11Device* dev, class ID3D11DeviceContext* ctx);
    void Shutdown();
    void Draw();       // one ImGui frame
    void MarkDirty();  // push g_params/g_app to engine + autosave
    void LoadProfilesIntoUI();
    void SelectProfile(int idx);
    void SetPreset(int preset);
    void Flash(const char* msg);
    std::vector<GameProfile>& Profiles();
    void ToggleHud();
    void EnsureHud();
}
