// Ported from https://github.com/nferhat/fht-compositor/blob/main/src/renderer/shaders/blur-finish.frag
//
// Implementation from pinnacle-comp/pinnacle (GPL-3.0)
// Thank you very much!
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

#if defined(EXTERNAL)
uniform samplerExternalOES alpha_tex;
#else
uniform sampler2D alpha_tex;
#endif

uniform float alpha;
varying vec2 v_coords;

uniform vec4 geo;
uniform vec2 output_size;
uniform float corner_radius;
uniform float noise;
uniform float ignore_alpha;

// float rounding_alpha(vec2 coords, vec2 size, float radius) {
//     vec2 center;

//     if (coords.x < radius && coords.y < radius) {
//         center = vec2(radius, radius);
//     } else if (coords.x > size.x - radius && coords.y < radius) {
//         center = vec2(size.x - radius, radius);
//     } else if (coords.x > size.x - radius && coords.y > size.y - radius) {
//         center = vec2(size.x - radius, size.y - radius);
//     } else if (coords.x < radius && coords.y > size.y - radius) {
//         center = vec2(radius, size.y - radius);
//     } else {
//         return 1.0;
//     }

//     float dist = distance(coords, center);
//     float half_px = 0.5 ;
//     return 1.0 - smoothstep(radius - half_px, radius + half_px, dist);
// }
float fast_rounding_alpha(vec2 coords, vec2 size, float radius) {
    // 简化版圆角计算
    vec2 dist = abs(coords - size * 0.5) - size * 0.5 + radius;
    float sdf = length(max(dist, 0.0)) + min(max(dist.x, dist.y), 0.0);
    return 1.0 - smoothstep(radius - 0.5, radius + 0.5, sdf);
}

// Noise function copied from hyprland.
// I like the effect it gave, can be tweaked further
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 727.727); // wysi :wink: :wink:
    p3 += dot(p3, p3.xyz + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec4 color = texture2D(tex, v_coords);

#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0);
#endif

    // Alpha测试（无分支）
    float alpha_value = texture2D(alpha_tex, v_coords).a;
    float ignore_flag = max(sign(ignore_alpha), 0.0);
    float alphaMask = 1.0 - ignore_flag * step(alpha_value, ignore_alpha);

    vec2 size = geo.zw;
    vec2 loc = gl_FragCoord.xy - geo.xy;

    // 噪声（无分支）
    float noiseHash = hash(loc / size);
    float noise_contrib = (mod(noiseHash, 1.0) - 0.5) * noise;
    color.rgb += noise_contrib * max(sign(alphaMask), 0.0);

    // 圆角（无分支）
    float radius_flag = max(sign(corner_radius), 0.0);
    float round_alpha = fast_rounding_alpha(loc, size, corner_radius);
    color.a *= mix(1.0, round_alpha, radius_flag) * alpha * alphaMask;

    gl_FragColor = color;
}

// vim: ft=glsl
