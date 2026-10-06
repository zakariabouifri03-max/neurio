// NovaForge Engine - offline "Cinematic Grade" post pass
//
// This is a *real* image processing pass (contrast curve, warm/cool grade,
// subtle bloom, vignette, optional film grain), not a neural network. It runs
// either on the CPU (software renderer / screenshots / video capture) or as a
// fragment shader in the OpenGL renderer. A neural upscaler was considered
// (see docs/ROADMAP.md) but is out of scope for V1 because it needs a runtime
// inference library and model weights that cannot be verified in this build
// environment - the hook (applyGrade) is where such a network would plug in.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace nf {

struct GradeSettings {
    bool enabled = false;
    float contrast = 1.08f;
    float saturation = 1.05f;
    float warmth = 0.06f;       // + warm, - cool
    float bloom = 0.18f;        // threshold bloom strength
    float bloomThreshold = 0.72f;
    float vignette = 0.22f;
    float grain = 0.0f;         // 0..0.15
    float exposure = 1.0f;
    std::string presetName = "Cinematic";

    static GradeSettings neutral() { return GradeSettings(); }
    static GradeSettings cinematic();
    static GradeSettings bright();
    static GradeSettings noir();
    static GradeSettings warmIsland();
    static GradeSettings fromName(const std::string& name);
    static std::vector<std::string> presetNames();
};

// Applies the grade to an RGBA8 image in place (CPU path).
void applyGrade(std::vector<uint8_t>& rgba, int width, int height, const GradeSettings& s);

}  // namespace nf
