// AI Vision 4K demo — particle fragment shader (soft additive sprite).
#version 450

layout(location = 0) in vec4 vColour;
layout(location = 1) in vec2 vLocal;
layout(location = 0) out vec4 outColor;

void main() {
    const float radius = length(vLocal);
    if (radius > 1.0) {
        discard;
    }
    const float falloff = pow(1.0 - radius, 2.0);
    // Additive glow: the blending state is set up by the pipeline.
    outColor = vec4(vColour.rgb * falloff * vColour.a, vColour.a * falloff);
}
