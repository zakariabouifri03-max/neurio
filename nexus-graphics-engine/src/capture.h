// Real-time frame capture via DXGI Desktop Duplication (public OS API).
// Captures the game's presented output at vsync cadence - no injection,
// no game process access, no anti-cheat interaction.
#pragma once
#include "common.h"
#include "engine.h"

class Capture {
public:
    Capture();
    ~Capture();
    int Start(ID3D11Device* dev, IDXGIFactory1* fac, HWND targetWnd);
    void Stop();
    void Run();                 // capture thread main loop
    // engine-thread consumer
    bool GetLatest(FrameSource* out);
    double FpsEstimate() { return fpsEst; }
    bool Active() { return active; }
    const char* LastError() { return err; }
    void SetCrop(int x, int y, int w, int h);   // crop region in output pixels
    void SetTarget(HWND w);                      // new target window (re-resolve output)

private:
    int StartDuplication(HWND targetWnd);
    void ReleaseFrameSlot(int i);

    ID3D11Device* dev;
    IDXGIFactory1* fac;
    IDXGIAdapter1* adapter;
    IDXGIOutput1* output;
    IDXGIOutputDuplication* dup;
    HWND target;

    // 3-slot frame ring
    struct Slot {
        ID3D11Texture2D* tex;
        ID3D11ShaderResourceView* srv;
        DXGI_FORMAT fmt;
        int w, h;
        double acquireMs;
    };
    Slot slots[3];
    int slotHead;
    CRITICAL_SECTION cs;

    volatile int run;
    volatile int active;
    int cropX, cropY, cropW, cropH;
    int lostRetries;
    double lastAcq; int nFrames; double fpsT0; double fpsEst;
    char err[160];
};
