## 简介

客制化 [Niri](https://github.com/YaLTeR/niri)

## 额外功能

### 强制渲染

在 window-rule 添加以下规则以启用（屏幕捕获自动强制渲染）:

```
window-rule {
    #match app-id="appid"
    offscreen-render true #启用离屏渲染
    offscreen-render-fps 120 #离屏渲染fps限制，不加则无限制
}
```

### blur

> 为了优化性能，blur 窗口根据 window-rule 的 opacity 判断，不透明的窗口不受 blur 影响。软件自己的透明度设置无法影响 blur 条件判断，如果想要用软件自己的透明度，建议设置 opacity 小于 1（可以是0.999）
>
> blur passes 上限 8

popup blur 与 layout blur 同步，也可以单独添加 window rule，layer blur 需要在 layer rule 添加 blur 配置块。

layer blur 非实时更新，需要重开对应 layer（例如 qs 的 bar 需要重启，而启动器是使用时创建 layer 就不需要重启）

例：

```
layout {
    blur {
        on
        passes 1
        radius 4
        ignore-alpha 0.1 // 透明度剔除
    }
}

window-rule{
    match app-id="appid"
    blur {
        off
    }
}

layer-rule{
    blur {
        on
        passes 1
        radius 4
        ignore-alpha 0.1 // 透明度剔除
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