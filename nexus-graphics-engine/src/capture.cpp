#include "capture.h"
#include <stdio.h>
#include <string.h>

Capture::Capture() : dev(0), fac(0), adapter(0), output(0), dup(0), target(0),
                     slotHead(0), run(0), active(0), cropX(0), cropY(0), cropW(0), cropH(0),
                     lostRetries(0), lastAcq(0), nFrames(0), fpsT0(0), fpsEst(0)
{
    memset(err, 0, sizeof err);
    memset(slots, 0, sizeof slots);
    InitializeCriticalSection(&cs);
}

Capture::~Capture(){
    run = 0;
    if (dup){ dup->Release(); dup = 0; }
    if (output){ output->Release(); output = 0; }
    if (adapter){ adapter->Release(); adapter = 0; }
    for (int i = 0; i < 3; i++) ReleaseFrameSlot(i);
    DeleteCriticalSection(&cs);
}

void Capture::SetCrop(int x, int y, int w, int h){
    EnterCriticalSection(&cs);
    cropX = x; cropY = y; cropW = w; cropH = h;
    LeaveCriticalSection(&cs);
}

int Capture::StartDuplication(HWND targetWnd){
    if (dup){ dup->Release(); dup = 0; }
    if (output){ output->Release(); output = 0; }
    if (adapter){ adapter->Release(); adapter = 0; }

    // find the output that contains the target window center
    RECT wr; GetWindowRect(targetWnd, &wr);
    int cx = (wr.left + wr.right) / 2;
    int cy = (wr.top + wr.bottom) / 2;
    IDXGIOutput* best0 = 0;
    IDXGIAdapter1* bestAdp = 0;
    for (UINT a = 0;; a++){
        IDXGIAdapter1* adp = 0;
        HRESULT hr = fac->EnumAdapters1(a, &adp);
        if (hr == DXGI_ERROR_NOT_FOUND) break;
        if (FAILED(hr)) break;
        for (UINT o = 0;; o++){
            IDXGIOutput* out0 = 0;
            HRESULT ho = adp->EnumOutputs(o, &out0);
            if (ho == DXGI_ERROR_NOT_FOUND) break;
            if (FAILED(ho)) break;
            DXGI_OUTPUT_DESC od;
            int found = 0;
            if (SUCCEEDED(out0->GetDesc(&od))){
                RECT ar = od.DesktopCoordinates;
                if (cx >= ar.left && cx < ar.right && cy >= ar.top && cy < ar.bottom)
                    found = 1;
            }
            if (found){
                if (best0) best0->Release();
                if (bestAdp) bestAdp->Release();
                out0->AddRef();
                best0 = out0;
                adp->AddRef();
                bestAdp = adp;
                out0->Release();
                adp->Release();
                goto found;
            }
            out0->Release();
        }
        adp->Release();
    }
found:
    if (best0){
        if (SUCCEEDED(best0->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output))){
            adapter = bestAdp;
        } else if (bestAdp){
            bestAdp->Release();
            bestAdp = 0;
        }
        best0->Release();
        best0 = 0;
    }
    if (!output){
        // fallback: first adapter, first output
        HRESULT hr = fac->EnumAdapters1(0, &adapter);
        if (FAILED(hr)){ snprintf(err, sizeof err, "no DXGI adapter"); return -1; }
        IDXGIOutput* out0 = 0;
        hr = adapter->EnumOutputs(0, &out0);
        if (FAILED(hr)){ snprintf(err, sizeof err, "no DXGI output"); adapter->Release(); adapter = 0; return -1; }
        if (SUCCEEDED(out0->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output))){}
        out0->Release();
        if (!output){
            adapter->Release(); adapter = 0;
            snprintf(err, sizeof err, "IDXGIOutput1 not available");
            return -1;
        }
    }

    HRESULT hr = output->DuplicateOutput(dev, &dup);
    if (FAILED(hr)){
        if (hr == DXGI_ERROR_NOT_CURRENTLY_AVAILABLE){
            snprintf(err, sizeof err, "duplication not available (exclusive fullscreen?)");
        } else {
            snprintf(err, sizeof err, "DuplicateOutput failed 0x%08lX", (unsigned long)hr);
        }
        output->Release(); output = 0;
        adapter->Release(); adapter = 0;
        return -1;
    }
    return 0;
}

int Capture::Start(ID3D11Device* d, IDXGIFactory1* f, HWND w){
    dev = d; fac = f; target = w;
    lostRetries = 0;
    if (StartDuplication(w)) return -1;
    active = 1;
    run = 1;
    NLog("Capture started (DXGI desktop duplication)");
    return 0;
}

void Capture::Stop(){
    run = 0;
    Sleep(120);
    active = 0;
    if (dup){ dup->Release(); dup = 0; }
    if (output){ output->Release(); output = 0; }
    if (adapter){ adapter->Release(); adapter = 0; }
    for (int i = 0; i < 3; i++) ReleaseFrameSlot(i);
}

void Capture::ReleaseFrameSlot(int i){
    if (slots[i].srv){ slots[i].srv->Release(); slots[i].srv = 0; }
    if (slots[i].tex){ slots[i].tex->Release(); slots[i].tex = 0; }
    slots[i].fmt = DXGI_FORMAT_UNKNOWN;
}

void Capture::SetTarget(HWND w){
    target = w;
    if (run && StartDuplication(w) == 0){
        NLog("Capture re-targeted to window");
    }
}

void Capture::Run(){
    while (run){
        if (!dup) break;
        DXGI_OUTDUPL_FRAME_INFO fi;
        IDXGIResource* res = 0;
        HRESULT hr = dup->AcquireNextFrame(16, &fi, &res);
        if (hr == S_OK){
            ID3D11Texture2D* tex = 0;
            if (res) res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&tex);
            if (res) res->Release();
            if (tex){
                D3D11_TEXTURE2D_DESC d;
                tex->GetDesc(&d);
                int next = (slotHead + 1) % 3;
                ReleaseFrameSlot(next);
                slots[next].tex = tex;
                slots[next].fmt = d.Format;
                slots[next].w = (int)d.Width;
                slots[next].h = (int)d.Height;
                slots[next].acquireMs = NowMs_();
                ID3D11ShaderResourceView* srv = 0;
                dev->CreateShaderResourceView(tex, 0, &srv);
                slots[next].srv = srv;
                EnterCriticalSection(&cs);
                slotHead = next;
                LeaveCriticalSection(&cs);
                double now = NowMs_();
                if (!fpsT0) fpsT0 = now;
                nFrames++;
                if (now - fpsT0 >= 1000.0){
                    fpsEst = (double)nFrames * 1000.0 / (now - fpsT0);
                    fpsT0 = now; nFrames = 0;
                }
                lastAcq = now;
            }
            dup->ReleaseFrame();
        } else if (hr == DXGI_ERROR_ACCESS_LOST){
            lostRetries++;
            if (lostRetries > 8){
                NLog("Capture: display lost after repeated ACCESS_LOST");
                snprintf(err, sizeof err, "display lost");
                run = 0;
                break;
            }
            NLog("Capture: ACCESS_LOST, restarting duplication (%d/8)", lostRetries);
            Sleep(200);
            if (dup){ dup->Release(); dup = 0; }
            if (target) StartDuplication(target);
        } else if (hr == DXGI_ERROR_NOT_CURRENTLY_AVAILABLE){
            // no new frame yet
        }
    }
}

bool Capture::GetLatest(FrameSource* out){
    out->valid = false;
    EnterCriticalSection(&cs);
    Slot* s = &slots[slotHead];
    if (s->tex){
        out->tex = s->tex;
        out->w = s->w;
        out->h = s->h;
        out->fmt = s->fmt;
        out->acquireMs = s->acquireMs;
        out->cropX = cropX; out->cropY = cropY;
        out->cropW = cropW; out->cropH = cropH;
        out->valid = true;
    }
    LeaveCriticalSection(&cs);
    return out->valid;
}
