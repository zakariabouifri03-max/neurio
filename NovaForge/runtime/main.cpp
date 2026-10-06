// NovaForge Engine - standalone game runtime entry point
//
//   NovaForgeRuntime.exe                        -> runs the game next to it
//   NovaForgeRuntime.exe --project <folder>     -> runs any NovaForge project
//   NovaForgeRuntime.exe --headless --seconds 5 --screenshot shot.png
#include "runtime/game_runtime.h"

#include "core/fs.h"
#include "core/log.h"
#include "platform/platform.h"

#include <cstdio>
#include <cstring>
#include <string>

using namespace nf;

namespace {

void printUsage(const char* exe) {
    std::printf(
        "NovaForge game runtime %s\n"
        "\n"
        "Usage: %s [options]\n"
        "\n"
        "  -p, --project <folder>   project folder to play (default: next to the exe)\n"
        "  -s, --scene <path>       start scene, project relative\n"
        "      --width N            window width  (default 1280)\n"
        "      --height N           window height (default 720)\n"
        "      --title TEXT         window title\n"
        "      --headless           no window: fixed step simulation (CI/capture)\n"
        "      --seconds N          stop after N seconds (0 = until closed)\n"
        "      --screenshot FILE    write a PNG of the last frame\n"
        "      --no-audio           disable audio output\n"
        "      --no-scripts         disable Lua scripting\n"
        "      --debug              start with the stats overlay on\n"
        "  -h, --help               this text\n"
        "\n"
        "In game: WASD move, Shift run, Space jump, E interact, mouse attack,\n"
        "         Esc/P pause, F1 stats, F2 screenshot, R respawn.\n",
        engineVersion(), exe);
}

}  // namespace

int main(int argc, char** argv) {
    RuntimeOptions options;
    if (!parseRuntimeArguments(argc, argv, &options)) {
        printUsage(argv[0]);
        return 0;
    }
    Log::get().setMinLevel(LogLevel::Info);

    GameRuntime runtime;
    std::string error;
    if (!runtime.init(options, &error)) {
        std::fprintf(stderr, "\n%s\n", error.c_str());
        NF_LOG_ERROR("Runtime", "%s", error.c_str());
#if defined(NF_PLATFORM_WINDOWS)
        showMessageBox("NovaForge Runtime", error, true);
#endif
        return 1;
    }
    if (options.headless) {
        const float seconds = options.maxSeconds > 0.0f ? options.maxSeconds : 3.0f;
        runtime.runHeadless(seconds);
        runtime.shutdown();
        std::printf("headless run finished (%.1fs)\n", seconds);
        return 0;
    }
    return runtime.run();
}
