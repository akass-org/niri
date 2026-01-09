precision highp float;

#if defined(DEBUG_FLAGS)
uniform float niri_tint;
#endif

uniform float niri_alpha;
uniform float niri_scale;

uniform vec2 niri_size;
varying vec2 niri_v_coords;

uniform vec4 shadow_color;
uniform float sigma;

uniform mat3 input_to_geo;
uniform vec2 geo_size;
uniform vec4 corner_radius;

uniform mat3 window_input_to_geo;
uniform vec2 window_geo_size;
uniform vec4 window_corner_radius;

/* ================= math ================= */

vec2 erf_approx(vec2 x) {
    vec2 s = sign(x);
    vec2 a = abs(x);
    vec2 t = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    t *= t;
    return s - s / (t * t);
}

/* ================= rounded SDF ================= */

float rounding_alpha(vec2 p, vec2 size, vec4 r) {
    float aa = 0.5 / niri_scale;

    vec2 q = abs(p - size * 0.5) - size * 0.5;

    float rx = mix(r.x, r.y, step(0.0, q.x));
    float ry = mix(r.w, r.z, step(0.0, q.x));
    float cr = mix(rx, ry, step(0.0, q.y));

    float d = length(max(q + cr, 0.0)) - cr;
    return 1.0 - smoothstep(-aa, aa, d);
}

/* ================= optimized shadow ================= */

float roundedBoxShadowFast(vec2 size, vec2 p, float sigma, float corner) {
    vec2 halfSize = size * 0.5;
    p -= halfSize;

    float delta = min(halfSize.y - corner - abs(p.y), 0.0);
    float curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));

    float k = sqrt(0.5) / max(sigma, 1e-4);
    vec2 integral = 0.5 + 0.5 * erf_approx((p.x + vec2(-curved, curved)) * k);
    float xShadow = integral.y - integral.x;

    // 2-sample vertical integration
    float y0 = -sigma;
    float y1 =  sigma;
    float g0 = exp(-0.5);
    float g1 = g0;

    return xShadow * (g0 + g1) * 0.5;
}

void main() {
    vec2 geo = (input_to_geo * vec3(niri_v_coords, 1.0)).xy;
    vec2 win = (window_input_to_geo * vec3(niri_v_coords, 1.0)).xy;

    vec4 color = shadow_color;

    // shadow vs solid rounded rect
    float solid = rounding_alpha(geo, geo_size, corner_radius);
    float blur  = roundedBoxShadowFast(geo_size, geo, sigma, corner_radius.x);

    float blur_mask = step(0.1, sigma);
    float shadow = mix(solid, blur, blur_mask);

    color *= shadow;

    /* ===== window cutout ===== */

    float win_inside =
        step(0.0, win.x) *
        step(0.0, win.y) *
        step(win.x, window_geo_size.x) *
        step(win.y, window_geo_size.y);

    float win_round =
        rounding_alpha(win, window_geo_size, window_corner_radius);

    float cutout = win_inside * win_round;
    color *= (1.0 - cutout);

    /* ===== final alpha ===== */

    color *= niri_alpha;

#if defined(DEBUG_FLAGS)
    float dbg = step(0.5, niri_tint);
    color = mix(color, vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8, dbg);
#endif

    gl_FragColor = color;
}
