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

// uniform float alpha;
varying vec2 v_coords;

uniform vec4 geo;
// uniform vec2 output_size;
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
    float sdf = max(dist.x,0.0) + max(dist.y,0.0) + min(max(dist.x, dist.y), 0.0);
    return 1.0 - smoothstep(radius - 0.5, radius + 0.5, sdf);
}

// 优化3：蓝噪声（Blue Noise）近似
float blue_noise(vec2 uv) {
    // 使用旋转的三角波
    float x = uv.x * 1.61803398875; // 黄金比例
    float y = uv.y * 1.61803398875;

    float noise = sin(x * 12.9898 + y * 78.233) * 43758.5453;
    noise = fract(noise);

    // 添加高频分量
    noise += sin(x * 26.9898 + y * 92.233) * 43758.5453;
    noise = fract(noise) * 0.5 + 0.25; // 限制在[0.25, 0.75]

    return noise - 0.5; // 居中在0
}


void main() {
    vec4 color = texture2D(tex, v_coords);

#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0);
#endif

    // Alpha测试
    float alpha_value = texture2D(alpha_tex, v_coords).a;

    // 圆角
    float radius_flag = step(0.0, corner_radius);  // 更清晰的标志

    // 正确的无分支alpha剔除
    // step(ignore_alpha, alpha_value): 当alpha_value>ignore_alpha时返回1
    float alphaMask = step(ignore_alpha, alpha_value);

    vec2 size = geo.zw;
    vec2 loc = gl_FragCoord.xy - geo.xy;

    // 噪声（只在alpha测试通过时添加）
    float noise_contrib = blue_noise(loc / size) * noise * 0.08;
    color.rgb = mix(color.rgb, color.rgb + noise_contrib, alphaMask);

    float round_alpha = fast_rounding_alpha(loc, size, corner_radius);
    
    color *= round_alpha * radius_flag;
    // color *= alpha;
    color *= alphaMask;

    gl_FragColor = color;
}

// vim: ft=glsl
