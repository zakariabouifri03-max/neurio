// Minimal GUI CRT startup for the zig/mingw cross-link.
// Avoids libstdc++ static global constructors (none exist in this codebase:
// all globals are POD, initialized in AppMain_).
#include <windows.h>
extern int main(int argc, char **argv);
void __main(void){}
void wWinMainCRTStartup(void){
    LPWSTR cmd = GetCommandLineW();
    char *argv0 = (char*)"nexus";
    (void)cmd;
    int rc = main(1, &argv0);
    ExitProcess(rc);
}
