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

/* ================= SDF rounded rect ================= */

float rounding_alpha(vec2 p, vec2 size) {
    float aa = 0.5 / niri_scale;

    // center-based SDF (IQ style, asymmetric radius)
    vec2 q = abs(p - size * 0.5) - size * 0.5;

    float rx = mix(corner_radius.x, corner_radius.y, step(0.0, q.x));
    float ry = mix(corner_radius.w, corner_radius.z, step(0.0, q.x));
    float r  = mix(rx, ry, step(0.0, q.y));

    float d = length(max(q + r, 0.0)) - r;
    return 1.0 - smoothstep(-aa, aa, d);
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
        rounding_alpha(geo * geo_size, geo_size);

    color *= inside * round;

    // global alpha
    color *= alpha;

#if defined(DEBUG_FLAGS)
    float dbg = step(0.5, tint);
    color = mix(color, vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8, dbg);
#endif

    gl_FragColor = color;
}
