// Ported from https://github.com/nferhat/fht-compositor/blob/main/src/renderer/shaders/blur-down.frag

precision highp float;

#if defined(EXTERNAL)
#extension GL_OES_EGL_image_external : require
uniform samplerExternalOES tex;
#else
uniform sampler2D tex;
#endif

varying vec2 niri_v_coords;
uniform float radius;
uniform vec2 half_pixel;
uniform float scale;

void main() {
    vec2 uv = niri_v_coords * scale;

    if (radius == 0.0) {
        gl_FragColor = texture2D(tex, uv);
        return;
    }
    // Kawase风格：对角线采样
    vec2 offset = half_pixel * (radius * 0.707 + 0.5); // 调整到对角线

    vec4 sum = texture2D(tex, uv + vec2(-offset.x, -offset.y))
            + texture2D(tex, uv + vec2( offset.x, -offset.y))
            + texture2D(tex, uv + vec2(-offset.x,  offset.y))
            + texture2D(tex, uv + vec2( offset.x,  offset.y));

    gl_FragColor = sum * 0.25;
    // gl_FragColor = texture2D(tex, uv);
}
