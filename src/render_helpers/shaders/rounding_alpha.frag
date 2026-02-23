uniform float exponent;

float niri_rounding_alpha(vec2 coords, vec2 size, vec4 corner_radius) {
    // vec2 center;
    // float radius;

    // if (coords.x < corner_radius.x && coords.y < corner_radius.x) {
    //     radius = corner_radius.x;
    //     center = vec2(radius, radius);
    // } else if (size.x - corner_radius.y < coords.x && coords.y < corner_radius.y) {
    //     radius = corner_radius.y;
    //     center = vec2(size.x - radius, radius);
    // } else if (size.x - corner_radius.z < coords.x && size.y - corner_radius.z < coords.y) {
    //     radius = corner_radius.z;
    //     center = vec2(size.x - radius, size.y - radius);
    // } else if (coords.x < corner_radius.w && size.y - corner_radius.w < coords.y) {
    //     radius = corner_radius.w;
    //     center = vec2(radius, size.y - radius);
    // } else {
    //     return 1.0;
    // }

    // float dist = distance(coords, center);

    // // Manual smoothstep() between radius - half_px and radius + half_px
    // // to avoid a division in clamp().
    // float t = clamp((dist - radius) * niri_scale + 0.5, 0.0, 1.0);
    // return 1.0 - t * t * (3.0 - 2.0 * t);
    // anti-alias
    float aa = 0.5 / niri_scale;

    // 坐标中心化（相对于矩形中心）
    vec2 offset = coords - size * 0.5;

    // 四角半径
    float rx = mix(corner_radius.x, corner_radius.y, step(0.0, offset.x));
    float ry = mix(corner_radius.w, corner_radius.z, step(0.0, offset.x));
    float rad = mix(rx, ry, step(0.0, offset.y));

    // 局部角落坐标
    vec2 q = abs(offset) - (size * 0.5 - rad);

    // 主区域直接返回 1.0
    if(q.x < 0.0 && q.y < 0.0) {
        return 1.0;
    }
    // FG-squircle 核心公式
    vec2 corner = max(q, 0.0);      // 角落部分
    float dist = pow(pow(corner.x, exponent) + pow(corner.y, exponent), 1.0 / exponent) - rad;

    // 过渡区平滑 alpha
    return 1.0 - smoothstep(-aa, aa, dist);
}
