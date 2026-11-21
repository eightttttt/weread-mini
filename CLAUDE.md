# CLAUDE.md — 微信读书小窗（WeReadMini）开发交接

这份文件给接手开发的 Claude（Claude Code）看。项目在 claude.ai 的对话里从 0 开发到 v2.18，这里记录了当时的需求、架构、踩过的坑和发布流程。改代码前先读完。

## 用户与协作约定

- 用户：Zhang Bin（GitHub：eightttttt）。**始终用中文回复。**
- 用户在 Windows 上用打包好的 exe，不跑源码。每次改动的交付方式：
  1. 改代码 → `package.json` 版本号 +0.01（如 2.18.0 → 2.19.0）
  2. `npm run pack:win` → `dist/WeReadMini-win32-x64/`（打包后自动跑 `scripts/check-pack.js`，检查 asar 里关键文件齐全；新增必需文件时要加进它的 `REQUIRED`）
  3. 更新包里的 `使用说明.txt`：改标题版本号，在最前面加一段“vX.XX 更新/修复：”说明（只存在于 dist 包里，不在仓库）
  4. 把 `WeReadMini-win32-x64` 复制成文件夹 `微信读书小窗`，打成 `微信读书小窗_vX.XX.zip`。**复制前先 `rm -rf dist/微信读书小窗`**：残留的旧文件夹会让 `cp -r` 把程序复制进它里面，压缩包里变成两份程序、体积翻倍（v2.26 第一次打包出过这个问题）。正常大小约 150 MB。
  5. git 提交并推送到 `origin main`（提交信息写清版本和改动）
  6. **`version.json`（检查新版本用）不要随每次提交自动改**：它决定所有用户会不会收到“有新版本”提示。只有用户确认新版已经公开发布（发在小红书等可下载的地方）后，才把它的 `version` 改成该版本，`url` 指向下载页（目前是小红书主页），`notes` 写一句更新内容，单独提交推送。
- 回复风格：说清“改了什么、为什么、用户怎么升级（托盘右键退出旧版 → 解压替换）”，以及哪些需要用户在真机上确认。
- **Mac 版暂停**（用户原话“暂时不做mac版本了”）。代码里的 Mac 适配（IS_MAC、dock.hide、模板托盘图标、`pack:mac`）保留但不打包。
- 用户问过 Win7：Electron 45 不支持 Win7（Electron 22 是最后支持的版本）。已告知可另做 Win7 版（需改用 BrowserView、无毛玻璃/原生圆角），用户尚未决定。

## 架构

Electron 45，一个 `BaseWindow`（无边框、`transparent: true`、背景 `#00000000`）里放三个 `WebContentsView`：

| 视图 | 内容 | 说明 |
| --- | --- | --- |
| `bar` | `bar.html` + `preload.js` | 顶部工具栏，高 `BAR_H = 30` |
| `page` | weread.qq.com，partition `persist:weread`，preload `page-preload.js` | 书页；`inject.js` 在 dom-ready 和页内跳转时用 `executeJavaScript` 注入（`__MARGIN__` 用 `replaceAll` 替换） |
| `ticker` | `ticker.html` | 播报条（单行滚动） |

另有独立小窗 `donate.html`（`openDonate()`，BrowserWindow）：“请作者喝瓶水”打赏弹窗，入口：工具栏灰色水滴按钮 `#donate`（在 `⋯` 左边，`fitBar` 优先级 5：最先收起；收起后在 `⋯` 菜单最底部（v2.27 起，单独分隔、无彩色表情，不抢眼）。用户试过蓝色/优先级 60、52，最终决定“不想影响使用”：灰色、最先收起）、托盘菜单。收款码先找 exe 旁的 `donate-wechat.png`/`donate-alipay.png`，再找仓库 `donate/wechat.png`/`alipay.png`。用户决定：软件免费，只做自愿打赏，不收费。反馈与新版本渠道是用户的小红书 @东尼滝谷（主页链接 `XHS_URL`（main.js；托盘“反馈与更新（小红书）”、打赏弹窗底部链接，用 `shell.openExternal` 打开）；打赏弹窗不再写“自愿支持，不影响任何功能”（用户要求去掉）；底部两行：“反馈与新版本” / 图标 + @东尼滝谷。小红书图标是用户提供的图片裁出来的 `donate/xhs.png`（不要自己画商标；没有这个文件时退回中性对话气泡，exe 旁 `donate-xhs.png` 可覆盖）；不放微信等私人联系方式。弹窗风格按用户要求：克制、不要太可爱，深色毛玻璃（窗口非 transparent + `backgroundMaterial: 'acrylic'`，让 Win11 给系统圆角），配色跟微信读书图标的蓝色渐变。`donate/*.png` 是用收款链接重新生成的纯二维码（不含用户头像、名字、ID）。

- 检查新版本（v2.33）：`main.js` 的 `checkUpdate()` 依次读 jsDelivr 镜像（cdn / fastly）和 raw.githubusercontent 上的 `version.json`（国内访问 GitHub 不稳），启动 15 秒后查一次，之后每 12 小时；有新版时托盘菜单第一项“⬆ 有新版本”，工具栏书名处绿字提示 5 秒（`cfg.updNotified` 保证每个版本只提示一次）；托盘“检查新版本”手动查并弹对话框。jsDelivr 对分支有缓存，改完 `version.json` 可能要过几小时用户才看到。
- 网页改版自动降级（v2.34）：`inject.js` 的 `layoutHealthy()` 每秒检查阅读页关键元素（翻页模式 `.wr_horizontalReader` 下的 `.readerChapterContent/.renderTargetContainer/canvas/.preRenderContent`，或滚动模式 `.readerContent`）以及正文 canvas 是否还在窗口里；连续 12 秒不正常就 `enterCompat()`：边距改回原版（M=-1）、停用点击翻页；离开阅读页时恢复，下次进书重新检查。主进程在进度轮询里读 `__wrm.compat()`，首次进入时工具栏提示 6 秒、托盘显示“兼容模式”并顺便检查新版本。**以后改选择器时同步改 `layoutHealthy()` 的列表。**
- `main.js`：窗口、托盘、快捷键、自动翻页、隐身（fade）、色调、播报条、配置（userData 里的 json，默认值在 `cfg` 定义处）。
- `alive()` / `barAlive()` 守卫 + `shutdown()` 清定时器 —— 退出时 “Object has been destroyed” 崩溃就是靠这个修的，新增定时器/回调都要加守卫。
- `layout()` 摆放三个视图；`layoutDeferred()` 拖动缩放时 350ms 防抖再排版。
- 播报条开启时书页移到屏幕外 `x: -(width+100)`（不能只设透明，否则原文会透出来）。
- 窗口材质 `applyMaterial()`：Windows `setBackgroundMaterial('acrylic')`。**透明色调 / 播报条 / 圆角模式下关闭**，因为系统材质只能是方的，会在圆角外露出方角。此时 bar 收到 `glass {clear:true}`，用更厚的半透明底。
- 圆角（v2.18，`cfg.round` 默认开，托盘可关）：`page.setBorderRadius(RADIUS=8)`；工具栏显示时书页向上多伸 RADIUS 像素藏到工具栏下面遮住上圆角，并通过 `__wrm.setTop(px)` 让正文同步下移；工具栏自己用 CSS 圆上两角。注意：给容器 `View` 设圆角**不会**裁剪子视图，必须设在每个 WebContentsView 上。
- 拖动窗口：手动 IPC（`drag`）+ 锁定宽高 `setBounds`（否则 125% 缩放下拖动会越拖越大）。右下角 7px 调整大小走 `rsz` IPC。
- 需要“真实点击”的微信读书控件（切换阅读方式等，网页检查 `isTrusted`）用 `webContents.sendInputEvent` 模拟。

## 微信读书网页结构（逆向所得，网页改版时最先坏的地方）

- 翻页模式：`.wr_horizontalReader`、`.readerChapterContent`（`.renderTargetContainer` 的 offsetParent）、`.renderTargetContainer`、`.wr_canvasContainer canvas`
- 内置留白：`.preRenderContent` 内联 paddingTop 84 / paddingBottom 70；章节标题行 `.renderTargetPageInfo_header`；翻页按钮 `.renderTarget_pager_button(_right)`
- 上下滚动模式：`.readerContent`
- 菜单：`.readerControls`（`.isHorizontalReader` / `.isNormalReader`）；原生字号面板 `.font-panel-content`
- 弹窗：`.reader_float_panel_container`、`.wr_mask`
- 本章总页数 = `.wr_decoration` 宽度 / canvas 宽度
- **正文是逐字 `fillText` 画在 canvas 上的**，DOM 里没有文字。`page-preload.js` 在主世界 hook `fillText`/`clearRect`，按 canvas 记录文字，`window.__wrmCanvasText(c)` 取出（播报条用）。
- 选字/划线命中：`clientXY2RenderAreaXY` 用 `renderTargetContainer.offsetLeft/offsetTop + scroll` 换算（代码在 weread 的 `9.*.js` 里）。

## 踩过的坑（别再踩）

0. **v2.27 工具栏消失**：核对安装包时在项目根目录 `asar extract-file ... bar.html` 后 `rm -f bar.html`，把源文件删了并被 `git add -A` 提交。解压/临时文件一律放 `/tmp`，不要在项目目录里删同名文件；提交前看一眼 `git status` 有没有意外的删除。

1. **划线对不上行（v2.15 + v2.16 两个原因）**
   - 微信读书只在启动时读一次 `devicePixelRatio`。缩放（A+/A−，本质是 zoomFactor）或换不同缩放比例的显示器后，绘制和命中错位 → `inject.js` 有 DPR 监视器，稳定 0.9s 后 `rememberNow()` + `location.reload()`，再由位置恢复回到原页；page 的 webPreferences 里带 `zoomFactor: cfg.zoom`，启动即正确比例。
   - 我们用负 margin 把 `.readerChapterContent` 上移/加宽，而 `offsetTop/offsetLeft` 是相对它算的，不含这段位移 → 选中鼠标上方 ~72px 的文字。修法：`page-preload.js` 在主世界改写 `HTMLElement.prototype.offsetTop/offsetLeft`，仅对 `.renderTargetContainer` 返回 `getBoundingClientRect() + scroll`。**以后再改排版 CSS，必须保证这个映射仍然成立。**
2. **打开后疯狂自动翻页（v2.4）**：位置恢复的章节 key 只用 URL 导致误判。现在 key = `pathname + '#' + 章节标题`，恢复最多 60 步，用户任何真实输入（pointerdown/keydown/wheel）立即中止。
3. 排版校准在 canvas 隐藏时死循环 → 宽度 < 50 跳过，最多 5 次。
4. 窄窗口上下滚动模式下菜单被隐藏 → 强制 `display:flex`。
5. 播报条：原文透出（→ 书页移出屏幕）、透明模式左侧色块和深色方角（→ 关材质）、深色分层（→ 统一背景 + mask 渐隐）。
6. 用户否决过 v2.0（改用网页原生字号），要求“根据 1.9 重新改” —— 字号一直用整页缩放（zoom）实现，不要换回原生字号。

## 主要功能对应代码

- 工具栏（`bar.html`）：书名+页数玻璃块 `#tblock`（`#title` + `#prog`，进度由主进程每 400ms 发 `prog`）、缩放组、自动翻页组、播报条、色调、不透明度滑块、隐身、置顶、沉浸、`⋯` 更多、最小化、关闭。窗口变窄时 `fitBar()` 按优先级收起（数字小先收）：donate 5, op 10, reload 15, min 20, zv 30, back 35, autoMore 40, home 45, pin 50, tone 55, zoomGroup 65, immersive 70, ticker 80, autoGroup 85, fade 90, prog 95；收起的进 `⋯` 菜单（主进程 `moreMenu`）。
- `inject.js`：窄边距 CSS（`T=12` 顶、`B=10` 底，左右 `M`）、点击左/右 1/3 翻页（120ms 延迟，弹窗打开时跳过）、左下书架按钮 `#__wrm_shelf` / 右下 ☰ `#__wrm_tg`（`fitButtons()` 按窗口宽度缩放，除以 zoom）、位置记忆（localStorage `wrm_pos`）、`window.__wrm` API（next/prev/scroll/pageText/progress/setTop…）。
- 播报条（`main.js` ticker 段 + `ticker.html`）：速度 `TICKER_SPEEDS`、字号 `TICKER_FONTS`、高度 = 字号×2+8；左侧 34px 功能区悬停才出现按钮（暂停、字号−+、背景、快、慢）；滚轮调速、Ctrl+滚轮调字号、双击/Esc 退出；文字取自 `__wrm.pageText()`，读完自动翻页续上（`awaiting` 防重复翻页），退出时翻回原页。看不见时自动停住：`syncTickerHold()`（隐身 / 隐藏到托盘 / 最小化）给 ticker 发 `hold`，与手动暂停 `paused` 互相独立。
- 全局快捷键见 README。

## 测试方法

- 没有 Windows 真机：在 Linux 用 Xvfb 跑 Electron。真实网页需要登录、且沙箱网络通常只放行包管理源，所以常用**本地模拟页**：仿微信读书 DOM 的 html，用 `python3 -m http.server` 起服务，把 `main.js` 副本里的 `HOME` 指过去。
- 截图：`Xvfb :77 -screen 0 1000x800x24` + `import -window root`。透明窗口在无合成器的 Xvfb 下是黑的，看圆角时把副本窗口改成不透明红底。
- 涉及微信读书内部逻辑（如选字映射）时，从网页加载的 `wrwebnjlogic/js/*.js` 里搜函数名读源码，再在模拟页复现同一公式。
- 毛玻璃、真实透明、真实划线手感只能让用户在 Windows 上确认 —— 回复里要说明哪些没法在本地验证。

## 打包

```bash
npm install
npm run pack:win   # electron-packager，asar，输出 dist/WeReadMini-win32-x64
```

`dist/`、`distmac/`、`*.zip`、`node_modules` 在 .gitignore 里。

## 版本历史（摘要）

v1.x 基础小窗、置顶、托盘、隐身、自动翻页、窄边距、点击翻页、收纳菜单 → v2.1 按 1.9 重做字号/按钮缩放 → v2.3 首次上传 GitHub → v2.4 修自动乱翻页、毛玻璃工具栏、透明背景 → v2.5 书架/☰ 移到下方两角 → v2.6–2.11 播报条及其修复 → v2.12 工具栏优先级收起 → v2.13–2.14 进度显示移到工具栏 → v2.15–2.16 修划线错位 → v2.17 书名+页数玻璃块 → v2.18 圆角窗口 → v2.19 请作者喝瓶水（打赏弹窗）→ v2.20 打赏弹窗改深色毛玻璃 + 收款码 → v2.21 播报条隐身/隐藏时自动暂停 → v2.22 打赏文案 → v2.23 工具栏水滴打赏按钮 → v2.24 水滴蓝色、优先级 60、⋯ 菜单置顶 → v2.25 水滴改灰色、移到 ⋯ 左边 → v2.26 水滴最先收起（优先级 5）→ v2.27 ⋯ 菜单里打赏移到最底部、去掉表情（此版漏了 bar.html，工具栏消失）→ v2.28 恢复 bar.html + 打包后自动检查文件 → v2.29 小红书反馈入口 → v2.30 显示 @东尼滝谷，去掉“自愿支持”一行 → v2.31 反馈信息分两行 + 可替换图标 → v2.32 用户提供的小红书图标 → v2.33 检查新版本 → v2.34 网页改版自动降级。详见 `git log`。
