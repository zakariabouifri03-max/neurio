// NEXUS GRAPHICS ENGINE - game detection / launching
#pragma once
#include "stdafx.h"

struct RunningGame {
    DWORD pid = 0;
    HWND hwnd = nullptr;
    std::wstring exeName, exePath, title;
    RECT rect{};
};

// visible top-level windows belonging to real processes (excludes our own)
std::vector<RunningGame> ScanRunningGames();

// find best window for an exe name ("efootball.exe", case-insensitive)
HWND FindWindowForExeName(const char* exeNameLower);

bool LaunchGame(const std::wstring& exePath, std::wstring* errOut);
std::wstring BrowseForExe(HWND owner);
