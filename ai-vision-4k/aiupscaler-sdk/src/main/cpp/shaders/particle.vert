// AI Vision 4K demo — particle vertex shader.
//
// Particles live in a storage buffer and are simulated on the GPU by
// particle_sim.comp; this shader expands each one into a camera facing quad.
#version 450

layout(location = 0) in vec2 aCorner;   // quad corner in [-1,1]

struct Particle {
    vec4 positionSize;   // xyz world position, w size
    vec4 colourLife;     // rgb colour, a life in [0,1]
    vec4 velocity;       // xyz velocity, w reserved
};

layout(std430, binding = 0) readonly buffer Particles {
    Particle particles[];
};

layout(set = 0, binding = 0) uniform SceneUniforms {
    mat4 viewProjection;
    mat4 lightViewProjection;
    vec4 lightDirection;
    vec4 cameraPosition;
    vec4 fogColor;
    vec4 ambientSky;
    vec4 params;
} ubo;

layout(location = 0) out vec4 vColour;
layout(location = 1) out vec2 vLocal;

void main() {
    const Particle p = particles[gl_InstanceIndex];
    const vec3 toCamera = normalize(ubo.cameraPosition.xyz - p.positionSize.xyz);
    const vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCamera));
    const vec3 up = cross(toCamera, right);

    const float size = p.positionSize.w;
    const vec3 worldPosition = p.positionSize.xyz + (right * aCorner.x + up * aCorner.y) * size;

    // Fade in at birth and out at death.
    const float life = clamp(p.colourLife.a, 0.0, 1.0);
    const float fade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));

    vColour = vec4(p.colourLife.rgb, fade);
    vLocal = aCorner;
    gl_Position = ubo.viewProjection * vec4(worldPosition, 1.0);
}
