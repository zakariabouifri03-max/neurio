#include "assets/model.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/json.h"
#include "core/log.h"

namespace nf {

int Model::findNode(const std::string& n) const {
    for (size_t i = 0; i < nodes.size(); ++i)
        if (nodes[i].name == n) return (int)i;
    return -1;
}

int Model::findClip(const std::string& n) const {
    for (size_t i = 0; i < animations.size(); ++i)
        if (animations[i].name == n) return (int)i;
    return -1;
}

size_t Model::triangleCount() const {
    size_t t = 0;
    for (auto& p : parts)
        if (p.mesh) t += p.mesh->triangleCount();
    return t;
}

void Model::computeBounds() {
    bounds = AABB();
    for (auto& p : parts) {
        if (!p.mesh) continue;
        AABB b = p.mesh->bounds;
        if (p.node >= 0 && p.node < (int)nodes.size()) {
            // walk up the hierarchy to build the bind pose world matrix
            Mat4 m;
            int cur = p.node;
            std::vector<int> chain;
            int guard = 0;
            while (cur >= 0 && cur < (int)nodes.size() && guard++ < 512) {
                chain.push_back(cur);
                cur = nodes[cur].parent;
            }
            for (auto it = chain.rbegin(); it != chain.rend(); ++it)
                m = m * nodes[*it].localMatrix();
            b = transformAABB(b, m);
        }
        bounds.expand(b);
    }
    if (!bounds.valid()) bounds.expand(Vec3(0, 0, 0));
}

// ---------------------------------------------------------------- save/load
static Json vec3Json(const Vec3& v) {
    Json j = Json::array();
    j.push(v.x); j.push(v.y); j.push(v.z);
    return j;
}
static Json vec4Json(const Vec4& v) {
    Json j = Json::array();
    j.push(v.x); j.push(v.y); j.push(v.z); j.push(v.w);
    return j;
}
static Vec3 vec3Of(const Json& j, const Vec3& d = Vec3(0, 0, 0)) {
    if (!j.isArray() || j.size() < 3) return d;
    return Vec3(j[0].asFloat(d.x), j[1].asFloat(d.y), j[2].asFloat(d.z));
}

bool Model::save(const std::string& path, const std::string& projectRoot) const {
    Json root = Json::object();
    root.set("format", "NovaForgeModel");
    root.set("version", 1);
    root.set("name", name);
    root.set("skinned", skinned);
    Json& b = root.arrayAt("bounds");
    b.push(bounds.min.x); b.push(bounds.min.y); b.push(bounds.min.z);
    b.push(bounds.max.x); b.push(bounds.max.y); b.push(bounds.max.z);

    Json& partsArr = root.arrayAt("parts");
    for (const ModelPart& p : parts) {
        Json jp = Json::object();
        jp.set("name", p.name);
        jp.set("mesh", p.meshPath);
        jp.set("material", p.materialPath);
        if (!p.subMaterialPaths.empty()) {
            Json& sm = jp.arrayAt("subMaterials");
            for (const std::string& sp : p.subMaterialPaths) sm.push(sp);
        }
        jp.set("node", p.node);
        jp.set("skin", p.skin);
        jp.set("castShadow", p.castsShadow);
        if (p.materialPath.empty())
            jp.set("inlineMaterial", p.inlineMaterial.toJson());
        partsArr.push(jp);
    }
    Json& nodesArr = root.arrayAt("nodes");
    for (const ModelNode& n : nodes) {
        Json jn = Json::object();
        jn.set("name", n.name);
        jn.set("parent", n.parent);
        jn.set("translation", vec3Json(n.translation));
        jn.set("rotation", vec4Json(Vec4(n.rotation.x, n.rotation.y, n.rotation.z, n.rotation.w)));
        jn.set("scale", vec3Json(n.scale));
        if (!n.children.empty()) {
            Json& ch = jn.arrayAt("children");
            for (int c : n.children) ch.push(c);
        }
        nodesArr.push(jn);
    }
    Json& skinsArr = root.arrayAt("skins");
    for (const Skin& s : skins) {
        Json js = Json::object();
        js.set("name", s.name);
        Json& jn = js.arrayAt("joints");
        for (int j : s.joints) jn.push(j);
        Json& ib = js.arrayAt("inverseBind");
        for (const Mat4& m : s.inverseBind) {
            Json jm = Json::array();
            for (int k = 0; k < 16; ++k) jm.push(m.m[k]);
            ib.push(jm);
        }
        skinsArr.push(js);
    }
    Json& anims = root.arrayAt("animations");
    for (const AnimationClip& clip : animations) {
        Json jc = Json::object();
        jc.set("name", clip.name);
        jc.set("duration", clip.duration);
        jc.set("loop", clip.loop);
        Json& chans = jc.arrayAt("channels");
        for (const AnimationChannel& ch : clip.channels) {
            Json jch = Json::object();
            jch.set("node", ch.node);
            jch.set("path", ch.path == AnimationChannel::Path::Translation ? "translation"
                            : ch.path == AnimationChannel::Path::Scale ? "scale"
                                                                       : "rotation");
            Json& times = jch.arrayAt("times");
            for (float t : ch.times) times.push(t);
            Json& vals = jch.arrayAt("values");
            for (const Vec4& v : ch.values) vals.push(vec4Json(v));
            chans.push(jch);
        }
        anims.push(jc);
    }
    (void)projectRoot;   // mesh/material paths are already project relative
    return root.saveFile(path, 2);
}

bool Model::load(const std::string& path, const std::string& projectRoot, std::string* error) {
    Json root;
    std::string err;
    if (!Json::parseFile(path, root, &err)) {
        if (error) *error = err;
        NF_LOG_ERROR("Assets", "Unable to load model '%s'\n  Reason: %s", path.c_str(), err.c_str());
        return false;
    }
    this->path = path;
    name = root["name"].asString(fs::stem(path));
    skinned = root["skinned"].asBool(false);
    if (root.has("bounds") && root["bounds"].size() >= 6) {
        const Json& b = root["bounds"];
        bounds.min = Vec3(b[0].asFloat(), b[1].asFloat(), b[2].asFloat());
        bounds.max = Vec3(b[3].asFloat(), b[4].asFloat(), b[5].asFloat());
    }
    parts.clear();
    for (const Json& jp : root["parts"].items()) {
        ModelPart p;
        p.name = jp["name"].asString("Part");
        p.meshPath = jp["mesh"].asString("");
        p.materialPath = jp["material"].asString("");
        for (const Json& sm : jp["subMaterials"].items()) p.subMaterialPaths.push_back(sm.asString());
        p.node = jp["node"].asInt(-1);
        p.skin = jp["skin"].asInt(-1);
        p.castsShadow = jp["castShadow"].asBool(true);
        if (jp.has("inlineMaterial"))
            p.inlineMaterial = Material::fromJson(jp["inlineMaterial"], p.name);
        p.mesh = std::make_shared<Mesh>();
        if (!p.meshPath.empty()) {
            std::string full = fs::isAbsolute(p.meshPath) ? p.meshPath : fs::join(projectRoot, p.meshPath);
            std::string merr;
            if (!p.mesh->load(full, &merr)) {
                NF_LOG_ERROR("Assets",
                             "Unable to load mesh '%s' of model '%s'\n  Reason: %s",
                             p.meshPath.c_str(), path.c_str(), merr.c_str());
                continue;
            }
        } else {
            // built-in primitive parts keep their in-memory geometry
            *p.mesh = primitives::cube(1.0f);
        }
        parts.push_back(p);
    }
    nodes.clear();
    for (const Json& jn : root["nodes"].items()) {
        ModelNode n;
        n.name = jn["name"].asString("Node");
        n.parent = jn["parent"].asInt(-1);
        n.translation = vec3Of(jn["translation"]);
        if (jn.has("rotation") && jn["rotation"].size() >= 4) {
            const Json& q = jn["rotation"];
            n.rotation = Quat(q[0].asFloat(), q[1].asFloat(), q[2].asFloat(), q[3].asFloat(1.0f));
        }
        n.scale = vec3Of(jn["scale"], Vec3(1, 1, 1));
        nodes.push_back(n);
    }
    for (size_t i = 0; i < nodes.size(); ++i) {
        if (nodes[i].parent >= 0 && nodes[i].parent < (int)nodes.size())
            nodes[nodes[i].parent].children.push_back((int)i);
    }
    skins.clear();
    for (const Json& js : root["skins"].items()) {
        Skin s;
        s.name = js["name"].asString("Skin");
        for (const Json& j : js["joints"].items()) s.joints.push_back(j.asInt());
        for (const Json& jm : js["inverseBind"].items()) {
            Mat4 m;
            for (int k = 0; k < 16 && k < (int)jm.size(); ++k) m.m[k] = jm[k].asFloat(k == 0 || k == 5 || k == 10 || k == 15 ? 1.0f : 0.0f);
            s.inverseBind.push_back(m);
        }
        skins.push_back(s);
    }
    animations.clear();
    for (const Json& jc : root["animations"].items()) {
        AnimationClip clip;
        clip.name = jc["name"].asString("Animation");
        clip.duration = jc["duration"].asFloat(0.0f);
        clip.loop = jc["loop"].asBool(true);
        for (const Json& jch : jc["channels"].items()) {
            AnimationChannel ch;
            ch.node = jch["node"].asInt(-1);
            std::string p = jch["path"].asString("translation");
            ch.path = p == "rotation" ? AnimationChannel::Path::Rotation
                    : p == "scale" ? AnimationChannel::Path::Scale
                                   : AnimationChannel::Path::Translation;
            for (const Json& t : jch["times"].items()) ch.times.push_back(t.asFloat());
            for (const Json& v : jch["values"].items()) {
                if (v.size() >= 4)
                    ch.values.push_back(Vec4(v[0].asFloat(), v[1].asFloat(), v[2].asFloat(),
                                             v[3].asFloat()));
                else if (v.size() >= 3)
                    ch.values.push_back(Vec4(v[0].asFloat(), v[1].asFloat(), v[2].asFloat(), 0));
            }
            clip.channels.push_back(std::move(ch));
        }
        animations.push_back(std::move(clip));
    }
    if (!bounds.valid()) computeBounds();
    return true;
}

// ---------------------------------------------------------------- instance
ModelInstance::ModelInstance(std::shared_ptr<Model> model) : model_(std::move(model)) { reset(); }

void ModelInstance::reset() {
    if (!model_) return;
    nodeLocal_.resize(model_->nodes.size());
    nodeWorld_.resize(model_->nodes.size());
    for (size_t i = 0; i < model_->nodes.size(); ++i) nodeLocal_[i] = model_->nodes[i].localMatrix();
    updateTransforms();
    jointCache_.assign(model_->parts.size(), {});
    jointCacheValid_.assign(model_->parts.size(), false);
    clipIndex_ = -1;
    time_ = 0;
    playing_ = false;
    finished_ = false;
}

void ModelInstance::updateTransforms() {
    if (!model_) return;
    if (nodeLocal_.size() != model_->nodes.size()) nodeLocal_.resize(model_->nodes.size());
    if (nodeWorld_.size() != model_->nodes.size()) nodeWorld_.resize(model_->nodes.size());
    for (size_t i = 0; i < model_->nodes.size(); ++i) {
        if (nodeLocal_[i].m[15] == 0.0f) nodeLocal_[i] = model_->nodes[i].localMatrix();
        int parent = model_->nodes[i].parent;
        nodeWorld_[i] = (parent >= 0 && parent < (int)nodeWorld_.size())
                            ? nodeWorld_[parent] * nodeLocal_[i]
                            : nodeLocal_[i];
    }
    for (size_t i = 0; i < jointCacheValid_.size(); ++i) jointCacheValid_[i] = false;
}

Mat4 ModelInstance::partWorld(int partIndex) const {
    if (!model_ || partIndex < 0 || partIndex >= (int)model_->parts.size()) return Mat4();
    int node = model_->parts[partIndex].node;
    if (node >= 0 && node < (int)nodeWorld_.size()) return nodeWorld_[node];
    return Mat4();
}

const std::vector<Mat4>& ModelInstance::jointMatrices(int partIndex) {
    static const std::vector<Mat4> empty;
    if (!model_ || partIndex < 0 || partIndex >= (int)model_->parts.size()) return empty;
    const ModelPart& part = model_->parts[partIndex];
    if (part.skin < 0 || part.skin >= (int)model_->skins.size()) return empty;
    if (partIndex < (int)jointCacheValid_.size() && jointCacheValid_[partIndex])
        return jointCache_[partIndex];
    const Skin& skin = model_->skins[part.skin];
    std::vector<Mat4>& out = jointCache_[partIndex];
    out.resize(skin.joints.size());
    for (size_t j = 0; j < skin.joints.size(); ++j) {
        int node = skin.joints[j];
        Mat4 world = (node >= 0 && node < (int)nodeWorld_.size()) ? nodeWorld_[node] : Mat4();
        Mat4 inv = (j < skin.inverseBind.size()) ? skin.inverseBind[j] : Mat4();
        out[j] = world * inv;
    }
    jointCacheValid_[partIndex] = true;
    return out;
}

void ModelInstance::play(const std::string& clipName, bool loop, float speed) {
    if (!model_) return;
    int idx = model_->findClip(clipName);
    if (idx < 0) {
        // fall back to the first clip so a renamed animation still plays
        idx = model_->animations.empty() ? -1 : 0;
    }
    playIndex(idx, loop, speed);
}

void ModelInstance::playIndex(int clipIndex, bool loop, float speed) {
    if (!model_ || clipIndex < 0 || clipIndex >= (int)model_->animations.size()) {
        stop();
        return;
    }
    clipIndex_ = clipIndex;
    time_ = 0;
    loop_ = loop;
    speed_ = speed;
    playing_ = true;
    finished_ = false;
    sampleClip(0.0f);
    updateTransforms();
}

void ModelInstance::stop() {
    playing_ = false;
    clipIndex_ = -1;
    if (model_) {
        for (size_t i = 0; i < model_->nodes.size(); ++i) nodeLocal_[i] = model_->nodes[i].localMatrix();
        updateTransforms();
    }
}

float ModelInstance::normalizedTime() const {
    if (!model_ || clipIndex_ < 0 || clipIndex_ >= (int)model_->animations.size()) return 0.0f;
    float d = model_->animations[clipIndex_].duration;
    return d > 0.0001f ? clampf(time_ / d, 0.0f, 1.0f) : 0.0f;
}

void ModelInstance::update(float dt) {
    if (!playing_ || !model_ || clipIndex_ < 0) return;
    const AnimationClip& clip = model_->animations[clipIndex_];
    if (!clip.valid()) return;
    time_ += dt * speed_;
    if (time_ >= clip.duration) {
        if (loop_) {
            time_ = std::fmod(time_, clip.duration);
        } else {
            time_ = clip.duration;
            playing_ = false;
            finished_ = true;
        }
    } else if (time_ < 0) {
        time_ = loop_ ? clip.duration + std::fmod(time_, clip.duration) : 0.0f;
    }
    sampleClip(time_);
    updateTransforms();
}

void ModelInstance::sampleClip(float time) {
    const AnimationClip& clip = model_->animations[clipIndex_];
    for (const AnimationChannel& ch : clip.channels) {
        if (ch.node < 0 || ch.node >= (int)nodeLocal_.size() || ch.times.empty()) continue;
        // find the surrounding keyframes
        size_t i1 = 0;
        while (i1 < ch.times.size() && ch.times[i1] < time) ++i1;
        size_t i0 = i1 > 0 ? i1 - 1 : 0;
        if (i1 >= ch.times.size()) i1 = ch.times.size() - 1;
        float t0 = ch.times[i0], t1 = ch.times[i1];
        float alpha = (t1 - t0) > 1e-6f ? clampf((time - t0) / (t1 - t0), 0.0f, 1.0f) : 0.0f;
        Vec4 v0 = ch.values[std::min(i0, ch.values.size() - 1)];
        Vec4 v1 = ch.values[std::min(i1, ch.values.size() - 1)];
        Vec4 v(v0.x + (v1.x - v0.x) * alpha, v0.y + (v1.y - v0.y) * alpha,
              v0.z + (v1.z - v0.z) * alpha, v0.w + (v1.w - v0.w) * alpha);
        switch (ch.path) {
            case AnimationChannel::Path::Translation:
                nodeLocal_[ch.node].at(3, 0) = v.x;
                nodeLocal_[ch.node].at(3, 1) = v.y;
                nodeLocal_[ch.node].at(3, 2) = v.z;
                break;
            case AnimationChannel::Path::Scale:
                nodeLocal_[ch.node].at(0, 0) = v.x;
                nodeLocal_[ch.node].at(1, 1) = v.y;
                nodeLocal_[ch.node].at(2, 2) = v.z;
                break;
            case AnimationChannel::Path::Rotation: {
                Quat q0(v0.x, v0.y, v0.z, v0.w);
                Quat q1(v1.x, v1.y, v1.z, v1.w);
                Quat q = slerp(q0, q1, alpha);
                Vec3 t(nodeLocal_[ch.node].at(3, 0), nodeLocal_[ch.node].at(3, 1),
                       nodeLocal_[ch.node].at(3, 2));
                Vec3 s(nodeLocal_[ch.node].at(0, 0), nodeLocal_[ch.node].at(1, 1),
                       nodeLocal_[ch.node].at(2, 2));
                nodeLocal_[ch.node] = Mat4::trs(t, q, s);
                break;
            }
        }
    }
}

}  // namespace nf
