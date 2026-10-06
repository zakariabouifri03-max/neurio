// NovaForge Engine - tests/CoreTests.cpp
#include "TestFramework.h"
#include "core/Math.h"
#include "core/Json.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/ThreadPool.h"

using namespace nf;

NF_TEST(Core, VecBasics) {
  Vec3 a(1, 2, 3), b(4, 5, 6);
  NF_CHECK_NEAR(Dot(a, b), 32.0, 1e-6);
  Vec3 c = Cross(a, b);
  NF_CHECK_NEAR(c.x, -3.0, 1e-6);
  NF_CHECK_NEAR(c.y, 6.0, 1e-6);
  NF_CHECK_NEAR(c.z, -3.0, 1e-6);
  NF_CHECK_NEAR(Length(Vec3(3, 4, 0)), 5.0, 1e-6);
  NF_CHECK_NEAR(Length(Normalize(Vec3(0, 0, 7))), 1.0, 1e-5);
  NF_CHECK_NEAR(Distance(Vec3(0, 0, 0), Vec3(0, 0, 3)), 3.0, 1e-6);
}

NF_TEST(Core, Mat4MultiplyAndInverse) {
  Mat4 t = Mat4::Translate(Vec3(5, -2, 3));
  Mat4 s = Mat4::Scale(Vec3(2, 2, 2));
  Mat4 m = t * s;
  Vec3 p = m.TransformPoint(Vec3(1, 1, 1));
  NF_CHECK_NEAR(p.x, 7.0, 1e-5);
  NF_CHECK_NEAR(p.y, 0.0, 1e-5);
  NF_CHECK_NEAR(p.z, 5.0, 1e-5);

  Mat4 inv = m.Inverse();
  Vec3 back = inv.TransformPoint(p);
  NF_CHECK_NEAR(back.x, 1.0, 1e-4);
  NF_CHECK_NEAR(back.y, 1.0, 1e-4);
  NF_CHECK_NEAR(back.z, 1.0, 1e-4);
}

NF_TEST(Core, QuatRotationRoundTrip) {
  Quat q = Quat::FromEuler(20.0f, 35.0f, -10.0f);   // pitch, yaw, roll
  Vec3 v(0, 0, -1);
  Vec3 fwd = q * v;
  NF_CHECK_NEAR(Length(fwd), 1.0, 1e-4);

  Mat4 m = q.ToMat4();
  Vec3 fwd2 = m.TransformDir(v);
  NF_CHECK_NEAR(fwd.x, fwd2.x, 1e-4);
  NF_CHECK_NEAR(fwd.y, fwd2.y, 1e-4);
  NF_CHECK_NEAR(fwd.z, fwd2.z, 1e-4);

  Quat back = Quat::FromMat4(m);
  Vec3 fwd3 = back * v;
  NF_CHECK_NEAR(fwd.x, fwd3.x, 1e-3);
  NF_CHECK_NEAR(fwd.y, fwd3.y, 1e-3);
  NF_CHECK_NEAR(fwd.z, fwd3.z, 1e-3);

  // inverse rotation undone by conjugate
  Vec3 restored = q.Conjugate() * fwd;
  NF_CHECK_NEAR(restored.z, -1.0, 1e-4);
}

NF_TEST(Core, TransformRoundTrip) {
  Transform t;
  t.position = {3, 1, -4};
  t.rotation = Quat::FromEuler(10, 45, 5);
  t.scale = {2, 3, 4};
  Mat4 m = t.Matrix();
  Transform r = Transform::FromMatrix(m);
  NF_CHECK_NEAR(r.position.x, 3.0, 1e-4);
  NF_CHECK_NEAR(r.position.y, 1.0, 1e-4);
  NF_CHECK_NEAR(r.position.z, -4.0, 1e-4);
  NF_CHECK_NEAR(r.scale.x, 2.0, 1e-4);
  NF_CHECK_NEAR(r.scale.y, 3.0, 1e-4);
  NF_CHECK_NEAR(r.scale.z, 4.0, 1e-4);
  Vec3 probe(1, 1, 1);
  Vec3 a = m.TransformPoint(probe);
  Vec3 b = t.rotation * Vec3(probe.x * t.scale.x, probe.y * t.scale.y, probe.z * t.scale.z) + t.position;
  NF_CHECK_NEAR(a.x, b.x, 1e-4);
  NF_CHECK_NEAR(a.y, b.y, 1e-4);
  NF_CHECK_NEAR(a.z, b.z, 1e-4);
}

NF_TEST(Core, AABBAndRaycast) {
  AABB box = AABB::FromCenterExtents(Vec3(0, 0, 0), Vec3(1, 1, 1));
  Ray r{{0, 0, 5}, {0, 0, -1}};
  f32 t = 0;
  Vec3 n;
  NF_CHECK(RaycastAABB(r, box, &t, &n));
  NF_CHECK_NEAR(t, 4.0, 1e-4);
  NF_CHECK_NEAR(n.z, 1.0, 1e-4);

  Ray miss{{5, 5, 5}, {0, 0, -1}};
  NF_CHECK(!RaycastAABB(miss, box, &t));

  AABB other = AABB::FromCenterExtents(Vec3(1.5f, 0, 0), Vec3(1, 1, 1));
  NF_CHECK(box.Intersects(other));
  NF_CHECK(!box.Intersects(AABB::FromCenterExtents(Vec3(9, 9, 9), Vec3(1, 1, 1))));

  // transformed bounds
  Mat4 m = Mat4::TRS(Vec3(10, 0, 0), Quat::FromEuler(0, 45, 0), Vec3(1, 1, 1));
  AABB world = AABB::Transform(box, m);
  NF_CHECK(world.min.x < 9.0f && world.max.x > 11.0f);
}

NF_TEST(Core, FrustumCulling) {
  Mat4 view = Mat4::LookAt(Vec3(0, 0, 10), Vec3(0, 0, 0), Vec3(0, 1, 0));
  Mat4 proj = Mat4::Perspective(60.0f * kDegToRad, 16.0f / 9.0f, 0.1f, 100.0f);
  Frustum f = Frustum::FromMatrix(proj * view);
  NF_CHECK(f.TestAABB(AABB::FromCenterExtents(Vec3(0, 0, 0), Vec3(1, 1, 1))));
  NF_CHECK(!f.TestAABB(AABB::FromCenterExtents(Vec3(0, 0, 500), Vec3(1, 1, 1))));
  NF_CHECK(!f.TestAABB(AABB::FromCenterExtents(Vec3(500, 0, 0), Vec3(1, 1, 1))));
  NF_CHECK(f.TestSphere(Vec3(0, 0, 0), 1.0f));
}

NF_TEST(Core, JsonRoundTrip) {
  JsonValue root = JsonValue::Object();
  root["name"] = "MyGame";
  root["version"] = 3;
  root["enabled"] = true;
  root["scale"] = 1.5;
  JsonValue arr = JsonValue::Array();
  arr.Push(1); arr.Push(2); arr.Push("three");
  root["items"] = arr;
  JsonValue nested = JsonValue::Object();
  nested["x"] = 1.25;
  root["nested"] = nested;
  root["vector"] = JsonValue::Vec3Json(Vec3(1, 2, 3));

  std::string text = root.Dump();
  std::string err;
  JsonValue parsed = JsonValue::Parse(text, &err);
  NF_CHECK_MSG(err.empty(), err.c_str());
  NF_CHECK(parsed["name"].AsString() == "MyGame");
  NF_CHECK(parsed["version"].AsInt() == 3);
  NF_CHECK(parsed["enabled"].AsBool());
  NF_CHECK_NEAR(parsed["scale"].AsFloat(), 1.5, 1e-6);
  NF_CHECK(parsed["items"].Size() == 3);
  NF_CHECK(parsed["items"][2].AsString() == "three");
  NF_CHECK_NEAR(parsed["nested"]["x"].AsFloat(), 1.25, 1e-6);
  Vec3 v = parsed["vector"].AsVec3();
  NF_CHECK_NEAR(v.y, 2.0, 1e-6);
  NF_CHECK(parsed.Has("items"));
  NF_CHECK(!parsed.Has("missing"));
}

NF_TEST(Core, JsonErrorsAndEdgeCases) {
  std::string err;
  JsonValue bad = JsonValue::Parse("{ \"a\": }", &err);
  NF_CHECK(!err.empty());
  (void)bad;

  err.clear();
  JsonValue bad2 = JsonValue::Parse("[1, 2", &err);
  NF_CHECK(!err.empty());
  (void)bad2;

  JsonValue doc = JsonValue::Parse("// comment\n{\"k\": \"va\\nlue \\u00e9\"}", &err);
  NF_CHECK(err.empty());
  NF_CHECK(doc["k"].AsString()[0] == 'v');

  JsonValue empty = JsonValue::Parse("", &err);
  NF_CHECK(!err.empty());
  (void)empty;

  // numbers / escapes
  JsonValue n = JsonValue::Parse("{\"n\": -12.5e2, \"s\": \"quote\\\"end\"}", &err);
  NF_CHECK_NEAR(n["n"].AsFloat(), -1250.0, 1e-3);
  NF_CHECK(n["s"].AsString() == "quote\"end");
}

NF_TEST(Core, FileSystemBasic) {
  std::string tmp = fs::Join(fs::TempDirectory(), "novaforge_test_dir");
  fs::RemoveRecursive(tmp);
  NF_CHECK(fs::CreateDirectories(fs::Join(tmp, "a/b/c")));
  NF_CHECK(fs::IsDirectory(fs::Join(tmp, "a/b/c")));
  std::string file = fs::Join(tmp, "a/b/c/scene.nfscene");
  NF_CHECK(fs::WriteText(file, "hello world"));
  NF_CHECK(fs::Exists(file));
  NF_CHECK(fs::Extension(file) == "nfscene");
  NF_CHECK(fs::Stem(file) == "scene");
  NF_CHECK(fs::FileName(file) == "scene.nfscene");
  std::string text;
  NF_CHECK(fs::ReadText(file, &text));
  NF_CHECK(text == "hello world");
  auto list = fs::ListFilesWithExtension(tmp, "nfscene", true);
  NF_CHECK(list.size() == 1);
  NF_CHECK(fs::Copy(file, fs::Join(tmp, "copy.nfscene")));
  NF_CHECK(fs::Exists(fs::Join(tmp, "copy.nfscene")));
  fs::RemoveRecursive(tmp);
  NF_CHECK(!fs::Exists(tmp));
}

NF_TEST(Core, StringHelpers) {
  NF_CHECK(SplitString("a,b,c", ',').size() == 3);
  NF_CHECK(SplitString("a.b.c", ".")[1] == "b");
  NF_CHECK(Trim("  x  ") == "x");
  NF_CHECK(ToLower("AbC") == "abc");
  NF_CHECK(StartsWith("NovaForge", "Nova"));
  NF_CHECK(EndsWith("scene.nfscene", ".nfscene"));
  NF_CHECK(ReplaceAll("a-b-c", "-", "+") == "a+b+c");
  NF_CHECK(ToDisplayName("PlayerController") == "Player Controller");
  NF_CHECK(SanitizeIdentifier("create enemy!") == "CreateEnemy");
}

NF_TEST(Core, ThreadPoolRuns) {
  ThreadPool pool(2);
  std::atomic<int> counter{0};
  for (int i = 0; i < 32; i++) pool.Submit([&counter] { counter.fetch_add(1); });
  pool.WaitAll();
  NF_CHECK(counter.load() == 32);
}

NF_TEST(Core, SweepCollision) {
  AABB box = AABB::FromCenterExtents(Vec3(0, 0, 0), Vec3(0.5f, 0.5f, 0.5f));
  AABB wall = AABB::FromCenterExtents(Vec3(3, 0, 0), Vec3(1, 5, 5));
  Vec3 n;
  f32 t = 0;
  bool hit = SweepAABB(box, Vec3(10, 0, 0), wall, &n, &t);
  NF_CHECK(hit);
  if (hit) NF_CHECK_NEAR(n.x, -1.0, 1e-5);

  bool miss = SweepAABB(box, Vec3(0, 10, 0), wall, &n, &t);
  NF_CHECK(!miss);
}
