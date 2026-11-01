# AIDIY · 和 AI 一起做的创意编程作品集

这里放的是我用 AI 辅助做的浏览器视觉 / 交互作品，大多是为了录抖音、TikTok、B 站短视频。每个项目都是一个独立的 Vite 工程，拉下来 `npm install`、`npm run dev` 就能跑，不依赖任何付费 API 或后端。

## 目录

| 分类 | 项目 | 一句话介绍 | 怎么玩 | 本地端口 |
|---|---|---|---|---|
| 🌌 宇宙与物理 | [EVENT HORIZON](space/event-horizon) | 一个会把自己所在网页吞掉的黑洞 | 鼠标 / 键盘 | 5181 |
| 🌌 宇宙与物理 | [GOD MODE](space/god-mode) | 用手势创造、坍缩、引爆一个 GPU 粒子宇宙 | 鼠标 / 触屏 / 摄像头手势 | 5173 |
| 🎵 声音可视化 | [LIQUID FREQUENCY](audio-visual/liquid-frequency) | 被音乐实时驱动的液态铬金属雕塑 | 上传音乐 / 内置 DEMO | 5178 |
| 🎮 游戏与交互世界 | [PORTAL PARADOX](games/portal-paradox) | 两扇实时连通的传送门：穿越世界、无限递归、重力反转、时间倒流 | 键盘鼠标第一人称 / 触屏 | 5184 |

## 仓库结构

```
AIDIY/
├── space/                    宇宙、引力、天体物理题材
│   ├── event-horizon/        黑洞吞噬网页
│   └── god-mode/             手势控制的粒子宇宙
├── audio-visual/             声音驱动的视觉
│   └── liquid-frequency/     音乐驱动的液态金属
├── games/                    可以走进去玩的 3D 世界
│   └── portal-paradox/       实时传送门 + 物理实验室
└── .claude/launch.json       Claude 桌面版预览用的启动配置
```

每个项目文件夹里都有一份更详细的 README，写了实现原理、完整快捷键、录屏建议，以及哪些测过、哪些没测过。

---

## 🌌 space/ · 宇宙与物理模拟

### EVENT HORIZON：黑洞吞掉互联网

📁 [`space/event-horizon`](space/event-horizon)

**它是干嘛的**：打开是一个很有未来感的"深空观测站"网页。点 **DESTROY REALITY** 之后，页面上真实的 DOM 元素（标题、卡片、文字）会被引力拉扯、潮汐撕裂、螺旋坠入吸积盘；然后镜头冲过事件视界，穿过时空隧道，进入另一个宇宙。整段约 26 秒，按一次 `D` 正好录一条 30 秒的视频，可以反复重建、重播。

**亮点**
- 黑洞是逐像素做 Schwarzschild 光子轨道数值积分（RK4）画出来的。光子环、引力透镜、吸积盘一侧亮一侧暗（多普勒效应），都是算出来的，不是贴图。
- 网页元素先作为真实 DOM 变形，再在同一帧无缝交给 WebGL 变成碎片，继续被撕成更小的块，最后烧蚀成粒子被视界吞没。
- 音效全部用 Web Audio 实时合成，没有采样，也没有版权音乐。
- 带录屏工具：电影模式（隐藏界面和鼠标）、16:9 / 9:16 画框、一键演示回放、画质分档。

**常用按键**：`Space` 摧毁 · `R` 重建 · `D` 演示回放 · `C` 电影模式 · `A` 切画幅 · `Q` 画质 · `F` 全屏

**技术栈**：React 19 · TypeScript · Vite · Three.js（手写多 pass 渲染管线）· GSAP · html-to-image · zustand

### GOD MODE：用双手控制宇宙

📁 [`space/god-mode`](space/god-mode)

**它是干嘛的**：一个实时运行在 GPU 上的粒子宇宙（最多约 26 万颗粒子）。可以用鼠标、键盘、触屏，也可以直接对着摄像头比手势：握拳让宇宙旋转，捏合让它坍缩成黑洞，张开手掌把它引爆，横向挥手切换形态（星系、DNA、星云、奇点、黑洞）。16 秒没人操作时，它会自己进入电影式的自动演出。

**亮点**
- 粒子的位置和速度全部在 GPU 上模拟（GPGPU），每帧不经过 CPU。
- MediaPipe 手部追踪，加一个自己写的手势分类器（有单元测试，`npm test`）。
- 每种形态都有自己的镜头：希区柯克式变焦、宽银幕黑边、横向镜头光晕、引爆后的子弹时间。
- 没有 WebGL2 的设备自动降级成 Canvas 2D 版本（网址后加 `?lite` 可以强制使用）。

**常用按键**：按住 `Space` 坍缩 · `E` 引爆 · `←` `→` 或 `1`–`5` 切形态 · `R` 从大爆炸重播 · `H` 隐藏界面 · `C` 开摄像头

**注意**：摄像头只能在 `localhost` 或 HTTPS 下打开。第一次开摄像头时会从 Google 下载约 8 MB 的手部模型。

**技术栈**：TypeScript · Vite · Three.js · MediaPipe Tasks Vision · Vitest

---

## 🎵 audio-visual/ · 声音可视化

### LIQUID FREQUENCY：让声音变成物质

📁 [`audio-visual/liquid-frequency`](audio-visual/liquid-frequency)

**它是干嘛的**：一件被音乐实时驱动的 3D 液态铬金属雕塑。把自己的歌拖进窗口，浏览器会在本地做频谱分析：低音让金属膨胀、打出冲击波，中频控制流动和扭曲，高频让表面细细颤动、甩出银色碎片。检测到 drop 时，雕塑会炸成几千块碎片，悬浮一会儿，再被引力螺旋吸回，长成新的形态。

**亮点**
- 液态金属用 SDF 光线步进（Raymarching）渲染，液滴可以融合、分裂。
- 自己写的音频分析：分频段能量、节拍、BPM、build-up / drop 检测。
- 内置一首原创的 30 秒电子乐 DEMO，由浏览器实时合成（没有采样文件，不涉及版权），画面跟着乐谱编排。
- 四种形态：CHROME HEART、MERCURY OCEAN、SHATTERED REALITY、SINGULARITY。
- 音频只在本地浏览器里处理，不上传任何服务器。

**常用按键**：`1`–`4` 切形态 · `X` 手动触发高潮 · `Space` 播放 / 暂停 · `C` 电影模式 · `A` 切画幅 · `?` 快捷键面板

**技术栈**：React 19 · TypeScript · Vite · Three.js + React Three Fiber · postprocessing · zustand

---

## 🎮 games/ · 游戏与交互世界

### PORTAL PARADOX：现实已经坏掉了

📁 [`games/portal-paradox`](games/portal-paradox)

**它是干嘛的**：第一人称走进一座 120 米长的粗野主义混凝土实验大厅。大厅中央的传送门 α 连着另一个世界：星云下漂浮的岛屿、带环的巨行星、倒悬的金字塔。门里看到的是另一边的实时画面，走过去就真的到了那边；东西扔进去，会带着原来的速度和旋转从另一扇门飞出来。按 `1` / `2` 可以把两扇门放到任何地方，面对面放就会出现层层嵌套的无限走廊。按 `G` 让整个实验室的重力反转，按住 `R` 让刚才几秒倒放回去。按 `C` 播放一段正好 30 秒、可以直接录抖音的自动演示（支持 9:16 竖屏）。

**亮点**
- 传送门是真的：每一层递归都是从自己的虚拟相机实时渲染的（偏轴子视锥 + 裁剪面），不是贴图，也不是缩放的截图。HIGH 档 7 层递归，ULTRA 11 层。
- 人和物体穿门时，位置、朝向、速度、角速度一起变换；门的两面都能走，来回穿不会卡住或抖动。传送门数学有单元测试（`npm test`）。
- Rapier 物理：拾取、投掷、动能脉冲、重力反转；时间倒流是记录 + 回放所有刚体状态，松手后从倒流到的那一刻继续算。
- 天窗阳光逐像素解析计算，解析体积光，程序生成的板模混凝土；音效全部 Web Audio 实时合成。

**常用按键**：`WASD` 移动 · `E` 拿 · 左键扔 · `1` `2` 放门 · `G` 重力 · 按住 `R` 倒流 · `L` 换布局 · `C` 演示 · `V` 画框 · `Q` 画质

**技术栈**：React 19（UI）· TypeScript · Vite · Three.js（原生多 pass 传送门渲染器）· Rapier 物理 · zustand

---

## 拉到本地运行

需要 [Node.js](https://nodejs.org/) 18+、git，以及已登录的 [GitHub CLI](https://cli.github.com/)（仓库是私有的）。推荐用桌面版 Chrome 或 Edge 打开，需要支持 WebGL2。

整个仓库拉下来：

```bash
gh repo clone Will1202/AIDIY
cd AIDIY/space/event-horizon
npm install
npm run dev
```

只想要其中一个项目（不下载其他项目的文件）：

```bash
gh repo clone Will1202/AIDIY -- --filter=blob:none --sparse
cd AIDIY
git sparse-checkout set audio-visual/liquid-frequency
```

## 关于占用空间

本地一个项目动辄一两百 MB，几乎全是 `node_modules`（依赖包）和 `dist`（构建产物）。这两样都写进了 `.gitignore`，不进仓库，随时可以用 `npm install` / `npm run build` 重新生成。仓库里只有源码，三个项目加起来不到 1 MB。

暂时不玩的项目，可以只删掉本地的 `node_modules` 和 `dist`，或者整个文件夹删掉，要用时再拉回来。

## 加一个新项目

1. 选一个分类文件夹放进去。没有合适的就新建一个，比如 `generative-art/`（生成艺术）、`gesture/`（体感交互）、`shader-art/`、`tools/`。
2. 在分类下建项目文件夹，带上它自己的 `package.json` 和 `README.md`。
3. 在本文件的「目录」表格和对应分类下各加一段介绍。
4. 要用 Claude 桌面版预览的话，在 `.claude/launch.json` 加一条，用 `npm --prefix <分类>/<项目> run dev`。
5. 提交并推送：

```bash
git add .
git commit -m "add <项目名>"
git push
```
