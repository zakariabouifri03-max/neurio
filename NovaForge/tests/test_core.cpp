// Core module tests: math, JSON, filesystem, images/audio containers,
// threading, logging.
#include "test_framework.h"

#include "core/fs.h"
#include "core/guid.h"
#include "core/image.h"
#include "core/json.h"
#include "core/log.h"
#include "core/math.h"
#include "core/thread_pool.h"

#include <atomic>
#include <set>
#include <thread>

using namespace nf;

static std::string tmpDir() {
    std::string d = fs::join(fs::tempDir(), "novaforge_tests");
    fs::createDirectories(d);
    return d;
}

// ------------------------------------------------------------------ math
NF_TEST(math_vec_ops) {
    Vec3 a(1, 2, 3), b(4, 5, 6);
    CHECK_NEAR(dot(a, b), 32.0f, 1e-5f);
    Vec3 c = cross(Vec3(1, 0, 0), Vec3(0, 1, 0));
    CHECK_NEAR(c.z, 1.0f, 1e-6f);
    CHECK_NEAR(a.length(), std::sqrt(14.0f), 1e-5f);
    Vec3 n = Vec3(3, 0, 4).normalized();
    CHECK_NEAR(n.length(), 1.0f, 1e-6f);
}

NF_TEST(math_matrix_inverse) {
    Mat4 m = Mat4::translate(Vec3(3, -2, 5)) * Mat4::rotateY(0.7f) * Mat4::scale(Vec3(2, 2, 2));
    Mat4 inv = m.inverse();
    Mat4 id = m * inv;
    for (int i = 0; i < 16; ++i) {
        float expect = (i % 5 == 0) ? 1.0f : 0.0f;
        CHECK_NEAR(id.m[i], expect, 1e-4f);
    }
    Vec3 p(1.5f, 2.5f, -3.5f);
    Vec3 rt = inv.transformPoint(m.transformPoint(p));
    CHECK_NEAR(rt.x, p.x, 1e-4f);
    CHECK_NEAR(rt.y, p.y, 1e-4f);
    CHECK_NEAR(rt.z, p.z, 1e-4f);
}

NF_TEST(math_quat_euler_roundtrip) {
    Vec3 euler(15.0f, 40.0f, -25.0f);
    Quat q = Quat::fromEulerDeg(euler);
    Vec3 back = q.toEulerDeg();
    CHECK_NEAR(back.x, euler.x, 0.01f);
    CHECK_NEAR(back.y, euler.y, 0.01f);
    CHECK_NEAR(back.z, euler.z, 0.01f);
    Quat r = Quat::fromAxisAngle(Vec3(0, 1, 0), 1.5707963f);
    Vec3 v = r.rotate(Vec3(1, 0, 0));
    CHECK_NEAR(v.x, 0.0f, 1e-4f);
    CHECK_NEAR(v.z, -1.0f, 1e-4f);
}

NF_TEST(math_trs_and_decompose) {
    Vec3 t(1, 2, 3), s(2, 3, 4);
    Quat q = Quat::fromEulerDeg(Vec3(10, 20, 30));
    Mat4 m = Mat4::trs(t, q, s);
    Vec3 pt = m.transformPoint(Vec3(0, 0, 0));
    CHECK_NEAR(pt.x, 1.0f, 1e-4f);
    CHECK_NEAR(pt.y, 2.0f, 1e-4f);
    CHECK_NEAR(pt.z, 3.0f, 1e-4f);
    // the basis columns carry the scale
    CHECK_NEAR(m.col(0).xyz().length(), s.x, 1e-3f);
    CHECK_NEAR(m.col(1).xyz().length(), s.y, 1e-3f);
    CHECK_NEAR(m.col(2).xyz().length(), s.z, 1e-3f);
    // decompose must invert trs()
    Vec3 dt, ds;
    Quat dq;
    m.decompose(dt, dq, ds);
    CHECK_NEAR(dt.x, t.x, 1e-4f);
    CHECK_NEAR(dt.y, t.y, 1e-4f);
    CHECK_NEAR(dt.z, t.z, 1e-4f);
    CHECK_NEAR(ds.x, s.x, 1e-3f);
    CHECK_NEAR(ds.y, s.y, 1e-3f);
    CHECK_NEAR(ds.z, s.z, 1e-3f);
    Vec3 probe(0.3f, -0.7f, 1.1f);
    Vec3 viaQuat = dq.rotate(Vec3(probe.x * ds.x, probe.y * ds.y, probe.z * ds.z)) + dt;
    Vec3 viaMat = m.transformPoint(probe);
    CHECK_NEAR(viaQuat.x, viaMat.x, 1e-3f);
    CHECK_NEAR(viaQuat.y, viaMat.y, 1e-3f);
    CHECK_NEAR(viaQuat.z, viaMat.z, 1e-3f);
}

NF_TEST(math_ray_and_frustum) {
    AABB box;
    box.expand(Vec3(-1, -1, -1));
    box.expand(Vec3(1, 1, 1));
    Ray r{Vec3(0, 0, -5), Vec3(0, 0, 1)};
    float t = 0;
    CHECK(rayAABB(r, box, t));
    CHECK_NEAR(t, 4.0f, 1e-4f);
    Ray miss{Vec3(5, 5, -5), Vec3(0, 0, 1)};
    CHECK(!rayAABB(miss, box, t));

    Mat4 proj = Mat4::perspective(60.0f * DEG2RAD, 16.0f / 9.0f, 0.1f, 100.0f);
    Mat4 view = Mat4::lookAt(Vec3(0, 0, 5), Vec3(0, 0, 0), Vec3(0, 1, 0));
    Frustum f = Frustum::fromMatrix(proj * view);
    AABB inFront;
    inFront.expand(Vec3(-0.5f, -0.5f, -0.5f));
    inFront.expand(Vec3(0.5f, 0.5f, 0.5f));
    CHECK(f.intersectsAABB(inFront));
    AABB behind;
    behind.expand(Vec3(-0.5f, -0.5f, 20.0f));
    behind.expand(Vec3(0.5f, 0.5f, 21.0f));
    CHECK(!f.intersectsAABB(behind));
    CHECK(f.containsPoint(Vec3(0, 0, 0)));
}

// ------------------------------------------------------------------ json
NF_TEST(json_roundtrip) {
    Json root = Json::object();
    root.set("name", "Sample Island");
    root.set("version", 3);
    root.set("gravity", -9.81);
    root.set("enabled", true);
    root.set("nothing", Json());
    Json& arr = root.arrayAt("objects");
    for (int i = 0; i < 3; ++i) {
        Json o = Json::object();
        o.set("id", i);
        o.set("pos", std::string("0,1,2"));
        o["nested"] = Json::object();
        o["nested"]["deep"] = std::string("value \"quoted\"\nnewline");
        arr.push(o);
    }
    std::string text = root.dump(2);
    CHECK(text.find("\"name\": \"Sample Island\"") != std::string::npos);
    Json parsed = Json::parse(text);
    CHECK_EQ(parsed["name"].asString(), std::string("Sample Island"));
    CHECK_EQ(parsed["version"].asInt(), 3);
    CHECK_NEAR(parsed["gravity"].asFloat(), -9.81f, 1e-5f);
    CHECK(parsed["enabled"].asBool());
    CHECK_EQ((int)parsed["objects"].size(), 3);
    CHECK_EQ(parsed["objects"][2]["id"].asInt(), 2);
    CHECK_EQ(parsed["objects"][0]["nested"]["deep"].asString(),
             std::string("value \"quoted\"\nnewline"));
    // idempotent dumps
    CHECK_EQ(parsed.dump(2), text);
}

NF_TEST(json_error_handling) {
    std::string err;
    Json j = Json::parse("{\"a\": 1, \"b\": [1,2,}", &err);
    CHECK(!err.empty());
    // graceful defaults instead of crashes
    CHECK_EQ(j["missing"].asInt(42), 42);
    CHECK_EQ(j["a"].asInt(), 1);
    Json deep = Json::parse("{\"x\":{\"y\":{\"z\":[1,2,3]}}}");
    CHECK_EQ(deep["x"]["y"]["z"][1].asInt(), 2);
    // unicode escape
    Json u = Json::parse("{\"s\":\"caf\\u00e9\"}");
    CHECK_EQ(u["s"].asString(), std::string("café"));
}

NF_TEST(json_file_io) {
    std::string dir = tmpDir();
    std::string path = fs::join(dir, "test_project.json");
    Json root = Json::object();
    root.set("projectName", "TestProject");
    Json& scenes = root.arrayAt("scenes");
    scenes.push(std::string("Assets/Scenes/main.scene"));
    CHECK(root.saveFile(path));
    CHECK(fs::exists(path));
    Json loaded;
    std::string err;
    CHECK(Json::parseFile(path, loaded, &err));
    CHECK_EQ(loaded["projectName"].asString(), std::string("TestProject"));
    CHECK_EQ(loaded["scenes"][0].asString(), std::string("Assets/Scenes/main.scene"));
    CHECK(fs::removeFile(path));
}

// ------------------------------------------------------------------ fs
NF_TEST(fs_paths_and_io) {
    CHECK_EQ(fs::join("a", "b"), std::string("a/b"));
    CHECK_EQ(fs::join("a/", "b"), std::string("a/b"));
    CHECK_EQ(fs::normalize("a\\b\\c"), std::string("a/b/c"));
    CHECK_EQ(fs::filename("x/y/z.glb"), std::string("z.glb"));
    CHECK_EQ(fs::stem("x/y/z.glb"), std::string("z"));
    CHECK_EQ(fs::extension("x/y/Z.GLB"), std::string("glb"));
    CHECK_EQ(fs::parent("x/y/z.glb"), std::string("x/y"));

    std::string dir = fs::join(tmpDir(), "nested/deep");
    CHECK(fs::createDirectories(dir));
    std::string f = fs::join(dir, "hello.txt");
    CHECK(fs::writeText(f, "hello engine"));
    CHECK_EQ(fs::readText(f), std::string("hello engine"));
    CHECK_EQ(fs::fileSize(f), (int64_t)12);
    auto entries = fs::listDirectory(tmpDir(), true);
    bool found = false;
    for (auto& e : entries)
        if (e.name == "hello.txt") found = true;
    CHECK(found);
    CHECK(fs::removeTree(fs::join(tmpDir(), "nested")));
}

// ------------------------------------------------------------------ guid / threads
NF_TEST(guid_unique) {
    std::set<std::string> ids;
    for (int i = 0; i < 2000; ++i) {
        std::string g = generateGuid();
        CHECK_EQ(g.size(), (size_t)32);
        ids.insert(g);
    }
    CHECK_EQ(ids.size(), (size_t)2000);
    CHECK(hashString("hello") == hashString(std::string("hello")));
    CHECK(hashString("hello") != hashString("hallo"));
}

NF_TEST(thread_pool_executes_and_joins) {
    ThreadPool pool(3);
    std::atomic<int> counter{0};
    std::vector<std::future<int>> futures;
    for (int i = 0; i < 20; ++i)
        futures.push_back(pool.submit([&counter, i] {
            counter++;
            return i * 2;
        }));
    for (int i = 0; i < 20; ++i) CHECK_EQ(futures[i].get(), i * 2);
    pool.waitIdle();
    CHECK_EQ(counter.load(), 20);
    CHECK_EQ(pool.pending(), 0);
}

// ------------------------------------------------------------------ image / audio containers
NF_TEST(image_png_roundtrip) {
    const int W = 32, H = 16;
    std::vector<uint8_t> rgba((size_t)W * H * 4);
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) {
            size_t i = ((size_t)y * W + x) * 4;
            rgba[i] = (uint8_t)(x * 8);
            rgba[i + 1] = (uint8_t)(y * 16);
            rgba[i + 2] = 64;
            rgba[i + 3] = 255;
        }
    std::string path = fs::join(tmpDir(), "unit.png");
    CHECK(writePng(path, rgba.data(), W, H));
    ImageData img;
    std::string err;
    CHECK_MSG(decodeImageFile(path, img, 4, false, &err), err);
    CHECK_EQ(img.width, W);
    CHECK_EQ(img.height, H);
    CHECK_EQ(img.pixels.size(), rgba.size());
    // PNG is lossless - the first pixel must match exactly
    CHECK_EQ((int)img.pixels[0], (int)rgba[0]);
    CHECK_EQ((int)img.pixels[1], (int)rgba[1]);
    CHECK_EQ((int)img.pixels[2], (int)rgba[2]);
    // a corrupt image must fail gracefully, not crash
    ImageData bad;
    std::string err2;
    CHECK(!decodeImageFile(path + ".missing", bad, 4, false, &err2));
    CHECK(!err2.empty());
    fs::removeFile(path);
}

NF_TEST(audio_wav_roundtrip) {
    const int frames = 800;
    std::vector<float> samples((size_t)frames * 2);
    for (int i = 0; i < frames; ++i) {
        samples[i * 2] = std::sin(i * 0.05f) * 0.8f;
        samples[i * 2 + 1] = std::sin(i * 0.03f) * 0.5f;
    }
    std::string path = fs::join(tmpDir(), "unit.wav");
    CHECK(writeWav16(path, samples.data(), frames, 2, 44100));
    auto bytes = fs::readBinary(path);
    CHECK(!bytes.empty());
    std::vector<float> back;
    int ch = 0, sr = 0;
    std::string err;
    CHECK_MSG(readWav(bytes.data(), bytes.size(), back, ch, sr, &err), err);
    CHECK_EQ(ch, 2);
    CHECK_EQ(sr, 44100);
    CHECK_EQ((int)back.size(), frames * 2);
    for (int i = 0; i < 20; ++i) CHECK_NEAR(back[i * 7], samples[i * 7], 0.001);
    fs::removeFile(path);
}

// ------------------------------------------------------------------ log
NF_TEST(log_capture_and_levels) {
    auto& log = Log::get();
    size_t before = log.count();
    size_t errorsBefore = log.errorCount();
    NF_LOG_INFO("Test", "hello %s %d", "world", 42);
    NF_LOG_ERROR("Test", "an error %d", 7);
    CHECK(log.count() >= before + 2);
    CHECK_EQ(log.errorCount(), errorsBefore + 1);
    auto entries = log.entries();
    CHECK_EQ(entries.back().message, std::string("an error 7"));
    CHECK_EQ(entries.back().level, LogLevel::Error);
    size_t n = log.count();
    for (int i = 0; i < 5000; ++i) NF_LOG_TRACE("Test", "spam %d", i);
    CHECK(log.count() <= n + 5000);
    CHECK(std::string(Log::levelName(LogLevel::Warning)) == "WARN");
}
