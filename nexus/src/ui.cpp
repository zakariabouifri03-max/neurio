// NEXUS GRAPHICS ENGINE - control panel UI implementation
#include "stdafx.h"
#include "ui.h"
#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"
#include "games.h"

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_STATIC
#include "stb_image.h"

// embedded assets (generated)
extern const unsigned int nexus_logo_len;
extern const unsigned char nexus_logo_data[];
extern const unsigned int nexus_font_len;
extern const unsigned char nexus_font_data[];

FrameParams  g_params;
AppSettings  g_app;
GameProfile  g_activeProfile;
int          g_selectedProfile = -1;
PerfMon      g_perf;
int          g_masterPct = 85;
ID3D11ShaderResourceView* g_logoSrv = nullptr;
int          g_logoW = 0, g_logoH = 0;

namespace ui {
    static ID3D11Device*        s_dev = nullptr;
    static ID3D11DeviceContext* s_ctx = nullptr;
    static std::vector<GameProfile> s_profiles;
    static uint32_t s_lastSaveTick = 0;
    static int s_tab = 0;
    static uint32_t s_scanTick = 0;
    static std::vector<RunningGame> s_running;
    void MarkDirty() {
        Engine::Get().UpdateParams(g_params);
        Engine::Get().UpdateApp(g_app);
        uint32_t now = GetTickCount();
        if (now - s_lastSaveTick > 1500) {
            s_lastSaveTick = now;
            g_app.lastPreset = g_params.master >= 0 ? g_app.lastPreset : g_app.lastPreset;
            SaveAppSettings(g_app);
            if (g_activeProfile.valid) {
                g_activeProfile.params = g_params;
                SaveProfile(g_activeProfile);
            }
        }
    }

    void SetPreset(int preset) {
        if (preset != P_CUSTOM) {
            ApplyPreset(g_params, preset, g_params.master);
            ApplyColorPreset(g_params, g_activeProfile.valid ? g_activeProfile.colorPreset : C_NATURAL);
            g_app.lastPreset = preset;
            g_activeProfile.preset = preset;
        } else {
            g_app.lastPreset = P_CUSTOM;
            g_activeProfile.preset = P_CUSTOM;
        }
        MarkDirty();
    }

    bool Init(HWND hwnd, ID3D11Device* dev, ID3D11DeviceContext* ctx) {
        s_dev = dev; s_ctx = ctx;
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO();
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        io.IniFilename = nullptr;

        // embed font (DejaVu Sans) so the exe is self-contained
        ImFontConfig fc;
        fc.FontDataOwnedByAtlas = true;
        io.Fonts->AddFontFromMemoryTTF((void*)nexus_font_data, (int)nexus_font_len, 17.0f, &fc);

        ImGui_ImplWin32_Init(hwnd);
        ImGui_ImplDX11_Init(dev, ctx);

        // logo texture
        {
            int w, h, comp;
            unsigned char* px = stbi_load_from_memory(nexus_logo_data, (int)nexus_logo_len, &w, &h, &comp, 4);
            if (px) {
                D3D11_TEXTURE2D_DESC d = {};
                d.Width = (UINT)w; d.Height = (UINT)h; d.MipLevels = 1; d.ArraySize = 1;
                d.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
                d.SampleDesc.Count = 1;
                d.Usage = D3D11_USAGE_IMMUTABLE;
                d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
                D3D11_SUBRESOURCE_DATA sd = { px, (UINT)(w * 4), 0 };
                ID3D11Texture2D* tex = nullptr;
                if (SUCCEEDED(dev->CreateTexture2D(&d, &sd, &tex))) {
                    D3D11_SHADER_RESOURCE_VIEW_DESC srvd = {};
                    srvd.Format = d.Format; srvd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
                    srvd.Texture2D.MipLevels = 1;
                    dev->CreateShaderResourceView(tex, &srvd, &g_logoSrv);
                    tex->Release();
                }
                g_logoW = w; g_logoH = h;
                stbi_image_free(px);
            }
        }

        // theme: dark graphite + teal accents
        ImGuiStyle& st = ImGui::GetStyle();
        st.WindowRounding = 6; st.FrameRounding = 4; st.GrabRounding = 4;
        st.PopupRounding = 4; st.ScrollbarRounding = 8; st.TabRounding = 4;
        st.WindowPadding = ImVec2(12, 10); st.FramePadding = ImVec2(8, 5);
        st.ItemSpacing = ImVec2(9, 7);
        ImVec4* c = st.Colors;
        c[ImGuiCol_WindowBg] = ImVec4(0.045f, 0.055f, 0.070f, 0.97f);
        c[ImGuiCol_ChildBg] = ImVec4(0.060f, 0.072f, 0.090f, 1.00f);
        c[ImGuiCol_PopupBg] = ImVec4(0.070f, 0.080f, 0.100f, 0.98f);
        c[ImGuiCol_Border] = ImVec4(0.10f, 0.14f, 0.17f, 0.7f);
        c[ImGuiCol_Text] = ImVec4(0.90f, 0.93f, 0.95f, 1.0f);
        c[ImGuiCol_TextDisabled] = ImVec4(0.48f, 0.52f, 0.56f, 1.0f);
        c[ImGuiCol_TitleBg] = ImVec4(0.030f, 0.036f, 0.046f, 1.0f);
        c[ImGuiCol_TitleBgActive] = ImVec4(0.040f, 0.050f, 0.062f, 1.0f);
        c[ImGuiCol_FrameBg] = ImVec4(0.085f, 0.100f, 0.125f, 1.0f);
        c[ImGuiCol_FrameBgHovered] = ImVec4(0.105f, 0.125f, 0.155f, 1.0f);
        c[ImGuiCol_FrameBgActive] = ImVec4(0.120f, 0.145f, 0.180f, 1.0f);
        c[ImGuiCol_SliderGrab] = ImVec4(0.00f, 0.78f, 0.72f, 1.0f);
        c[ImGuiCol_SliderGrabActive] = ImVec4(0.00f, 0.92f, 0.84f, 1.0f);
        c[ImGuiCol_CheckMark] = ImVec4(0.00f, 0.85f, 0.78f, 1.0f);
        c[ImGuiCol_Button] = ImVec4(0.090f, 0.115f, 0.145f, 1.0f);
        c[ImGuiCol_ButtonHovered] = ImVec4(0.00f, 0.45f, 0.42f, 1.0f);
        c[ImGuiCol_ButtonActive] = ImVec4(0.00f, 0.60f, 0.55f, 1.0f);
        c[ImGuiCol_Header] = ImVec4(0.00f, 0.42f, 0.39f, 1.0f);
        c[ImGuiCol_HeaderHovered] = ImVec4(0.00f, 0.50f, 0.46f, 1.0f);
        c[ImGuiCol_HeaderActive] = ImVec4(0.00f, 0.58f, 0.53f, 1.0f);
        c[ImGuiCol_Tab] = ImVec4(0.070f, 0.085f, 0.105f, 1.0f);
        c[ImGuiCol_TabHovered] = ImVec4(0.00f, 0.50f, 0.46f, 1.0f);
        c[ImGuiCol_TabActive] = ImVec4(0.00f, 0.42f, 0.39f, 1.0f);
        c[ImGuiCol_PlotLines] = ImVec4(0.00f, 0.85f, 0.78f, 1.0f);
        c[ImGuiCol_PlotHistogram] = ImVec4(0.00f, 0.75f, 0.70f, 1.0f);
        c[ImGuiCol_Separator] = ImVec4(0.10f, 0.14f, 0.17f, 0.7f);

        LoadAppSettings(g_app);
        ApplyPreset(g_params, g_app.lastPreset, 0.85f);
        g_masterPct = (int)(g_params.master * 100 + 0.5f);
        LoadProfilesIntoUI();
        g_perf.Start();
        return true;
    }

    void Shutdown() {
        g_perf.Stop();
        if (g_logoSrv) { g_logoSrv->Release(); g_logoSrv = nullptr; }
        ImGui_ImplDX11_Shutdown();
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext();
    }

    void LoadProfilesIntoUI() {
        s_profiles = LoadAllProfiles();
        g_selectedProfile = -1;
        if (g_app.lastProfileId[0]) {
            for (int i = 0; i < (int)s_profiles.size(); i++)
                if (s_profiles[i].id == g_app.lastProfileId) { g_selectedProfile = i; break; }
        }
        if (g_selectedProfile < 0 && !s_profiles.empty()) g_selectedProfile = 0;
        if (g_selectedProfile >= 0) SelectProfile(g_selectedProfile);
    }

    void SelectProfile(int idx) {
        if (idx < 0 || idx >= (int)s_profiles.size()) return;
        g_selectedProfile = idx;
        g_activeProfile = s_profiles[idx];
        g_params = g_activeProfile.params;
        g_masterPct = (int)(g_params.master * 100 + 0.5f);
        strncpy_s(g_app.lastProfileId, g_activeProfile.id.c_str(), _TRUNCATE);
        Engine::Get().UpdateParams(g_params);
        SaveAppSettings(g_app);
    }

    std::vector<GameProfile>& Profiles() { return s_profiles; }
}
