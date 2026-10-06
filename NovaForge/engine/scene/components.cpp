#include "scene/components.h"

#include <cstring>

namespace nf {

const char* componentTypeName(ComponentType t) {
    switch (t) {
        case ComponentType::MeshRenderer: return "Mesh Renderer";
        case ComponentType::Camera: return "Camera";
        case ComponentType::Light: return "Light";
        case ComponentType::Collider: return "Collider";
        case ComponentType::RigidBody: return "Rigid Body";
        case ComponentType::Character: return "Character Controller";
        case ComponentType::NPC: return "NPC Brain";
        case ComponentType::Health: return "Health";
        case ComponentType::Trigger: return "Trigger Volume";
        case ComponentType::Interactable: return "Interactable";
        case ComponentType::Door: return "Door";
        case ComponentType::AudioSource: return "Audio Source";
        case ComponentType::Animator: return "Animator";
        case ComponentType::Script: return "Script (Lua)";
        case ComponentType::Particle: return "Particle Burst";
        default: return "Unknown";
    }
}

ComponentType componentTypeFromName(const std::string& n) {
    for (int i = 0; i < (int)ComponentType::Count; ++i) {
        ComponentType t = (ComponentType)i;
        if (n == componentTypeName(t)) return t;
    }
    if (n == "MeshRenderer" || n == "mesh") return ComponentType::MeshRenderer;
    if (n == "RigidBody" || n == "rigidbody" || n == "Physics") return ComponentType::RigidBody;
    if (n == "NPC") return ComponentType::NPC;
    if (n == "Particles") return ComponentType::Particle;
    return ComponentType::Count;
}

}  // namespace nf
