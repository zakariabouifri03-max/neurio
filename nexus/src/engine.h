// NEXUS GRAPHICS ENGINE - real-time enhancement engine
//
// Architecture (honest, real-time):
//   game presents frames -> Windows Desktop Duplication captures the game
//   window's rendered output in real time -> D3D11 compute pipeline enhances
//   each frame (temporal reconstruction, edge-directed upscaling, AA, detail,
//   AO/shadow/lighting enhancement, color) -> enhanced frame is presented in a
//   topmost overlay window aligned over the game.
//
// This is a genuine real-time processing loop (every frame, continuously),
// not screenshot processing and not a filter on saved images. No game files
// are modified and nothing is injected into the game process - the pipeline
// is external and therefore safe with anti-cheat systems.
#pragma once
#include "stdafx.h"
#include "config.h"
#include "d3d.h"

struct EngineStats {
    std::mutex mu;
    bool active = false;
    bool capturing = false;
    bool windowFound = false;
    bool selfTest = false;
    bool selfTestDone = false;
    bool selfTestOk = false;
    char gameName[96] = "";
    char gameExe[96] = "";
    char status[192] = "Idle";
    char lastError[256] = "";
    uint32_t inW = 0, inH = 0, outW = 0, outH = 0;
    LONG outX = 0, outY = 0;
    double fps = 0;
    float gpuMs = 0, frameMs = 0, latencyMs = 0;
    uint64_t dropped = 0, frames = 0;
    bool bypass = false, split = false;
    float fpsHist[120] = {};
    float procHist[120] = {};
    int histN = 0;
    std::deque<std::string> autoLog;     // auto-optimizer events
    int autoAdjust = 0;
    bool interaction = false;
};

class Engine {
public:
    static Engine& Get();

    bool Activate(const GameProfile& gp, const AppSettings& app, const FrameParams& fp, bool selfTest = false);
    void Deactivate();
    bool IsActive();

    void UpdateParams(const FrameParams& fp);   // push full settings snapshot
    void UpdateApp(const AppSettings& s);
    void Snapshot(const std::function<void(EngineStats&)>& reader);

    void SetBypass(bool on);   // ORIGINAL view
    void ToggleBypass();
    void SetSplit(bool on);    // split compare
    void ToggleSplit();
    void SetInteraction(bool on);

private:
    Engine() = default;
    ~Engine();
    void ThreadProc();
    bool InitDeviceAndShaders();
    void ReleasePipeline();
    bool AllocResources(uint32_t inW, uint32_t inH, uint32_t outW, uint32_t outH);
    bool EnsureCaptureTarget();               // find game window + duplication
    bool UpdateWindowRect();                  // track game window (returns size-changed)
    bool CreateOverlayWindow();               // topmost output window + swapchain
    bool StartDuplication();                  // desktop duplication for game monitor
    bool AcquireFrame(uint32_t timeoutMs);    // desktop duplication
    bool ProcessFrame();                      // full pipeline
    void UpdateStats();
    void AutoOptimizeTick();
    void ApplyAutoReductions(FrameParams& fp);
    void PumpOverlayMessages();
    static LRESULT CALLBACK OverlayWndProc(HWND, UINT, WPARAM, LPARAM);
    bool appVsync();

    std::thread thread_;
    std::atomic<bool> running_{ false };
    std::atomic<bool> stopFlag_{ false };
    int mode_ = 0;                       // 0 = live game, 1 = self test

    // guarded config
    std::mutex cfgMu_;
    FrameParams userParams_;             // what the user set
    FrameParams effParams_;              // auto-optimizer adjusted copy
    AppSettings app_;

    GameProfile profile_;
    EngineStats stats_;
    int autoRed_[5] = { 0,0,0,0,0 };     // active auto-opt reductions (ao,scene,artifact,temporal,aa)

    // current pipeline sizes
    uint32_t cinW_ = 0, cinH_ = 0, coutW_ = 0, coutH_ = 0;

    // D3D
    NexusComPtr<ID3D11Device> dev_;
    NexusComPtr<ID3D11DeviceContext> ctx_;
    NexusComPtr<IDXGIFactory2> factory_;
    NexusComPtr<IDXGIOutputDuplication> dup_;
    LONG dupDesktopLeft_ = 0, dupDesktopTop_ = 0;
    uint32_t dupOutW_ = 0, dupOutH_ = 0;
    NexusComPtr<ID3D11Texture2D> capTex_;     // input res, SRV
    NexusComPtr<ID3D11ShaderResourceView> capSrv_;
    dxe::GpuTimer gpuTimer_;

    // pipeline textures
    dxe::Tex lin_, luma4_[2], motion4_, up_, cur_[2], chain_[6], aa_, det_, lit_, mask_[2], scene_, col_, finalTex_;

    // shaders
    struct Shaders {
        dxe::ShaderCS linearize, lowcur, motion, upscale, temporal, down, aa,
            detail, light, scene, color, finalPass, bypass, test;
    } sh_;

    NexusComPtr<ID3D11Buffer> cb_;

    int ping_ = 0;      // cur_ index written this frame
    int lumaIdx_ = 0;
    int maskIdx_ = 0;
    bool histValid_ = false;
    bool firstFrame_ = true;

    // overlay window
    HWND overlayWnd_ = nullptr;
    NexusComPtr<IDXGISwapChain1> swap_;
    NexusComPtr<ID3D11Texture2D> backBuf_;
    uint32_t swW_ = 0, swH_ = 0;         // swapchain size
    uint32_t swInW_ = 0, swInH_ = 0;     // input size the pipeline was built for
    bool interaction_ = false;
    bool dragging_ = false;
    POINT dragStart_{};
    float splitDragStart_ = 0.5f;

    // capture target
    HWND gameWnd_ = nullptr;
    DWORD gamePid_ = 0;
    RECT gameClientRect_{};
    HMONITOR gameMonitor_ = nullptr;
    uint32_t lastRectTick_ = 0;
    uint64_t lastPresentQpc_ = 0;

    // perf accounting
    double fpsAccumCount_ = 0;
    LARGE_INTEGER perfFreq_{};
    float gpuMsAvg_ = 0;
    uint32_t lastStatsTick_ = 0;
    int autoCooldown_ = 0;
};
