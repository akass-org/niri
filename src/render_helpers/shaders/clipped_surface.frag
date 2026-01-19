#version 100

//_DEFINES_

#if defined(EXTERNAL)
#extension GL_OES_EGL_image_external : require
#endif

precision highp float;

#if defined(EXTERNAL)
uniform samplerExternalOES tex;
#else
uniform sampler2D tex;
#endif

uniform float alpha;
varying vec2 v_coords;

#if defined(DEBUG_FLAGS)
uniform float tint;
#endif

uniform float niri_scale;

uniform vec2 geo_size;
uniform vec4 corner_radius;
uniform mat3 input_to_geo;
uniform float exponent;

/* ================= SDF rounded rect ================= */

float rounding_alpha(vec2 p, vec2 s, vec4 r) {
    // anti-alias
    float aa = 0.5 / niri_scale;

    // 坐标中心化（相对于矩形中心）
    vec2 offset = p - s * 0.5;

    // 四角半径
    float rx = mix(r.x, r.y, step(0.0, offset.x));
    float ry = mix(r.w, r.z, step(0.0, offset.x));
    float rad = mix(rx, ry, step(0.0, offset.y));

    // 局部角落坐标
    vec2 q = abs(offset) - (s * 0.5 - rad);

    // ------------------------
    // FG-squircle 核心公式
    vec2 corner = max(q, 0.0);      // 角落部分
    float dist = pow(pow(corner.x, exponent) + pow(corner.y, exponent), 1.0/exponent) - rad;

    // ------------------------
    // 内部 alpha 修正：中心和边沿
    float inside = min(max(q.x, q.y), 0.0); // q<0 时表示在矩形内部
    dist += inside;

    // 返回 alpha
    return 1.0 - smoothstep(-aa, aa, dist);
}

void main() {
    vec2 geo = (input_to_geo * vec3(v_coords, 1.0)).xy;

    // texture sample
    vec4 color = texture2D(tex, v_coords);

#if defined(NO_ALPHA)
    color.a = 1.0;
#endif

    // clip mask (0 outside, 1 inside)
    float inside =
        step(0.0, geo.x) *
        step(0.0, geo.y) *
        step(geo.x, 1.0) *
        step(geo.y, 1.0);

    // rounded rect alpha
    float round =
        rounding_alpha(geo * geo_size, geo_size, corner_radius);

    color *= inside * round;

    // global alpha
    color *= alpha;

#if defined(DEBUG_FLAGS)
    float dbg = step(0.5, tint);
    color = mix(color, vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8, dbg);
#endif

    gl_FragColor = color;
}
