// Fullscreen triangle. Used by the sky pass and by the presentation pass.
// No vertex buffer: three vertices generated from gl_VertexIndex cover the
// whole viewport with one triangle, which is cheaper than two and avoids the
// diagonal tear a fullscreen quad can show on some tilers.
#version 450

layout(location = 0) out vec2 vUV;

void main() {
    const vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    const vec2 uv = positions[gl_VertexIndex] * 0.5 + 0.5;
    vUV = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(positions[gl_VertexIndex], 0.0, 1.0);
}
