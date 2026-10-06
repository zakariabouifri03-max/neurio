#include "engine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// pass indexes (match NShaders table)
enum {
    P_VS = 0, P_IMPORT, P_LUMA, P_DOWN, P_MOTION, P_TEMPORAL, P_RECON,
    P_AAE, P_AAB, P_SHADOW, P_LIGHT, P_AO, P_REFLECT, P_DETAIL, P_DISTANT,
    P_VEG, P_PARTICLE, P_WATER, P_LOD, P_COLOR, P_DEBAND, P_OUTPUT,
    P_STANDBY, P_SELFTEST, P_COUNT
};

// ---------------------------------------------------------------- constant buffers
typedef float F4[4];
struct CBImport   { F4 outSize; F4 srcFull; F4 crop; F4 pad; };
struct CBPlain    { F4 outSize; F4 pad; };
struct CBMotion   { F4 outSize; float gain; float bias; float pad; float pad2; };
struct CBTemporal { F4 outSize; float amt; float sharp; float gate; float first; };
struct CBRecon    { F4 outSize; float amt; float edgeK; float pad; float pad2; };
struct CBAE       { F4 outSize; float thr; float pad; float pad2; float pad3; };
struct CBAAB      { F4 outSize; float radius; float blend; float pad; float pad2; };
struct CBShadow   { F4 outSize; float quality; float detail; float stability; float softness; float contact; float pad; float pad2; float pad3; };
struct CBLight    { F4 outSize; float exposure; float local; float detail; float dyn; float quality; float pad; float pad2; float pad3; };
struct CBAO       { F4 outSize; float amt; float radius; float halo; float pad; float pad2; float pad3; float pad4; };
struct CBStd      { F4 outSize; float amt; float pad; float pad2; float pad3; };
struct CBDistant  { F4 outSize; float amt; float stab; float pad; float pad2; };
struct CBDetail   { F4 outSize; float sharp; float fine; float texcl; float edge; float denoise; float pad; float pad2; float pad3; };
struct CBColor    { F4 outSize; float bright; float contrast; float sat; float hi; float sh; float gamma; float temp; float hdr; };
struct CBOutput   { F4 outSize; float split; float beforeAfter; float hdrOut; F4 hudRect; float pad; };
struct CBStandby  { F4 outSize; F4 hudRect; float bg; float pad; float pad2; };
struct CBTest     { F4 time; F4 res; F4 pad; F4 pad2; };

static void SetF4(F4 v, float x, float y, float z, float w){ v[0]=x; v[1]=y; v[2]=z; v[3]=w; }

// ----------------------------------------------------------------
typedef HRESULT (WINAPI *D3DCompileFn)(LPCVOID, SIZE_T, LPCWSTR, const void*, void*, LPCWSTR, LPCWSTR, ID3DBlob**, ID3DBlob**);
static D3DCompileFn g_d3dCompile = 0;
static void* g_d3dMod = 0;

// zig's ID3D10Blob lacks GetBufferLength - call it through the stable COM vtable
struct NxBlobVtbl { const void* a; const void* b; const void* c; const void* d;
                    void* (*getPtr)(void*); unsigned long (*getLen)(void*); };
static SIZE_T BlobLen_(ID3D10Blob* b){
    NxBlobVtbl* vt = *(NxBlobVtbl**)&b;
    return (SIZE_T)vt->getLen(b);
}

static int LoadD3DCompiler(void){
    const wchar_t* names[3] = { L"d3dcompiler_47.dll", L"d3dcompiler_46.dll", L"d3dcompiler_43.dll" };
    for (int i = 0; i < 3; i++){
        void* m = LoadLibraryW(names[i]);
        if (m){
            g_d3dCompile = (D3DCompileFn)GetProcAddress((HMODULE)m, "D3DCompile");
            if (g_d3dCompile){ g_d3dMod = m; return 0; }
        }
    }
    return 1;
}

// ----------------------------------------------------------------
int Engine::Init(HWND overlayHwnd, int w, int h){
    overlayHwnd = overlayHwnd;
    swW = w; swH = h;
    selftestT = 0;
    fps = 0; frameMs = 0; procMs = 0; latencyMs = 0;
    dropped = 0; frames = 0; presentCount = 0;
    lastPresentMs = NowMs_();
    fpsT0 = lastPresentMs;
    pW = pH = 0;
    InitializeCriticalSection(&reqCs);
    memset(&W[0], 0, sizeof W);
    memset(&SelfTest, 0, sizeof SelfTest);

    HRESULT hr = E_FAIL;
    UINT flags = 0;
#ifdef _DEBUG
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
    static const D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    hr = D3D11CreateDevice(0, D3D_DRIVER_TYPE_HARDWARE, 0, flags, levels, 2,
                           D3D11_SDK_VERSION, &dev, 0, &ctx);
    if (FAILED(hr)){
        NLog("GPU device creation failed (hr=0x%08lX), falling back to WARP software renderer", (unsigned long)hr);
        hr = D3D11CreateDevice(0, D3D_DRIVER_TYPE_WARP, 0, flags, levels, 2,
                               D3D11_SDK_VERSION, &dev, 0, &ctx);
        NLog("WARP software device created");
    }
    if (FAILED(hr)){
        snprintf(lastErr, sizeof lastErr, "D3D11CreateDevice failed 0x%08lX", (unsigned long)hr);
        return -1;
    }

    hr = CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&factory);
    if (FAILED(hr) || !factory){
        snprintf(lastErr, sizeof lastErr, "CreateDXGIFactory1 failed 0x%08lX", (unsigned long)hr);
        return -1;
    }

    if (LoadD3DCompiler()){
        snprintf(lastErr, sizeof lastErr, "d3dcompiler_4x.dll not found");
        return -2;
    }
    if (CompileShaders()) return -3;

    // sampler
    D3D11_SAMPLER_DESC sd; ZeroMemory(&sd, sizeof sd);
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MipLODBias = 0; sd.MaxAnisotropy = 1;
    sd.ComparisonFunc = D3D11_COMPARISON_NEVER;
    sd.MinLOD = 0; sd.MaxLOD = D3D11_FLOAT32_MAX;
    dev->CreateSamplerState(&sd, &smp);

    // vertex buffer: fullscreen triangle
    const float verts[6] = { -1.f, -1.f, 3.f, -1.f, -1.f, 3.f };
    D3D11_BUFFER_DESC bd; ZeroMemory(&bd, sizeof bd);
    bd.ByteWidth = sizeof verts; bd.Usage = D3D11_USAGE_IMMUTABLE;
    bd.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    D3D11_SUBRESOURCE_DATA sd0; sd0.pSysMem = verts;
    dev->CreateBuffer(&bd, &sd0, &vb);

    // queries
    D3D11_QUERY_DESC qd; qd.Query = D3D11_QUERY_EVENT; qd.MiscFlags = 0;
    dev->CreateQuery(&qd, &qStart);
    dev->CreateQuery(&qd, &qEnd);

    // HUD texture (dynamic)
    HUD.w = 512; HUD.h = 320;
    NewTex(HUD.w, HUD.h, DXGI_FORMAT_B8G8R8A8_UNORM, false, true,
           &HUD.tex, 0, &HUD.srv);
    // clear
    if (HUD.tex){
        unsigned int zeros[512 * 320];
        memset(zeros, 0, sizeof zeros);
        ctx->UpdateSubresource(HUD.tex, 0, 0, zeros, HUD.w * 4, HUD.w * HUD.h * 4);
    }

    if (ResizeSwap(w, h)) return -4;
    NLog("Engine initialized: %dx%d overlay, shader set %d passes", w, h, NShaderCount);
    return 0;
}

int Engine::NewTex(int w, int h, DXGI_FORMAT fmt, bool rt, bool dyn,
                   ID3D11Texture2D** tex, ID3D11RenderTargetView** rtv, ID3D11ShaderResourceView** srv){
    D3D11_TEXTURE2D_DESC d; ZeroMemory(&d, sizeof d);
    d.Width = (UINT)w; d.Height = (UINT)h;
    d.MipLevels = 1; d.ArraySize = 1;
    d.Format = fmt;
    d.SampleDesc.Count = 1;
    d.Usage = dyn ? D3D11_USAGE_DYNAMIC : D3D11_USAGE_DEFAULT;
    d.BindFlags = (rt ? D3D11_BIND_RENDER_TARGET : 0) | D3D11_BIND_SHADER_RESOURCE;
    if (dyn) d.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    if (FAILED(dev->CreateTexture2D(&d, 0, tex))) return -1;
    if (rt) dev->CreateRenderTargetView(*tex, 0, rtv);
    if (srv) dev->CreateShaderResourceView(*tex, 0, srv);
    return 0;
}

int Engine::CompileShaders(){
    psCount = 0;
    char src[8192];
    for (int i = 0; i < NShaderCount; i++){
        const NShaderDef* def = &NShaders[i];
        if (i == P_VS){
            strncpy(src, def->src, sizeof src - 1); src[sizeof src - 1] = 0;
        } else {
            strcpy(src, SH_COMMON);
            strncat(src, def->src, sizeof src - strlen(src) - 1);
        }
        ID3DBlob* blob = 0; ID3DBlob* err = 0;
        HRESULT hr = g_d3dCompile((LPCVOID)src, strlen(src), 0, 0, 0,
                                  (i == P_VS) ? L"vs_5_0" : L"ps_5_0", 0, &blob, &err);
        if (FAILED(hr)){
            char msg[512] = {0};
            if (err && BlobLen_(err))
                strncpy(msg, (const char*)err->GetBufferPointer(), sizeof msg - 1);
            if (err) err->Release();
            NLog("Shader compile failed: %s: %s", def->name, msg[0] ? msg : "unknown");
            if (blob) blob->Release();
            snprintf(lastErr, sizeof lastErr, "shader %s compile failed", def->name);
            return -1;
        }
        if (err) err->Release();
        void* code = blob->GetBufferPointer();
        SIZE_T len = BlobLen_(blob);
        if (i == P_VS){
            if (FAILED(dev->CreateVertexShader(code, len, 0, &vs))) return -1;
            // input layout from the same bytecode
            D3D11_INPUT_ELEMENT_DESC ied[1] = {
                { "POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 }
            };
            dev->CreateInputLayout(ied, 1, code, len, &layout);
        } else {
            if (FAILED(dev->CreatePixelShader(code, len, 0, &ps[i]))) return -1;
            // constant buffer
            D3D11_BUFFER_DESC bd; ZeroMemory(&bd, sizeof bd);
            bd.ByteWidth = 128; bd.Usage = D3D11_USAGE_DEFAULT;
            bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
            dev->CreateBuffer(&bd, 0, &cbs[i]);
        }
        blob->Release();
        psCount = i + 1;
    }
    return 0;
}

// ----------------------------------------------------------------
int Engine::ResizeSwap(int w, int h){
    if (w < 16) w = 16; if (h < 16) h = 16;
    if (swap){
        ctx->Unmap(0, 0);
        swap->Release();
        swap = 0;
        if (swapRtv){ swapRtv->Release(); swapRtv = 0; }
        hdrSwap = false;
    }
    // flip-model composition swapchain. The DXGI_SWAP_CHAIN_DESC1 layout on
    // Windows includes a trailing ColorSpace field that this toolchain's header
    // omits, so zero-pad the struct (0 = RGB full sRGB = SDR).
    IDXGIFactory2* f2 = 0;
    HRESULT hr = factory->QueryInterface(__uuidof(IDXGIFactory2), (void**)&f2);
    if (SUCCEEDED(hr)){
        unsigned char buf[sizeof(DXGI_SWAP_CHAIN_DESC1) + 16];
        memset(buf, 0, sizeof buf);
        DXGI_SWAP_CHAIN_DESC1* d = (DXGI_SWAP_CHAIN_DESC1*)buf;
        d->Width = (UINT)w; d->Height = (UINT)h;
        d->Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        d->SampleDesc.Count = 1;
        d->BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        d->BufferCount = 2;
        d->SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
        d->AlphaMode = DXGI_ALPHA_MODE_IGNORE;
        // this toolchain lacks the C++ definition of IDXGIFactory2 - call
        // CreateSwapChainForComposition through the stable COM vtable
        // (vtable: 0 QI,1 AddRef,2 Release,3 CreateSwapChain,4 CreateSwapChainForHwnd,
        //  5 GetAdapter,6 CreateSwapChainForComposition)
        typedef HRESULT (STDMETHODCALLTYPE *CSFCFn)(void*, IUnknown*, const DXGI_SWAP_CHAIN_DESC1*, IDXGIOutput*, IDXGISwapChain1**);
        CSFCFn csfc = (CSFCFn)((void**)f2)[6];
        IDXGISwapChain1* sc1 = 0;
        hr = csfc((void*)f2, (IUnknown*)dev, d, 0, &sc1);
        if (SUCCEEDED(hr)){
            flipModel = true;
            swap = sc1;
            sc1 = 0;
            swap->SetFullscreenState(FALSE, 0);
            ID3D11Texture2D* bb = 0;
            swap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&bb);
            if (bb){ dev->CreateRenderTargetView(bb, 0, &swapRtv); bb->Release(); }
        }
        f2->Release();
    }
    if (!swap){
        // legacy fallback
        DXGI_SWAP_CHAIN_DESC d2; ZeroMemory(&d2, sizeof d2);
        d2.BufferCount = 2;
        d2.BufferDesc.Width = (UINT)w; d2.BufferDesc.Height = (UINT)h;
        d2.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        d2.BufferDesc.RefreshRate.Numerator = 60; d2.BufferDesc.RefreshRate.Denominator = 1;
        d2.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        d2.OutputWindow = overlayHwnd;
        d2.Windowed = TRUE;
        d2.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
        hr = factory->CreateSwapChain(dev, &d2, &swap);
        if (SUCCEEDED(hr)){
            flipModel = false;
            ID3D11Texture2D* bb = 0;
            swap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&bb);
            if (bb){ dev->CreateRenderTargetView(bb, 0, &swapRtv); bb->Release(); }
        }
    }
    if (!swap){
        snprintf(lastErr, sizeof lastErr, "swapchain creation failed 0x%08lX", (unsigned long)hr);
        return -1;
    }
    swW = w; swH = h;
    return 0;
}

// DXGI_COLOR_SPACE1_SCRGB_FULL_G10_NONE value (enum missing from this toolchain)
#define NEXUS_CSPACE_SCRGB_FULL_G10_NONE 16u
bool Engine::HdrColorSpaceSupported(){
    IDXGIFactory2* f2 = 0;
    if (FAILED(factory->QueryInterface(__uuidof(IDXGIFactory2), (void**)&f2))) return false;
    // vtable: 0 QI,1 AddRef,2 Release,3 CreateSwapChain,4 CreateSwapChainForHwnd,
    // 5 GetAdapter,6 CreateSwapChainForComposition,7 GetWindowedColorSpaceSupport,
    // 8 GetWindowedColorSpace,9 SetWindowedColorSpace,10 IsWindowedColorSpaceSupported
    typedef HRESULT (STDMETHODCALLTYPE *IsWCSFn)(void*, UINT, WINBOOL*);
    IsWCSFn fn = (IsWCSFn)((void**)f2)[10];
    WINBOOL supported = FALSE;
    HRESULT hr = fn((void*)f2, NEXUS_CSPACE_SCRGB_FULL_G10_NONE, &supported);
    f2->Release();
    return SUCCEEDED(hr) && supported;
}

// ----------------------------------------------------------------
void Engine::SetRequest(const FrameReq* r){
    EnterCriticalSection(&reqCs);
    req = r;
    LeaveCriticalSection(&reqCs);
}
void Engine::UpdateHud(const unsigned int* rgba, int w, int h){
    if (!HUD.tex || !rgba) return;
    int cw = w < HUD.w ? w : HUD.w;
    int ch = h < HUD.h ? h : HUD.h;
    ctx->UpdateSubresource(HUD.tex, 0, 0, rgba, w * 4, w * ch * 4);
}

ID3D11ShaderResourceView* Engine::SrvFor(ID3D11Texture2D* t, DXGI_FORMAT fmt){
    // external capture textures: use the engine's own SRV (same device)
    ID3D11ShaderResourceView* s = 0;
    dev->CreateShaderResourceView(t, 0, &s);
    return s;
}

void Engine::ClearSrvCache(){
    // called on pipeline rebuild / capture frame change
}

void Engine::EnsureSelftestTex(int w, int h){
    if (SelfTest.tex && SelfTest.w == w && SelfTest.h == h) return;
    if (SelfTest.tex){
        SelfTest.tex->Release(); SelfTest.tex = 0;
        if (SelfTest.rtv){ SelfTest.rtv->Release(); SelfTest.rtv = 0; }
        if (SelfTest.srv){ SelfTest.srv->Release(); SelfTest.srv = 0; }
    }
    NewTex(w, h, DXGI_FORMAT_B8G8R8A8_UNORM, true, false, &SelfTest.tex, &SelfTest.rtv, &SelfTest.srv);
    SelfTest.w = w; SelfTest.h = h;
}

// ----------------------------------------------------------------
void Engine::BindSrvs(const ID3D11ShaderResourceView* const* srvs, int n){
    ID3D11ShaderResourceView* nulls[8] = {0,0,0,0,0,0,0,0};
    for (int i = 0; i < n && i < 8; i++) nulls[i] = const_cast<ID3D11ShaderResourceView*>(srvs[i]);
    ctx->PSSetShaderResources(0, 8, nulls);
}

void Engine::DrawPass(int pass, const void* cb, int rtIndex){
    if (!ps[pass]) return;
    if (cb && cbs[pass]) ctx->UpdateSubresource(cbs[pass], 0, 0, cb, 0, 0);
    ctx->PSSetShader(ps[pass], 0, 0);
    if (cbs[pass]) ctx->PSSetConstantBuffers(0, 1, &cbs[pass]);
    ID3D11RenderTargetView* rt = 0;
    if (rtIndex < 0) rt = swapRtv;
    else if (rtIndex == 90) rt = L0.rtv;
    else if (rtIndex == 91) rt = L1.rtv;
    else if (rtIndex == 92) rt = L1C.rtv;
    else if (rtIndex == 93) rt = PREV_L0.rtv;
    else if (rtIndex == 94) rt = SelfTest.rtv;
    else if (rtIndex == 100) rt = M[0].rtv;
    else if (rtIndex == 101) rt = M[1].rtv;
    else if (rtIndex >= 0 && rtIndex < 4) rt = W[rtIndex].rtv;
    if (!rt) rt = swapRtv;
    ctx->OMSetRenderTargets(1, &rt, 0);
    ctx->Draw(3, 0);
}

int Engine::BuildPipeline(int w, int h){
    ReleasePipeline();
    pW = w; pH = h;
    int qw = (w + 3) / 4, qh = (h + 3) / 4;
    for (int i = 0; i < 4; i++)
        if (NewTex(w, h, DXGI_FORMAT_B8G8R8A8_UNORM, true, false, &W[i].tex, &W[i].rtv, &W[i].srv)) return -1;
    if (NewTex(w, h, DXGI_FORMAT_R8_UNORM, true, false, &L0.tex, &L0.rtv, &L0.srv)) return -1;
    if (NewTex(w, h, DXGI_FORMAT_R8_UNORM, true, false, &PREV_L0.tex, &PREV_L0.rtv, &PREV_L0.srv)) return -1;
    if (NewTex(qw, qh, DXGI_FORMAT_R8_UNORM, true, false, &L1.tex, &L1.rtv, &L1.srv)) return -1;
    if (NewTex(qw, qh, DXGI_FORMAT_B8G8R8A8_UNORM, true, false, &L1C.tex, &L1C.rtv, &L1C.srv)) return -1;
    if (NewTex(w, h, DXGI_FORMAT_R8_UNORM, true, false, &M[0].tex, &M[0].rtv, &M[0].srv)) return -1;
    if (NewTex(w, h, DXGI_FORMAT_R8_UNORM, true, false, &M[1].tex, &M[1].rtv, &M[1].srv)) return -1;
    if (NewTex(w, h, DXGI_FORMAT_B8G8R8A8_UNORM, true, false, &PREV.tex, &PREV.rtv, &PREV.srv)) return -1;
    return 0;
}

void Engine::ReleasePipeline(){
    #undef REL_T
    #define REL_T(t) do { if ((t).srv){ (t).srv->Release(); (t).srv = 0; } \
                          if ((t).rtv){ (t).rtv->Release(); (t).rtv = 0; } \
                          if ((t).tex){ (t).tex->Release(); (t).tex = 0; } } while (0)
    for (int i = 0; i < 4; i++) REL_T(W[i]);
    REL_T(L0); REL_T(PREV_L0); REL_T(L1); REL_T(L1C);
    REL_T(M[0]); REL_T(M[1]); REL_T(PREV);
    pW = pH = 0;
}

// ----------------------------------------------------------------
bool Engine::Tick(){
    if (!dev) return false;
    const FrameReq* r;
    EnterCriticalSection(&reqCs);
    r = req;
    LeaveCriticalSection(&reqCs);
    if (!r) return false;

    // ---- source
    FrameSource src;
    memset(&src, 0, sizeof src);
    bool haveSrc = false;
    if (r->srcMode == 2){
        EnsureSelftestTex(r->selftestW > 0 ? r->selftestW : 1280, r->selftestH > 0 ? r->selftestH : 720);
        selftestT += 1.0 / 60.0;
        CBTest cb;
        SetF4(cb.time, (float)selftestT, 0, 0, 0);
        SetF4(cb.res, (float)SelfTest.w, (float)SelfTest.h, 0, 0);
        SetF4(cb.pad, 0,0,0,0); SetF4(cb.pad2, 0,0,0,0);
        // render selftest into its own texture
        ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        ctx->IASetInputLayout(layout);
        ctx->VSSetShader(vs, 0, 0);
        UINT stride0 = 8, off0 = 0;
        ctx->IASetVertexBuffers(0, 1, &vb, &stride0, &off0);
        ctx->PSSetSamplers(0, 1, &smp);
        ID3D11ShaderResourceView* nulls[8] = {0};
        ctx->PSSetShaderResources(0, 8, nulls);
        DrawPass(P_SELFTEST, &cb, 94);
        haveSrc = true;
        src.tex = SelfTest.tex; src.w = SelfTest.w; src.h = SelfTest.h;
        src.fmt = DXGI_FORMAT_B8G8R8A8_UNORM;
        src.cropX = src.cropY = src.cropW = src.cropH = 0;
        src.acquireMs = NowMs_();
        src.valid = true;
    } else if (r->srcMode == 1){
        if (r->src.valid && r->src.tex){
            src = r->src;
            haveSrc = true;
        }
    }

    if (!haveSrc){
        // standby screen
        CBStandby cb;
        SetF4(cb.outSize, (float)swW, (float)swH, 0, 0);
        SetF4(cb.hudRect, 0, 0, (float)HUD.w / (float)swW, (float)HUD.h / (float)swH);
        cb.bg = 0.05f; cb.pad = 0; cb.pad2 = 0;
        ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        ctx->VSSetShader(vs, 0, 0);
        ctx->IASetInputLayout(layout);
        UINT stride = 8, off = 0;
        ctx->IASetVertexBuffers(0, 1, &vb, &stride, &off);
        ctx->PSSetSamplers(0, 1, &smp);
        DrawPass(P_STANDBY, &cb, -1);
        ctx->PSSetShader(0, 0, 0);
        HRESULT hr = swap->Present(1, 0);
        double now = NowMs_();
        frameMs = now - lastPresentMs;
        lastPresentMs = now;
        presentCount++; frames++;
        if (now - fpsT0 >= 1000.0){ fps = (double)(presentCount - 0) * 1000.0 / (now - fpsT0); fpsT0 = now; }
        return SUCCEEDED(hr);
    }

    int outW = r->s.outW > 0 ? r->s.outW : src.w;
    int outH = r->s.outH > 0 ? r->s.outH : src.h;
    if (outW < 16) outW = 16;
    if (outH < 16) outH = 16;
    if (outW > 3840) outW = 3840;
    if (outH > 2160) outH = 2160;

    if (pW != outW || pH != outH){
        if (BuildPipeline(outW, outH)){
            NLog("Pipeline build failed at %dx%d", outW, outH);
            return false;
        }
        NLog("Pipeline: %dx%d output (source %dx%d)", outW, outH, src.w, src.h);
    }

    // source SRV (capture textures are external - create SRV each frame start; cheap and safe)
    ID3D11ShaderResourceView* srcSrv = SrvFor(src.tex, src.fmt);

    float f = MasterFactor_(r->s.master);
    const NexusSettings* s = &r->s;

    ctx->ClearState();
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->IASetInputLayout(layout);
    ctx->VSSetShader(vs, 0, 0);
    UINT stride = 8, off = 0;
    ctx->IASetVertexBuffers(0, 1, &vb, &stride, &off);
    ctx->PSSetSamplers(0, 1, &smp);

    ctx->Begin(qStart);

    // ---- import: src -> W[3] (linear)
    CBImport cbi;
    SetF4(cbi.outSize, (float)outW, (float)outH, 0, 0);
    SetF4(cbi.srcFull, (float)src.w, (float)src.h, 0, 0);
    int cx = src.cropX, cy = src.cropY, cw = src.cropW ? src.cropW : src.w, ch = src.cropH ? src.cropH : src.h;
    if (cx + cw > src.w) cw = src.w - cx;
    if (cy + ch > src.h) ch = src.h - cy;
    SetF4(cbi.crop, (float)cx, (float)cy, (float)cw, (float)ch);
    SetF4(cbi.pad, 0,0,0,0);
    {
        const ID3D11ShaderResourceView* sr[1] = { srcSrv };
        BindSrvs(sr, 1);
        DrawPass(P_IMPORT, &cbi, 3);
    }

    // ---- luma + downsample pyramid
    CBPlain cbp;
    SetF4(cbp.outSize, (float)outW, (float)outH, 0, 0); SetF4(cbp.pad, 0,0,0,0);
    {
        const ID3D11ShaderResourceView* sr[1] = { W[3].srv };
        BindSrvs(sr, 1);
        DrawPass(P_LUMA, &cbp, 90);
    }
    {
        CBPlain cbp2; SetF4(cbp2.outSize, (float)((outW+3)/4), (float)((outH+3)/4), 0, 0); SetF4(cbp2.pad,0,0,0,0);
        const ID3D11ShaderResourceView* sr[1] = { L0.srv };
        BindSrvs(sr, 1);
        DrawPass(P_DOWN, &cbp2, 91);
    }
    {
        CBPlain cbpc;
        SetF4(cbpc.outSize, (float)((outW+3)/4), (float)((outH+3)/4), 0, 0);
        SetF4(cbpc.pad, 0,0,0,0);
        const ID3D11ShaderResourceView* sr[1] = { W[3].srv };
        BindSrvs(sr, 1);
        DrawPass(P_DOWN, &cbpc, 92);
    }

    // ---- motion
    CBMotion cbm;
    SetF4(cbm.outSize, (float)outW, (float)outH, 0, 0);
    float mc = (float)s->motionComp / 100.0f;
    cbm.gain = 4.0f + 10.0f * mc;
    cbm.bias = 0.012f + 0.035f * (1.0f - mc);
    cbm.pad = cbm.pad2 = 0;
    {
        const ID3D11ShaderResourceView* sr[2] = { L0.srv, PREV_L0.srv };
        BindSrvs(sr, 2);
        DrawPass(P_MOTION, &cbm, 100);
    }

    // ---- temporal reconstruction
    CBTemporal cbt;
    SetF4(cbt.outSize, (float)outW, (float)outH, 0, 0);
    cbt.amt = Lvl5_(s->temporal) * f;
    cbt.sharp = (1.0f - (float)s->temporalHistory / 100.0f) * 1.2f;
    cbt.gate = 0.8f + 1.4f * mc;
    cbt.first = (frames < 2) ? 1.0f : 0.0f;
    {
        const ID3D11ShaderResourceView* sr[3] = { W[3].srv, PREV.srv, M[0].srv };
        BindSrvs(sr, 3);
        DrawPass(P_TEMPORAL, &cbt, 0);
    }

    // ---- reconstruction filter (super-resolution refinement)
    CBRecon cbr;
    SetF4(cbr.outSize, (float)outW, (float)outH, 0, 0);
    float scale = (float)outW / (float)(cw > 0 ? cw : 1);
    cbr.amt = 0; cbr.edgeK = 30.0f; cbr.pad = cbr.pad2 = 0;
    if (s->superRes && scale > 1.02f){
        cbr.amt = (0.30f + 0.45f * f) * (scale > 2.5f ? 1.0f : scale / 2.5f);
        cbr.edgeK = 25.0f + 30.0f * (1.0f - f);
    }
    {
        const ID3D11ShaderResourceView* sr[1] = { W[0].srv };
        BindSrvs(sr, 1);
        DrawPass(P_RECON, &cbr, 1);
    }

    // ---- AA
    CBAE cbae;
    SetF4(cbae.outSize, (float)outW, (float)outH, 0, 0);
    int lvl = s->aa;
    cbae.thr = lvl > 0 ? (0.035f - 0.0035f * lvl) : 0.5f;
    cbae.pad = cbae.pad2 = cbae.pad3 = 0;
    {
        const ID3D11ShaderResourceView* sr[2] = { W[1].srv, L0.srv };
        BindSrvs(sr, 2);
        DrawPass(P_AAE, &cbae, 101);
    }
    CBAAB cbaab;
    SetF4(cbaab.outSize, (float)outW, (float)outH, 0, 0);
    cbaab.radius = lvl > 0 ? (2.0f + (float)lvl * 1.5f) : 0.0f;
    cbaab.blend = Lvl5_(lvl) * f * 0.85f;
    cbaab.pad = cbaab.pad2 = 0;
    {
        const ID3D11ShaderResourceView* sr[2] = { W[1].srv, M[1].srv };
        BindSrvs(sr, 2);
        DrawPass(P_AAB, &cbaab, 2);
    }

    // ---- shadow
    CBShadow cbs;
    SetF4(cbs.outSize, (float)outW, (float)outH, 0, 0);
    cbs.quality = (float)s->shadowQuality / 100.0f * f;
    cbs.detail  = (float)s->shadowDetail / 100.0f * f;
    cbs.stability = (float)s->shadowStability / 100.0f * f;
    cbs.softness  = (float)s->shadowSoftness / 100.0f * f;
    cbs.contact   = (float)s->shadowContact / 100.0f * f;
    cbs.pad = cbs.pad2 = cbs.pad3 = 0;
    {
        const ID3D11ShaderResourceView* sr[5] = { W[2].srv, L0.srv, L1.srv, L1C.srv, PREV.srv };
        BindSrvs(sr, 5);
        DrawPass(P_SHADOW, &cbs, 0);
    }

    // ---- light
    CBLight cbl;
    SetF4(cbl.outSize, (float)outW, (float)outH, 0, 0);
    float lq = (float)s->lightQuality / 100.0f;
    cbl.exposure = (float)s->lightExposure / 100.0f;
    cbl.local = (float)s->lightLocalContrast / 100.0f * f * (0.4f + 0.6f * lq);
    cbl.detail = (float)s->lightDetail / 100.0f * f * (0.4f + 0.6f * lq);
    cbl.dyn = (float)s->lightDynRange / 100.0f * f;
    cbl.quality = lq;
    cbl.pad = cbl.pad2 = cbl.pad3 = 0;
    {
        const ID3D11ShaderResourceView* sr[4] = { W[0].srv, L0.srv, L1.srv, L1C.srv };
        BindSrvs(sr, 4);
        DrawPass(P_LIGHT, &cbl, 1);
    }

    // ---- AO
    CBAO cba;
    SetF4(cba.outSize, (float)outW, (float)outH, 0, 0);
    cba.amt = Lvl5_(s->ao) * f;
    cba.radius = 2.0f + (float)s->ao * 1.5f;
    cba.halo = 0.5f + 0.5f * f;
    cba.pad = cba.pad2 = cba.pad3 = cba.pad4 = 0;
    {
        const ID3D11ShaderResourceView* sr[3] = { W[1].srv, L0.srv, L1.srv };
        BindSrvs(sr, 3);
        DrawPass(P_AO, &cba, 2);
    }

    // ---- reflection stabilization
    CBStd cbstd;
    SetF4(cbstd.outSize, (float)outW, (float)outH, 0, 0);
    cbstd.amt = (float)s->reflection / 100.0f * f;
    cbstd.pad = cbstd.pad2 = cbstd.pad3 = 0;
    {
        const ID3D11ShaderResourceView* sr[4] = { W[2].srv, PREV.srv, L0.srv, M[0].srv };
        BindSrvs(sr, 4);
        DrawPass(P_REFLECT, &cbstd, 0);
    }

    // ---- detail
    CBDetail cbd;
    SetF4(cbd.outSize, (float)outW, (float)outH, 0, 0);
    float boost = (float)s->detail / 100.0f * f * 0.5f;
    float chq = (float)s->character / 100.0f * f;
    cbd.sharp = (float)s->iqSharp / 100.0f * f + boost + chq * 0.3f;
    cbd.fine = (float)s->iqFineDetail / 100.0f * f + boost * 0.8f + chq * 0.4f;
    cbd.texcl = (float)s->iqTextureClarity / 100.0f * f + boost + chq * 0.2f;
    cbd.edge = (float)s->iqEdgeDetail / 100.0f * f + boost * 0.6f + chq * 0.35f;
    cbd.denoise = (float)s->iqDenoise / 100.0f * f;
    cbd.pad = cbd.pad2 = cbd.pad3 = 0;
    {
        const ID3D11ShaderResourceView* sr[3] = { W[0].srv, L0.srv, M[1].srv };
        BindSrvs(sr, 3);
        DrawPass(P_DETAIL, &cbd, 1);
    }

    // ---- distant detail
    CBDistant cbdis;
    SetF4(cbdis.outSize, (float)outW, (float)outH, 0, 0);
    cbdis.amt = (float)s->distant / 100.0f * f;
    cbdis.stab = (float)s->distant / 100.0f * f * 0.7f;
    cbdis.pad = cbdis.pad2 = 0;
    {
        const ID3D11ShaderResourceView* sr[6] = { W[1].srv, L0.srv, L1.srv, L1C.srv, M[0].srv, PREV.srv };
        BindSrvs(sr, 6);
        DrawPass(P_DISTANT, &cbdis, 2);
    }

    // ---- vegetation
    cbstd.amt = (float)s->vegetation / 100.0f * f;
    {
        const ID3D11ShaderResourceView* sr[4] = { W[2].srv, PREV.srv, L0.srv, M[0].srv };
        BindSrvs(sr, 4);
        DrawPass(P_VEG, &cbstd, 0);
    }

    // ---- particles
    cbstd.amt = (float)s->particles / 100.0f * f;
    {
        const ID3D11ShaderResourceView* sr[5] = { W[0].srv, PREV.srv, L0.srv, L1.srv, M[0].srv };
        BindSrvs(sr, 5);
        DrawPass(P_PARTICLE, &cbstd, 1);
    }

    // ---- water
    cbstd.amt = (float)s->water / 100.0f * f;
    {
        const ID3D11ShaderResourceView* sr[4] = { W[1].srv, PREV.srv, L0.srv, M[0].srv };
        BindSrvs(sr, 4);
        DrawPass(P_WATER, &cbstd, 2);
    }

    // ---- LOD smoothing
    cbstd.amt = (float)s->lod / 100.0f * f;
    {
        const ID3D11ShaderResourceView* sr[5] = { W[2].srv, L0.srv, PREV_L0.srv, L1.srv, M[0].srv };
        BindSrvs(sr, 5);
        DrawPass(P_LOD, &cbstd, 0);
    }

    // ---- color
    CBColor cbc;
    SetF4(cbc.outSize, (float)outW, (float)outH, 0, 0);
    cbc.bright = (float)s->cBright / 100.0f;
    cbc.contrast = (float)s->cContrast / 100.0f;
    cbc.sat = (float)s->cSat / 100.0f;
    cbc.hi = (float)s->cHighlights / 100.0f;
    cbc.sh = (float)s->cShadows / 100.0f;
    cbc.gamma = (float)s->cGamma / 100.0f;
    cbc.temp = (float)s->cTemp / 100.0f;
    cbc.hdr = (float)s->hdr / 100.0f * (0.3f + 0.7f * f);
    {
        const ID3D11ShaderResourceView* sr[1] = { W[0].srv };
        BindSrvs(sr, 1);
        DrawPass(P_COLOR, &cbc, 1);
    }

    // ---- artifact reduction
    cbstd.amt = (float)s->iqArtifact / 100.0f * f;
    {
        const ID3D11ShaderResourceView* sr[3] = { W[1].srv, L0.srv, L1.srv };
        BindSrvs(sr, 3);
        DrawPass(P_DEBAND, &cbstd, 2);
    }

    // ---- output
    CBOutput cbo;
    SetF4(cbo.outSize, (float)outW, (float)outH, 0, 0);
    cbo.split = r->split;
    cbo.beforeAfter = r->beforeAfter;
    cbo.hdrOut = r->hdrOutput ? 1.0f : 0.0f;
    SetF4(cbo.hudRect, 0, 0, (float)HUD.w / (float)outW, (float)HUD.h / (float)outH);
    cbo.pad = 0;
    {
        const ID3D11ShaderResourceView* sr[3] = { W[2].srv, W[3].srv, HUD.srv };
        BindSrvs(sr, 3);
        DrawPass(P_OUTPUT, &cbo, -1);
    }

    // ---- history
    ctx->CopyResource(PREV.tex, W[2].tex);
    ctx->CopyResource(PREV_L0.tex, L0.tex);

    ctx->End(qEnd);

    HRESULT hr = swap->Present(1, 0);
    if (FAILED(hr)){
        NLog("Present failed 0x%08lX", (unsigned long)hr);
        srcSrv->Release();
        return false;
    }
    srcSrv->Release();

    // stats
    double now = NowMs_();
    frameMs = now - lastPresentMs;
    lastPresentMs = now;
    latencyMs = now - src.acquireMs;
    presentCount++; frames++;
    if (hr == DXGI_ERROR_DEVICE_REMOVED){
        NLog("Device removed");
        return false;
    }
    if (now - fpsT0 >= 1000.0){ fps = (double)presentCount * 1000.0 / (now - fpsT0); fpsT0 = now; presentCount = 0; }
    // dropped: frame interval over budget (assume 60fps vsync budget)
    if (frameMs > 26.0) dropped++;

    // GPU timing
    BOOL done0 = ctx->GetData(qStart, &tStart, 8, 0) == S_OK; // D3D11_ASYNC
    BOOL done1 = ctx->GetData(qEnd, &tEnd, 8, 0) == S_OK;     // D3D11_ASYNC
    if (done0 && done1){
        double ms = (tEnd - tStart) / 1e7;
        if (ms > 0 && ms < 200) procMs = ms;
    }
    return true;
}

// ----------------------------------------------------------------
static void ReadTexCore_(ID3D11Device* dev, ID3D11DeviceContext* ctx,
                         ID3D11Texture2D* from, unsigned int* out, int w, int h,
                         ID3D11Texture2D** stag, ID3D11Texture2D** cp,
                         int* cw, int* chh, UINT srcW, UINT srcH){
    if (!from) return;
    if (*cw != w || *chh != h || !*stag){
        if (*stag){ (*stag)->Release(); *stag = 0; }
        if (*cp){ (*cp)->Release(); *cp = 0; }
        D3D11_TEXTURE2D_DESC d; ZeroMemory(&d, sizeof d);
        d.Width = (UINT)w; d.Height = (UINT)h; d.MipLevels = 1; d.ArraySize = 1;
        d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
        d.Usage = D3D11_USAGE_STAGING; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        dev->CreateTexture2D(&d, 0, stag);
        d.Usage = D3D11_USAGE_DEFAULT; d.CPUAccessFlags = 0; d.BindFlags = 0;
        dev->CreateTexture2D(&d, 0, cp);
        *cw = w; *chh = h;
    }
    D3D11_BOX box;
    box.left = (UINT)((srcW - w) / 2);
    box.right = (UINT)((srcW + w) / 2);
    box.top = (UINT)((srcH - h) / 2);
    box.bottom = (UINT)((srcH + h) / 2);
    box.front = 0; box.back = 1;
    if (box.left < 0) box.left = 0;
    if (box.top < 0) box.top = 0;
    if (box.right > srcW) box.right = srcW;
    if (box.bottom > srcH) box.bottom = srcH;
    if (box.right <= box.left || box.bottom <= box.top) return;
    ctx->CopySubresourceRegion(*cp, 0, 0, 0, 0, from, 0, &box);
    ctx->CopyResource(*stag, *cp);
    D3D11_MAPPED_SUBRESOURCE ms;
    if (SUCCEEDED(ctx->Map(*stag, 0, D3D11_MAP_READ, 0, &ms))){
        const unsigned int* p = (const unsigned int*)ms.pData;
        for (int r = 0; r < h; r++){
            size_t rowBytes = (size_t)ms.RowPitch / 4;
            memcpy(out + (size_t)r * w, p + rowBytes * r, (size_t)w * 4);
        }
        ctx->Unmap(0, 0);
    }
}

void Engine::ReadSmall(ID3D11Texture2D* from, unsigned int* out, int w, int h){
    static ID3D11Texture2D* stag = 0; static ID3D11Texture2D* cp = 0;
    static int cw = 0, chh = 0;
    ReadTexCore_(dev, ctx, from, out, w, h, &stag, &cp, &cw, &chh, (UINT)pW, (UINT)pH);
}

void Engine::ReadPreview(unsigned int* enhanced, unsigned int* orig, int w, int h, bool* ok){
    if (*ok){
        ReadSmall(PREV.tex, enhanced, w, h);
        ReadSmall(W[3].tex, orig, w, h);
    }
}

bool Engine::ReadFull(unsigned int* out, int* w, int* h){
    if (!W[2].tex || pW < 2) return false;
    static ID3D11Texture2D* stag = 0; static ID3D11Texture2D* cp = 0;
    static int cw = 0, chh = 0;
    ReadTexCore_(dev, ctx, W[2].tex, out, pW, pH, &stag, &cp, &cw, &chh, (UINT)pW, (UINT)pH);
    *w = pW; *h = pH;
    return true;
}

void Engine::GetStats(EngineStats* st){
    st->fps = fps;
    st->frameMs = frameMs;
    st->procMs = procMs;
    st->latencyMs = latencyMs;
    st->dropped = dropped;
    st->frames = frames;
    st->srcW = 0; st->srcH = 0;
    st->outW = pW; st->outH = pH;
}

void Engine::Shutdown(){
    DeleteCriticalSection(&reqCs);
    ReleasePipeline();
    if (SelfTest.tex){ SelfTest.tex->Release(); SelfTest.tex = 0; }
    if (SelfTest.rtv){ SelfTest.rtv->Release(); SelfTest.rtv = 0; }
    if (SelfTest.srv){ SelfTest.srv->Release(); SelfTest.srv = 0; }
    if (HUD.tex){ HUD.tex->Release(); HUD.tex = 0; }
    if (HUD.rtv){ HUD.rtv->Release(); HUD.rtv = 0; }
    if (HUD.srv){ HUD.srv->Release(); HUD.srv = 0; }
    if (qStart){ qStart->Release(); qStart = 0; }
    if (qEnd){ qEnd->Release(); qEnd = 0; }
    if (vb){ vb->Release(); vb = 0; }
    if (layout){ layout->Release(); layout = 0; }
    if (smp){ smp->Release(); smp = 0; }
    if (vs){ vs->Release(); vs = 0; }
    for (int i = 0; i < 32; i++){
        if (ps[i]){ ps[i]->Release(); ps[i] = 0; }
        if (cbs[i]){ cbs[i]->Release(); cbs[i] = 0; }
    }
    if (swap){ swap->Release(); swap = 0; }
    if (swapRtv){ swapRtv->Release(); swapRtv = 0; }
    if (ctx){ ctx->Release(); ctx = 0; }
    if (dev){ dev->Release(); dev = 0; }
    if (factory){ factory->Release(); factory = 0; }
    if (g_d3dMod) FreeLibrary((HMODULE)g_d3dMod);
}
