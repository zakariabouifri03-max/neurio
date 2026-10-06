// NovaForge Engine - build system implementation
#include "buildsys/build_system.h"

#include "core/fs.h"
#include "core/log.h"
#include "platform/platform.h"

#include <algorithm>
#include <cstring>
#include <ctime>

#include "miniz.h"

namespace nf {

namespace {

std::string nowIso() {
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

std::string bytesToText(int64_t bytes) {
    char buf[64];
    if (bytes < 1024) snprintf(buf, sizeof buf, "%lld B", (long long)bytes);
    else if (bytes < 1024 * 1024) snprintf(buf, sizeof buf, "%.1f KB", bytes / 1024.0);
    else snprintf(buf, sizeof buf, "%.1f MB", bytes / (1024.0 * 1024.0));
    return buf;
}

// Extensions that never belong in an exported game.
bool isEditorOnly(const std::string& projectRelative) {
    static const char* blocked[] = {".nfscene.bak", ".orig", ".tmp", ".log"};
    for (const char* b : blocked)
        if (projectRelative.size() > std::strlen(b) &&
            projectRelative.compare(projectRelative.size() - std::strlen(b), std::strlen(b), b) == 0)
            return true;
    return false;
}

}  // namespace

std::string BuildResult::summary() const {
    if (!success) return "build failed: " + error;
    return "built " + std::to_string(copiedFiles.size()) + " files (" + bytesToText(totalBytes) +
           ") in " + std::to_string((int)(seconds * 1000.0)) + " ms -> " + outputDirectory;
}

std::string BuildSystem::runtimeExecutableName() {
#if defined(_WIN32)
    return "NovaForgeRuntime.exe";
#else
    return "NovaForgeRuntime";
#endif
}

std::string BuildSystem::findRuntimeExecutable() {
    // 1) next to the editor executable   2) build/ output folders
    const std::string name = runtimeExecutableName();
    std::vector<std::string> candidates;
    std::string exeDir = fs::executableDir();
    candidates.push_back(fs::join(exeDir, name));
    candidates.push_back(fs::join(fs::join(exeDir, ".."), name));
    candidates.push_back(fs::join("build/runtime", name));
    candidates.push_back(fs::join("build/windows", name));
#if defined(_WIN32)
    candidates.push_back(fs::join("build/windows", "NovaForgeRuntime.exe"));
#endif
    for (const std::string& c : candidates)
        if (fs::exists(c)) return fs::absolute(c);
    for (const std::string& c : candidates) {
        if (fs::exists(c)) return fs::absolute(c);
    }
    return {};
}

std::vector<std::pair<std::string, int64_t>> BuildSystem::planFiles(const Project& project,
                                                                    const BuildOptions& options) const {
    std::vector<std::pair<std::string, int64_t>> plan;
    if (!project.isOpen()) return plan;
    std::vector<fs::DirEntry> entries = fs::listDirectory(project.path("Assets"), true);
    for (const fs::DirEntry& e : entries) {
        if (e.directory) continue;
        std::string rel = project.relative(e.path);
        if (isEditorOnly(rel)) continue;
        if (!options.copySourceAssets) {
            std::string ext = fs::extension(e.name);
            if (ext == "glb" || ext == "gltf" || ext == "fbx" || ext == "obj" || ext == "mtl" ||
                ext == "png.source")
                continue;
        }
        plan.emplace_back(rel, e.size);
    }
    std::sort(plan.begin(), plan.end());
    return plan;
}

BuildResult BuildSystem::build(const Project& project, const BuildOptions& options,
                               ProgressFn progress) {
    BuildResult result;
    double startTime = timeSeconds();
    auto report = [&](int step, int total, const std::string& stepName, const std::string& file,
                      float fraction) {
        if (!progress) return;
        BuildProgress p;
        p.step = step;
        p.totalSteps = total;
        p.stepName = stepName;
        p.currentFile = file;
        p.fraction = fraction;
        progress(p);
    };
    auto fail = [&](const std::string& message) {
        result.error = message;
        result.success = false;
        NF_LOG_ERROR("Build", "%s", message.c_str());
        return result;
    };

    if (!project.isOpen()) return fail("no project is open");
    const std::string gameName = options.gameName.empty()
                                     ? (project.settings.build.gameName.empty()
                                            ? project.name()
                                            : project.settings.build.gameName)
                                     : options.gameName;
    if (gameName.empty()) return fail("the game needs a name");
    const std::string exeName = options.executableName.empty()
                                    ? (gameName + (std::string(".exe")))
                                    : options.executableName;
    const std::string outDir = options.outputDirectory.empty()
                                   ? project.path(fs::join(project.buildsDir(), gameName))
                                   : fs::absolute(options.outputDirectory);

    // What are we going to do? (drives the progress bar)
    std::vector<std::pair<std::string, int64_t>> assets;
    if (options.copyAssets) assets = planFiles(project, options);
    const int totalSteps = 6 + (int)assets.size();
    int step = 0;

    report(step, totalSteps, "Preparing the output folder", outDir, 0.0f);
    fs::createDirectories(outDir);
    if (!fs::isDirectory(outDir)) return fail("cannot create " + outDir);
    ++step;

    // 1. the standalone runtime executable
    report(step, totalSteps, "Copying the runtime executable", exeName, 0.0f);
    std::string runtimeExe = options.runtimeExecutable.empty() ? findRuntimeExecutable()
                                                               : options.runtimeExecutable;
    if (!runtimeExe.empty() && fs::exists(runtimeExe)) {
        std::string target = fs::join(outDir, exeName);
        if (!fs::copyFile(runtimeExe, target)) return fail("cannot copy " + runtimeExe + " to " + target);
        result.executablePath = target;
        result.copiedFiles.push_back(exeName);
        result.totalBytes += fs::fileSize(target);
    } else {
        result.error = "runtime executable not found - build it with 'python build.py --target "
                       "windows-runtime' (or the Linux 'runtime' target) first";
        NF_LOG_ERROR("Build", "%s", result.error.c_str());
        return result;   // success stays false
    }
    ++step;

    // 2. assets
    if (options.copyAssets) {
        for (const auto& [rel, size] : assets) {
            report(step, totalSteps, "Copying assets", rel,
                   (float)step / (float)std::max(totalSteps, 1));
            std::string source = project.path(rel);
            std::string target = fs::join(outDir, rel);
            fs::createDirectories(fs::parent(target));
            if (fs::copyFile(source, target)) {
                result.copiedFiles.push_back(rel);
                result.totalBytes += fs::fileSize(target);
            } else {
                NF_LOG_WARN("Build", "could not copy %s", rel.c_str());
            }
            ++step;
        }
    } else {
        // still make the folders so the game has somewhere to write
        for (const char* folder : {"Assets/Scenes", "Assets/Scripts", "Logs"})
            fs::createDirectories(fs::join(outDir, folder));
    }

    // 3. the project manifest travels with the game (so it stays a project)
    report(step, totalSteps, "Writing the project manifest", Project::manifestRelativePath(), 0.0f);
    {
        std::string manifest = project.path(Project::manifestRelativePath());
        std::string target = fs::join(outDir, Project::manifestRelativePath());
        fs::createDirectories(fs::parent(target));
        if (fs::exists(manifest)) {
            fs::copyFile(manifest, target);
            result.copiedFiles.push_back(Project::manifestRelativePath());
            result.totalBytes += fs::fileSize(target);
        }
        // imports DB keeps re-import possible inside the exported folder
        std::string imports = project.path("Project/imports.json");
        if (fs::exists(imports)) {
            std::string targetImports = fs::join(outDir, "Project/imports.json");
            fs::copyFile(imports, targetImports);
            result.copiedFiles.push_back("Project/imports.json");
            result.totalBytes += fs::fileSize(targetImports);
        }
        result.manifestPath = target;
    }
    ++step;

    // 4. game.json - what the runtime reads
    report(step, totalSteps, "Writing game.json", "game.json", 0.0f);
    {
        Json j = Json::object();
        j.set("format", "NovaForgeGame");
        j.set("version", 1);
        j.set("gameName", gameName);
        j.set("executable", exeName);
        j.set("engineVersion", project.engineVersion);
        j.set("builtUtc", nowIso());
        j.set("startScene", project.startSceneRelative());
        j.set("windowWidth", project.settings.build.windowWidth);
        j.set("windowHeight", project.settings.build.windowHeight);
        j.set("fullscreen", project.settings.build.fullscreen);
        j.set("quality", project.settings.render.quality);
        j.set("resolutionScale", project.settings.render.resolutionScale);
        j.set("vsync", project.settings.render.vsync);
        j.set("postGrade", project.settings.render.postGrade);
        j.set("debugDrawPhysics", project.settings.render.debugDrawPhysics);
        j.set("renderer", "software");   // V1 ships the CPU rasterizer (docs/RENDERING.md)
        std::string target = fs::join(outDir, "game.json");
        if (!fs::writeText(target, j.dump(2) + "\n")) return fail("cannot write game.json");
        result.copiedFiles.push_back("game.json");
        result.totalBytes += fs::fileSize(target);
    }
    ++step;

    // 5. BUILD_INFO.txt - an honest record of the export
    report(step, totalSteps, "Writing BUILD_INFO.txt", "BUILD_INFO.txt", 0.0f);
    {
        std::string info;
        info += "NovaForge Engine - exported game\n";
        info += "================================\n\n";
        info += "game:          " + gameName + "\n";
        info += "executable:    " + exeName + "\n";
        info += "project:       " + project.name() + "  (" + project.root() + ")\n";
        info += "start scene:   " + project.startSceneRelative() + "\n";
        info += "engine:        " + project.engineVersion + "\n";
        info += "built:         " + nowIso() + "\n";
        info += "renderer:      software rasterizer (CPU, multithreaded)\n";
        info += "files:         " + std::to_string(result.copiedFiles.size()) + "\n";
        info += "size:          " + bytesToText(result.totalBytes) + "\n\n";
        info += "Run " + exeName + " in this folder. Assets are loaded from ./Assets.\n";
        info += "Delete the folder to uninstall - nothing is written outside it\n";
        info += "(except Logs/ and your saved settings).\n";
        std::string target = fs::join(outDir, "BUILD_INFO.txt");
        if (!fs::writeText(target, info)) return fail("cannot write BUILD_INFO.txt");
        result.copiedFiles.push_back("BUILD_INFO.txt");
        result.totalBytes += fs::fileSize(target);
    }
    ++step;

    // 6. optional zip
    if (options.createZip) {
        report(step, totalSteps, "Creating the .zip archive", gameName + ".zip", 0.5f);
        std::string zipPath = fs::join(project.path(project.buildsDir()), gameName + ".zip");
        std::vector<std::pair<std::string, std::string>> files;
        for (const fs::DirEntry& e : fs::listDirectory(outDir, true)) {
            if (e.directory) continue;
            std::string rel = fs::relativeTo(e.path, outDir);
            files.emplace_back(rel, e.path);
        }
        std::string zipError;
        if (writeZip(zipPath, files, &zipError)) {
            result.zipPath = zipPath;
            result.copiedFiles.push_back(fs::filename(zipPath));
            result.totalBytes += fs::fileSize(zipPath);
        } else {
            NF_LOG_WARN("Build", "zip archive failed: %s", zipError.c_str());
        }
        ++step;
    }

    report(totalSteps, totalSteps, "Done", "", 1.0f);
    result.success = true;
    result.outputDirectory = outDir;
    result.seconds = timeSeconds() - startTime;
    NF_LOG_INFO("Build", "%s", result.summary().c_str());
    return result;
}

// --------------------------------------------------------------------- zip
namespace {

void put32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((uint8_t)(v & 0xFF));
    out.push_back((uint8_t)((v >> 8) & 0xFF));
    out.push_back((uint8_t)((v >> 16) & 0xFF));
    out.push_back((uint8_t)((v >> 24) & 0xFF));
}
void put16(std::vector<uint8_t>& out, uint16_t v) {
    out.push_back((uint8_t)(v & 0xFF));
    out.push_back((uint8_t)((v >> 8) & 0xFF));
}

uint32_t crc32Of(const std::vector<uint8_t>& data) {
    return (uint32_t)mz_crc32(MZ_CRC32_INIT, data.data(), data.size());
}

}  // namespace

bool BuildSystem::writeZip(const std::string& zipPath,
                           const std::vector<std::pair<std::string, std::string>>& files,
                           std::string* error) {
    std::vector<uint8_t> zip;
    struct CentralEntry {
        std::string name;
        uint32_t crc = 0, size = 0, offset = 0, compressed = 0;
        uint16_t method = 0;
    };
    std::vector<CentralEntry> central;

    for (const auto& [nameInZip, diskPath] : files) {
        fs::Bytes data = fs::readBinary(diskPath);
        if (data.empty() && fs::fileSize(diskPath) > 0) {
            if (error) *error = "cannot read " + diskPath;
            return false;
        }
        CentralEntry entry;
        entry.name = nameInZip;
        entry.crc = crc32Of(data);
        entry.size = (uint32_t)data.size();
        entry.offset = (uint32_t)zip.size();

        // deflate with miniz's tdefl; fall back to "stored" when it does not help
        size_t bound = mz_compressBound((mz_ulong)data.size());
        std::vector<uint8_t> compressed(bound);
        mz_ulong compressedSize = (mz_ulong)bound;
        int status = mz_compress2(compressed.data(), &compressedSize, data.data(),
                                  (mz_ulong)data.size(), MZ_BEST_COMPRESSION);
        bool useDeflate = status == MZ_OK && compressedSize < data.size();
        entry.method = useDeflate ? 8 : 0;
        const uint8_t* payload = useDeflate ? compressed.data() : data.data();
        uint32_t payloadSize = useDeflate ? (uint32_t)compressedSize : (uint32_t)data.size();
        entry.compressed = payloadSize;

        put32(zip, 0x04034b50);            // local file header
        put16(zip, 20);                    // version needed
        put16(zip, 0);                     // flags
        put16(zip, entry.method);
        put16(zip, 0);                     // mod time
        put16(zip, 0);                     // mod date
        put32(zip, entry.crc);
        put32(zip, payloadSize);
        put32(zip, entry.size);
        put16(zip, (uint16_t)entry.name.size());
        put16(zip, 0);                     // extra length
        zip.insert(zip.end(), entry.name.begin(), entry.name.end());
        zip.insert(zip.end(), payload, payload + payloadSize);
        central.push_back(entry);
    }

    uint32_t centralOffset = (uint32_t)zip.size();
    for (const CentralEntry& e : central) {
        put32(zip, 0x02014b50);            // central directory header
        put16(zip, 20);                    // version made by
        put16(zip, 20);                    // version needed
        put16(zip, 0);                     // flags
        put16(zip, e.method);
        put16(zip, 0);
        put16(zip, 0);
        put32(zip, e.crc);
        put32(zip, e.compressed);
        put32(zip, e.size);
        put16(zip, (uint16_t)e.name.size());
        put16(zip, 0);
        put16(zip, 0);
        put16(zip, 0);
        put16(zip, 0);
        put32(zip, 0);
        put32(zip, e.offset);
        zip.insert(zip.end(), e.name.begin(), e.name.end());
    }
    uint32_t centralSize = (uint32_t)zip.size() - centralOffset;
    put32(zip, 0x06054b50);                // end of central directory
    put16(zip, 0);
    put16(zip, 0);
    put16(zip, (uint16_t)central.size());
    put16(zip, (uint16_t)central.size());
    put32(zip, centralSize);
    put32(zip, centralOffset);
    put16(zip, 0);                         // comment length

    fs::createDirectories(fs::parent(zipPath));
    if (!fs::writeBinary(zipPath, zip)) {
        if (error) *error = "cannot write " + zipPath;
        return false;
    }
    return true;
}

}  // namespace nf
