// AI Vision 4K demo — scene vertex shader (terrain, buildings, moving objects).
//
// Instanced: one mesh, many objects. The instance transform arrives as four
// vec4 attributes (locations 3..6) instead of a UBO array so the demo works
// within the 128 byte push constant limit of older drivers.
#version 450

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

layout(location = 3) in vec4 aInstanceRow0;
layout(location = 4) in vec4 aInstanceRow1;
layout(location = 5) in vec4 aInstanceRow2;
layout(location = 6) in vec4 aInstanceRow3;
layout(location = 7) in vec4 aInstanceColor;
layout(location = 8) in vec4 aInstanceMaterial;   // x emissive, y roughness, z uvScale, w flags

layout(set = 0, binding = 0) uniform SceneUniforms {
    mat4 viewProjection;
    mat4 lightViewProjection;
    vec4 lightDirection;      // xyz direction, w intensity
    vec4 cameraPosition;
    vec4 fogColor;            // rgb, w density
    vec4 ambientSky;          // rgb, w ground bounce
    vec4 params;              // x time, y shadow strength, z shadow texel, w unused
} ubo;

// The shadow pass reuses this shader with SHADOW_PASS defined; the only
// difference is that it writes light space positions instead of view positions.
#ifndef SHADOW_PASS
layout(location = 0) out vec3 vWorldPosition;
layout(location = 1) out vec3 vNormal;
layout(location = 2) out vec2 vTexCoord;
layout(location = 3) out vec4 vColor;
layout(location = 4) out vec4 vMaterial;
layout(location = 5) out vec4 vLightSpacePosition;
#endif

void main() {
    const mat4 instanceTransform = mat4(aInstanceRow0, aInstanceRow1, aInstanceRow2, aInstanceRow3);
    const vec4 worldPosition = instanceTransform * vec4(aPosition, 1.0);
    const vec3 worldNormal = normalize(mat3(instanceTransform) * aNormal);

#ifdef SHADOW_PASS
    gl_Position = ubo.lightViewProjection * worldPosition;
#else
    vWorldPosition = worldPosition.xyz;
    vNormal = worldNormal;
    vTexCoord = aTexCoord * aInstanceMaterial.z;
    vColor = aInstanceColor;
    vMaterial = aInstanceMaterial;
    vLightSpacePosition = ubo.lightViewProjection * worldPosition;
    gl_Position = ubo.viewProjection * worldPosition;
#endif
}
