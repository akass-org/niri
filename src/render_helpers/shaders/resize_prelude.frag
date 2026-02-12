precision highp float;

#if defined(DEBUG_FLAGS)
uniform float niri_tint;
#endif

varying vec2 niri_v_coords;
uniform vec2 niri_size;

uniform mat3 niri_input_to_curr_geo;
uniform mat3 niri_curr_geo_to_prev_geo;
uniform mat3 niri_curr_geo_to_next_geo;
uniform vec2 niri_curr_geo_size;

uniform sampler2D niri_tex_prev;
uniform mat3 niri_geo_to_tex_prev;

uniform sampler2D niri_tex_next;
uniform mat3 niri_geo_to_tex_next;

uniform float niri_progress;
uniform float niri_clamped_progress;

uniform vec4 niri_corner_radius;
uniform float niri_clip_to_geometry;

uniform float niri_alpha;
uniform float niri_scale;
uniform float exponent;

float niri_rounding_alpha(vec2 p, vec2 s) {
    // anti-alias
    float aa = 0.5 / niri_scale;

    // 坐标中心化（相对于矩形中心）
    vec2 offset = p - s * 0.5;

    // 四角半径
    float rx = mix(niri_corner_radius.x, niri_corner_radius.y, step(0.0, offset.x));
    float ry = mix(niri_corner_radius.w, niri_corner_radius.z, step(0.0, offset.x));
    float rad = mix(rx, ry, step(0.0, offset.y));

    // 局部角落坐标
    vec2 q = abs(offset) - (s * 0.5 - rad);

    // ------------------------
    // FG-squircle 核心公式
    vec2 corner = max(q, 0.0);      // 角落部分
    float dist = pow(pow(corner.x, exponent) + pow(corner.y, exponent), 1.0 / exponent) - rad;

    // ------------------------
    // 内部 alpha 修正：中心和边沿
    float inside = min(max(q.x, q.y), 0.0); // q<0 时表示在矩形内部
    dist += inside;

    // 返回 alpha
    return 1.0 - smoothstep(-aa, aa, dist);
}
