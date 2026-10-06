// NEXUS GRAPHICS ENGINE - D3D11 helpers (device, runtime shader compile, resources, GPU timer)
#pragma once
#include "stdafx.h"

typedef HRESULT(WINAPI* PFN_D3DCompile)(
    LPCVOID pSrcData, SIZE_T SrcDataSize, LPCSTR pSourceName,
    const D3D_SHADER_MACRO* pDefines, ID3DInclude* pInclude,
    LPCSTR pEntrypoint, LPCSTR pTarget, UINT Flags1, UINT Flags2,
    ID3DBlob** ppShader, ID3DBlob** ppErrorBlob);

namespace dxe {

// dynamically loads d3dcompiler_47.dll (present on all Windows 10/11 systems)
bool  InitCompiler();
void  ShutdownCompiler();
PFN_D3DCompile Compiler();

struct ShaderCS {
    NexusComPtr<ID3D11ComputeShader> cs;
    std::string error;
    bool ok() const { return cs.Get() != nullptr; }
};

ShaderCS CompileCS(ID3D11Device* dev, const char* src, const char* entry, const char* target = "cs_5_0");

struct Tex {
    NexusComPtr<ID3D11Texture2D>          tex;
    NexusComPtr<ID3D11ShaderResourceView> srv;
    NexusComPtr<ID3D11UnorderedAccessView> uav;
    UINT w = 0, h = 0;
    DXGI_FORMAT fmt = DXGI_FORMAT_UNKNOWN;
    bool Create(ID3D11Device* dev, UINT w, UINT h, DXGI_FORMAT fmt, const void* initData = nullptr, size_t initDataRowPitch = 0);
    void Release() { tex.Reset(); srv.Reset(); uav.Reset(); w = h = 0; }
    bool ok() const { return tex.Get() != nullptr; }
};

// GPU timestamp pair timer (disjoint query per frame)
class GpuTimer {
public:
    void Init(ID3D11Device* dev, ID3D11DeviceContext* ctx);
    void Begin(ID3D11DeviceContext* ctx);
    void End(ID3D11DeviceContext* ctx);
    // returns most recent resolved GPU time in ms (0 while pending); non-blocking
    float Resolve(ID3D11DeviceContext* ctx);
private:
    static const int kSlots = 8;
    struct Slot { NexusComPtr<ID3D11Query> start, end, disjoint; bool pending = false; };
    Slot slots_[kSlots];
    int  cur_ = 0;
    float lastMs_ = 0;
    ID3D11Device* dev_ = nullptr;
};

inline std::string HrToString(HRESULT hr) {
    char buf[64];
    _snprintf_s(buf, sizeof(buf), _TRUNCATE, "0x%08X", (unsigned)hr);
    return buf;
}

} // namespace dxe
