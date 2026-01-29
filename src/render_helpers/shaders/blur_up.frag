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
uniform float scale;

void main() {
    vec2 uv = niri_v_coords / scale;
    // if (radius == 0.0) {
    //     gl_FragColor = texture2D(tex, uv);
    //     return;
    // }
    // vec2 offset = half_pixel * radius;
    // vec4 sum = texture2D(tex, uv) * 4.0
    //     + texture2D(tex, uv + vec2(offset.x, 0.0))
    //     + texture2D(tex, uv - vec2(offset.x, 0.0))
    //     + texture2D(tex, uv + vec2(0.0, offset.y))
    //     + texture2D(tex, uv - vec2(0.0, offset.y));

    // gl_FragColor = sum * 0.125;
    gl_FragColor = texture2D(tex, uv);
}
