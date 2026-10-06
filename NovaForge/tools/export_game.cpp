// NovaForge Engine - command line game exporter
//
//   ./build/tools/export_game <projectDir> [options]
//     --out DIR          output folder (default: <project>/Builds/<Game>)
//     --name NAME        game name (default: project build settings)
//     --runtime PATH     the standalone runtime to package (default: auto find)
//     --zip              also write a .zip of the export
//     --zip-out PATH     move the .zip here afterwards
//     --sources          include the original .glb/.obj sources
//
// This is the same BuildSystem the editor's BUILD GAME button calls, so an
// export made here is byte-for-byte the export the editor would produce.
#include "buildsys/build_system.h"
#include "core/fs.h"
#include "core/log.h"
#include "project/project.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace nf;

int main(int argc, char** argv) {
    Log::get().setMinLevel(LogLevel::Info);
    if (argc < 2) {
        std::fprintf(stderr,
                     "usage: export_game <projectDir> [--out DIR] [--name NAME] [--runtime PATH]\n"
                     "                   [--zip] [--zip-out PATH] [--sources]\n");
        return 2;
    }
    std::string projectDir = argv[1];
    BuildOptions options;
    std::string zipOut;
    for (int i = 2; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string& dst) {
            if (i + 1 < argc) dst = argv[++i];
        };
        if (a == "--out") next(options.outputDirectory);
        else if (a == "--name") next(options.gameName);
        else if (a == "--runtime") next(options.runtimeExecutable);
        else if (a == "--zip-out") next(zipOut);
        else if (a == "--zip") options.createZip = true;
        else if (a == "--sources") options.copySourceAssets = true;
        else {
            std::fprintf(stderr, "unknown option: %s\n", a.c_str());
            return 2;
        }
    }

    Project project;
    std::string error;
    if (!project.open(projectDir, &error)) {
        std::fprintf(stderr, "cannot open project: %s\n", error.c_str());
        return 1;
    }
    std::printf("project: %s  (%s)\n", project.name().c_str(), project.root().c_str());
    std::printf("start scene: %s\n", project.startSceneRelative().c_str());

    BuildSystem builder;
    if (options.runtimeExecutable.empty()) {
        const std::string found = BuildSystem::findRuntimeExecutable();
        if (found.empty()) {
            std::fprintf(stderr,
                         "no runtime executable found - build it first:\n"
                         "  python build.py --target windows-runtime     (Windows .exe)\n"
                         "  python build.py --target runtime              (this platform)\n");
            return 1;
        }
        options.runtimeExecutable = found;
    }
    std::printf("runtime: %s\n", options.runtimeExecutable.c_str());

    int lastStep = -1;
    BuildResult result = builder.build(project, options, [&](const BuildProgress& p) {
        if (p.step != lastStep) {
            lastStep = p.step;
            std::printf("  [%d/%d] %s %s\n", p.step, p.totalSteps, p.stepName.c_str(),
                        p.currentFile.c_str());
            std::fflush(stdout);
        }
    });
    if (!result.success) {
        std::fprintf(stderr, "build failed: %s\n", result.error.c_str());
        return 1;
    }
    std::printf("%s\n", result.summary().c_str());
    std::printf("executable: %s\n", result.executablePath.c_str());

    if (options.createZip && !zipOut.empty() && !result.zipPath.empty()) {
        fs::createDirectories(fs::parent(zipOut));
        if (!fs::copyFile(result.zipPath, zipOut)) {
            std::fprintf(stderr, "could not copy the zip to %s\n", zipOut.c_str());
            return 1;
        }
        std::printf("zip: %s (%lld bytes)\n", zipOut.c_str(),
                    (long long)fs::fileSize(zipOut));
    }
    return 0;
}
