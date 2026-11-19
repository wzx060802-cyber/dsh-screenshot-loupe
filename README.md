# dsh-screenshot-loupe

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 输入框的截屏插件：点一下相机按钮，**屏幕就地冻结压暗，直接在桌面上拖框**，松手即作为图片草稿进输入框。带 8× 放大镜、像素网格与十字准线，边缘想落在哪一像素就落在哪一像素。

A composer screenshot plugin for DeepSeek Harness: the screen freezes where it is,
you drag a rectangle **on the desktop itself**, and the crop lands in the message
draft as an ordinary image attachment. An 8× loupe with a one-pixel grid and
crosshair guides make the edges land on the exact pixel.

---

## 它解决的问题

DeepSeek Harness 原本只能拖文件或选文件来附图，想把屏幕上看到的东西发给模型，得走「截图工具 → 存盘 → 找文件 → 拖进输入框」。

这个插件把它压缩成一次点击：**相机按钮 → 拖框 → 图已经在输入框里**。

## 特性

- **就地截屏**：相机按钮在输入框工具行（`conversation.input.left`），点一下立刻进入框选，不需要选模式
- **冻结画面 + 压暗**：框选时屏幕是冻结的那一帧（不是实时画面），选区呈现为压暗层里的"亮窗"，不会因为背景变化选偏
- **8× 放大镜**：跟随指针，显示 15×15 像素的放大视图、1px 像素网格、目标像素描框和坐标（`1215, 1086`）；贴边自动翻到另一侧
- **十字准线**：贯穿全屏的黑/白双线，浅色和深色背景上都看得清
- **框内标注**：松手后选区留在原地，工具条浮在下方 —— 箭头、方框、文字、马赛克，图标是矢量绘制，标注按原始分辨率烧进最终 PNG
- **可撤销**：`Ctrl+Z` 退掉最后一笔，`A/R/T/M` 切工具，`Enter` 或 ✓ 完成，双击选区内也能完成
- **可隐藏本窗口**：勾选后截图前把 DSH 窗口最小化，截完自动还原（用最小化而不是隐藏，异常时不会把窗口留在"消失"状态）
- **零运行时依赖**：遮罩是一段 C#，用 Windows 自带的 .NET Framework 现场编译一次并缓存，**不需要装 .NET 8、也不需要打包 exe**
- **跨平台选区**：Windows 用自带遮罩；macOS 走 `screencapture -i`；Linux 走 `maim -s` / `scrot -s` / `gnome-screenshot -a` / `spectacle -r`
- **入口自适应**：页面加载时读一次 `/dsh-screenshot-loupe/probe`，不支持的控件（比如非 Windows 的"隐藏本窗口"）自动隐藏
- **走 Harness 原生入口**：截图通过输入框自己的粘贴通道进入草稿，图片数量/体积限制、上传状态、缩略图、删除都是原生行为

## 平台支持

| 平台 | 框选 | 框内标注 | 整屏 | 隐藏本窗口 | 状态 |
|---|---|---|---|---|---|
| Windows 10 / 11 | 自带遮罩（含放大镜、准线） | 箭头 / 方框 / 文字 / 马赛克 | 是 | 是（最小化后还原） | **已实测** |
| macOS | `screencapture -i` | 无 | 是 | 否 | 代码已写，未实测 |
| Linux | `maim -s` / `scrot -s` / `gnome-screenshot -a` / `spectacle -r` | 无 | 是 | 否 | 代码已写，未实测 |

## 安装

这是一个 Harness profile bundle（`package.json` 里声明了 `dsh.bundle.patch` 与 `dsh.client`）。

**方式一：插件管理器装本地目录**

```text
plugin_manager install_bundle /绝对路径/dsh-screenshot-loupe
```

**方式二：手动放进 profile**

把目录拷到 `$DSH_PROFILE_DIR/node_modules/`，然后在 profile 的 `cordis.patch.yml` 里插入：

```yaml
- insert:
    - id: dsh-screenshot-loupe
      name: 'dsh-screenshot-loupe'
```

**方式三：npm**

```bash
npm i dsh-screenshot-loupe
```

然后把包名加进 profile 的 bundle 列表（同上那条 patch 行）。装完重启 Harness（宿主已加载的模块不会热替换），然后刷新页面。

## 使用

1. 点输入框工具行的相机按钮
2. 屏幕冻结并压暗，移动鼠标看放大镜对准边缘
3. 按住左键拖出一个矩形，松手 —— **选区留在原地，工具条浮在选区下方**
4. 需要的话在框内画箭头 / 方框 / 打码 / 写字；`Ctrl+Z` 撤销，`A R T M` 切工具
5. `Enter`、`✓` 或双击选区完成 → 图自动进入输入框附件区，跟着下一条消息发出

- `Esc` 或**右键**取消
- 拖动小于 6×6 像素视为误触，遮罩保留，可以重来
- 想让 DSH 不出现在图里：`+` 菜单 →「截屏」打开选项面板，勾上「截屏时隐藏本窗口」（选择会被记住）
- 面板里还有「整屏截屏」，跳过框选直接截
- 文字工具：在框内点一下就地出现输入框，`Enter` 提交、`Esc` 放弃

## 工作原理

```text
[页面] 相机按钮 / + 菜单
   │ GET /dsh-screenshot-loupe/screen.png?mode=region&hide=1&hint=…
   ▼
[宿主插件] PowerShell 起捕屏脚本
   │ 1. 需要时最小化本应用窗口（finally 里还原）
   │ 2. CopyFromScreen 抓虚拟桌面（DPI 感知）
   │ 3. 全屏遮罩：冻结帧 + 压暗 + 十字准线 + 放大镜 → 拖框
   │ 4. 框内标注（箭头/方框/文字/马赛克），Ctrl+Z 撤销
   │ 5. 按选区裁剪，把标注按原始分辨率烧进 PNG
   ▼
[页面] 拿到 PNG → 合成 paste 事件交给输入框自己的 intake
   ▼
DSH 的粘贴路由校验图片限制 → 变成草稿附件
```

遮罩是 `snip.cs`（C# 5，兼容 Windows PowerShell 5.1 的 CodeDom 编译器）。插件在首次加载时把它编译成 `%TEMP%\dsh-screenshot-loupe\snip-<sha1前12位>.dll` 并按源码哈希复用，因此首次点击约 2 秒、之后约 1 秒出遮罩。

`GET /dsh-screenshot-loupe/probe` 返回 `{ platform, region, annotate, hideWindow }`，页面据此决定显示哪些控件。

```text
index.js          Host 半：路由、抓屏脚本、隐藏/还原窗口、编译缓存
snip.cs           遮罩、放大镜与框内标注（WinForms，C# 5）
client.js         页面半：相机按钮、选项面板、调用与入草稿
locale/*.json     插件管理器的标题/描述/详情页
docs/DETAIL.md    插件详情页正文
cordis.patch.yml  Loader 行
```

## 已知限制

- 框内标注与「隐藏本窗口」仅 Windows 生效；macOS / Linux 走系统自带截屏，回来的是成品图
- 没有滚动截屏、没有窗口选择器；标注没有自由旋转、线宽/颜色选择（固定品牌蓝 3px + 白色描边文字）
- 一次抓一帧：遮罩下是冻结画面，不是实时预览
- 多显示器按虚拟桌面整屏抓取，框选可以跨屏
- 抓屏路由是同源 GET，没有额外凭据；它只绑定 Web GUI 已在监听的本地回环地址
- macOS 首次需要给 Harness「屏幕录制」权限；Linux 需要装上面任一工具

## 隐私

- 截图只在内存与临时目录之间流转：抓到的帧写到临时 PNG，取走后立即删除
- 只有点发送后，图片才由 Harness 的附件存储落盘
- 插件不落任何配置文件；「隐藏本窗口」的开关存在浏览器 `localStorage`

## 生态

DSH 社区已经有不少截图插件，各有取舍，安装前值得都看一眼：

- [joythatway/dsh-screenshot](https://github.com/joythatway/dsh-screenshot) — 框选/窗口/整屏 + 设置页 + 图片预览，macOS 上最完整
- [12138hao/dsh-snap](https://github.com/12138hao/dsh-snap) — Windows 冻结框选，需要 .NET 8 运行时
- [aaron999-h/dsh-screenshot](https://github.com/aaron999-h/dsh-screenshot) — `+` 菜单入口，DSH 保持可见
- [lsnnn123/dsh-screenshot-win](https://github.com/lsnnn123/dsh-screenshot-win) — 额外提供 Agent 可调用的 `screenshot` 工具
- [TenDollars-ag/dsh-screenshot](https://github.com/TenDollars-ag/dsh-screenshot) — 零依赖、Per-Monitor DPI、整屏/被遮挡窗口

本插件与它们的主要区别：**不依赖任何额外运行时**（系统自带 .NET Framework 现场编译 + 缓存）、**三平台都有选区路径**、以及**放大镜 + 像素网格 + 十字准线**的取景体验。

## License

MIT
