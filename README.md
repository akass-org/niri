## 简介

客制化 [Niri](https://github.com/YaLTeR/niri)

## 额外功能

### 强制渲染

在 window-rule 添加以下规则以启用（屏幕捕获自动强制渲染）:

```
window-rule {
    #match app-id="appid"
    force-render true #启用离屏渲染
    force-render-fps 120 #离屏渲染fps限制，不加则无限制
}
```

### blur

> 该功能补全（弹窗模糊，透明剔除）仅对实时模糊（xray false）有效
> dms 取消背景压暗功能时，launcher 输入法 blur 区域会无效，暂时不知道怎么解决

包括窗口模糊，layer 模糊，弹窗模糊

例：

```
blur {
    passes 4
    radius 2
    noise 0.1 // 噪点
    ignore-alpha 0.1 // 透明度剔除
    saturation 1.0 // 饱和度
}

window-rule{
    match app-id="appid"
    background-effect{
        xray false // false 为实时模糊
        blur true
        noise 0.1 // 噪点
        ignore-alpha 0.1 // 透明度剔除
        saturation 1.0 // 饱和度
    }
}

layer-rule{
    background-effect{
        xray false
        blur true
        noise 0.1 // 噪点
        ignore-alpha 0.1 // 透明度剔除
        saturation 1.0 // 饱和度
    }
}
```

**建议 blur 规则**

```

layer-rule{
    match namespace="gtk4-layer-shell"
    match namespace="selection"
    match namespace="swww-daemon"
    match namespace="linux-wallpaperengine"
    match namespace="noctalia-bar-exclusion*"
    match namespace="noctalia-bar-content*"
    match namespace="noctalia-image-cache-renderer*"
    match namespace="noctalia-dock-peek*"
    match namespace="^dms:.*:background$"

    background-effect{
        blur false
    }
}
```

### ~~窗口捕获光标绘制~~（上游已实现）

~~窗口捕获时（应用不自行绘制光标的时候）可以绘制光标，不过目前无法通过 OBS 设置取消绘制。 参考 [Naxdy/niri@defae6a](https://github.com/Naxdy/niri/commit/defae6ad230e909657e3fcd5c46beeb926714652) 并修复 bug~~

### shm 屏幕录制

实现 shm 屏幕录制 [YaLTeR#1791](https://github.com/YaLTeR/niri/pull/1791)

### 窗口规则

#### block-out-from 

透明屏蔽

```
window-rule {
    #match rule
    transparent-block true
}
```

#### opacity-on-fullscreen

全屏窗口是否遵循透明度设置

```
window-rule {
    #match rule
    opacity-on-fullscreen true
}
```

#### fullscreen-backdrop-color

允许自定义全屏背景颜色 [YaLTeR#3004](https://github.com/YaLTeR/niri/pull/3004) 

```
layout {
    fullscreen-backdrop-color "transparent"
}
```

#### rounding-exponent

窗口超椭圆圆角系数，默认 2.8，如果设置为 2.0 则为普通圆角

```
window-rule {
    #match rule
    rounding-exponent 2.8
}

layer-rule {
    #match rule
    rounding-exponent 2.8
}
```

### ipc

window layout 提供当前窗口在当前 Output 的逻辑坐标 （Window location） 和 显示器名称（Monitor name）

```
> niri msg pick-window

Window ID 60: (focused)
  Title: "niri msg pick-window ~"
  App ID: "com.mitchellh.ghostty"
  Is floating: no
  PID: 3604487
  Workspace ID: 10
  Layout:
    Tile size: 948 x 1023
    Scrolling position: column 2, tile 1
    Window size: 940 x 1015
    Window offset in tile: 4 x 4
    Window location: 964 x 49
    Monitor name: DP-2
```

### 其他

引入 [YaLTeR#2659](https://github.com/YaLTeR/niri/pull/2659)，不过不知为何 background-in-working-area-only 似乎没有生效
