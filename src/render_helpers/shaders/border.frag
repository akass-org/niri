precision highp float;

#if defined(DEBUG_FLAGS)
uniform float niri_tint;
#endif

uniform float niri_alpha;
uniform float niri_scale;

varying vec2 niri_v_coords;

uniform float colorspace;        // 0 srgb, 1 linear, 2 oklab, 3 oklch
uniform float hue_interpolation;
uniform vec4 color_from;
uniform vec4 color_to;
uniform vec2 grad_offset;
uniform float grad_width;
uniform vec2 grad_vec;

uniform mat3 input_to_geo;
uniform vec2 geo_size;
uniform vec4 outer_radius;
uniform float border_width;

/* ================= constants ================= */

const mat3 RGB_TO_LMS = mat3(
    0.4122214708, 0.5363325363, 0.0514459929,
    0.2119034982, 0.6806995451, 0.1073969566,
    0.0883024619, 0.2817188376, 0.6299787005
);

const mat3 LMS_TO_OKLAB = mat3(
    0.2104542553, 0.7936177850, -0.0040720468,
    1.9779984951, -2.4285922050, 0.4505937099,
    0.0259040371, 0.7827717662, -0.8086757660
);

const mat3 OKLAB_TO_LMS = mat3(
    1.0, 0.3963377774, 0.2158037573,
    1.0, -0.1055613458, -0.0638541728,
    1.0, -0.0894841775, -1.2914855480
);

const mat3 LMS_TO_RGB = mat3(
    4.0767416621, -3.3077115913, 0.2309699292,
   -1.2684380046,  2.6097574011, -0.3413193965,
   -0.0041960863, -0.7034186147,  1.7076147010
);

/* ================= utils ================= */

vec4 premul_rect(vec4 c) { c.rgb *= c.a; return c; }
vec4 unpremul_rect(vec4 c) { c.rgb /= max(c.a, 1e-6); return c; }

vec4 premul_lch(vec4 c) { c.xy *= c.a; return c; }
vec4 unpremul_lch(vec4 c) { c.xy /= max(c.a, 1e-6); return c; }

/* fast enough for UI */
vec3 srgb_to_linear(vec3 c) { return c * c; }
vec3 linear_to_srgb(vec3 c) { return sqrt(c); }

/* ================= OKLab ================= */

vec3 linear_to_oklab(vec3 c) {
    vec3 lms = pow(c * RGB_TO_LMS, vec3(1.0 / 3.0));
    return lms * LMS_TO_OKLAB;
}

vec3 oklab_to_linear(vec3 c) {
    vec3 lms = pow(c * OKLAB_TO_LMS, vec3(3.0));
    return lms * LMS_TO_RGB;
}

vec3 lab_to_lch(vec3 c) {
    float C = length(c.yz);
    float H = mod(degrees(atan(c.z, c.y)) + 360.0, 360.0);
    return vec3(c.x, C, H);
}

vec3 lch_to_lab(vec3 c) {
    return vec3(
        c.x,
        c.y * cos(radians(c.z)),
        c.y * sin(radians(c.z))
    );
}

/* ================= color mix (optimized, no branch) ================= */

vec4 color_mix(vec4 a, vec4 b, float t) {
    vec4 srgb = mix(premul_rect(a), premul_rect(b), t);

    vec4 la = vec4(srgb_to_linear(a.rgb), a.a);
    vec4 lb = vec4(srgb_to_linear(b.rgb), b.a);
    vec4 linear = unpremul_rect(mix(premul_rect(la), premul_rect(lb), t));
    linear.rgb = linear_to_srgb(linear.rgb);

    vec4 oa = vec4(linear_to_oklab(la.rgb), a.a);
    vec4 ob = vec4(linear_to_oklab(lb.rgb), b.a);
    vec4 oklab = unpremul_rect(mix(premul_rect(oa), premul_rect(ob), t));
    oklab.rgb = linear_to_srgb(oklab_to_linear(oklab.xyz));

    vec3 lch1 = lab_to_lch(linear_to_oklab(la.rgb));
    vec3 lch2 = lab_to_lch(linear_to_oklab(lb.rgb));

    float dh = mod(lch2.z - lch1.z + 360.0, 360.0);
    float h = lch1.z + mix(dh - 360.0, dh, step(dh, 180.0)) * t;

    vec4 oklch = vec4(
        linear_to_srgb(oklab_to_linear(lch_to_lab(
            vec3(mix(lch1.x, lch2.x, t),
                 mix(lch1.y, lch2.y, t),
                 mod(h, 360.0))
        ))),
        mix(a.a, b.a, t)
    );

    float m0 = step(abs(colorspace - 0.0), 0.5);
    float m1 = step(abs(colorspace - 1.0), 0.5);
    float m2 = step(abs(colorspace - 2.0), 0.5);
    float m3 = step(abs(colorspace - 3.0), 0.5);

    return srgb * m0 + linear * m1 + oklab * m2 + oklch * m3;
}

/* ================= gradient ================= */

vec4 gradient_color(vec2 p) {
    p += grad_offset;

    float flip = step(grad_vec.x * grad_vec.y, 0.0);
    p.x -= grad_width * flip;

    float f = dot(p, grad_vec) / dot(grad_vec, grad_vec);
    f += step(grad_vec.y, 0.0);
    f = clamp(f, 0.0, 1.0);

    return color_mix(color_from, color_to, f);
}

/* ================= rounded rect SDF ================= */

float rounding_alpha(vec2 p, vec2 s, vec4 r) {
    float aa = 0.5 / niri_scale;

    vec2 q = abs(p - s * 0.5) - s * 0.5;

    float rx = mix(r.x, r.y, step(0.0, q.x));
    float ry = mix(r.w, r.z, step(0.0, q.x));
    float rad = mix(rx, ry, step(0.0, q.y));

    float d = length(max(q + rad, 0.0)) - rad;
    return 1.0 - smoothstep(-aa, aa, d);
}

/* ================= main ================= */

void main() {
    vec2 p = (input_to_geo * vec3(niri_v_coords, 1.0)).xy;

    vec4 color = gradient_color(p);

    float outer = rounding_alpha(p, geo_size, outer_radius);

    vec2 ip = p - vec2(border_width);
    vec2 is = geo_size - vec2(border_width * 2.0);
    vec4 ir = max(outer_radius - vec4(border_width), 0.0);

    float inner = rounding_alpha(ip, is, ir);

    float has_border = step(0.0001, border_width);
    float mask = outer * (1.0 - has_border * inner);

    color *= mask * niri_alpha;

#if defined(DEBUG_FLAGS)
    float dbg = step(0.5, niri_tint);
    color = mix(color, vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8, dbg);
#endif

    gl_FragColor = color;
}
