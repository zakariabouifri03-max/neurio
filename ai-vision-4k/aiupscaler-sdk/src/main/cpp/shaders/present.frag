// AI Vision 4K — presentation pass.
//
// Draws the reconstructed frame to the swapchain. It also implements the
// benchmark's "Native vs AI" comparison view:
//
//   mode 0 : show the enhanced image
//   mode 1 : split screen — native reference left, enhanced right, with a
//            movable split position
//   mode 2 : show the native reference only
//   mode 3 : enhanced image plus a magnifier inset (the pixel-level compare)
#version 450

layout(location = 0) in vec2 vUV;
layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform sampler2D uEnhanced;
layout(set = 0, binding = 1) uniform sampler2D uReference;   // native-resolution render

layout(push_constant) uniform PushConstants {
    vec2 outputSize;
    vec2 invOutputSize;
    float splitPosition;    // 0 = all reference, 1 = all enhanced
    float magnifierScale;   // 1 disables the inset
    vec2 magnifierCentre;   // uv
    uint mode;
    float exposure;
    uint showGrid;
    uint reserved;
} pc;

vec3 sampleEnhanced(vec2 uv) {
    // Nearest sampling on purpose: the comparison screen must show real
    // reconstructed pixels, not a bilinearly smoothed version of them.
    return texture(uEnhanced, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

vec3 sampleReference(vec2 uv) {
    return texture(uReference, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
    vec2 uv = vUV;
    vec3 colour;

    if (pc.mode == 2u) {
        colour = sampleReference(uv);
    } else if (pc.mode == 1u) {
        const float split = clamp(pc.splitPosition, 0.0, 1.0);
        colour = uv.x <= split ? sampleReference(uv) : sampleEnhanced(uv);
        // One pixel wide separator so the split is unambiguous.
        const float distanceToSplit = abs(uv.x - split);
        if (distanceToSplit < 1.5 * pc.invOutputSize.x) {
            colour = vec3(0.13, 0.88, 1.0);
        }
    } else if (pc.mode == 3u && pc.magnifierScale > 1.0) {
        colour = sampleEnhanced(uv);
        const vec2 centre = pc.magnifierCentre == vec2(0.0) ? vec2(0.5) : pc.magnifierCentre;
        const vec2 halfExtent = 0.12 * vec2(1.0, pc.outputSize.x / max(pc.outputSize.y, 1.0));
        const vec2 lower = centre - halfExtent;
        const vec2 upper = centre + halfExtent;
        if (uv.x > lower.x && uv.x < upper.x && uv.y > lower.y && uv.y < upper.y) {
            const vec2 local = (uv - lower) / (upper - lower);
            // Magnified neighbourhood around the centre point.
            const vec2 zoomed = centre + (local - 0.5) * halfExtent / pc.magnifierScale;
            colour = sampleEnhanced(zoomed);
            const float border = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
            if (border < 0.01) {
                colour = vec3(0.13, 0.88, 1.0);
            }
        }
    } else {
        colour = sampleEnhanced(uv);
    }

    if (pc.showGrid != 0u) {
        // Rule-of-thirds overlay used by the comparison screen.
        const vec2 grid = abs(fract(uv * 3.0) - 0.5);
        const float line = min(grid.x, grid.y);
        if (line > 0.495) {
            colour = mix(colour, vec3(0.13, 0.88, 1.0), 0.25);
        }
    }

    outColor = vec4(clamp(colour * pc.exposure, vec3(0.0), vec3(1.0)), 1.0);
}
