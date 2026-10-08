#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <objbase.h>
#include <shlguid.h>
#include <commctrl.h>
#include <string>
#include <vector>

#pragma comment(lib, "ole32")
#pragma comment(lib, "uuid")
#pragma comment(lib, "shell32")
#pragma comment(lib, "shlwapi")
#pragma comment(lib, "comctl32")
#pragma comment(lib, "user32")
#pragma comment(lib, "gdi32")
#pragma comment(lib, "advapi32")
#pragma comment(lib, "comdlg32")

static const wchar_t kAppName[] = L"Piano Pro";
static const wchar_t kExeName[] = L"PianoPro.exe";
static const wchar_t kUninstKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PianoPro";

static std::wstring dirnameOf(const std::wstring& p) {
    std::wstring d = p;
    size_t s = d.find_last_of(L"\\/");
    if (s == std::wstring::npos) return L".";
    return d.substr(0, s);
}

static std::wstring modulePath() {
    wchar_t buf[MAX_PATH];
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    return buf;
}

static bool copyFileReplace(const std::wstring& src, const std::wstring& dst) {
    return CopyFileW(src.c_str(), dst.c_str(), FALSE) != 0;
}

static bool createDir(const std::wstring& p) {
    if (PathFileExistsW(p.c_str())) return true;
    return CreateDirectoryW(p.c_str(), nullptr) != 0 || GetLastError() == ERROR_ALREADY_EXISTS;
}

static bool makeShortcut(const std::wstring& linkPath, const std::wstring& target,
                         const std::wstring& args, const std::wstring& workDir,
                         const std::wstring& desc) {
    IShellLinkW* sl = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_IShellLinkW, (void**)&sl);
    if (FAILED(hr) || !sl) return false;
    sl->SetPath(target.c_str());
    sl->SetWorkingDirectory(workDir.c_str());
    if (!args.empty()) sl->SetArguments(args.c_str());
    sl->SetDescription(desc.c_str());
    std::wstring ico = workDir + L"\\assets\\icons\\pianopro.ico";
    if (PathFileExistsW(ico.c_str()))
        sl->SetIconLocation(ico.c_str(), 0);
    else
        sl->SetIconLocation(target.c_str(), 0);
    IPersistFile* pf = nullptr;
    hr = sl->QueryInterface(IID_IPersistFile, (void**)&pf);
    bool ok = false;
    if (SUCCEEDED(hr) && pf) {
        ok = SUCCEEDED(pf->Save(linkPath.c_str(), TRUE));
        pf->Release();
    }
    sl->Release();
    return ok;
}

static std::wstring localPrograms() {
    wchar_t path[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, path)))
        return L"";
    PathAppendW(path, L"Programs");
    createDir(path);
    PathAppendW(path, L"PianoPro");
    return path;
}

static std::wstring startMenuDir() {
    wchar_t path[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_PROGRAMS, nullptr, SHGFP_TYPE_CURRENT, path)))
        return L"";
    PathAppendW(path, L"Piano Pro");
    return path;
}

static std::wstring desktopPath() {
    wchar_t path[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_DESKTOPDIRECTORY, nullptr, SHGFP_TYPE_CURRENT, path)))
        return L"";
    return path;
}

static void writeUninstall(const std::wstring& instDir, const std::wstring& setupPath) {
    HKEY k = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, kUninstKey, 0, nullptr, 0, KEY_WRITE, nullptr, &k, nullptr) != ERROR_SUCCESS)
        return;
    auto set = [&](const wchar_t* name, const std::wstring& val) {
        RegSetValueExW(k, name, 0, REG_SZ, (const BYTE*)val.c_str(), (DWORD)((val.size() + 1) * sizeof(wchar_t)));
    };
    set(L"DisplayName", kAppName);
    set(L"Publisher", L"Piano Pro");
    set(L"InstallLocation", instDir);
    set(L"DisplayIcon", instDir + L"\\" + kExeName);
    std::wstring uncmd = L"\"" + setupPath + L"\" /uninstall";
    set(L"UninstallString", uncmd);
    DWORD noMod = 1;
    RegSetValueExW(k, L"NoModify", 0, REG_DWORD, (const BYTE*)&noMod, sizeof(noMod));
    RegSetValueExW(k, L"NoRepair", 0, REG_DWORD, (const BYTE*)&noMod, sizeof(noMod));
    RegCloseKey(k);
}

static void removeUninstall() {
    RegDeleteKeyW(HKEY_CURRENT_USER, kUninstKey);
}

static void recursiveDelete(const std::wstring& dir) {
    std::wstring spec = dir + L"\\*";
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(spec.c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
            std::wstring p = dir + L"\\" + fd.cFileName;
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
                recursiveDelete(p);
            else
                DeleteFileW(p.c_str());
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    RemoveDirectoryW(dir.c_str());
}

static int doUninstall(HWND owner) {
    if (MessageBoxW(owner,
                    L"Remove Piano Pro from this computer?\n\nSettings in AppData will be kept.",
                    L"Uninstall Piano Pro", MB_YESNO | MB_ICONQUESTION) != IDYES)
        return 0;
    std::wstring inst = localPrograms();
    std::wstring sm = startMenuDir();
    std::wstring desk = desktopPath() + L"\\Piano Pro.lnk";
    recursiveDelete(inst);
    recursiveDelete(sm);
    DeleteFileW(desk.c_str());
    removeUninstall();
    MessageBoxW(owner, L"Piano Pro was uninstalled.", L"Piano Pro", MB_OK | MB_ICONINFORMATION);
    return 0;
}

static bool copyTree(const std::wstring& srcDir, const std::wstring& dstDir) {
    createDir(dstDir);
    std::wstring spec = srcDir + L"\\*";
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(spec.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return false;
    do {
        if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
        if (_wcsicmp(fd.cFileName, L"PianoPro_Setup.exe") == 0) continue;
        std::wstring s = srcDir + L"\\" + fd.cFileName;
        std::wstring d = dstDir + L"\\" + fd.cFileName;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            copyTree(s, d);
        } else {
            copyFileReplace(s, d);
        }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return true;
}

static int doInstall(HWND owner, bool desktop) {
    std::wstring self = modulePath();
    std::wstring srcDir = dirnameOf(self);
    std::wstring srcExe = srcDir + L"\\" + kExeName;
    if (!PathFileExistsW(srcExe.c_str())) {
        MessageBoxW(owner,
                    L"PianoPro.exe was not found next to the installer.\n"
                    L"Keep PianoPro.exe and PianoPro_Setup.exe in the same folder.",
                    L"Piano Pro Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    std::wstring inst = localPrograms();
    if (inst.empty() || !createDir(inst)) {
        MessageBoxW(owner, L"Could not create the install folder.", L"Piano Pro Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    std::wstring dstExe = inst + L"\\" + kExeName;
    if (!copyFileReplace(srcExe, dstExe)) {
        MessageBoxW(owner, L"Could not copy PianoPro.exe. Close the app if it is running.",
                    L"Piano Pro Setup", MB_OK | MB_ICONERROR);
        return 1;
    }
    // assets if present
    std::wstring srcAssets = srcDir + L"\\assets";
    if (PathFileExistsW(srcAssets.c_str()))
        copyTree(srcAssets, inst + L"\\assets");
    // copy setup for uninstall
    std::wstring dstSetup = inst + L"\\PianoPro_Setup.exe";
    copyFileReplace(self, dstSetup);

    std::wstring sm = startMenuDir();
    createDir(sm);
    makeShortcut(sm + L"\\Piano Pro.lnk", dstExe, L"", inst, L"Piano Pro");
    makeShortcut(sm + L"\\Uninstall Piano Pro.lnk", dstSetup, L"/uninstall", inst, L"Uninstall Piano Pro");
    if (desktop) {
        std::wstring desk = desktopPath();
        if (!desk.empty())
            makeShortcut(desk + L"\\Piano Pro.lnk", dstExe, L"", inst, L"Piano Pro");
    }
    writeUninstall(inst, dstSetup);
    MessageBoxW(owner, L"Piano Pro was installed.\n\nYou can start it from the Start menu.",
                L"Piano Pro Setup", MB_OK | MB_ICONINFORMATION);
    ShellExecuteW(nullptr, L"open", dstExe.c_str(), nullptr, inst.c_str(), SW_SHOWNORMAL);
    return 0;
}

static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE: {
        CreateWindowExW(0, L"Static",
                        L"Piano Pro\n\nLightweight 88-key virtual piano for Windows.\n"
                        L"Works fully offline. No account required.",
                        WS_CHILD | WS_VISIBLE | SS_LEFT,
                        24, 20, 420, 90, h, nullptr, nullptr, nullptr);
        CreateWindowExW(0, L"Button", L"Create a desktop shortcut",
                        WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
                        24, 120, 300, 24, h, (HMENU)10, nullptr, nullptr);
        SendMessageW(GetDlgItem(h, 10), BM_SETCHECK, BST_CHECKED, 0);
        CreateWindowExW(0, L"Button", L"Install",
                        WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
                        220, 170, 100, 32, h, (HMENU)1, nullptr, nullptr);
        CreateWindowExW(0, L"Button", L"Cancel",
                        WS_CHILD | WS_VISIBLE,
                        330, 170, 100, 32, h, (HMENU)2, nullptr, nullptr);
        return 0;
    }
    case WM_COMMAND: {
        int id = LOWORD(w);
        if (id == 2 || id == IDCANCEL) { DestroyWindow(h); return 0; }
        if (id == 1) {
            BOOL desk = (BOOL)SendMessageW(GetDlgItem(h, 10), BM_GETCHECK, 0, 0);
            int rc = doInstall(h, desk == BST_CHECKED);
            if (rc == 0) DestroyWindow(h);
            return 0;
        }
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

int WINAPI WinMain(HINSTANCE inst, HINSTANCE, LPSTR cmd, int show) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    INITCOMMONCONTROLSEX icc { sizeof(icc), ICC_WIN95_CLASSES };
    InitCommonControlsEx(&icc);

    std::wstring cl = GetCommandLineW();
    if (cl.find(L"/uninstall") != std::wstring::npos || cl.find(L"--uninstall") != std::wstring::npos) {
        int rc = doUninstall(nullptr);
        CoUninitialize();
        return rc;
    }
    (void)cmd;

    WNDCLASSEXW wc {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = proc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"PianoProSetup";
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(0, L"PianoProSetup", L"Piano Pro Setup",
                                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                                CW_USEDEFAULT, CW_USEDEFAULT, 460, 260,
                                nullptr, nullptr, inst, nullptr);
    ShowWindow(hwnd, show);
    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    CoUninitialize();
    return (int)msg.wParam;
}

#endif
