// Ported from https://github.com/nferhat/fht-compositor/blob/main/src/renderer/shaders/blur-up.frag

precision highp float;

#if defined(EXTERNAL)
#extension GL_OES_EGL_image_external : require
uniform samplerExternalOES tex;
#else
uniform sampler2D tex;
#endif

varying vec2 niri_v_coords;
uniform vec2 half_pixel;
uniform float radius;

void main() {
    vec2 uv = niri_v_coords / 2.0;
    vec2 offset = half_pixel * radius;
    vec4 center = texture2D(tex, uv);
    vec4 horizontal = texture2D(tex, uv + vec2(offset.x, 0.0));
    horizontal += texture2D(tex, uv + vec2(-offset.x, 0.0));
    vec4 vertical = texture2D(tex, uv + vec2(0.0, offset.y));
    vertical += texture2D(tex, uv + vec2(0.0, -offset.y));

    // 4次采样：中心 + 水平平均 + 垂直平均
    gl_FragColor = (center * 2.0 + horizontal + vertical) / 6.0;
}
