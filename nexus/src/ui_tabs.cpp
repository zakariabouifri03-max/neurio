// NEXUS GRAPHICS ENGINE - control panel tabs
#include "stdafx.h"
#include "ui.h"
#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"
#include "games.h"
#include "overlay.h"

namespace ui {
    static HudWindow s_hud;
    static bool s_hudCreated = false;
    static std::vector<RunningGame> s_running;
    static uint32_t s_scanTick = 0;
    static char s_statusMsg[256] = "";
    static uint32_t s_statusUntil = 0;

    // copyable view of engine stats (EngineStats itself has a mutex)
    struct StatsView {
        bool active = false, capturing = false, windowFound = false;
        bool selfTest = false, selfTestDone = false, selfTestOk = false;
        char gameName[96] = "", status[192] = "", lastError[256] = "";
        uint32_t inW = 0, inH = 0, outW = 0, outH = 0;
        LONG outX = 0, outY = 0;
        double fps = 0;
        float gpuMs = 0, frameMs = 0, latencyMs = 0;
        uint64_t dropped = 0, frames = 0;
        bool bypass = false, split = false;
        float fpsHist[120] = {}, procHist[120] = {};
        int histN = 0;
        std::deque<std::string> autoLog;
    };
    static StatsView CopyStats() {
        StatsView d;
        Engine::Get().Snapshot([&](EngineStats& s) {
            d.active = s.active; d.capturing = s.capturing; d.windowFound = s.windowFound;
            d.selfTest = s.selfTest; d.selfTestDone = s.selfTestDone; d.selfTestOk = s.selfTestOk;
            memcpy(d.gameName, s.gameName, sizeof(d.gameName));
            memcpy(d.status, s.status, sizeof(d.status));
            memcpy(d.lastError, s.lastError, sizeof(d.lastError));
            d.inW = s.inW; d.inH = s.inH; d.outW = s.outW; d.outH = s.outH;
            d.outX = s.outX; d.outY = s.outY;
            d.fps = s.fps; d.gpuMs = s.gpuMs; d.frameMs = s.frameMs; d.latencyMs = s.latencyMs;
            d.dropped = s.dropped; d.frames = s.frames;
            d.bypass = s.bypass; d.split = s.split;
            memcpy(d.fpsHist, s.fpsHist, sizeof(d.fpsHist));
            memcpy(d.procHist, s.procHist, sizeof(d.procHist));
            d.histN = s.histN;
            d.autoLog = s.autoLog;
        });
        return d;
    }

    void Flash(const char* msg) {
        strncpy_s(s_statusMsg, msg, _TRUNCATE);
        s_statusUntil = GetTickCount() + 3000;
    }

    static void LevelCombo(const char* label, int* level) {
        if (ImGui::BeginCombo(label, QName(*level))) {
            for (int q = 0; q < Q_COUNT; q++)
                if (ImGui::Selectable(QName(q), q == *level)) { *level = q; SetPreset(P_CUSTOM); }
            ImGui::EndCombo();
        }
    }
    static void SliderF(const char* label, float* v, float mn = 0.0f, float mx = 1.0f) {
        if (ImGui::SliderFloat(label, v, mn, mx, "%.2f")) SetPreset(P_CUSTOM);
    }

    // ------------------------------------------------------------------ HOME
    static void TabHome() {
        StatsView local = CopyStats();
        const HwInfo& hw = DetectHardware();

        ImGui::BeginChild("statusCard", ImVec2(0, 150), true);
        if (g_logoSrv)
            ImGui::Image((ImTextureID)g_logoSrv, ImVec2(72, 72));
        ImGui::SameLine();
        ImGui::BeginGroup();
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1.0f), "NEXUS GRAPHICS ENGINE");
        ImGui::TextDisabled("Real-Time 3D Game Graphics Enhancer");
        if (local.active) {
            ImGui::TextColored(ImVec4(0.2f, 1.0f, 0.6f, 1), "STATE: %s", local.status);
            ImGui::Text("Game: %s   In: %ux%u   Out: %ux%u", local.gameName, local.inW, local.inH, local.outW, local.outH);
            ImGui::Text("FPS: %.0f   Processing: %.2f ms (GPU)   Latency: %.1f ms", local.fps, local.gpuMs, local.latencyMs);
        } else {
            ImGui::Text("STATE: %s", local.status);
            if (local.lastError[0]) ImGui::TextColored(ImVec4(1, 0.4f, 0.35f, 1), "Error: %s", local.lastError);
        }
        ImGui::EndGroup();
        ImGui::EndChild();

        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1.0f), "GRAPHICS ENHANCEMENT");
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 14));
        if (ImGui::SliderInt("##master", &g_masterPct, 0, 100, "%d%%")) {
            g_params.master = g_masterPct / 100.0f;
            ApplyPreset(g_params, g_app.lastPreset, g_params.master);
            MarkDirty();
        }
        ImGui::PopStyleVar();
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("0%% = original image. 100%% = maximum supported enhancement.\nScales the strength of every enhancement module.");
        ImGui::Spacing();

        ImGui::Text("Quality Presets");
        const int presets[] = { P_LOW_ENHANCEMENT, P_QUALITY, P_ULTRA, P_EXTREME, P_REALISTIC, P_CINEMATIC, P_MAX_GRAPHICS, P_CUSTOM };
        for (int i = 0; i < IM_ARRAYSIZE(presets); i++) {
            if (i % 4) ImGui::SameLine();
            bool sel = g_app.lastPreset == presets[i];
            if (ImGui::Selectable(PresetName(presets[i]), sel, 0, ImVec2(150, 30))) SetPreset(presets[i]);
        }

        ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (Engine::Get().IsActive()) {
            if (ImGui::Button("STOP ENHANCEMENT", ImVec2(200, 36))) {
                Engine::Get().Deactivate();
                if (s_hudCreated) s_hud.SetVisible(false);
            }
        } else {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.5f, 0.3f, 1));
            if (ImGui::Button("ACTIVATE  (attach to game)", ImVec2(200, 36))) {
                if (!g_activeProfile.valid) Flash("Create or select a game profile first (GAMES tab).");
                else {
                    Engine::Get().Activate(g_activeProfile, g_app, g_params);
                    EnsureHud();
                    s_hud.SetVisible(g_app.showHud);
                }
            }
            ImGui::PopStyleColor();
        }
        ImGui::SameLine();
        if (ImGui::Button("Run GPU self-test", ImVec2(160, 36))) {
            GameProfile test = g_activeProfile;
            test.displayName = "GPU self-test";
            Engine::Get().Activate(test, g_app, g_params, true);
        }
        ImGui::SameLine();
        ImGui::BeginGroup();
        ImGui::TextDisabled("CTRL+F9  Original <-> Enhanced");
        ImGui::TextDisabled("CTRL+F10 Split view   CTRL+F11 HUD");
        ImGui::EndGroup();

        if (local.selfTest && !local.selfTestDone)
            ImGui::TextColored(ImVec4(1, 0.85f, 0.3f, 1), "GPU self-test running...");
        else if (local.selfTest && local.selfTestDone)
            ImGui::Text(local.selfTestOk ? "GPU self-test: PASSED (%.2f ms/frame on this GPU)" : "GPU self-test: finished with warnings - see log.",
                local.gpuMs);

        if (GetTickCount() < s_statusUntil && s_statusMsg[0])
            ImGui::TextColored(ImVec4(1, 0.85f, 0.3f, 1), "%s", s_statusMsg);

        ImGui::Spacing();
        ImGui::TextWrapped("%s", hw.recommendedNote);
        if (g_app.enableAutoOptimize)
            ImGui::TextDisabled("Auto optimization: ON, target %d FPS (see Performance tab).", g_app.targetFps);
    }

    // ------------------------------------------------------------------ GAMES
    static void TabGames() {
        auto& profiles = Profiles();
        ImGui::BeginChild("profList", ImVec2(280, 0), true);
        ImGui::Text("Game Profiles"); ImGui::Separator();
        for (int i = 0; i < (int)profiles.size(); i++) {
            char label[256];
            _snprintf_s(label, _TRUNCATE, "%s (%s)", profiles[i].displayName.c_str(), profiles[i].exeName.c_str());
            if (ImGui::Selectable(label, g_selectedProfile == i)) SelectProfile(i);
        }
        ImGui::Separator();
        if (ImGui::Button("+ Add game manually")) {
            std::wstring p = BrowseForExe(nullptr);
            if (!p.empty()) {
                GameProfile gp = MakeProfileFromExe(p);
                SaveProfile(gp);
                LoadProfilesIntoUI();
                Flash("Profile created.");
            }
        }
        ImGui::EndChild();
        ImGui::SameLine();

        ImGui::BeginChild("profEdit", ImVec2(0, 0), true);
        if (g_selectedProfile >= 0 && g_selectedProfile < (int)profiles.size()) {
            GameProfile& gp = profiles[g_selectedProfile];
            char nameBuf[128]; strncpy_s(nameBuf, gp.displayName.c_str(), _TRUNCATE);
            char exeBuf[256]; strncpy_s(exeBuf, gp.exeName.c_str(), _TRUNCATE);
            if (ImGui::InputText("Display name", nameBuf, sizeof(nameBuf))) gp.displayName = nameBuf;
            if (ImGui::InputText("Executable (process name)", exeBuf, sizeof(exeBuf))) {
                gp.exeName = exeBuf;
                for (auto& c : gp.exeName) c = (char)tolower((unsigned char)c);
            }
            if (ImGui::Checkbox("Auto-activate when window appears", &gp.autoActivate)) {}

            ImGui::Spacing();
            ImGui::Text("Resolution Enhancement");
            const char* inOpts[] = { "1280x720", "1600x900", "1920x1080", "2560x1440", "Auto (window size)" };
            const char* outOpts[] = { "1920x1080", "2560x1440", "3840x2160", "Match input" };
            int inIdx = 4;
            if (gp.inW == 1280 && gp.inH == 720) inIdx = 0;
            else if (gp.inW == 1600 && gp.inH == 900) inIdx = 1;
            else if (gp.inW == 1920 && gp.inH == 1080) inIdx = 2;
            else if (gp.inW == 2560 && gp.inH == 1440) inIdx = 3;
            int outIdx = 3;
            if (gp.outW == 1920 && gp.outH == 1080) outIdx = 0;
            else if (gp.outW == 2560 && gp.outH == 1440) outIdx = 1;
            else if (gp.outW == 3840 && gp.outH == 2160) outIdx = 2;
            ImGui::SetNextItemWidth(220);
            if (ImGui::Combo("Game renders at", &inIdx, inOpts, 5)) {
                static const int W[] = { 1280, 1600, 1920, 2560 };
                static const int H[] = { 720, 900, 1080, 1440 };
                if (inIdx < 4) { gp.inW = W[inIdx]; gp.inH = H[inIdx]; }
            }
            ImGui::SetNextItemWidth(220);
            if (ImGui::Combo("Nexus outputs", &outIdx, outOpts, 4)) {
                if (outIdx == 0) { gp.outW = 1920; gp.outH = 1080; }
                else if (outIdx == 1) { gp.outW = 2560; gp.outH = 1440; }
                else if (outIdx == 2) { gp.outW = 3840; gp.outH = 2160; }
                else { gp.outW = gp.inW; gp.outH = gp.inH; }
            }
            ImGui::Spacing();
            const char* pnames[P_COUNT];
            for (int i = 0; i < P_COUNT; i++) pnames[i] = PresetName(i);
            ImGui::SetNextItemWidth(220);
            if (ImGui::Combo("Preset", &gp.preset, pnames, P_COUNT)) {
                ApplyPreset(gp.params, gp.preset, gp.params.master);
                if (g_selectedProfile == g_selectedProfile && &gp == &profiles[g_selectedProfile]) {
                    g_params = gp.params;
                    Engine::Get().UpdateParams(g_params);
                }
            }
            ImGui::Spacing();
            if (ImGui::Button("Save profile")) { SaveProfile(gp); LoadProfilesIntoUI(); Flash("Profile saved."); }
            ImGui::SameLine();
            if (ImGui::Button("Launch game")) {
                std::wstring err;
                std::wstring path = Utf8ToWide(gp.exePath);
                if (path.empty()) Flash("No exe path stored - recreate via 'Add game manually'.");
                else if (LaunchGame(path, &err)) Flash("Game launched.");
                else Flash(WideToUtf8(err).c_str());
            }
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.45f, 0.1f, 0.1f, 1));
            if (ImGui::Button("Delete")) { DeleteProfile(gp.id); LoadProfilesIntoUI(); Flash("Profile deleted."); }
            ImGui::PopStyleColor();
        } else {
            ImGui::TextDisabled("No profile selected.");
        }

        ImGui::Spacing(); ImGui::Separator();
        ImGui::Text("Auto-Detect: games running now");
        uint32_t now = GetTickCount();
        if (now - s_scanTick > 2000) {
            s_scanTick = now;
            s_running = ScanRunningGames();
        }
        ImGui::BeginChild("running", ImVec2(0, 180), true);
        for (auto& g : s_running) {
            std::string label = WideToUtf8(g.exeName) + "  -  " + WideToUtf8(g.title);
            if (label.size() > 70) label = label.substr(0, 70) + "...";
            ImGui::PushID((int)g.pid);
            if (ImGui::Button("Profile")) {
                GameProfile gp = MakeProfileFromExe(g.exePath);
                SaveProfile(gp);
                LoadProfilesIntoUI();
                Flash("Profile created from running game.");
            }
            ImGui::SameLine();
            ImGui::TextDisabled("%s", label.c_str());
            ImGui::PopID();
        }
        if (s_running.empty()) ImGui::TextDisabled("No game windows detected.");
        ImGui::EndChild();
        ImGui::EndChild();
    }

    // ------------------------------------------------------------------ ENHANCEMENT
    static void TabEnhancement() {
        ImGui::Columns(2, "enhCols", false);
        ImGui::SetColumnWidth(0, 470.0f);

        ImGui::BeginChild("enhL", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Temporal & Reconstruction");
        ImGui::Separator();
        LevelCombo("Temporal Reconstruction", &g_params.temporalLevel);
        ImGui::TextDisabled("Uses previous frames + motion estimation to reconstruct\nedges, distant objects, vegetation and thin geometry.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Anti-Aliasing");
        ImGui::Separator();
        LevelCombo("Mode##aa", &g_params.aaLevel);
        ImGui::TextDisabled("Luma-edge directed smoothing. Higher modes widen the\nedge kernel and lower detection thresholds.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Ambient Occlusion Enhancer");
        ImGui::Separator();
        LevelCombo("AO", &g_params.aoLevel);
        SliderF("Contact shadow strength", &g_params.contactShadow);
        ImGui::TextDisabled("Screen-space crease + contact darkening from the\ncaptured image. No depth buffer is available in\ncapture mode - this is a shading proxy, not engine SSAO.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Shadow Enhancer");
        ImGui::Separator();
        SliderF("Shadow quality", &g_params.shadowQuality);
        SliderF("Shadow detail", &g_params.shadowDetail);
        SliderF("Shadow stability", &g_params.shadowStability);
        SliderF("Shadow softness", &g_params.shadowSoftness);
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Lighting Enhancer");
        ImGui::Separator();
        SliderF("Lighting quality", &g_params.lightingQuality);
        SliderF("Light detail", &g_params.lightDetail);
        SliderF("Exposure", &g_params.exposure, 0.5f, 1.6f);
        SliderF("Dynamic range", &g_params.dynamicRange);
        ImGui::EndChild();

        ImGui::NextColumn();

        ImGui::BeginChild("enhR", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Image Quality Engine");
        ImGui::Separator();
        SliderF("Sharpness (overshoot-controlled)", &g_params.sharpen);
        SliderF("Fine detail", &g_params.fineDetail);
        SliderF("Texture clarity", &g_params.textureClarity);
        SliderF("Edge detail", &g_params.edgeDetail);
        SliderF("Local contrast", &g_params.localContrast);
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Detail Boost");
        ImGui::Separator();
        int detailPct = (int)(g_params.detailBoost * 100 + 0.5f);
        if (ImGui::SliderInt("Detail Boost##pct", &detailPct, 0, 100, "%d%%")) {
            g_params.detailBoost = detailPct / 100.0f;
            SetPreset(P_CUSTOM);
        }
        ImGui::TextDisabled("Drives reconstruction strength, detail recovery and\nedge definition together.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Distant & Scene Enhancement");
        ImGui::Separator();
        SliderF("Long distance detail", &g_params.distantDetail);
        LevelCombo("Scene pass level", &g_params.sceneLevel);
        SliderF("Vegetation stability & clarity", &g_params.vegetation);
        SliderF("Particle contrast & smoothing", &g_params.particles);
        SliderF("Water streak enhancement", &g_params.water);
        SliderF("Character/skin protection", &g_params.characterProtect);
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Reflection Enhancer");
        ImGui::Separator();
        SliderF("Reflection sharpening", &g_params.reflectionStrength);
        SliderF("Reflection stabilization", &g_params.reflectionStabilize);
        ImGui::TextDisabled("Stabilizes and sharpens screen-space speculars in the\ncaptured image. Cannot create game-side reflections.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Artifact Reduction");
        ImGui::Separator();
        LevelCombo("Level##art", &g_params.artifactLevel);
        SliderF("Denoise (edge-aware)", &g_params.denoise);
        SliderF("Deband dithering", &g_params.deband);
        ImGui::EndChild();
        ImGui::Columns(1);
    }

    // ------------------------------------------------------------------ COLOR
    static void TabColor() {
        const HwInfo& hw = DetectHardware();
        ImGui::Columns(2, "colCols", false);
        ImGui::SetColumnWidth(0, 430.0f);
        ImGui::BeginChild("colL", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Color Engine");
        ImGui::Separator();
        if (ImGui::SliderFloat("Brightness", &g_params.brightness, 0.6f, 1.5f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Contrast", &g_params.contrast, 0.7f, 1.5f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Saturation", &g_params.saturation, 0.0f, 1.6f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Highlights", &g_params.highlights, 0.0f, 1.0f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Shadows", &g_params.shadows, 0.0f, 1.0f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Gamma", &g_params.gamma, 0.6f, 1.6f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("Temperature", &g_params.temperature, -1.0f, 1.0f, "%.2f")) SetPreset(P_CUSTOM);
        if (ImGui::SliderFloat("HDR shoulder (SDR-safe)", &g_params.hdrAmount, 0.0f, 1.0f, "%.2f")) SetPreset(P_CUSTOM);
        ImGui::TextDisabled("Default is Natural: no oversaturation.");
        ImGui::EndChild();

        ImGui::NextColumn();
        ImGui::BeginChild("colR", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Color Presets");
        ImGui::Separator();
        for (int i = 0; i < C_COUNT - 1; i++) {
            if (i) ImGui::SameLine();
            if (ImGui::Button(ColorPresetName(i), ImVec2(120, 28))) {
                ApplyColorPreset(g_params, i);
                g_activeProfile.colorPreset = i;
                MarkDirty();
            }
        }
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "HDR / Display");
        ImGui::Separator();
        ImGui::Text("Monitor HDR support: %s", hw.hdrSupported ? "YES" : "not detected");
        bool hdrActiveNow = DesktopHdrActive();
        ImGui::Text("HDR mode active on desktop: %s", hdrActiveNow ? "YES" : "NO (SDR output)");
        ImGui::BeginDisabled(!hdrActiveNow);
        if (ImGui::Checkbox("HDR output (linear scRGB pipeline)", &g_app.hdrWanted)) {
            if (!hdrActiveNow) g_app.hdrWanted = false; // never enable unsupported HDR
            MarkDirty();
        }
        ImGui::EndDisabled();
        if (!hdrActiveNow)
            ImGui::TextDisabled("Enable HDR in Windows display settings to unlock HDR output.\nNexus will never fake HDR on an SDR display.");
        else
            ImGui::TextDisabled("HDR output processes in linear light and presents scRGB.");
        ImGui::EndChild();
        ImGui::Columns(1);
    }

    // ------------------------------------------------------------------ PERFORMANCE
    static void TabPerformance() {
        static PerfSample sample;
        static uint32_t lastS = 0;
        uint32_t now = GetTickCount();
        if (now - lastS > 400) { lastS = now; sample = g_perf.Sample(); }

        static float fpsArr[120], procArr[120];
        static int n = 0;
        StatsView local = CopyStats();
        {
            int total = std::min(120, local.histN);
            for (int i = 0; i < total; i++) {
                int idx = (local.histN - total + i) % 120;
                fpsArr[i] = local.fpsHist[idx];
                procArr[i] = local.procHist[idx];
            }
            n = total;
        }

        ImGui::Columns(2, "perfCols", false);
        ImGui::SetColumnWidth(0, 430.0f);
        ImGui::BeginChild("perfL", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Live Measurements (real)");
        ImGui::Separator();
        ImGui::Text("FPS (output):        %.0f", local.fps);
        ImGui::Text("Frame time:          %.2f ms", local.frameMs);
        ImGui::Text("Processing (GPU):    %.2f ms", local.gpuMs);
        ImGui::Text("Capture latency:     %.1f ms", local.latencyMs);
        ImGui::Text("Dropped frames:      %llu", (unsigned long long)local.dropped);
        ImGui::Text("Frames processed:    %llu", (unsigned long long)local.frames);
        ImGui::Separator();
        ImGui::Text("CPU usage:           %.0f%%", sample.cpuPct);
        if (sample.gpuCountersOk) ImGui::Text("GPU usage:           %.0f%%", sample.gpuPct);
        else ImGui::TextDisabled("GPU usage:           counters unavailable");
        ImGui::Text("RAM used:            %llu MB", (unsigned long long)sample.ramUsedMB);
        ImGui::Text("VRAM used:           %llu MB", (unsigned long long)sample.vramUsedMB);
        ImGui::EndChild();

        ImGui::NextColumn();
        ImGui::BeginChild("perfR", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Auto Optimization");
        ImGui::Separator();
        if (ImGui::Checkbox("Enable auto optimizer", &g_app.enableAutoOptimize)) MarkDirty();
        int tf = g_app.targetFps;
        ImGui::SetNextItemWidth(140);
        if (ImGui::Combo("Target FPS", &tf, "30\060\090\0120\0144\0")) { g_app.targetFps = tf; MarkDirty(); }
        ImGui::TextDisabled("Finds the strongest enhancement settings that hold the\ntarget. Adjusts AO, scene pass, artifact reduction,\ntemporal reconstruction and AA based on real GPU timing.");
        ImGui::Separator();
        ImGui::Text("Adjustment log");
        ImGui::BeginChild("autolog", ImVec2(0, 150), true);
        for (auto it = local.autoLog.rbegin(); it != local.autoLog.rend(); ++it)
            ImGui::TextDisabled("%s", it->c_str());
        if (local.autoLog.empty()) ImGui::TextDisabled("No automatic adjustments yet.");
        ImGui::EndChild();
        ImGui::Separator();
        if (n > 1) {
            ImGui::PlotLines("FPS", fpsArr, n, 0, nullptr, 0.0f, 240.0f, ImVec2(400, 70));
            ImGui::PlotLines("GPU ms", procArr, n, 0, nullptr, 0.0f, 33.0f, ImVec2(400, 70));
        }
        ImGui::EndChild();
        ImGui::Columns(1);
    }

    // ------------------------------------------------------------------ SETTINGS
    static void TabSettings() {
        ImGui::BeginChild("setChild", ImVec2(560, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Overlay & HUD");
        ImGui::Separator();
        if (ImGui::Checkbox("Show in-game HUD", &g_app.showHud)) {
            if (s_hudCreated) s_hud.SetVisible(g_app.showHud);
            MarkDirty();
        }
        if (ImGui::SliderFloat("HUD scale", &g_app.hudScale, 0.75f, 1.6f, "%.2f")) MarkDirty();
        ImGui::TextDisabled("Hotkeys: CTRL+F9 before/after, CTRL+F10 split view,\nCTRL+F11 HUD toggle.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "Capture");
        ImGui::Separator();
        int mode = g_app.captureMode;
        if (ImGui::Combo("Capture region", &mode, "Game window region (recommended)\0Full monitor\0")) {
            g_app.captureMode = mode; MarkDirty();
        }
        if (ImGui::Checkbox("V-sync overlay output", &g_app.vsyncOverlay)) MarkDirty();
        {
            static bool interaction = false;
            if (ImGui::Checkbox("Overlay interaction mode (enable to drag the split divider)", &interaction))
                Engine::Get().SetInteraction(interaction);
        }
        ImGui::TextDisabled("Capture uses Windows Desktop Duplication. The overlay\nwindow is excluded from capture (no feedback loop).\nGames work best in windowed / borderless mode.");
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "System");
        ImGui::Separator();
        if (ImGui::Checkbox("Start with Windows", &g_app.startWithWindows)) {
            HKEY hk;
            if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hk) == ERROR_SUCCESS) {
                if (g_app.startWithWindows) {
                    wchar_t exe[MAX_PATH]; GetModuleFileNameW(nullptr, exe, MAX_PATH);
                    std::wstring cmd = std::wstring(L"\"") + exe + L"\" /minimized";
                    RegSetValueExW(hk, L"NexusGraphicsEngine", 0, REG_SZ, (const BYTE*)cmd.c_str(), (DWORD)((cmd.size() + 1) * sizeof(wchar_t)));
                } else {
                    RegDeleteValueW(hk, L"NexusGraphicsEngine");
                }
                RegCloseKey(hk);
            }
            MarkDirty();
        }
        ImGui::EndChild();
    }

    // ------------------------------------------------------------------ ABOUT
    static void TabAbout() {
        ImGui::BeginChild("aboutChild", ImVec2(0, 0), true);
        ImGui::TextColored(ImVec4(0.0f, 0.9f, 0.84f, 1), "NEXUS GRAPHICS ENGINE  -  Real-Time 3D Game Graphics Enhancer");
        ImGui::TextDisabled("Independent graphics enhancement layer. Not affiliated with NVIDIA/AMD.");
        ImGui::TextDisabled("No DLSS branding, no fake effects: every enabled feature runs real GPU processing.");
        ImGui::Separator();
        ImGui::TextWrapped("How it works");
        ImGui::BulletText("Captures the game's rendered frames in real time (Desktop Duplication API).");
        ImGui::BulletText("Enhances every frame on your GPU via a D3D11 compute pipeline.");
        ImGui::BulletText("Presents the enhanced image in a topmost window over the game.");
        ImGui::BulletText("Nothing is injected into the game; no game files are modified (anti-cheat safe).");
        ImGui::Spacing();
        ImGui::TextWrapped("What post-processing CAN do");
        ImGui::BulletText("Reconstruct detail from multiple frames (temporal reconstruction).");
        ImGui::BulletText("Edge-directed upscaling, anti-aliasing, overshoot-controlled sharpening.");
        ImGui::BulletText("Local contrast / shadow / highlight / color enhancement, artifact reduction.");
        ImGui::BulletText("Screen-space AO-proxy, specular stabilization, scene-adaptive processing.");
        ImGui::Spacing();
        ImGui::TextWrapped("What it CANNOT do (honest limits)");
        ImGui::BulletText("It cannot add polygons, raise native texture resolution or shadow-map size.");
        ImGui::BulletText("It cannot enable ray tracing in games that do not implement it.");
        ImGui::BulletText("Screen-space effects (AO-proxy, reflection enhancement) are estimates from\nthe captured image, not engine data.");
        ImGui::BulletText("Exclusive-fullscreen games should run borderless/windowed for the overlay.");
        ImGui::Spacing();
        ImGui::TextDisabled("Backend: DirectX 11 compute shaders (HLSL, compiled locally). All processing is local and offline.");
        ImGui::EndChild();
    }

    // ------------------------------------------------------------------ DRAW
    void Draw() {
        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->Pos);
        ImGui::SetNextWindowSize(vp->Size);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14, 12));
        ImGui::Begin("##root", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus);

        ImGui::BeginChild("nav", ImVec2(190, 0), true);
        if (g_logoSrv) ImGui::Image((ImTextureID)g_logoSrv, ImVec2(150, 150.0f * g_logoH / g_logoW));
        ImGui::Spacing();
        const char* tabs[] = { "HOME", "GAMES", "ENHANCEMENT", "COLOR", "PERFORMANCE", "SETTINGS", "ABOUT" };
        static int s_tab = 0;
        for (int i = 0; i < IM_ARRAYSIZE(tabs); i++)
            if (ImGui::Selectable(tabs[i], s_tab == i, 0, ImVec2(160, 34))) s_tab = i;
        ImGui::Spacing();
        {
            StatsView s = CopyStats();
            if (s.active) {
                ImGui::TextColored(ImVec4(0.2f, 1.0f, 0.6f, 1), "ENGINE ACTIVE");
                ImGui::TextDisabled("%.0f FPS  %.1f ms", s.fps, s.gpuMs);
            } else ImGui::TextDisabled("Engine idle");
        }
        ImGui::EndChild();
        ImGui::SameLine();

        ImGui::BeginChild("content", ImVec2(0, 0), false);
        switch (s_tab) {
        case 0: TabHome(); break;
        case 1: TabGames(); break;
        case 2: TabEnhancement(); break;
        case 3: TabColor(); break;
        case 4: TabPerformance(); break;
        case 5: TabSettings(); break;
        case 6: TabAbout(); break;
        }
        ImGui::EndChild();
        ImGui::End();
        ImGui::PopStyleVar(2);

        if (s_hudCreated) s_hud.Tick(g_params, g_app);

        ImGui::Render();
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
    }

    void EnsureHud() {
        if (!s_hudCreated) { s_hud.Create(); s_hudCreated = true; }
        s_hud.SetVisible(g_app.showHud);
    }

    void ToggleHud() {
        g_app.showHud = !g_app.showHud;
        if (s_hudCreated) s_hud.SetVisible(g_app.showHud);
        SaveAppSettings(g_app);
    }
}
