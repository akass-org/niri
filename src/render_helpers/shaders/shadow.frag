precision highp float;

#if defined(DEBUG_FLAGS)
uniform float niri_tint;
#endif

uniform float niri_alpha;
uniform float niri_scale;

varying vec2 niri_v_coords;

uniform vec4 shadow_color;
uniform float sigma;

uniform mat3 input_to_geo;
uniform vec2 geo_size;
uniform vec4 corner_radius;

uniform mat3 window_input_to_geo;
uniform vec2 window_geo_size;
uniform vec4 window_corner_radius;
uniform float exponent;

/* ================= math ================= */

float erf_approx(float x) {
    float s = sign(x);
    x = abs(x);
    float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * x * x) * x) * x;
    t *= t;
    return s - s / (t * t);
}

/* ================= SDF rounded rect ================= */

float sdRoundRect(vec2 p, vec2 size, vec4 r) {
    vec2 h = size * 0.5;
    vec2 offset = p - h;

    // 四角半径选择（与你最早的版本完全一致）
    float rx = mix(r.x, r.y, step(0.0, offset.x));
    float ry = mix(r.w, r.z, step(0.0, offset.x));
    float rad = mix(rx, ry, step(0.0, offset.y));

    // 局部角坐标
    vec2 q = abs(offset) - (h - rad);

    // -------- 超椭圆（FG-squircle）--------
    vec2 corner = max(q, 0.0);

    float dist =
        pow(
            pow(corner.x, exponent) +
            pow(corner.y, exponent),
            1.0 / exponent
        ) - rad;

    // inside 修正（保持 signed distance 语义）
    dist += min(max(q.x, q.y), 0.0);

    return dist;
}

/* ================= coverage ================= */

float rounding_alpha(vec2 p, vec2 size, vec4 r) {
    float aa = 0.5 / niri_scale;
    float d = sdRoundRect(p, size, r);
    return 1.0 - smoothstep(-aa, aa, d);
}

/* ================= shadow (CORRECT MODEL) ================= */
/* coverage blur == Gaussian CDF */

float shadow_alpha(vec2 p, vec2 size, vec4 r, float sigma) {
    float d = sdRoundRect(p, size, r);
    float s = max(sigma, 1e-4);
    return 0.5 * (1.0 - erf_approx(d / (sqrt(2.0) * s)));
}

void main() {
    vec2 geo = (input_to_geo * vec3(niri_v_coords, 1.0)).xy;
    vec2 win = (window_input_to_geo * vec3(niri_v_coords, 1.0)).xy;

    vec4 color = shadow_color;

    /* ===== solid vs blur ===== */

    float solid = rounding_alpha(geo, geo_size, corner_radius);
    float blur  = shadow_alpha(geo, geo_size, corner_radius, sigma);

    float use_blur = step(0.1, sigma);
    float shadow = mix(solid, blur, use_blur);

    color *= shadow;

    /* ===== window cutout (coverage-correct) ===== */

    float win_inside =
        step(0.0, win.x) *
        step(0.0, win.y) *
        step(win.x, window_geo_size.x) *
        step(win.y, window_geo_size.y);

    float win_cov = rounding_alpha(win, window_geo_size, window_corner_radius);

    color *= (1.0 - win_inside * win_cov);

    /* ===== final ===== */

    color *= niri_alpha;

#if defined(DEBUG_FLAGS)
    float dbg = step(0.5, niri_tint);
    color = mix(color, vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8, dbg);
#endif

    gl_FragColor = color;
}
