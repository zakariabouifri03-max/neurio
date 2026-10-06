// NovaForge Engine - tests for the project system and the game build system
#include "test_framework.h"

#include "buildsys/build_system.h"
#include "core/fs.h"
#include "project/project.h"
#include "scene/scene.h"

#include "miniz.h"

using namespace nf;

namespace {

std::string tempRoot(const char* tag) {
    fprintf(stderr, "[dbg] tempRoot enter\n");
    std::string dir = fs::join(fs::tempDir(), std::string("nf_project_") + tag);
    fprintf(stderr, "[dbg] dir=%s\n", dir.c_str());
    fs::removeTree(dir);
    fprintf(stderr, "[dbg] removed\n");
    fs::createDirectories(dir);
    fprintf(stderr, "[dbg] created\n");
    return dir;
}

}  // namespace

// --------------------------------------------------------------- project
NF_TEST(project_creates_the_documented_layout) {
    std::string root = tempRoot("layout");
    Project project;
    std::string error;
    CHECK(project.create(root, "Zephyr", &error));
    CHECK_MSG(error.empty(), "creating a project must not report an error");

    CHECK(fs::isDirectory(project.path("Project")));
    for (const char* folder : {"Assets/Models", "Assets/Textures", "Assets/Materials",
                               "Assets/Audio", "Assets/Scenes", "Assets/Scripts",
                               "Assets/Prefabs", "Settings", "Logs", "Builds"})
        CHECK_MSG(fs::isDirectory(project.path(folder)), ("missing folder " + std::string(folder)).c_str());

    CHECK(fs::exists(project.path(Project::manifestRelativePath())));
    CHECK_EQ(project.name(), std::string("Zephyr"));
    CHECK(project.isOpen());
    CHECK(Project::isProject(root));
    CHECK(!Project::isProject(fs::tempDir()));

    // create() also drops a starting scene with a camera and a sun
    std::vector<std::string> scenes = project.listScenes();
    CHECK_MSG(scenes.size() >= 1, "a new project needs a start scene");
    Scene scene;
    std::string scenePath = project.startSceneRelative();
    CHECK(project.loadScene(scene, scenePath, &error));
    CHECK_MSG(error.empty(), "the generated start scene must be loadable");
    int cameras = 0, lights = 0;
    for (const auto& [id, e] : scene.entities()) {
        if (e.camera) ++cameras;
        if (e.light) ++lights;
    }
    CHECK_EQ(cameras, 1);
    CHECK_EQ(lights, 1);
    fs::removeTree(root);
}

NF_TEST(project_settings_and_extra_survive_a_round_trip) {
    std::string root = tempRoot("roundtrip");
    std::string error;
    {
        Project project;
        CHECK(project.create(root, "RoundTrip", &error));
        project.settings.render.quality = "Ultra";
        project.settings.render.shadowMapSize = 2048;
        project.settings.render.postGrade = "Noir";
        project.settings.physics.gravity = Vec3(0, -14.5f, 0);
        project.settings.build.gameName = "RoundTripGame";
        project.settings.build.windowWidth = 1920;
        project.settings.build.createZip = true;
        project.settings.ai.provider = "openai";
        project.settings.ai.model = "gpt-4o-mini";
        project.settings.inputActions = {{"Jump", {"Space", "GamepadA"}, 0.1f, false},
                                         {"MoveForward", {"W", "Up"}, 0.05f, true}};
        // unknown keys must be preserved verbatim
        project.settings.extra.set("customFarm", "yes");
        project.settings.extra.set("customNumber", 42);
        Json nested = Json::object();
        nested.set("deep", true);
        project.settings.extra.set("nested", nested);
        CHECK(project.save(&error));
        CHECK_MSG(error.empty(), "save must not report an error");
    }
    {
        Project reopened;
        CHECK(reopened.open(root, &error));
        CHECK_MSG(error.empty(), "open must not report an error");
        CHECK_EQ(reopened.name(), std::string("RoundTrip"));
        CHECK_EQ(reopened.settings.render.quality, std::string("Ultra"));
        CHECK_EQ(reopened.settings.render.shadowMapSize, 2048);
        CHECK_EQ(reopened.settings.render.postGrade, std::string("Noir"));
        CHECK_NEAR(reopened.settings.physics.gravity.y, -14.5f, 1e-4f);
        CHECK_EQ(reopened.settings.build.gameName, std::string("RoundTripGame"));
        CHECK_EQ(reopened.settings.build.windowWidth, 1920);
        CHECK(reopened.settings.build.createZip);
        CHECK_EQ(reopened.settings.ai.provider, std::string("openai"));
        CHECK_EQ(reopened.settings.inputActions.size(), size_t(2));
        bool foundJump = false;
        for (const auto& action : reopened.settings.inputActions) {
            if (action.action == "Jump") {
                foundJump = true;
                CHECK_EQ(action.keys.size(), size_t(2));
                CHECK_NEAR(action.deadzone, 0.1f, 1e-4f);
            }
        }
        CHECK(foundJump);
        CHECK_EQ(reopened.settings.extra["customFarm"].asString(), std::string("yes"));
        CHECK_EQ(reopened.settings.extra["customNumber"].asInt(), 42);
        CHECK(reopened.settings.extra["nested"]["deep"].asBool());
    }
    // the manifest is human readable JSON at the documented path
    Json manifest = Json::parse(fs::readText(fs::join(root, Project::manifestRelativePath())));
    CHECK_EQ(manifest["format"].asString(), std::string("NovaForgeProject"));
    CHECK(manifest.has("version"));
    CHECK(manifest.has("extra"));
    fs::removeTree(root);
}

NF_TEST(project_repairs_a_folder_that_only_has_assets) {
    std::string root = tempRoot("repair");
    fs::createDirectories(fs::join(root, "Assets/Scenes"));
    Project project;
    std::string error;
    CHECK(project.open(root, &error));
    CHECK_EQ(project.name(), std::string("repair"));
    CHECK(fs::exists(fs::join(root, Project::manifestRelativePath())));
    CHECK(fs::isDirectory(project.path("Assets/Scripts")));
    fs::removeTree(root);
}

NF_TEST(project_scene_and_file_helpers) {
    std::string root = tempRoot("files");
    Project project;
    std::string error;
    CHECK(project.create(root, "Helpers", &error));

    std::string sceneRel = project.createScene("Level Two", &error);
    CHECK(!sceneRel.empty());
    CHECK_EQ(sceneRel, std::string("Assets/Scenes/Level_Two.nfscene.json"));
    CHECK(fs::exists(project.path(sceneRel)));

    Scene scene;
    scene.createEntity("Crate");
    CHECK(project.saveScene(scene, sceneRel, &error));
    Scene loaded;
    CHECK(project.loadScene(loaded, sceneRel, &error));
    CHECK_EQ(loaded.count(), size_t(1));

    project.writeTextFile("Assets/Scripts/hello.lua", "-- hello\n", &error);
    CHECK_EQ(project.readTextFile("Assets/Scripts/hello.lua"), std::string("-- hello\n"));
    CHECK(project.listFiles("Assets/Scripts", ".lua").size() == 1);

    project.setStartScene(sceneRel);
    CHECK_EQ(project.startSceneRelative(), sceneRel);
    CHECK(project.modifiedFiles().size() >= 1);
    CHECK_EQ(project.assetPath("Scenes/x.png"), fs::join(project.path("Assets"), "Scenes/x.png"));

    fs::removeTree(root);
}

// --------------------------------------------------------------- build system
NF_TEST(build_system_refuses_to_export_without_a_runtime) {
    std::string root = tempRoot("build_noruntime");
    Project project;
    std::string error;
    CHECK(project.create(root, "NoRuntime", &error));

    BuildSystem builder;
    BuildOptions options;
    options.outputDirectory = fs::join(root, "Builds/Out");
    options.runtimeExecutable = fs::join(root, "definitely_missing_executable");
    BuildResult result = builder.build(project, options, nullptr);
    CHECK_MSG(!result.success, "a build without a runtime must fail rather than fake success");
    CHECK(result.error.find("runtime") != std::string::npos);
    fs::removeTree(root);
}

NF_TEST(build_system_exports_a_playable_folder) {
    std::string root = tempRoot("build_ok");
    Project project;
    std::string error;
    CHECK(project.create(root, "IslandExport", &error));
    project.settings.build.gameName = "SampleIsland";
    project.writeTextFile("Assets/Scripts/spinner.lua", "return { onStart = function() end }\n", &error);
    project.writeTextFile("Assets/Textures/roof.png", std::string(64, 'x'), &error);
    project.writeTextFile("Assets/Models/hero.obj", "v 0 0 0\n", &error);
    project.save(&error);

    // a stand-in for the runtime executable (the real one is built by build.py)
    std::string fakeRuntime = fs::join(root, "runtime_stub.exe");
    CHECK(fs::writeBinary(fakeRuntime, fs::Bytes{'M', 'Z', 0x90, 0x00, 0x01}));

    BuildSystem builder;
    BuildOptions options;
    options.runtimeExecutable = fakeRuntime;
    options.createZip = true;
    options.copySourceAssets = false;

    std::vector<BuildProgress> steps;
    BuildResult result = builder.build(project, options, [&](const BuildProgress& p) {
        steps.push_back(p);
    });
    CHECK_MSG(result.success, result.error.c_str());
    CHECK_MSG(steps.size() > 5, "the build must report real progress steps");
    CHECK_NEAR(steps.front().fraction, 0.0f, 1e-6f);
    CHECK_NEAR(steps.back().fraction, 1.0f, 1e-6f);
    for (const BuildProgress& p : steps) CHECK(p.totalSteps >= 1);

    std::string out = result.outputDirectory;
    CHECK_EQ(fs::filename(out), std::string("SampleIsland"));
    CHECK(fs::exists(fs::join(out, "SampleIsland.exe")));
    CHECK(fs::exists(fs::join(out, "game.json")));
    CHECK(fs::exists(fs::join(out, "BUILD_INFO.txt")));
    CHECK(fs::exists(fs::join(out, Project::manifestRelativePath())));
    CHECK(fs::exists(fs::join(out, "Assets/Scripts/spinner.lua")));
    CHECK(fs::exists(fs::join(out, "Assets/Textures/roof.png")));
    CHECK_MSG(!fs::exists(fs::join(out, "Assets/Models/hero.obj")),
              "source models are not exported unless asked for");
    CHECK(!result.zipPath.empty());
    CHECK(fs::exists(result.zipPath));
    CHECK(result.totalBytes > 0);

    Json game = Json::parse(fs::readText(fs::join(out, "game.json")));
    CHECK_EQ(game["format"].asString(), std::string("NovaForgeGame"));
    CHECK_EQ(game["gameName"].asString(), std::string("SampleIsland"));
    CHECK_EQ(game["executable"].asString(), std::string("SampleIsland.exe"));
    CHECK_EQ(game["startScene"].asString(), project.startSceneRelative());

    // the exported exe is byte-identical to the runtime it came from
    CHECK_EQ(fs::fileSize(fs::join(out, "SampleIsland.exe")), fs::fileSize(fakeRuntime));
    CHECK_EQ(fs::readText(fs::join(out, "SampleIsland.exe")).substr(0, 2), std::string("MZ"));

    // the zip really is a zip and contains the exe
    fs::Bytes zip = fs::readBinary(result.zipPath);
    CHECK(zip.size() > 22);
    CHECK_EQ(zip[0], (uint8_t)'P');
    CHECK_EQ(zip[1], (uint8_t)'K');
    CHECK_EQ(zip[2], (uint8_t)3);
    CHECK_EQ(zip[3], (uint8_t)4);
    std::string zipText((const char*)zip.data(), zip.size());
    CHECK(zipText.find("SampleIsland.exe") != std::string::npos);
    CHECK(zipText.find("game.json") != std::string::npos);

    // and only the files the project needs
    CHECK_MSG(result.copiedFiles.size() < 20, "the export must not swallow the whole folder");
    fs::removeTree(root);
}

NF_TEST(build_system_plan_matches_the_export) {
    std::string root = tempRoot("build_plan");
    Project project;
    std::string error;
    CHECK(project.create(root, "Planner", &error));
    project.writeTextFile("Assets/Scenes/Extra.nfscene.json", "{}", &error);
    project.writeTextFile("Assets/Models/source.glb", std::string(128, 'g'), &error);
    project.writeTextFile("Assets/Models/source.nfmodel.json", "{}", &error);
    project.writeTextFile("Assets/Textures/sky.png", std::string(32, 'p'), &error);

    BuildSystem builder;
    BuildOptions options;
    auto plan = builder.planFiles(project, options);
    bool hasGlb = false, hasModelJson = false, hasTexture = false;
    for (const auto& [rel, size] : plan) {
        if (rel.find(".glb") != std::string::npos) hasGlb = true;
        if (rel.find(".nfmodel.json") != std::string::npos) hasModelJson = true;
        if (rel.find("sky.png") != std::string::npos) hasTexture = true;
        CHECK(size >= 0);
    }
    CHECK(!hasGlb);
    CHECK(hasModelJson);
    CHECK(hasTexture);

    options.copySourceAssets = true;
    auto withSources = builder.planFiles(project, options);
    CHECK(withSources.size() > plan.size());
    fs::removeTree(root);
}

NF_TEST(build_system_zip_round_trips_through_miniz) {
    std::string root = tempRoot("zip");
    std::string binPath = fs::join(root, "data.bin");
    std::vector<uint8_t> payload;
    for (int i = 0; i < 4096; ++i) payload.push_back((uint8_t)(i % 251));
    CHECK(fs::writeBinary(binPath, payload));
    std::string textPath = fs::join(root, "readme.txt");
    CHECK(fs::writeText(textPath, "NovaForge\n"));

    std::string zipPath = fs::join(root, "out.zip");
    std::string error;
    CHECK(BuildSystem::writeZip(zipPath, {{"data.bin", binPath}, {"docs/readme.txt", textPath}}, &error));
    CHECK_MSG(error.empty(), error.c_str());
    fs::Bytes zip = fs::readBinary(zipPath);
    CHECK(zip.size() > payload.size());

    // inflate everything back out with miniz and compare byte for byte
    mz_zip_archive archive{};
    CHECK(mz_zip_reader_init_mem(&archive, zip.data(), zip.size(), 0) != 0);
    CHECK_EQ(mz_zip_reader_get_num_files(&archive), 2u);
    for (mz_uint i = 0; i < 2; ++i) {
        mz_zip_archive_file_stat stat{};
        CHECK(mz_zip_reader_file_stat(&archive, i, &stat) != 0);
        size_t size = 0;
        void* data = mz_zip_reader_extract_to_heap(&archive, i, &size, 0);
        CHECK(data != nullptr);
        if (!data) continue;
        if (std::string(stat.m_filename) == "data.bin") {
            CHECK_EQ(size, payload.size());
            CHECK(std::memcmp(data, payload.data(), size) == 0);
        } else {
            std::string got((const char*)data, size);
            CHECK_EQ(got, std::string("NovaForge\n"));
        }
        mz_free(data);
    }
    mz_zip_reader_end(&archive);
    fs::removeTree(root);
}
