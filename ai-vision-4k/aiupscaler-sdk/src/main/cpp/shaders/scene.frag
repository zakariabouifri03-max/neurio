// AI Vision 4K demo — scene fragment shader.
//
// Directional sun + 3x3 PCF shadows + hemispheric ambient + exponential fog.
// Everything is procedural (no texture assets), which keeps the demo scene
// reproducible and lets the reconstruction quality be judged on geometry,
// aliasing and shimmering rather than on photographic content.
#version 450

layout(location = 0) in vec3 vWorldPosition;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec2 vTexCoord;
layout(location = 3) in vec4 vColor;
layout(location = 4) in vec4 vMaterial;
layout(location = 5) in vec4 vLightSpacePosition;
layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform SceneUniforms {
    mat4 viewProjection;
    mat4 lightViewProjection;
    vec4 lightDirection;
    vec4 cameraPosition;
    vec4 fogColor;
    vec4 ambientSky;
    vec4 params;
} ubo;

layout(set = 0, binding = 1) uniform sampler2D uShadowMap;

float sampleShadow(vec3 lightSpace) {
    // lightSpace is already in [0,1] after the perspective divide.
    if (lightSpace.z > 1.0 || lightSpace.x < 0.0 || lightSpace.x > 1.0 ||
        lightSpace.y < 0.0 || lightSpace.y > 1.0) {
        return 1.0;   // outside the light frustum: treat as lit
    }
    const float bias = 0.0015;
    const float texel = ubo.params.z;
    float shadow = 0.0;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            const float depth = texture(uShadowMap, lightSpace.xy + vec2(x, y) * texel).r;
            shadow += (lightSpace.z - bias) <= depth ? 1.0 : 0.0;
        }
    }
    return shadow / 9.0;
}

float proceduralDetail(vec3 worldPosition, vec2 uv) {
    // Cheap value noise: enough to break up flat surfaces so upscaling
    // artefacts (over-sharpening, shimmering) are visible in the comparison.
    const float a = fract(sin(dot(floor(worldPosition.xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    const float b = fract(sin(dot(uv, vec2(39.346, 11.135))) * 24634.6345);
    return mix(a, b, 0.5);
}

void main() {
    const vec3 normal = normalize(vNormal);
    const vec3 viewDirection = normalize(ubo.cameraPosition.xyz - vWorldPosition);
    const vec3 lightDirection = normalize(-ubo.lightDirection.xyz);

    const float diffuse = max(dot(normal, lightDirection), 0.0);
    const vec3 halfVector = normalize(lightDirection + viewDirection);
    const float specularPower = mix(48.0, 8.0, clamp(vMaterial.y, 0.0, 1.0));
    const float specular = pow(max(dot(normal, halfVector), 0.0), specularPower) *
                           (1.0 - clamp(vMaterial.y, 0.0, 1.0)) * 0.35;

    const float shadow = sampleShadow(vLightSpacePosition.xyz / vLightSpacePosition.w);
    const float shadowFactor = mix(1.0, shadow, clamp(ubo.params.y, 0.0, 1.0));

    // Hemispheric ambient: sky colour from above, ground bounce from below.
    const float up = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
    const vec3 ambient = mix(ubo.ambientSky.rgb * ubo.ambientSky.w, ubo.ambientSky.rgb, up);

    // Per-instance albedo, modulated by procedural detail and vertex colour.
    vec3 albedo = vColor.rgb * (0.85 + 0.3 * proceduralDetail(vWorldPosition, vTexCoord));

    // Emissive windows for buildings: a regular grid on the vertical faces.
    if (vMaterial.x > 0.0) {
        const vec2 grid = fract(vec2(vTexCoord.x * 4.0, vTexCoord.y * 6.0));
        const float window = step(0.75, grid.x) * step(0.35, grid.y) * step(grid.y, 0.85);
        const float sign2 = step(0.0, normal.y - 0.5) + step(0.0, -normal.y + 0.5);
        albedo += vMaterial.x * window * (1.0 - sign2) * vec3(1.0, 0.85, 0.55);
    }

    vec3 colour = albedo * (ambient + diffuse * lightDirection.y * shadowFactor) +
                  vec3(specular * shadowFactor);

    // Exponential fog towards the sky colour.
    const float distance = length(ubo.cameraPosition.xyz - vWorldPosition);
    const float fog = 1.0 - exp(-distance * ubo.fogColor.w);
    colour = mix(colour, ubo.fogColor.rgb, clamp(fog, 0.0, 0.9));

    // Gamma-ish tone curve for a calm, "game-like" look.
    colour = pow(clamp(colour, vec3(0.0), vec3(4.0)), vec3(0.4545));
    outColor = vec4(clamp(colour, vec3(0.0), vec3(1.0)), 1.0);
}
