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
    
    // 原版：8次采样
    // 优化：使用对称性减少采样次数
    vec4 sum = vec4(0.0);
    float total_weight = 0.0;
    
    // 4方向采样 + 中心
    vec2 offsets[5] = vec2[](
        vec2(0.0, 0.0),
        vec2(half_pixel.x * radius, 0.0),
        vec2(-half_pixel.x * radius, 0.0),
        vec2(0.0, half_pixel.y * radius),
        vec2(0.0, -half_pixel.y * radius)
    );
    
    float weights[5] = float[](
        4.0,  // 中心权重
        2.0,  // 水平
        2.0,
        2.0,  // 垂直
        2.0
    );
    
    for (int i = 0; i < 5; i++) {
        sum += texture2D(tex, uv + offsets[i]) * weights[i];
        total_weight += weights[i];
    }
    
    gl_FragColor = sum / total_weight;
}
