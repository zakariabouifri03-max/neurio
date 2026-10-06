// NEXUS GRAPHICS ENGINE - D3D11 helpers implementation
#include "stdafx.h"
#include "d3d.h"

namespace dxe {

static HMODULE g_compilerDll = nullptr;
static PFN_D3DCompile g_compile = nullptr;

bool InitCompiler() {
    if (g_compile) return true;
    // Prefer the OS copy of d3dcompiler_47 (ships with Windows 10/11)
    const wchar_t* names[] = { L"d3dcompiler_47.dll", L"d3dcompiler_43.dll", L"d3dcompiler.exe.dll" };
    for (auto n : names) {
        HMODULE h = LoadLibraryW(n);
        if (h) {
            g_compile = (PFN_D3DCompile)GetProcAddress(h, "D3DCompile");
            if (g_compile) { g_compilerDll = h; return true; }
            FreeLibrary(h);
        }
    }
    return false;
}
void ShutdownCompiler() { if (g_compilerDll) { FreeLibrary(g_compilerDll); g_compilerDll = nullptr; g_compile = nullptr; } }
PFN_D3DCompile Compiler() { return g_compile; }

ShaderCS CompileCS(ID3D11Device* dev, const char* src, const char* entry, const char* target) {
    ShaderCS out;
    if (!InitCompiler()) { out.error = "d3dcompiler_47.dll not found"; return out; }
    NexusComPtr<ID3DBlob> blob, err;
    UINT flags = D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3;
#ifdef _DEBUG
    flags |= D3DCOMPILE_DEBUG;
#endif
    HRESULT hr = g_compile(src, strlen(src), "nexus.hlsl", nullptr, nullptr, entry, target, flags, 0, &blob, &err);
    if (FAILED(hr)) {
        out.error = Fmt("HLSL compile failed (%s): %s", HrToString(hr).c_str(),
            err.Get() ? (const char*)err->GetBufferPointer() : "no details");
        return out;
    }
    hr = dev->CreateComputeShader(blob->GetBufferPointer(), blob->GetBufferSize(), nullptr, &out.cs);
    if (FAILED(hr)) out.error = Fmt("CreateComputeShader failed: %s", HrToString(hr).c_str());
    return out;
}

bool Tex::Create(ID3D11Device* dev, UINT w, UINT h, DXGI_FORMAT f, const void* initData, size_t initDataRowPitch) {
    Release();
    D3D11_TEXTURE2D_DESC d = {};
    d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1;
    d.Format = f;
    d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT;
    d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_UNORDERED_ACCESS;
    if (initData) d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA sd = {};
    if (initData) { sd.pSysMem = initData; sd.SysMemPitch = (UINT)initDataRowPitch; }
    HRESULT hr = dev->CreateTexture2D(&d, initData ? &sd : nullptr, &tex);
    if (FAILED(hr)) { NEX_LOG("Tex::Create failed %ux%u fmt=%u hr=%s", w, h, f, HrToString(hr).c_str()); return false; }
    if (!initData) {
        D3D11_SHADER_RESOURCE_VIEW_DESC srd = {};
        srd.Format = f; srd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        srd.Texture2D.MipLevels = 1;
        dev->CreateShaderResourceView(tex.Get(), &srd, &srv);
        D3D11_UNORDERED_ACCESS_VIEW_DESC ud = {};
        ud.Format = f; ud.ViewDimension = D3D11_UAV_DIMENSION_TEXTURE2D;
        dev->CreateUnorderedAccessView(tex.Get(), &ud, &uav);
        if (!uav.Get() || !srv.Get()) { NEX_LOG("Tex::Create views failed"); return false; }
    } else {
        D3D11_SHADER_RESOURCE_VIEW_DESC srd = {};
        srd.Format = f; srd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        srd.Texture2D.MipLevels = 1;
        dev->CreateShaderResourceView(tex.Get(), &srd, &srv);
    }
    w = w; h = h; fmt = f;
    return true;
}

// ------------------------------------------------------------- GpuTimer
void GpuTimer::Init(ID3D11Device* dev, ID3D11DeviceContext* ctx) { dev_ = dev; }
void GpuTimer::Begin(ID3D11DeviceContext* ctx) {
    Slot& s = slots_[cur_];
    if (!s.pending) {
        D3D11_QUERY_DESC qd = { D3D11_QUERY_TIMESTAMP, 0 };
        D3D11_QUERY_DESC dd = { D3D11_QUERY_TIMESTAMP_DISJOINT, 0 };
        if (!s.start) { dev_->CreateQuery(&qd, &s.start); dev_->CreateQuery(&qd, &s.end); dev_->CreateQuery(&dd, &s.disjoint); }
        ctx->Begin(s.disjoint.Get());
        ctx->End(s.start.Get());
    }
}
void GpuTimer::End(ID3D11DeviceContext* ctx) {
    Slot& s = slots_[cur_];
    if (!s.pending) {
        ctx->End(s.end.Get());
        ctx->End(s.disjoint.Get());
        s.pending = true;
    }
    cur_ = (cur_ + 1) % kSlots;
}
float GpuTimer::Resolve(ID3D11DeviceContext* ctx) {
    // resolve the oldest pending slot
    int i = cur_;
    for (int tries = 0; tries < kSlots; tries++) {
        Slot& s = slots_[i];
        if (!s.pending) { i = (i + 1) % kSlots; continue; }
        BOOL disjointData = FALSE;
        D3D11_QUERY_DATA_TIMESTAMP_DISJOINT dd = {};
        if (SUCCEEDED(ctx->GetData(s.disjoint.Get(), &dd, sizeof(dd), D3D11_ASYNC_GETDATA_DONOTFLUSH)) && dd.Disjoint == FALSE) {
            UINT64 t0 = 0, t1 = 0;
            if (SUCCEEDED(ctx->GetData(s.start.Get(), &t0, sizeof(t0), D3D11_ASYNC_GETDATA_DONOTFLUSH)) &&
                SUCCEEDED(ctx->GetData(s.end.Get(), &t1, sizeof(t1), D3D11_ASYNC_GETDATA_DONOTFLUSH))) {
                lastMs_ = (float)((t1 - t0) / (double)dd.Frequency * 1000.0);
                s.pending = false;
            }
        }
        break;
    }
    return lastMs_;
}

} // namespace dxe
