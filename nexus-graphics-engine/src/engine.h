// NEXUS GRAPHICS ENGINE - D3D11 GPU pipeline host.
#pragma once
#include "common.h"
#include "shaders.h"

// ------------------------------------------------------------------
struct FrameSource {
    ID3D11Texture2D* tex;   // not owned by consumer (capture ring / engine selftest tex)
    int w, h;
    DXGI_FORMAT fmt;
    int cropX, cropY, cropW, cropH;   // in texture pixels; 0,0,0,0 = whole texture
    double acquireMs;                 // QPC ms when the frame was acquired
    bool valid;
};

struct EngineStats {
    double fps;        // overlay/pipeline fps (measured)
    double frameMs;    // present-to-present (measured)
    double procMs;     // GPU pipeline time (query, measured)
    double latencyMs;  // acquire -> present (measured)
    int dropped;       // frames over 1.6x budget
    int frames;        // total processed
    int srcW, srcH;    // current source resolution
    int outW, outH;    // current output resolution
};

class Engine {
public:
    struct FrameReq {
        NexusSettings s;
        int srcMode;          // 0=standby 1=capture 2=selftest
        FrameSource src;
        int beforeAfter;      // 0=enhanced 1=original
        int split;            // -1=off, 0..1000 divider position
        int hudW, hudH;       // HUD texture size
        bool hdrOutput;       // extended color space output
        int selftestW, selftestH; // selftest render resolution
    };

    int Init(HWND overlayHwnd, int w, int h);
    void Shutdown();

    void SetRequest(const FrameReq* req);
    void UpdateHud(const unsigned int* rgba, int w, int h);
    bool Tick();
    void GetStats(EngineStats* st);
    int ResizeSwap(int w, int h);

    // preview readback (center crop), both from the final enhanced + original frame
    void ReadPreview(unsigned int* enhanced, unsigned int* orig, int w, int h, bool* ok);
    // full final-frame readback (screenshot). engine-thread only.
    bool ReadFull(unsigned int* out, int* w, int* h);

    ID3D11Device* Dev() { return dev; }
    ID3D11DeviceContext* Ctx() { return ctx; }
    IDXGIFactory1* Factory() { return factory; }
    bool HdrColorSpaceSupported();
    const char* LastError() { return lastErr; }
    bool Alive() { return dev != 0; }

private:
    int BuildPipeline(int w, int h);
    void ReleasePipeline();
    int CompileShaders();
    void DrawPass(int pass, const void* cb, int rtIndex);
    void BindSrvs(const ID3D11ShaderResourceView* const* srvs, int n);
    int NewTex(int w, int h, DXGI_FORMAT fmt, bool rt, bool dyn,
               ID3D11Texture2D** tex, ID3D11RenderTargetView** rtv, ID3D11ShaderResourceView** srv);
    ID3D11ShaderResourceView* SrvFor(ID3D11Texture2D* tex, DXGI_FORMAT fmt);
    void EnsureSelftestTex(int w, int h);
    void ReadSmall(ID3D11Texture2D* from, unsigned int* out, int w, int h);
    void ClearSrvCache();

    // d3d
    IDXGIFactory1* factory;
    ID3D11Device* dev;
    ID3D11DeviceContext* ctx;
    HWND overlayHwnd;
    int swW, swH;
    IDXGISwapChain* swap;
    ID3D11RenderTargetView* swapRtv;
    bool flipModel;
    bool hdrSwap;

    // shaders
    ID3D11VertexShader* vs;
    ID3D11PixelShader* ps[32];
    int psCount;
    ID3D11InputLayout* layout;
    ID3D11Buffer* vb;
    ID3D11SamplerState* smp;
    ID3D11Buffer* cbs[32];

    // pipeline textures at output resolution
    int pW, pH;
    struct {
        ID3D11Texture2D* tex;
        ID3D11RenderTargetView* rtv;
        ID3D11ShaderResourceView* srv;
        int w, h;
    } W[4], L0, PREV_L0, L1, L1C, M[2], PREV, HUD, SelfTest;

    // selftest
    int selftestW, selftestH;
    double selftestT;

    // queries / stats
    ID3D11Query* qStart;
    ID3D11Query* qEnd;
    double tStart, tEnd;
    double procMs;
    unsigned long long presentCount;
    double lastPresentMs, fpsT0; double fps;
    double frameMs, latencyMs;
    int dropped; int frames;

    // request
    const FrameReq* req;
    CRITICAL_SECTION reqCs;

    char lastErr[256];
};
