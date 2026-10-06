// AI Vision 4K demo — procedural sky.
//
// Cheap gradient plus a sun disc and a horizon haze band. Written as a
// fullscreen pass with the depth buffer pre-cleared to the far plane, so the
// scene geometry simply draws over it.
#version 450

layout(location = 0) in vec2 vUV;
layout(location = 0) out vec4 outColor;

layout(push_constant) uniform PushConstants {
    vec3 sunDirection;
    float exposure;
    vec3 horizonColor;
    float hazeStrength;
    vec3 zenithColor;
    float time;
} pc;

void main() {
    const float height = clamp(vUV.y, 0.0, 1.0);
    vec3 colour = mix(pc.horizonColor, pc.zenithColor, pow(height, 0.65));

    // Sun glow along the view ray approximated from the screen position: the
    // demo only ever looks at the sun through a simple orbit camera.
    const vec3 viewRay = normalize(vec3(vUV.x * 2.0 - 1.0, (1.0 - height) * 2.0 - 1.0, 1.0));
    const float sunAmount = max(dot(viewRay, normalize(pc.sunDirection)), 0.0);
    colour += vec3(1.0, 0.86, 0.62) * pow(sunAmount, 64.0) * 1.4;
    colour += vec3(1.0, 0.72, 0.45) * pow(sunAmount, 8.0) * 0.18;

    // Horizon haze, so distant terrain fades into the sky instead of ending.
    const float haze = exp(-height * 12.0) * pc.hazeStrength;
    colour = mix(colour, pc.horizonColor, clamp(haze, 0.0, 0.7));

    // A subtle slow drift keeps the frame provably live (no frozen image can
    // be mistaken for a working benchmark run).
    colour += vec3(0.02) * sin(pc.time * 0.4 + vUV.x * 6.2831);

    outColor = vec4(clamp(colour * pc.exposure, vec3(0.0), vec3(1.0)), 1.0);
}
