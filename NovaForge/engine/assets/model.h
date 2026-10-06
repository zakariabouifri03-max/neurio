// NovaForge Engine - Model asset (.nfmodel.json) + runtime instances
//
// A Model is what a glTF/OBJ/FBX import produces: a node hierarchy, one or
// more mesh parts, materials, optional skins and animation clips.
// Instances (ModelInstance) hold the per-entity runtime state: node world
// matrices, joint matrices and the currently playing animation.
#pragma once
#include "assets/material.h"
#include "assets/mesh.h"

#include <memory>
#include <string>
#include <vector>

namespace nf {

struct ModelPart {
    std::string name;
    std::shared_ptr<Mesh> mesh;
    std::string meshPath;       // project relative .nfmesh ("" for built-in primitives)
    std::string materialPath;   // project relative .nfmat.json (may be empty)
    // Material per sub-mesh (index = SubMesh::materialIndex). Empty entries
    // fall back to `materialPath`. Imported models with several materials use
    // this, so every sub-mesh can be re-textured independently.
    std::vector<std::string> subMaterialPaths;
    Material inlineMaterial;    // used when materialPath is empty (OBJ/GLB inline)
    int node = -1;              // owning node (-1 = scene root)
    int skin = -1;              // index into Model::skins (-1 = static)
    bool castsShadow = true;
};

struct ModelNode {
    std::string name;
    int parent = -1;
    std::vector<int> children;
    Vec3 translation{0, 0, 0};
    Quat rotation = Quat::identity();
    Vec3 scale{1, 1, 1};
    Mat4 localMatrix() const { return Mat4::trs(translation, rotation, scale); }
};

struct Skin {
    std::string name;
    std::vector<int> joints;
    std::vector<Mat4> inverseBind;
};

struct AnimationChannel {
    enum class Path { Translation, Rotation, Scale } path = Path::Translation;
    int node = -1;
    std::vector<float> times;
    std::vector<Vec4> values;   // xyz used for translation/scale, xyzw for rotation
};

struct AnimationClip {
    std::string name = "Animation";
    float duration = 0.0f;
    std::vector<AnimationChannel> channels;
    bool loop = true;
    bool valid() const { return !channels.empty() && duration > 0.0f; }
};

struct Model {
    std::string path;      // project relative path, or "primitive://Cube"
    std::string name = "Model";
    std::vector<ModelPart> parts;
    std::vector<ModelNode> nodes;
    std::vector<Skin> skins;
    std::vector<AnimationClip> animations;
    AABB bounds;           // in model space (bind pose)
    bool skinned = false;

    int findNode(const std::string& name) const;
    int findClip(const std::string& name) const;
    size_t triangleCount() const;
    void computeBounds();

    bool save(const std::string& path, const std::string& projectRoot) const;
    bool load(const std::string& path, const std::string& projectRoot,
              std::string* error = nullptr);
};

// ---------------------------------------------------------------- runtime
class ModelInstance {
public:
    explicit ModelInstance(std::shared_ptr<Model> model);

    const std::shared_ptr<Model>& model() const { return model_; }
    bool valid() const { return model_ && !model_->parts.empty(); }

    void reset();
    // Recompute node world matrices (call after animation updates).
    void updateTransforms();
    const std::vector<Mat4>& nodeWorld() const { return nodeWorld_; }
    const std::vector<Mat4>& nodeLocal() const { return nodeLocal_; }
    Mat4 partWorld(int partIndex) const;
    // Joint matrices for a skinned part (empty when the part is static).
    const std::vector<Mat4>& jointMatrices(int partIndex);

    // --- animation ---------------------------------------------------
    void play(const std::string& clipName, bool loop = true, float speed = 1.0f);
    void playIndex(int clipIndex, bool loop = true, float speed = 1.0f);
    void stop();
    void update(float dt);
    bool playing() const { return playing_; }
    int currentClip() const { return clipIndex_; }
    float currentTime() const { return time_; }
    float normalizedTime() const;
    bool finished() const { return finished_; }
    void setSpeed(float s) { speed_ = s; }
    float speed() const { return speed_; }

private:
    void sampleClip(float time);

    std::shared_ptr<Model> model_;
    std::vector<Mat4> nodeWorld_, nodeLocal_;
    std::vector<std::vector<Mat4>> jointCache_;
    std::vector<bool> jointCacheValid_;
    int clipIndex_ = -1;
    float time_ = 0, speed_ = 1;
    bool playing_ = false, loop_ = true, finished_ = false;
};

}  // namespace nf
