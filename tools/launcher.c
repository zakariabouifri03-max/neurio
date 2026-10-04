// Streamer Life Sim 2 — Windows launcher
// Extracts the bundled offline game to %TEMP% and opens it in the default browser.
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>

extern const unsigned char GAME_HTML[];
extern const unsigned int GAME_HTML_LEN;

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR cmdLine, int cmdShow) {
    (void)hInst; (void)hPrev; (void)cmdShow;
    char tmp[MAX_PATH] = {0};
    char path[MAX_PATH] = {0};
    if (!GetTempPathA(MAX_PATH, tmp)) { MessageBoxA(NULL, "Cannot locate TEMP folder.", "Streamer Life 2", MB_ICONERROR); return 1; }
    snprintf(path, MAX_PATH, "%sstreamer-life-2.html", tmp);
    FILE* f = fopen(path, "wb");
    if (!f) { MessageBoxA(NULL, "Cannot write game file.", "Streamer Life 2", MB_ICONERROR); return 1; }
    fwrite(GAME_HTML, 1, GAME_HTML_LEN, f);
    fclose(f);
    HINSTANCE r = ShellExecuteA(NULL, "open", path, NULL, NULL, SW_SHOWNORMAL);
    if ((long long)(long long)(size_t)r <= 32) {
        MessageBoxA(NULL, "Could not open your browser.\nThe game was extracted to:\n\nstreamer-life-2.html (in %TEMP%) — open it manually.", "Streamer Life 2", MB_ICONWARNING);
    }
    return 0;
}
