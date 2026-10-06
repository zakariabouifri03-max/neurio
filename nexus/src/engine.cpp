// NEXUS GRAPHICS ENGINE - engine implementation
#include "stdafx.h"
#include "engine.h"
#include "shaders.h"
#include "games.h"
#include "hwinfo.h"

// cbuffer layout - MUST match the declaration order in shaders.h
struct F4 {
    float x, y, z, w;
    F4(float a = 0, float b = 0, float c = 0, float d = 0) : x(a), y(b), z(c), w(d) {}
};
struct CbData {
    F4 uSizes, uTexel, uFrame, uSplit, uTemporal, uDetail, uDetail2, uShadow,
        uLight, uLight2, uScene, uColor, uColor2, uFinal;
};

static const float kAAStr[Q_COUNT]     = { 0.f, 0.45f, 0.62f, 0.75f, 0.85f, 0.95f };
static const float kAAThr[Q_COUNT]     = { 0.09f, 0.100f, 0.085f, 0.070f, 0.055f, 0.040f };
static const float kAARad[Q_COUNT]     = { 1.f, 1.0f, 1.2f, 1.4f, 1.6f, 2.0f };
static const float kTempBase[Q_COUNT]  = { 1.0f, 0.45f, 0.35f, 0.28f, 0.22f, 0.16f };
static const float kTempClamp[Q_COUNT] = { 2.0f, 1.8f, 1.5f, 1.2f, 1.0f, 0.85f };
static const float kTempProt[Q_COUNT]  = { 0.f, 0.3f, 0.5f, 0.7f, 0.9f, 1.0f };
static const float kAOStr[Q_COUNT]     = { 0.f, 0.30f, 0.50f, 0.70f, 0.85f, 1.00f };
static const float kSceneScale[Q_COUNT]= { 0.f, 0.25f, 0.50f, 0.75f, 0.90f, 1.00f };
static const float kDenoiseLv[Q_COUNT] = { 0.f, 0.20f, 0.35f, 0.50f, 0.65f, 0.80f };
static const float kDebandLv[Q_COUNT]  = { 0.f, 0.25f, 0.40f, 0.55f, 0.70f, 0.85f };

static float MasterScale(float m) { return 0.15f + 0.85f * m; }
static UINT  DivUp(UINT a, UINT b) { return (a + b - 1) / b; }

static void UnbindCompute(ID3D11DeviceContext* ctx) {
    ID3D11ShaderResourceView* nullSRV[8] = {};
    ID3D11UnorderedAccessView* nullUAV[8] = {};
    ctx->CSSetShaderResources(0, 8, nullSRV);
    ctx->CSSetUnorderedAccessViews(0, 8, nullUAV, nullptr);
}

// SHADER_COMMON + body concat (cached)
static const std::string& FullShader(const char* body) {
    static std::map<std::string, std::string> cache;
    auto it = cache.find(body);
    if (it == cache.end()) {
        std::string s = SHADER_COMMON;
        s += body;
        it = cache.emplace(body, std::move(s)).first;
    }
    return it->second;
}

Engine& Engine::Get() { static Engine e; return e; }
Engine::~Engine() { Deactivate(); }

// ------------------------------------------------------------------ lifecycle
bool Engine::Activate(const GameProfile& gp, const AppSettings& app, const FrameParams& fp, bool selfTest) {
    if (running_.load()) return false;
    profile_ = gp;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        userParams_ = fp; effParams_ = fp; app_ = app;
    }
    mode_ = selfTest ? 1 : 0;
    stopFlag_ = false;
    {
        std::lock_guard<std::mutex> lk(stats_.mu);
        stats_.active = false; stats_.capturing = false; stats_.windowFound = false;
        stats_.selfTest = false; stats_.selfTestDone = false; stats_.selfTestOk = false;
        memset(stats_.gameName, 0, sizeof(stats_.gameName));
        memset(stats_.gameExe, 0, sizeof(stats_.gameExe));
        memset(stats_.status, 0, sizeof(stats_.status));
        memset(stats_.lastError, 0, sizeof(stats_.lastError));
        stats_.inW = stats_.inH = stats_.outW = stats_.outH = 0;
        stats_.outX = stats_.outY = 0;
        stats_.fps = 0; stats_.gpuMs = stats_.frameMs = stats_.latencyMs = 0;
        stats_.dropped = 0; stats_.frames = 0;
        stats_.bypass = false; stats_.split = false; stats_.histN = 0;
        stats_.autoLog.clear(); stats_.autoAdjust = 0; stats_.interaction = false;
        stats_.active = true;
        stats_.selfTest = selfTest;
        strncpy_s(stats_.gameName, gp.displayName.c_str(), _TRUNCATE);
        strncpy_s(stats_.gameExe, gp.exeName.c_str(), _TRUNCATE);
        strcpy_s(stats_.status, selfTest ? "Self test running..." : "Starting...");
    }
    running_ = true;
    thread_ = std::thread(&Engine::ThreadProc, this);
    return true;
}

void Engine::Deactivate() {
    if (!running_.load()) return;
    stopFlag_ = true;
    if (thread_.joinable()) thread_.join();
    running_ = false;
    std::lock_guard<std::mutex> lk(stats_.mu);
    stats_.active = false;
    stats_.capturing = false;
    strcpy_s(stats_.status, "Idle");
}

bool Engine::IsActive() { return running_.load(); }

void Engine::UpdateParams(const FrameParams& fp) {
    std::lock_guard<std::mutex> lk(cfgMu_);
    userParams_ = fp;
    effParams_ = fp;
    ApplyAutoReductions(effParams_);
}
void Engine::UpdateApp(const AppSettings& s) {
    std::lock_guard<std::mutex> lk(cfgMu_);
    app_ = s;
}
void Engine::Snapshot(const std::function<void(EngineStats&)>& reader) {
    std::lock_guard<std::mutex> lk(stats_.mu);
    reader(stats_);
}
void Engine::SetBypass(bool on) {
    std::lock_guard<std::mutex> lk(cfgMu_);
    if (on && effParams_.viewMode == 0) effParams_.viewMode = 1;
    else if (!on && effParams_.viewMode == 1) effParams_.viewMode = 0;
    userParams_.viewMode = effParams_.viewMode;
}
void Engine::ToggleBypass() {
    std::lock_guard<std::mutex> lk(cfgMu_);
    effParams_.viewMode = (effParams_.viewMode == 1) ? 0 : 1;
    userParams_.viewMode = effParams_.viewMode;
}
void Engine::SetSplit(bool on) {
    std::lock_guard<std::mutex> lk(cfgMu_);
    if (on && effParams_.viewMode != 2) effParams_.viewMode = 2;
    if (!on && effParams_.viewMode == 2) effParams_.viewMode = 0;
    userParams_.viewMode = effParams_.viewMode;
}
void Engine::ToggleSplit() {
    std::lock_guard<std::mutex> lk(cfgMu_);
    effParams_.viewMode = (effParams_.viewMode == 2) ? 0 : 2;
    userParams_.viewMode = effParams_.viewMode;
}
void Engine::SetInteraction(bool on) {
    interaction_ = on;
    if (overlayWnd_) {
        LONG_PTR ex = GetWindowLongPtrW(overlayWnd_, GWL_EXSTYLE);
        if (on) ex &= ~(LONG_PTR)WS_EX_TRANSPARENT; else ex |= WS_EX_TRANSPARENT;
        SetWindowLongPtrW(overlayWnd_, GWL_EXSTYLE, ex);
    }
    std::lock_guard<std::mutex> lk(stats_.mu);
    stats_.interaction = on;
}


void Engine::ApplyAutoReductions(FrameParams& fp) {
    fp.aoLevel = std::max(0, fp.aoLevel - autoRed_[0]);
    fp.sceneLevel = std::max(0, fp.sceneLevel - autoRed_[1]);
    fp.artifactLevel = std::max(0, fp.artifactLevel - autoRed_[2]);
    fp.temporalLevel = std::max(0, fp.temporalLevel - autoRed_[3]);
    fp.aaLevel = std::max(0, fp.aaLevel - autoRed_[4]);
}

// ------------------------------------------------------------------ window proc
LRESULT CALLBACK Engine::OverlayWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    Engine* e = (Engine*)GetWindowLongPtrW(hwnd, GWLP_USERDATA);
    switch (msg) {
    case WM_NCHITTEST:
        if (e && e->interaction_) return HTCLIENT;
        return HTTRANSPARENT;
    case WM_LBUTTONDOWN:
        if (e && e->interaction_) {
            bool split = false;
            {
                std::lock_guard<std::mutex> lk(e->cfgMu_);
                split = (e->effParams_.viewMode == 2);
            }
            if (split) {
                SetCapture(hwnd);
                e->dragging_ = true;
                e->dragStart_.x = GET_X_LPARAM(lp);
                e->dragStart_.y = GET_Y_LPARAM(lp);
                std::lock_guard<std::mutex> lk(e->cfgMu_);
                e->splitDragStart_ = e->effParams_.splitX;
            }
            return 0;
        }
        break;
    case WM_MOUSEMOVE:
        if (e && e->dragging_) {
            int x = GET_X_LPARAM(lp);
            RECT rc; GetClientRect(hwnd, &rc);
            int w = std::max(1, (int)(rc.right - rc.left));
            float nx = e->splitDragStart_ + (float)(x - e->dragStart_.x) / (float)w;
            nx = std::min(0.98f, std::max(0.02f, nx));
            std::lock_guard<std::mutex> lk(e->cfgMu_);
            e->effParams_.splitX = nx; e->userParams_.splitX = nx;
            return 0;
        }
        break;
    case WM_LBUTTONUP:
        if (e && e->dragging_) { e->dragging_ = false; ReleaseCapture(); }
        break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

void Engine::PumpOverlayMessages() {
    if (!overlayWnd_) return;
    MSG msg;
    while (PeekMessageW(&msg, overlayWnd_, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

// ------------------------------------------------------------------ device & shaders
bool Engine::InitDeviceAndShaders() {
    D3D_FEATURE_LEVEL fls[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL flOut = (D3D_FEATURE_LEVEL)0;
    IDXGIAdapter* ad = (IDXGIAdapter*)AdapterForMonitor(gameMonitor_); // null -> default
    HRESULT hr = D3D11CreateDevice(ad, ad ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
        nullptr, 0, fls, ARRAYSIZE(fls), D3D11_SDK_VERSION, &dev_, &flOut, &ctx_);
    if (FAILED(hr)) {
        hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, fls, ARRAYSIZE(fls),
            D3D11_SDK_VERSION, &dev_, &flOut, &ctx_);
    }
    if (FAILED(hr) || !dev_.Get()) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "Direct3D 11 device creation failed. A DX11 GPU (feature level 11.0+) is required.");
        return false;
    }
    if (flOut < D3D_FEATURE_LEVEL_11_0) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "GPU does not support feature level 11.0 - compute pipeline unavailable.");
        return false;
    }
    {
        NexusComPtr<IDXGIDevice1> d;
        if (SUCCEEDED(dev_->QueryInterface(IID_PPV_ARGS(&d)))) d->SetMaximumFrameLatency(1);
        NexusComPtr<IDXGIAdapter> ad2;
        if (d.Get() && SUCCEEDED(d->GetAdapter(&ad2))) {
            ad2->GetParent(IID_PPV_ARGS(&factory_));
        }
    }
    if (!dxe::InitCompiler()) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "d3dcompiler_47.dll could not be loaded (needed to compile enhancement shaders).");
        return false;
    }
    sh_.linearize  = dxe::CompileCS(dev_.Get(), FullShader(CS_LINEARIZE).c_str(), "main");
    sh_.lowcur     = dxe::CompileCS(dev_.Get(), FullShader(CS_LOWCUR).c_str(), "main");
    sh_.motion     = dxe::CompileCS(dev_.Get(), FullShader(CS_MOTION).c_str(), "main");
    sh_.upscale    = dxe::CompileCS(dev_.Get(), FullShader(CS_UPSCALE).c_str(), "main");
    sh_.temporal   = dxe::CompileCS(dev_.Get(), FullShader(CS_TEMPORAL).c_str(), "main");
    sh_.down       = dxe::CompileCS(dev_.Get(), FullShader(CS_DOWN).c_str(), "main");
    sh_.aa         = dxe::CompileCS(dev_.Get(), FullShader(CS_AA).c_str(), "main");
    sh_.detail     = dxe::CompileCS(dev_.Get(), FullShader(CS_DETAIL).c_str(), "main");
    sh_.light      = dxe::CompileCS(dev_.Get(), FullShader(CS_LIGHT).c_str(), "main");
    sh_.scene      = dxe::CompileCS(dev_.Get(), FullShader(CS_SCENE).c_str(), "main");
    sh_.color      = dxe::CompileCS(dev_.Get(), FullShader(CS_COLOR).c_str(), "main");
    sh_.finalPass  = dxe::CompileCS(dev_.Get(), FullShader(CS_FINAL).c_str(), "main");
    sh_.bypass     = dxe::CompileCS(dev_.Get(), FullShader(CS_BYPASS).c_str(), "main");
    sh_.test       = dxe::CompileCS(dev_.Get(), FullShader(CS_TEST).c_str(), "main");
    dxe::ShaderCS* all[] = { &sh_.linearize,&sh_.lowcur,&sh_.motion,&sh_.upscale,&sh_.temporal,&sh_.down,
                             &sh_.aa,&sh_.detail,&sh_.light,&sh_.scene,&sh_.color,&sh_.finalPass,&sh_.bypass,&sh_.test };
    std::string errs;
    for (auto* s : all) if (!s->ok()) errs += s->error + "\n";
    if (!errs.empty()) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strncpy_s(stats_.lastError, errs.c_str(), _TRUNCATE);
        NEX_LOG("Shader compile errors:\n%s", errs.c_str());
        return false;
    }
    D3D11_BUFFER_DESC bd = {};
    bd.Usage = D3D11_USAGE_DEFAULT;
    bd.ByteWidth = sizeof(CbData);
    bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    hr = dev_->CreateBuffer(&bd, nullptr, &cb_);
    if (FAILED(hr)) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "Failed to create constant buffer.");
        return false;
    }
    gpuTimer_.Init(dev_.Get(), ctx_.Get());
    return true;
}

void Engine::ReleasePipeline() {
    if (ctx_.Get()) UnbindCompute(ctx_.Get());
    lin_.Release(); luma4_[0].Release(); luma4_[1].Release(); motion4_.Release(); up_.Release();
    for (auto& c : cur_) c.Release();
    for (auto& c : chain_) c.Release();
    aa_.Release(); det_.Release(); lit_.Release(); scene_.Release(); col_.Release(); finalTex_.Release();
    mask_[0].Release(); mask_[1].Release();
    capTex_.Reset(); capSrv_.Reset();
    backBuf_.Reset();
    if (swap_.Get()) { swap_.Reset(); }
    if (dup_.Get()) { dup_->Release(); dup_.Reset(); }
    overlayWnd_ = nullptr;
    cb_.Reset();
    sh_ = Shaders{};
    ctx_.Reset(); dev_.Reset(); factory_.Reset();
    histValid_ = false;
    firstFrame_ = true;
}

bool Engine::AllocResources(uint32_t inW, uint32_t inH, uint32_t outW, uint32_t outH) {
    if (!dev_.Get()) return false;
    bool hdr = false;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        hdr = app_.hdrWanted && DesktopHdrActive();
    }
    capTex_.Reset(); capSrv_.Reset();
    // capture texture (SRV only)
    D3D11_TEXTURE2D_DESC cd = {};
    cd.Width = inW; cd.Height = inH; cd.MipLevels = 1; cd.ArraySize = 1;
    cd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    cd.SampleDesc.Count = 1;
    cd.Usage = D3D11_USAGE_DEFAULT;
    cd.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(dev_->CreateTexture2D(&cd, nullptr, &capTex_))) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "Failed to allocate capture texture.");
        return false;
    }
    D3D11_SHADER_RESOURCE_VIEW_DESC sd = {};
    sd.Format = cd.Format; sd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D; sd.Texture2D.MipLevels = 1;
    dev_->CreateShaderResourceView(capTex_.Get(), &sd, &capSrv_);

    const DXGI_FORMAT fLin = DXGI_FORMAT_R16G16B16A16_FLOAT;
    DXGI_FORMAT fOut = hdr ? DXGI_FORMAT_R16G16B16A16_FLOAT : DXGI_FORMAT_B8G8R8A8_UNORM;
    uint32_t lw = std::max(1u, inW / 4), lh = std::max(1u, inH / 4);
    bool ok = true;
    ok &= lin_.Create(dev_.Get(), inW, inH, fLin);
    ok &= luma4_[0].Create(dev_.Get(), lw, lh, DXGI_FORMAT_R16_FLOAT);
    ok &= luma4_[1].Create(dev_.Get(), lw, lh, DXGI_FORMAT_R16_FLOAT);
    ok &= motion4_.Create(dev_.Get(), lw, lh, DXGI_FORMAT_R16G16_FLOAT);
    ok &= up_.Create(dev_.Get(), outW, outH, fLin);
    ok &= cur_[0].Create(dev_.Get(), outW, outH, fLin);
    ok &= cur_[1].Create(dev_.Get(), outW, outH, fLin);
    for (int i = 0; i < 6; i++) {
        uint32_t cw = std::max(1u, outW >> (i + 1)), ch = std::max(1u, outH >> (i + 1));
        ok &= chain_[i].Create(dev_.Get(), cw, ch, DXGI_FORMAT_R16G16B16A16_FLOAT);
    }
    ok &= aa_.Create(dev_.Get(), outW, outH, fLin);
    ok &= det_.Create(dev_.Get(), outW, outH, fLin);
    ok &= lit_.Create(dev_.Get(), outW, outH, fLin);
    ok &= mask_[0].Create(dev_.Get(), outW, outH, DXGI_FORMAT_R8G8B8A8_UNORM);
    ok &= mask_[1].Create(dev_.Get(), outW, outH, DXGI_FORMAT_R8G8B8A8_UNORM);
    ok &= scene_.Create(dev_.Get(), outW, outH, fLin);
    ok &= col_.Create(dev_.Get(), outW, outH, fLin);
    ok &= finalTex_.Create(dev_.Get(), outW, outH, fOut);
    if (!ok) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.lastError, "Failed to allocate pipeline textures (VRAM or format support).");
        return false;
    }
    cinW_ = inW; cinH_ = inH; coutW_ = outW; coutH_ = outH;
    std::lock_guard<std::mutex> lk(stats_.mu);
    stats_.inW = inW; stats_.inH = inH; stats_.outW = outW; stats_.outH = outH;
    return true;
}

// ------------------------------------------------------------------ capture target
bool Engine::EnsureCaptureTarget() {
    gameWnd_ = FindWindowForExeName(profile_.exeName.c_str());
    if (!gameWnd_ && profile_.exeName.empty()) gameWnd_ = GetForegroundWindow();
    if (!gameWnd_ || !IsWindow(gameWnd_)) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        stats_.windowFound = false;
        strcpy_s(stats_.status, "Waiting for game window...");
        return false;
    }
    DWORD pid = 0;
    GetWindowThreadProcessId(gameWnd_, &pid);
    if (pid != gamePid_ || gameMonitor_ == nullptr) {
        gamePid_ = pid;
        UpdateWindowRect();
        if (gameMonitor_ == nullptr) {
            std::lock_guard<std::mutex> lk(stats_.mu);
            stats_.windowFound = false;
            strcpy_s(stats_.status, "Game window found, but monitor unavailable.");
            return false;
        }
    }
    std::lock_guard<std::mutex> lk(stats_.mu);
    stats_.windowFound = true;
    strcpy_s(stats_.status, "Capturing");
    return true;
}

bool Engine::UpdateWindowRect() {
    if (!gameWnd_ || !IsWindow(gameWnd_)) return false;
    if (IsIconic(gameWnd_)) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.status, "Game window minimized - waiting.");
        return false;
    }
    RECT rcClient{};
    GetClientRect(gameWnd_, &rcClient);
    POINT tl{ 0, 0 };
    ClientToScreen(gameWnd_, &tl);
    int cw = rcClient.right - rcClient.left, ch = rcClient.bottom - rcClient.top;
    bool fullMonitor = false;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        fullMonitor = (app_.captureMode == 1);
    }
    HMONITOR mon = MonitorFromPoint({ tl.x + cw / 2, tl.y + ch / 2 }, MONITOR_DEFAULTTONEAREST);
    if (fullMonitor && mon) {
        MONITORINFO mi{ sizeof(mi) };
        GetMonitorInfoW(mon, &mi);
        gameClientRect_ = mi.rcMonitor;
    } else {
        gameClientRect_ = RECT{ tl.x, tl.y, tl.x + cw, tl.y + ch };
    }
    HMONITOR newMon = mon;
    bool sizeChanged = false;
    if (newMon != gameMonitor_) {
        gameMonitor_ = newMon;
        sizeChanged = true; // forces device/swapchain re-init by caller
    }
    if (gameClientRect_.right - gameClientRect_.left != (long)swInW_ ||
        gameClientRect_.bottom - gameClientRect_.top != (long)swInH_) {
        sizeChanged = true;
    }
    return sizeChanged;
}

bool Engine::AcquireFrame(uint32_t timeoutMs) {
    if (!dup_.Get()) return false;
    DXGI_OUTDUPL_FRAME_INFO fi{};
    NexusComPtr<IDXGIResource> res;
    HRESULT hr = dup_->AcquireNextFrame(timeoutMs, &fi, &res);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) return false;
    if (FAILED(hr)) {
        // access lost (mode change, fullscreen transition): recreate next tick
        dup_.Reset();
        return false;
    }
    NexusComPtr<ID3D11Texture2D> tex;
    res->QueryInterface(IID_PPV_ARGS(&tex));
    if (tex.Get()) {
        // desktop -> capture region
        DXGI_OUTPUT_DESC od{};
        // region relative to desktop texture
        D3D11_BOX box{};
        box.left = std::max<LONG>(0, gameClientRect_.left - dupDesktopLeft_);
        box.top = std::max<LONG>(0, gameClientRect_.top - dupDesktopTop_);
        box.right = std::min<LONG>(dupDesktopLeft_ + (LONG)dupOutW_, gameClientRect_.right) - dupDesktopLeft_;
        box.bottom = std::min<LONG>(dupDesktopTop_ + (LONG)dupOutH_, gameClientRect_.bottom) - dupDesktopTop_;
        if (box.right > box.left && box.bottom > box.top && capTex_.Get()) {
            ctx_->CopySubresourceRegion(capTex_.Get(), 0, 0, 0, 0, tex.Get(), 0, &box);
            LARGE_INTEGER now;
            QueryPerformanceCounter(&now);
            lastPresentQpc_ = fi.LastPresentTime.QuadPart ? fi.LastPresentTime.QuadPart : now.QuadPart;
            if (fi.AccumulatedFrames > 1) {
                std::lock_guard<std::mutex> lk(stats_.mu);
                stats_.dropped += fi.AccumulatedFrames - 1;
            }
        }
    }
    dup_->ReleaseFrame();
    return true;
}

// ------------------------------------------------------------------ pipeline
static void FillCb(CbData& cb, const FrameParams& p, uint32_t inW, uint32_t inH, uint32_t outW, uint32_t outH,
    float timeSec, uint64_t frameIdx, bool hasHist, bool hdrOut) {
    const float ss = MasterScale(p.master);
    cb.uSizes = F4((float)outW, (float)outH, (float)inW, (float)inH);
    cb.uTexel = F4(1.f / outW, 1.f / outH, 1.f / inW, 1.f / inH);
    cb.uFrame = F4(hasHist ? 1.f : 0.f, (float)(frameIdx % 1000000), timeSec, (float)p.viewMode);
    int aa = std::min((int)Q_EXTREME, std::max(0, p.aaLevel));
    cb.uSplit = F4(p.splitX, kAAStr[aa], kAAThr[aa], kAARad[aa]);
    int tl = std::min((int)Q_EXTREME, std::max(0, p.temporalLevel));
    cb.uTemporal = F4(kTempBase[tl], kTempClamp[tl], kTempProt[tl], kAOStr[std::min((int)Q_EXTREME, std::max(0, p.aoLevel))]);
    cb.uDetail = F4(p.fineDetail * ss, p.textureClarity * ss, p.edgeDetail * ss, p.localContrast * ss);
    cb.uDetail2 = F4(p.distantDetail * ss, std::min(p.denoise, kDenoiseLv[std::min((int)Q_EXTREME, std::max(0, p.artifactLevel))]),
        p.deband, p.detailBoost);
    cb.uShadow = F4(p.shadowQuality * ss, p.shadowDetail * ss, p.shadowStability, p.shadowSoftness);
    cb.uLight = F4(p.contactShadow * ss, p.lightingQuality * ss, p.lightDetail * ss, p.exposure);
    cb.uLight2 = F4(p.dynamicRange * ss, p.highlights, p.reflectionStrength * ss, p.reflectionStabilize);
    int sl = std::min((int)Q_EXTREME, std::max(0, p.sceneLevel));
    cb.uScene = F4(p.vegetation * ss * kSceneScale[sl], p.particles * ss * kSceneScale[sl],
        p.water * ss * kSceneScale[sl], p.characterProtect);
    cb.uColor = F4(p.brightness, p.contrast, p.saturation, p.gamma);
    cb.uColor2 = F4(p.highlights, p.shadows, p.temperature, p.hdrAmount);
    cb.uFinal = F4(p.sharpen * ss, hdrOut ? 1.f : 0.f, p.master, 0);
}

bool Engine::ProcessFrame() {
    if (!ctx_.Get() || !capTex_.Get()) return false;
    FrameParams p;
    bool hdrOut = false;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        p = effParams_;
        hdrOut = app_.hdrWanted && DesktopHdrActive();
    }
    CbData cb;
    static uint64_t frameCounter = 0;
    float timeSec = (float)(GetTickCount64() % 1000000) / 1000.0f;
    FillCb(cb, p, cinW_, cinH_, coutW_, coutH_, timeSec, frameCounter, histValid_, hdrOut);
    ctx_->UpdateSubresource(cb_.Get(), 0, nullptr, &cb, 0, 0);
    ID3D11Buffer* cbPtr = cb_.Get();
    ctx_->CSSetConstantBuffers(0, 1, &cbPtr);

    ID3D11DeviceContext* ctx = ctx_.Get();
    const UINT inW = cinW_, inH = cinH_, outW = coutW_, outH = coutH_;
    gpuTimer_.Begin(ctx);

    // 1) linearize (or synthetic scene in self-test mode)
    if (mode_ == 1) {
        ID3D11UnorderedAccessView* uav = lin_.uav.Get();
        ctx->CSSetShader(sh_.test.cs.Get(), nullptr, 0);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(inW, 16), DivUp(inH, 16), 1);
        UnbindCompute(ctx);
    } else {
        ID3D11ShaderResourceView* srv = capSrv_.Get();
        ID3D11UnorderedAccessView* uav = lin_.uav.Get();
        ctx->CSSetShader(sh_.linearize.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(inW, 16), DivUp(inH, 16), 1);
        UnbindCompute(ctx);
    }
    // 2) luma quarter
    {
        int li = lumaIdx_;
        ID3D11ShaderResourceView* srv = lin_.srv.Get();
        ID3D11UnorderedAccessView* uav = luma4_[li].uav.Get();
        ctx->CSSetShader(sh_.lowcur.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(luma4_[li].w, 16), DivUp(luma4_[li].h, 16), 1);
        UnbindCompute(ctx);
    }
    bool temporalOn = p.temporalLevel > 0;
    if (temporalOn && histValid_) {
        int li = lumaIdx_;
        int lp = 1 - li;
        ID3D11ShaderResourceView* srv[2] = { luma4_[lp].srv.Get(), luma4_[li].srv.Get() };
        ID3D11UnorderedAccessView* uav = motion4_.uav.Get();
        ctx->CSSetShader(sh_.motion.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 2, srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(motion4_.w / 8, 16), DivUp(motion4_.h / 8, 16), 1);
        UnbindCompute(ctx);
    }
    // 3) upscale
    {
        ID3D11ShaderResourceView* srv = lin_.srv.Get();
        ID3D11UnorderedAccessView* uav = up_.uav.Get();
        ctx->CSSetShader(sh_.upscale.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
    }
    // 4) temporal reconstruction
    {
        int ci = ping_;
        ID3D11ShaderResourceView* srv[3] = { up_.srv.Get(), cur_[1 - ci].srv.Get(), motion4_.srv.Get() };
        ID3D11UnorderedAccessView* uav = cur_[ci].uav.Get();
        ctx->CSSetShader(sh_.temporal.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 3, srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
        if (!histValid_) { /* first frame: temporal pass already emitted pure current */ }
    }
    ID3D11Texture2D* enhanced = cur_[ping_].tex.Get();
    ID3D11ShaderResourceView* enhancedSrv = cur_[ping_].srv.Get();
    // 5) downsample chain
    {
        ID3D11ShaderResourceView* srv = enhancedSrv;
        for (int i = 0; i < 6; i++) {
            ID3D11UnorderedAccessView* uav = chain_[i].uav.Get();
            ctx->CSSetShader(sh_.down.cs.Get(), nullptr, 0);
            ctx->CSSetShaderResources(0, 1, &srv);
            ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
            ctx->Dispatch(DivUp(chain_[i].w, 16), DivUp(chain_[i].h, 16), 1);
            UnbindCompute(ctx);
            srv = chain_[i].srv.Get();
        }
    }
    // 6) anti-aliasing (skipped entirely when OFF)
    bool aaOn = kAAStr[std::min((int)Q_EXTREME, std::max(0, p.aaLevel))] > 0.0f;
    ID3D11ShaderResourceView* detailSrcSrv = enhancedSrv;
    if (aaOn) {
        ID3D11ShaderResourceView* srv = enhancedSrv;
        ID3D11UnorderedAccessView* uav = aa_.uav.Get();
        ctx->CSSetShader(sh_.aa.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
        detailSrcSrv = aa_.srv.Get();
    }
    // 7) detail recovery
    {
        ID3D11ShaderResourceView* srv[2] = { detailSrcSrv, chain_[2].srv.Get() };
        ID3D11UnorderedAccessView* uav = det_.uav.Get();
        ctx->CSSetShader(sh_.detail.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 2, srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
    }
    // 8) light / AO / shadows / reflections
    {
        ID3D11ShaderResourceView* srv[5] = { det_.srv.Get(), chain_[2].srv.Get(), chain_[4].srv.Get(),
                                             mask_[1 - maskIdx_].srv.Get(), motion4_.srv.Get() };
        ID3D11UnorderedAccessView* uav[2] = { lit_.uav.Get(), mask_[maskIdx_].uav.Get() };
        ctx->CSSetShader(sh_.light.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 5, srv);
        ctx->CSSetUnorderedAccessViews(0, 2, uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
    }
    // 9) scene-adaptive pass (vegetation / particles / water / character)
    ID3D11ShaderResourceView* colorSrcSrv = lit_.srv.Get();
    int sl = std::min((int)Q_EXTREME, std::max(0, p.sceneLevel));
    if (sl > 0) {
        ID3D11ShaderResourceView* srv = lit_.srv.Get();
        ID3D11UnorderedAccessView* uav = scene_.uav.Get();
        ctx->CSSetShader(sh_.scene.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
        colorSrcSrv = scene_.srv.Get();
    }
    // 10) color engine
    {
        ID3D11ShaderResourceView* srv = colorSrcSrv;
        ID3D11UnorderedAccessView* uav = col_.uav.Get();
        ctx->CSSetShader(sh_.color.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 1, &srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
    }
    // 11) final: sharpen + dither + compare modes -> output texture
    {
        ID3D11ShaderResourceView* srv[2] = { col_.srv.Get(), capSrv_.Get() };
        ID3D11UnorderedAccessView* uav = finalTex_.uav.Get();
        ctx->CSSetShader(sh_.finalPass.cs.Get(), nullptr, 0);
        ctx->CSSetShaderResources(0, 2, srv);
        ctx->CSSetUnorderedAccessViews(0, 1, &uav, nullptr);
        ctx->Dispatch(DivUp(outW, 16), DivUp(outH, 16), 1);
        UnbindCompute(ctx);
    }
    gpuTimer_.End(ctx);
    float g = gpuTimer_.Resolve(ctx);
    if (g > 0) gpuMsAvg_ = (gpuMsAvg_ <= 0) ? g : gpuMsAvg_ * 0.9f + g * 0.1f;

    // history swap
    ping_ = 1 - ping_;
    lumaIdx_ = 1 - lumaIdx_;
    maskIdx_ = 1 - maskIdx_;
    histValid_ = temporalOn ? true : false;
    frameCounter++;

    // present
    if (mode_ == 0 && backBuf_.Get() && finalTex_.tex.Get() &&
        finalTex_.w == swW_ && finalTex_.h == swH_) {
        ctx->CopyResource(backBuf_.Get(), finalTex_.tex.Get());
        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        {
            std::lock_guard<std::mutex> lk(stats_.mu);
            if (lastPresentQpc_ && perfFreq_.QuadPart)
                stats_.latencyMs = (float)((now.QuadPart - lastPresentQpc_) * 1000.0 / perfFreq_.QuadPart);
        }
        if (swap_.Get()) {
            int vsync = appVsync() ? 1 : 0;
            HRESULT hr = swap_->Present(vsync, 0);
            if (hr == DXGI_STATUS_OCCLUDED) Sleep(100);
            fpsAccumCount_++;
        }
    }
    return true;
}

// ------------------------------------------------------------------ overlay window & swapchain
bool Engine::CreateOverlayWindow() {
    if (!dev_.Get()) return false;
    if (!overlayWnd_) {
        static bool clsRegistered = false;
        if (!clsRegistered) {
            WNDCLASSEXW wc = { sizeof(wc) };
            wc.lpfnWndProc = OverlayWndProc;
            wc.hInstance = GetModuleHandleW(nullptr);
            wc.lpszClassName = L"NexusOverlayWnd";
            wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
            RegisterClassExW(&wc);
            clsRegistered = true;
        }
        // desired output size: profile out clamped to monitor work area
        uint32_t outW = (uint32_t)std::max(320, (int)profile_.outW);
        uint32_t outH = (uint32_t)std::max(240, (int)profile_.outH);
        MONITORINFO mi{ sizeof(mi) };
        if (gameMonitor_) GetMonitorInfoW(gameMonitor_, &mi);
        else { mi.rcWork = RECT{ 0,0,(LONG)outW,(LONG)outH }; mi.rcMonitor = mi.rcWork; }
        int waW = mi.rcWork.right - mi.rcWork.left, waH = mi.rcWork.bottom - mi.rcWork.top;
        swW_ = std::min<uint32_t>(outW, (uint32_t)waW);
        swH_ = std::min<uint32_t>(outH, (uint32_t)waH);
        int x = gameClientRect_.left, y = gameClientRect_.top;
        if (x + (int)swW_ > mi.rcWork.right) x = std::max(mi.rcWork.left, mi.rcWork.right - (int)swW_);
        if (y + (int)swH_ > mi.rcWork.bottom) y = std::max(mi.rcWork.top, mi.rcWork.bottom - (int)swH_);
        LONG_PTR exStyle = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        if (!interaction_) exStyle |= WS_EX_TRANSPARENT; // click-through while playing
        overlayWnd_ = CreateWindowExW(exStyle,
            L"NexusOverlayWnd", L"Nexus Enhanced Output", WS_POPUP,
            x, y, (int)swW_, (int)swH_, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
        if (!overlayWnd_) return false;
        SetWindowLongPtrW(overlayWnd_, GWLP_USERDATA, (LONG_PTR)this);
        // exclude our own windows from capture (prevents feedback loops) - Win10 2004+
        HMODULE u32 = GetModuleHandleW(L"user32.dll");
        if (u32) {
            typedef BOOL(WINAPI* PFN_SWDA)(HWND, DWORD);
            PFN_SWDA swda = (PFN_SWDA)GetProcAddress(u32, "SetWindowDisplayAffinity");
            if (swda) swda(overlayWnd_, 0x00000011 /*WDA_EXCLUDEFROMCAPTURE*/);
        }
        ShowWindow(overlayWnd_, SW_SHOWNOACTIVATE);
    }
    // swapchain (once per pipeline build)
    if (!swap_.Get()) {
        bool hdr = false;
        { std::lock_guard<std::mutex> lk(cfgMu_); hdr = app_.hdrWanted && DesktopHdrActive(); }
        DXGI_SWAP_CHAIN_DESC1 d = {};
        d.Width = swW_; d.Height = swH_;
        d.Format = hdr ? DXGI_FORMAT_R16G16B16A16_FLOAT : DXGI_FORMAT_B8G8R8A8_UNORM;
        d.SampleDesc.Count = 1;
        d.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        d.BufferCount = 2;
        d.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
        HRESULT hr = factory_->CreateSwapChainForHwnd(dev_.Get(), overlayWnd_, &d, nullptr, nullptr, &swap_);
        if (FAILED(hr)) {
            d.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
            d.BufferCount = 1;
            hr = factory_->CreateSwapChainForHwnd(dev_.Get(), overlayWnd_, &d, nullptr, nullptr, &swap_);
            if (FAILED(hr)) {
                NEX_LOG("CreateSwapChainForHwnd failed 0x%08X", (unsigned)hr);
                return false;
            }
        }
        if (hdr && swap_.Get()) {
            NexusComPtr<IDXGISwapChain3> sc3;
            if (SUCCEEDED(swap_->QueryInterface(IID_PPV_ARGS(&sc3)))) {
                UINT supported = 0;
                if (SUCCEEDED(sc3->CheckColorSpaceSupport(DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709, &supported)) && supported)
                    sc3->SetColorSpace1(DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709);
            }
        }
        swap_->GetBuffer(0, IID_PPV_ARGS(&backBuf_));
        SetWindowPos(overlayWnd_, HWND_TOPMOST,
            gameClientRect_.left, gameClientRect_.top, (int)swW_, (int)swH_,
            SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
    return backBuf_.Get() != nullptr;
}

bool Engine::StartDuplication() {
    if (!dev_.Get() || !factory_.Get()) return false;
    dup_.Reset();
    NexusComPtr<IDXGIAdapter1> adapter;
    for (UINT a = 0; factory_->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; a++) {
        NexusComPtr<IDXGIOutput> out;
        for (UINT o = 0; adapter->EnumOutputs(o, &out) != DXGI_ERROR_NOT_FOUND; o++) {
            DXGI_OUTPUT_DESC od{};
            out->GetDesc(&od);
            if (od.Monitor == gameMonitor_) {
                NexusComPtr<IDXGIOutput1> out1;
                if (SUCCEEDED(out->QueryInterface(IID_PPV_ARGS(&out1)))) {
                    HRESULT hr = out1->DuplicateOutput(dev_.Get(), &dup_);
                    if (FAILED(hr)) {
                        NEX_LOG("DuplicateOutput failed 0x%08X", (unsigned)hr);
                        std::lock_guard<std::mutex> lk(stats_.mu);
                        strcpy_s(stats_.lastError, "Desktop duplication failed - update graphics drivers (Windows 10+ required).");
                        return false;
                    }
                    dupDesktopLeft_ = od.DesktopCoordinates.left;
                    dupDesktopTop_ = od.DesktopCoordinates.top;
                    dupOutW_ = (uint32_t)(od.DesktopCoordinates.right - od.DesktopCoordinates.left);
                    dupOutH_ = (uint32_t)(od.DesktopCoordinates.bottom - od.DesktopCoordinates.top);
                    uint32_t inW = (uint32_t)std::max<LONG>(64, gameClientRect_.right - gameClientRect_.left);
                    uint32_t inH = (uint32_t)std::max<LONG>(64, gameClientRect_.bottom - gameClientRect_.top);
                    inW = std::min<uint32_t>(inW, 3840); inH = std::min<uint32_t>(inH, 2160);
                    swInW_ = inW; swInH_ = inH;
                    return AllocResources(inW, inH, swW_, swH_);
                }
            }
            out.Reset();
        }
        adapter.Reset();
    }
    std::lock_guard<std::mutex> lk(stats_.mu);
    strcpy_s(stats_.lastError, "Could not locate the display output for duplication.");
    return false;
}

bool Engine::appVsync() {
    std::lock_guard<std::mutex> lk(cfgMu_);
    return app_.vsyncOverlay;
}

// ------------------------------------------------------------------ auto optimize
void Engine::AutoOptimizeTick() {
    static uint32_t last = 0;
    uint32_t now = GetTickCount();
    if (now - last < 1000) return;
    last = now;
    if (gpuMsAvg_ <= 0) return;
    bool enable; int target;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        enable = app_.enableAutoOptimize && mode_ == 0;
        target = app_.targetFps;
    }
    if (!enable) return;
    float budget = 1000.0f / (float)std::max(15, target) * 0.55f;
    if (autoCooldown_ > 0) { autoCooldown_--; return; }

    const char* names[5] = { "AO", "Scene detail", "Artifact reduction", "Temporal reconstruction", "Anti-aliasing" };
    int idx = -1, from = 0, to = 0;
    {
        std::lock_guard<std::mutex> lk(cfgMu_);
        if (gpuMsAvg_ > budget * 1.05f) {
            for (int i = 0; i < 5; i++) {
                int cur;
                switch (i) {
                case 0: cur = effParams_.aoLevel; break;
                case 1: cur = effParams_.sceneLevel; break;
                case 2: cur = effParams_.artifactLevel; break;
                case 3: cur = effParams_.temporalLevel; break;
                default: cur = effParams_.aaLevel; break;
                }
                if (cur > 0) {
                    autoRed_[i]++;
                    effParams_ = userParams_;
                    ApplyAutoReductions(effParams_);
                    idx = i; from = cur; to = cur - 1;
                    autoCooldown_ = 2;
                    break;
                }
            }
        } else if (gpuMsAvg_ < budget * 0.55f) {
            for (int i = 4; i >= 0; i--) {
                if (autoRed_[i] > 0) {
                    autoRed_[i]--;
                    effParams_ = userParams_;
                    ApplyAutoReductions(effParams_);
                    idx = i;
                    switch (i) {
                    case 0: from = effParams_.aoLevel; break;
                    case 1: from = effParams_.sceneLevel; break;
                    case 2: from = effParams_.artifactLevel; break;
                    case 3: from = effParams_.temporalLevel; break;
                    default: from = effParams_.aaLevel; break;
                    }
                    to = from;
                    autoCooldown_ = 3;
                    break;
                }
            }
        }
    }
    if (idx >= 0) {
        std::string msg = (to < from)
            ? Fmt("Auto: %s %s -> %s (holding %d FPS target)", names[idx], QName(from), QName(to), target)
            : Fmt("Auto: %s restored to %s (headroom available)", names[idx], QName(from));
        std::lock_guard<std::mutex> lk(stats_.mu);
        stats_.autoLog.push_back(msg);
        while (stats_.autoLog.size() > 24) stats_.autoLog.pop_front();
    }
}

// ------------------------------------------------------------------ thread
void Engine::ThreadProc() {
    HRESULT hrCo = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    QueryPerformanceFrequency(&perfFreq_);
    NEX_LOG("Engine thread start (mode=%s, profile=%s)", mode_ == 1 ? "selftest" : "live", profile_.displayName.c_str());

    if (mode_ == 1) {
        gameMonitor_ = MonitorFromPoint({ 0, 0 }, MONITOR_DEFAULTTONEAREST);
        if (!InitDeviceAndShaders() || !AllocResources(1280, 720, 1920, 1080)) {
            std::lock_guard<std::mutex> lk(stats_.mu);
            stats_.selfTestDone = true; stats_.selfTestOk = false;
            NEX_LOG("Self test: init failed: %s", stats_.lastError);
            ReleasePipeline();
            if (hrCo == S_OK || hrCo == S_FALSE) CoUninitialize();
            running_ = false;
            return;
        }
        LARGE_INTEGER f; QueryPerformanceFrequency(&f);
        LARGE_INTEGER t0; QueryPerformanceCounter(&t0);
        const int kFrames = 150;
        for (int i = 0; i < kFrames && !stopFlag_.load(); i++) {
            ProcessFrame();
            Sleep(4);
        }
        LARGE_INTEGER t1; QueryPerformanceCounter(&t1);
        double secs = (double)(t1.QuadPart - t0.QuadPart) / f.QuadPart;
        bool ok = gpuMsAvg_ > 0 && gpuMsAvg_ < 250;
        {
            std::lock_guard<std::mutex> lk(stats_.mu);
            stats_.frames = kFrames;
            stats_.gpuMs = gpuMsAvg_;
            stats_.fps = kFrames / std::max(0.001, secs);
            strcpy_s(stats_.status, ok ? "Self test passed - enhancement pipeline verified on this GPU."
                                       : "Self test finished with warnings (check log).");
            stats_.selfTestOk = ok;
            stats_.selfTestDone = true;
        }
        NEX_LOG("Self test done: gpuMs=%.2f ok=%d", gpuMsAvg_, ok ? 1 : 0);
        ReleasePipeline();
        if (hrCo == S_OK || hrCo == S_FALSE) CoUninitialize();
        running_ = false;
        return;
    }

    // ---------------- live mode ----------------
    while (!stopFlag_.load()) {
        if (EnsureCaptureTarget()) break;
        Sleep(200);
    }
    if (stopFlag_.load()) { running_ = false; if (hrCo == S_OK || hrCo == S_FALSE) CoUninitialize(); return; }

    UpdateWindowRect();
    bool ready = InitDeviceAndShaders();
    if (ready) ready = CreateOverlayWindow();
    if (ready) ready = StartDuplication();
    if (ready) {
        RECT orc{};
        if (GetWindowRect(overlayWnd_, &orc)) {
            std::lock_guard<std::mutex> lk(stats_.mu);
            stats_.outX = orc.left; stats_.outY = orc.top;
        }
    }
    if (!ready) {
        std::lock_guard<std::mutex> lk(stats_.mu);
        strcpy_s(stats_.status, "Error");
        if (!stats_.lastError[0]) strcpy_s(stats_.lastError, "Engine initialization failed.");
        NEX_LOG("Engine init failed: %s", stats_.lastError);
        if (overlayWnd_) { DestroyWindow(overlayWnd_); overlayWnd_ = nullptr; }
        ReleasePipeline();
        running_ = false;
        if (hrCo == S_OK || hrCo == S_FALSE) CoUninitialize();
        return;
    }
    {
        std::lock_guard<std::mutex> lk(stats_.mu);
        stats_.capturing = true;
        strcpy_s(stats_.status, "Enhancing");
    }
    NEX_LOG("Engine active: in=%ux%u out=%ux%u", cinW_, cinH_, coutW_, coutH_);

    uint32_t tick250 = 0;
    LARGE_INTEGER lastStats = {};
    QueryPerformanceCounter(&lastStats);

    while (!stopFlag_.load()) {
        PumpOverlayMessages();

        uint32_t nowT = GetTickCount();
        if (nowT - tick250 >= 250) {
            tick250 = nowT;
            if (!IsWindow(gameWnd_)) {
                std::lock_guard<std::mutex> lk(stats_.mu);
                stats_.windowFound = false;
                strcpy_s(stats_.status, "Waiting for game window...");
            } else {
                bool changed = UpdateWindowRect();
                if (changed) {
                    NEX_LOG("Capture target changed - rebuilding pipeline");
                    dup_.Reset();
                    if (overlayWnd_) { DestroyWindow(overlayWnd_); overlayWnd_ = nullptr; }
                    ReleasePipeline();
                    if (InitDeviceAndShaders() && CreateOverlayWindow() && StartDuplication()) {
                        std::lock_guard<std::mutex> lk(stats_.mu);
                        stats_.capturing = true; stats_.windowFound = true;
                        strcpy_s(stats_.status, "Enhancing");
                    } else {
                        std::lock_guard<std::mutex> lk(stats_.mu);
                        stats_.capturing = false;
                        strcpy_s(stats_.status, "Error");
                    }
                }
            }
        }
        if (!dup_.Get()) StartDuplication();

        bool got = AcquireFrame(12);
        if (got) {
            ProcessFrame();
        } else {
            if (backBuf_.Get() && swap_.Get() && finalTex_.tex.Get() &&
                finalTex_.w == swW_ && finalTex_.h == swH_) {
                ctx_->CopyResource(backBuf_.Get(), finalTex_.tex.Get());
                swap_->Present(appVsync() ? 1 : 0, 0);
            }
            Sleep(6);
        }

        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        double dt = (double)(now.QuadPart - lastStats.QuadPart) / perfFreq_.QuadPart;
        if (dt >= 0.5) {
            lastStats = now;
            std::lock_guard<std::mutex> lk(stats_.mu);
            double fps = fpsAccumCount_ / std::max(0.001, dt);
            fpsAccumCount_ = 0;
            stats_.fps = fps;
            stats_.gpuMs = gpuMsAvg_;
            stats_.frameMs = 1000.0 / std::max(1.0, fps);
            stats_.frames++;
            int idx = stats_.histN % 120;
            stats_.fpsHist[idx] = (float)fps;
            stats_.procHist[idx] = gpuMsAvg_;
            stats_.histN++;
            if (stats_.windowFound && stats_.capturing) strcpy_s(stats_.status, "Enhancing");
        }
        AutoOptimizeTick();
        Sleep(1);
    }

    if (overlayWnd_) { DestroyWindow(overlayWnd_); overlayWnd_ = nullptr; }
    ReleasePipeline();
    {
        std::lock_guard<std::mutex> lk(stats_.mu);
        stats_.capturing = false;
        strcpy_s(stats_.status, "Idle");
    }
    NEX_LOG("Engine thread exit");
    if (hrCo == S_OK || hrCo == S_FALSE) CoUninitialize();
    running_ = false;
}
