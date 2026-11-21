const {
  app, BaseWindow, BrowserWindow, WebContentsView, Tray, Menu, nativeImage,
  globalShortcut, ipcMain, screen, shell, session, net, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');

const HOME = 'https://weread.qq.com/';
const BAR_H = 30;
const RADIUS = 8;    // 圆角窗口的圆角半径（像素）
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const ALT = IS_MAC ? '⌥' : 'Alt+';   // 菜单/提示里显示的快捷键写法
const MARGINS_OK = [-1, 32, 16, 8, 2];
const ZOOMS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.3, 2.6, 3];

// 阅读色调：页面文字是画布渲染的，用整页滤镜实现，任何书都生效
const OV = "html::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
const TONES = {
  none:  { label: '原色', css: '' },
  sepia: { label: '护眼', css: OV + 'background:#f6e7c8;mix-blend-mode:multiply}' },
  green: { label: '豆沙绿', css: OV + 'background:#c7edcc;mix-blend-mode:multiply}' },
  night: { label: '夜间', css: OV + 'backdrop-filter:invert(.9) hue-rotate(180deg)}' },
};
// 透明：书页背景全透明，只保留文字，能直接看到后面的桌面
const CLEAR_SEL = ['html', 'body', '.app', '.routerView', '.wr_horizontalReader', '.wr_horizontalReader_app_content',
  '.wr_various_font_provider_wrapper', '.readerChapterContent_container', '.readerChapterContent', '.renderTargetContainer',
  '.wr_canvasContainer', '.readerContent', '.app_content', '.navBarOffset', '.readerFooter'];
TONES.clear = {
  label: '透明',
  css: CLEAR_SEL.map((x) => x + '{background:transparent!important;background-image:none!important;box-shadow:none!important}').join('\n')
    // 文字加一圈细描边，任何桌面背景上都看得清（深色主题浅色字配深色描边，浅色主题反之）
    + '\nhtml.wrm-dark canvas{filter:drop-shadow(0 0 1px rgba(0,0,0,.95)) drop-shadow(0 0 2px rgba(0,0,0,.7))!important}'
    + '\nhtml:not(.wrm-dark) canvas{filter:drop-shadow(0 0 1px rgba(255,255,255,.95)) drop-shadow(0 0 2px rgba(255,255,255,.75))!important}',
};
const TONE_ORDER = ['none', 'sepia', 'green', 'night', 'clear'];

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- 设置持久化 ----------
const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  bounds: null, opacity: 1, onTop: true, fade: false, fadeLevel: 0, autoInterval: 30, autoSpeed: 40, margin: 16, tickerSpeed: 60, tickerH: 40, tickerFont: 18, tickerClear: true, round: true,
  lastUrl: HOME, showBar: true, zoom: 1, tone: 'none',
};
let cfg = { ...defaults };
function loadCfg() {
  try { cfg = { ...defaults, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch { /* 首次运行 */ }
  if (!TONES[cfg.tone]) cfg.tone = 'none';
  if (!MARGINS_OK.includes(cfg.margin)) cfg.margin = 16;
  if (!cfg.fadeV2) { cfg.fadeLevel = 0; cfg.fadeV2 = true; }   // 旧版默认 12%，升级后改为完全透明
  cfg.zoom = clampZoom(cfg.zoom);
}
let saveTimer = null;
function saveCfg() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {}
  }, 300);
}

let win, bar, page, tray, watchTimer, toneKey = null;
let hovering = true, peek = false, quitting = false;
let graceUntil = 0, hoverSince = 0, passThrough = false;
const REVEAL_DELAY = 100;   // 鼠标移入多久后显示（毫秒），避免路过时闪现；移出则立即隐身

// 窗口/页面是否仍然存在（退出过程中会被销毁，所有定时器都要先检查）
function alive() {
  return !quitting && win && !win.isDestroyed() && page && !page.webContents.isDestroyed();
}
function barAlive() { return !quitting && bar && !bar.webContents.isDestroyed(); }

function desktopUA() {
  return session.defaultSession.getUserAgent()
    .replace(/\s?Electron\/\S+/, '')
    .replace(/\s?weread-mini\/\S+/i, '');
}

// 固定工具栏：书页在工具栏下方；沉浸模式：书页铺满，工具栏悬浮出现，不挤压书页
function layout() {
  if (!alive()) return;
  const { width, height } = win.getContentBounds();
  if (ticker.on) {                      // 播报条模式：书页保持原来大小藏在后面（不重新分页），只显示播报条
    bar.setVisible(false);
    // 书页保持原尺寸（不重新分页），但整块移到窗口可见区域左侧之外：照常排版画字，却完全不会露出来
    if (ticker.pageBounds) { const pb = ticker.pageBounds; page.setBounds({ x: -(pb.width + 100), y: 0, width: pb.width, height: pb.height }); }
    ticker.view.setBounds({ x: 0, y: 0, width, height });
    return;
  }
  const top = cfg.showBar ? BAR_H : 0;
  bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
  bar.setVisible(cfg.showBar || peek);
  // 圆角：书页四角圆角；工具栏显示时书页顶部多出 RADIUS 像素藏在工具栏下面，把书页的上圆角遮住（正文同步下移，位置不变）
  const ov = cfg.round && top ? RADIUS : 0;
  page.setBounds({ x: 0, y: top - ov, width, height: Math.max(0, height - top + ov) });
  try { page.setBorderRadius(cfg.round ? RADIUS : 0); } catch {}
  setPageTop(ov);
}

// 调整窗口大小过程中只先调工具栏，书页等停止拖动 350ms 后再一次性调整：
// 网页每变一次大小就会重新分页，连续几十次重排会丢失阅读位置（跳回章节开头）
let resizeTimer = null;
let pageTop = 0;
function setPageTop(px) {
  if (px === pageTop) return;
  pageTop = px;
  pageJS(`window.__wrmTopDip = ${px}; window.__wrm && window.__wrm.setTop(${px});`);
}
function setRound(on) { cfg.round = on; layout(); applyMaterial(); saveCfg(); refreshTrayMenu(); }

function layoutDeferred() {
  if (!alive()) return;
  if (ticker.on) { layout(); return; }
  const { width } = win.getContentBounds();
  bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 350);
}

function sendState() {
  if (!barAlive() || !alive()) return;
  bar.webContents.send('state', {
    onTop: cfg.onTop, fade: cfg.fade, opacity: cfg.opacity, zoom: cfg.zoom,
    tone: cfg.tone, toneLabel: TONES[cfg.tone].label, immersive: !cfg.showBar,
    canBack: page.webContents.navigationHistory.canGoBack(),
    title: cleanTitle(page.webContents.getTitle()),
  });
  refreshTrayMenu();
}

function cleanTitle(t) {
  t = (t || '').replace(/\s*[-|–—]\s*微信读书.*$/, '').trim();
  return t || '微信读书';
}

function applyOpacity() {
  if (!alive()) return;
  const faded = cfg.fade && !hovering;
  // 隐身时鼠标穿透到下面的窗口，不挡操作；鼠标移回来自动恢复
  if (faded !== passThrough) {
    passThrough = faded;
    win.setIgnoreMouseEvents(faded, { forward: true });
  }
  win.setOpacity(faded ? cfg.fadeLevel : cfg.opacity);
  syncTickerHold();
}
// 播报条在看不见时自动暂停：隐身（鼠标移开）、隐藏到托盘 / 老板键；回来后自动继续（不影响手动暂停）
function syncTickerHold() {
  if (!alive() || !ticker.on) return;
  const hold = (cfg.fade && !hovering) || autoHidden || !win.isVisible() || win.isMinimized();
  tickerSend({ type: 'hold', on: hold });
}
// ---------- 字体缩放 ----------
function clampZoom(z) {
  z = Number(z) || 1;
  return Math.min(3, Math.max(0.6, Math.round(z * 100) / 100));
}
function setZoom(z) {
  cfg.zoom = clampZoom(z);
  page.webContents.setZoomFactor(cfg.zoom);
  pageJS(`window.__wrm && window.__wrm.setUiZoom(${cfg.zoom})`);
  saveCfg(); sendState();
}
function zoomStep(dir) {
  const cur = cfg.zoom;
  const next = dir > 0 ? ZOOMS.find(z => z > cur + 0.001) : [...ZOOMS].reverse().find(z => z < cur - 0.001);
  setZoom(next ?? cur);
}

// ---------- 色调 ----------
async function applyTone() {
  const wc = page.webContents;
  if (toneKey) { try { await wc.removeInsertedCSS(toneKey); } catch {} toneKey = null; }
  const css = TONES[cfg.tone].css;
  if (css) { try { toneKey = await wc.insertCSS(css); } catch {} }
}
function setTone(t) {
  cfg.tone = TONES[t] ? t : 'none';
  applyTone(); applyMaterial(); saveCfg(); sendState();
}
// 磨玻璃：窗口底层用系统的亚克力/毛玻璃材质（Windows 11、macOS），工具栏半透明地透出它。
// “透明”色调时关掉材质，让书页背后是清晰的桌面。
function applyMaterial() {
  if (!alive()) return;
  const clear = cfg.tone === 'clear' || ticker.on;   // 播报条模式一律关掉窗口材质：透明时不留色块，深色时保持圆角
  // 播报条和圆角窗口：关掉窗口底层的方形毛玻璃（系统材质只能是方的，会在圆角外露出方角）
  const noMaterial = clear || ticker.on || cfg.round;
  try {
    if (process.platform === 'win32' && win.setBackgroundMaterial) win.setBackgroundMaterial(noMaterial ? 'none' : 'acrylic');
    if (IS_MAC && win.setVibrancy) win.setVibrancy(noMaterial ? null : 'hud');
  } catch {}
  // 圆角模式下书页顶部有 RADIUS 像素藏在工具栏下面（遮住书页的上圆角），工具栏用不透明底，
  // 这样看不到下面的书页内容，工具栏和书页之间是一条干净的分界线（透明书页时保持半透明）
  const solid = !!cfg.round && cfg.tone !== 'clear';
  if (barAlive()) bar.webContents.send('glass', { clear: noMaterial, round: !!cfg.round, solid });
  tickerSend({ type: 'clear', clear: cfg.tickerClear });
}
function cycleTone() {
  setTone(TONE_ORDER[(TONE_ORDER.indexOf(cfg.tone) + 1) % TONE_ORDER.length]);
}

function setImmersive(on) {
  cfg.showBar = !on; peek = false; layout(); saveCfg(); sendState();
}

// 鼠标位置监视：移开变淡 + 沉浸模式下鼠标移到顶部弹出工具栏
function startWatcher() {
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    if (!alive() || !win.isVisible() || win.isMinimized()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (cfg.fade) {
      const now = Date.now();
      if (inside) hoverSince ||= now; else hoverSince = 0;
      if (!hovering && inside && now - hoverSince >= REVEAL_DELAY) { hovering = true; applyOpacity(); }
      else if (hovering && !inside && now > graceUntil) { hovering = false; applyOpacity(); }
    }
    if (!cfg.showBar && !ticker.on) {
      const wantPeek = peek
        ? inside && p.y < b.y + BAR_H + 12
        : inside && p.y < b.y + 8;
      if (wantPeek !== peek) { peek = wantPeek; layout(); }
    }
  }, 40);
}

function hideToTray() { if (!alive()) return; win.hide(); autoPauseHidden(true); }
function showWin() { if (!alive()) return; if (!win.isVisible() || win.isMinimized()) toggleShow(); else win.focus(); }
function toggleShow() {
  if (!alive()) return;
  if (win.isVisible() && !win.isMinimized()) hideToTray();
  else { if (win.isMinimized()) win.restore(); hovering = true; graceUntil = Date.now() + 1500; applyOpacity(); win.show(); win.focus(); autoPauseHidden(false); }
}

function pageKey(keyCode) {
  if (!alive()) return;
  const wc = page.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}

// ---------- 页面注入（窄边距 + 自动翻页执行器） ----------
const INJECT_SRC = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
const MARGINS = [[-1, '原版（不调整）'], [32, '宽松'], [16, '标准'], [8, '窄'], [2, '极窄']];
function inject() {
  if (!alive()) return;
  page.webContents.executeJavaScript(`window.__wrmZoom = ${cfg.zoom}; window.__wrmTopDip = ${pageTop};\n` + INJECT_SRC.replaceAll('__MARGIN__', String(cfg.margin)) + `\nwindow.__wrm && window.__wrm.setUiZoom(${cfg.zoom});`, true).catch(() => {});
}
function setMargin(m) { cfg.margin = m; inject(); saveCfg(); refreshTrayMenu(); }
function pageJS(code) {
  if (!alive()) return Promise.resolve(undefined);
  return page.webContents.executeJavaScript(code, true).catch(() => undefined);
}

// ---------- 自动翻页 ----------
// 自动识别阅读方式：左右翻页 → 每隔 N 秒点“下一页”；上下滚动 → 匀速滚动，到章末自动点“下一章”
const AUTO_INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180];
const AUTO_SPEEDS = [10, 15, 20, 30, 40, 55, 70, 90, 120];   // 像素/秒
let autoOn = false, autoHidden = false, autoTimer = null, autoNext = 0;
let readMode = 'page', appliedScroll = 0, modeCheckAt = 0, turning = false;

function isReader() { if (!alive()) return false; return /\/web\/reader\//.test(page.webContents.getURL()); }
function autoRunning() { return autoOn && !autoHidden; }

async function refreshMode() {
  const m = await pageJS('window.__wrm ? window.__wrm.mode() : null');
  if (m === 'page' || m === 'scroll') {
    if (m !== readMode) { readMode = m; autoNext = Date.now() + cfg.autoInterval * 1000; refreshTrayMenu(); }
  } else inject();
}
function syncScroll() {
  const want = autoRunning() && readMode === 'scroll' ? cfg.autoSpeed : 0;
  if (want !== appliedScroll) { appliedScroll = want; pageJS(`window.__wrm && window.__wrm.scroll(${want})`); }
}
async function autoTick() {
  if (!alive()) return;
  if (!autoOn) return;
  if (!isReader()) { setAuto(false); return; }
  const now = Date.now();
  if (now >= modeCheckAt) { modeCheckAt = now + 1000; await refreshMode(); }
  syncScroll();
  if (autoRunning() && readMode === 'page' && now >= autoNext && !turning) {
    turning = true;
    const r = await pageJS('window.__wrm ? window.__wrm.next() : "none"');
    if (r === 'busy') autoNext = Date.now() + 400;                 // 页面正在排版，稍后重试
    else { if (r !== 'ok') pageKey('Right'); autoNext = Date.now() + cfg.autoInterval * 1000; }
    turning = false;
  }
  sendAuto();
}
function sendAuto() {
  if (!barAlive()) return;
  const left = Math.max(0, Math.ceil((autoNext - Date.now()) / 1000));
  bar.webContents.send('auto', {
    on: autoOn, paused: autoHidden, mode: readMode,
    text: !autoOn ? '' : readMode === 'page' ? `${left}s` : `${cfg.autoSpeed}`,
  });
}
function setAuto(on) {
  if (on && !isReader()) { flashBar('先打开一本书'); on = false; }
  autoOn = on; modeCheckAt = 0;
  autoNext = Date.now() + cfg.autoInterval * 1000;
  clearInterval(autoTimer);
  if (on) { autoTimer = setInterval(autoTick, 100); autoTick(); }
  else syncScroll();
  sendAuto(); refreshTrayMenu();
}
function autoPauseHidden(h) {
  autoHidden = h;
  if (!h) autoNext = Date.now() + cfg.autoInterval * 1000;
  syncScroll(); sendAuto(); syncTickerHold();
}
function autoResetCountdown() { if (autoOn) { autoNext = Date.now() + cfg.autoInterval * 1000; sendAuto(); } }
function autoAdjust(dir) {          // 调快/调慢（按当前阅读方式）
  if (ticker.on) { tickerSpeed(dir); return; }
  if (readMode === 'page') {
    const i = AUTO_INTERVALS.indexOf(cfg.autoInterval);
    const j = Math.min(AUTO_INTERVALS.length - 1, Math.max(0, (i < 0 ? 4 : i) - dir));
    cfg.autoInterval = AUTO_INTERVALS[j];
    autoResetCountdown();
    flashBar(`每 ${cfg.autoInterval} 秒翻一页`);
  } else {
    const i = AUTO_SPEEDS.indexOf(cfg.autoSpeed);
    const j = Math.min(AUTO_SPEEDS.length - 1, Math.max(0, (i < 0 ? 4 : i) + dir));
    cfg.autoSpeed = AUTO_SPEEDS[j];
    syncScroll();
    flashBar(`滚动速度 ${cfg.autoSpeed} 像素/秒`);
  }
  saveCfg(); sendAuto(); refreshTrayMenu();
}
// 网页改版自动降级：inject.js 检测到微信读书网页结构变了会退回原版排版，这里负责提示（每次启动只提示一次）
let compatMode = false, compatNotified = false;
function setCompat(on) {
  if (on === compatMode) return;
  compatMode = on;
  refreshTrayMenu();
  if (on && !compatNotified) {
    compatNotified = true;
    flashBar({ text: '网页有变化，已换回原版排版', ms: 6000 });
    checkUpdate(false);                                  // 顺便看看有没有修好的新版本
  }
}
function flashBar(msg) {
  if (bar && !bar.webContents.isDestroyed()) bar.webContents.send('flash', msg);
  const ms = (typeof msg === 'object' && msg.ms) || 1500;
  if (!cfg.showBar && !peek) { peek = true; layout(); setTimeout(() => { if (!alive()) return; peek = false; layout(); }, ms); }
}
function autoMenu() {
  return [
    { label: autoOn ? '停止自动翻页' : '开始自动翻页', accelerator: 'Alt+P', click: () => setAuto(!autoOn) },
    { type: 'separator' },
    { label: `当前阅读方式：${readMode === 'page' ? '左右翻页 → 定时翻页' : '上下滚动 → 匀速滚动'}（自动识别）`, enabled: false },
    { type: 'separator' },
    { label: `翻页间隔（${cfg.autoInterval} 秒）`, submenu: AUTO_INTERVALS.map(v => ({
      label: `${v} 秒`, type: 'radio', checked: cfg.autoInterval === v,
      click: () => { cfg.autoInterval = v; autoResetCountdown(); saveCfg(); refreshTrayMenu(); },
    })) },
    { label: `滚动速度（${cfg.autoSpeed} 像素/秒）`, submenu: AUTO_SPEEDS.map(v => ({
      label: `${v} 像素/秒`, type: 'radio', checked: cfg.autoSpeed === v,
      click: () => { cfg.autoSpeed = v; syncScroll(); saveCfg(); sendAuto(); refreshTrayMenu(); },
    })) },
  ];
}

function boundsVisible(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
}

// 小窗内快捷键（书页和工具栏都生效）
function handleKeys(e, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const k = input.key;
  if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' '].includes(k) && !ctrl && !input.alt) autoResetCountdown();
  let handled = true;
  if (ctrl && (k === '=' || k === '+' || input.code === 'NumpadAdd')) zoomStep(1);
  else if (ctrl && (k === '-' || k === '_' || input.code === 'NumpadSubtract')) zoomStep(-1);
  else if (ctrl && (k === '0' || input.code === 'Numpad0')) setZoom(1);
  else if (k === 'F5') page.webContents.reload();
  else if (k === 'F11' || (ctrl && k.toLowerCase() === 'h')) setImmersive(cfg.showBar);
  else if (ctrl && k.toLowerCase() === 't') cycleTone();
  else if (ctrl && k.toLowerCase() === 'm') switchReadMode();
  else if (input.alt && k.toLowerCase() === 'p') setAuto(!autoOn);
  else if (input.alt && k === 'ArrowLeft' && !ctrl) {
    if (page.webContents.navigationHistory.canGoBack()) page.webContents.navigationHistory.goBack();
  } else if (k === 'Escape') closePanelOrImmersive();
  else handled = false;
  if (handled) e.preventDefault();
}

function pageContextMenu() {
  const wc = page.webContents;
  Menu.buildFromTemplate([
    { label: '后退', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: '刷新', accelerator: 'F5', click: () => wc.reload() },
    { type: 'separator' },
    { label: '字体放大', accelerator: 'CmdOrCtrl+=', click: () => zoomStep(1) },
    { label: '字体缩小', accelerator: 'CmdOrCtrl+-', click: () => zoomStep(-1) },
    { label: `恢复默认大小（当前 ${Math.round(cfg.zoom * 100)}%）`, accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
    { label: '阅读色调', submenu: toneMenu() },
    { label: autoOn ? '自动翻页（运行中）' : '自动翻页', submenu: autoMenu() },
    { label: '切换阅读方式（左右翻页 ⇄ 上下滚动）', accelerator: 'CmdOrCtrl+M', click: switchReadMode },
    { label: '播报条（单行滚动）', submenu: tickerMenu() },
    { label: '页面边距', submenu: marginMenu() },
    { type: 'separator' },
    { label: cfg.showBar ? '沉浸模式（隐藏工具栏）' : '退出沉浸模式', accelerator: 'CmdOrCtrl+H', click: () => setImmersive(cfg.showBar) },
    { label: '窗口置顶', type: 'checkbox', checked: cfg.onTop, click: (i) => setOnTop(i.checked) },
    { label: '回到书架', click: () => wc.loadURL(HOME + 'web/shelf') },
  ]).popup({ window: win });
}

function marginMenu() {
  return MARGINS.map(([v, l]) => ({ label: v < 0 ? l : `${l}（${v}px）`, type: 'radio', checked: cfg.margin === v, click: () => setMargin(v) }));
}
function toneMenu() {
  return TONE_ORDER.map(t => ({
    label: TONES[t].label, type: 'radio', checked: cfg.tone === t, click: () => setTone(t),
  }));
}
function zoomMenu() {
  return [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2].map(z => ({
    label: `${Math.round(z * 100)}%`, type: 'radio', checked: Math.abs(cfg.zoom - z) < 0.01, click: () => setZoom(z),
  }));
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  let b = cfg.bounds;
  if (!b || !boundsVisible(b)) {
    b = { width: 440, height: 660, x: wa.x + wa.width - 460, y: wa.y + wa.height - 680 };
  }

  win = new BaseWindow({
    ...b, minWidth: 260, minHeight: 200,
    frame: false, show: false, skipTaskbar: true,   // 不在任务栏显示，只在托盘
    alwaysOnTop: cfg.onTop, transparent: true, backgroundColor: '#00000000',   // 透明窗口：支持磨玻璃工具栏和透明书页
    icon: path.join(__dirname, 'icon.png'), title: '微信读书 · 桌面小窗',
  });
  if (cfg.onTop) win.setAlwaysOnTop(true, 'floating');
  // Mac：在所有桌面空间、包括其他应用全屏时都能显示
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  page = new WebContentsView({
    webPreferences: { partition: 'persist:weread', preload: path.join(__dirname, 'page-preload.js'), zoomFactor: cfg.zoom, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  win.contentView.addChildView(page);
  win.contentView.addChildView(bar);   // 后加入 → 悬浮在书页之上
  bar.setBackgroundColor('#00000000');
  page.setBackgroundColor('#00000000');

  bar.webContents.loadFile(path.join(__dirname, 'bar.html'));
  const wc = page.webContents;
  wc.setUserAgent(desktopUA());
  const start = typeof cfg.lastUrl === 'string' && cfg.lastUrl.startsWith(HOME) ? cfg.lastUrl : HOME;
  wc.loadURL(start);

  // 站内链接留在小窗，站外链接用系统浏览器打开
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(weread|qq)\.com\//i.test(url)) wc.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });
  const onNav = () => {
    const u = wc.getURL();
    if (u.startsWith(HOME)) { cfg.lastUrl = u; saveCfg(); }
    wc.setZoomFactor(cfg.zoom);
    if (autoOn && !isReader()) setAuto(false);
    inject();
    sendState();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('dom-ready', () => { toneKey = null; appliedScroll = 0; wc.setZoomFactor(cfg.zoom); applyTone(); inject(); });
  wc.on('page-title-updated', sendState);
  // 阅读进度显示在工具栏书名后面
  let lastProg = null;
  setInterval(async () => {
    if (!alive() || !barAlive()) return;
    const r = isReader() ? (await pageJS('window.__wrm && window.__wrm.progress ? [window.__wrm.progress(), !!(window.__wrm.compat && window.__wrm.compat())] : ["", false]')) || ['', false] : ['', false];
    const t = r[0] || '';
    if (t !== lastProg) { lastProg = t; bar.webContents.send('prog', t); }
    setCompat(!!r[1]);
  }, 400);
  wc.on('zoom-changed', (_e, dir) => zoomStep(dir === 'in' ? 1 : -1));   // Ctrl + 滚轮
  wc.on('context-menu', pageContextMenu);
  wc.on('before-input-event', handleKeys);
  bar.webContents.on('before-input-event', handleKeys);

  win.on('resize', () => { layoutDeferred(); cfg.bounds = win.getBounds(); saveCfg(); });
  win.on('resized', () => { clearTimeout(resizeTimer); layout(); });   // Windows：松开鼠标时立即应用
  win.on('move', () => { cfg.bounds = win.getBounds(); saveCfg(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); hideToTray(); } });
  win.on('minimize', () => { win.restore(); hideToTray(); });   // Win+D 等系统最小化也收到托盘

  layout();
  applyMaterial();
  graceUntil = Date.now() + 1500;   // 启动后先显示一会儿
  applyOpacity();
  win.show();
  bar.webContents.once('did-finish-load', () => { sendState(); applyMaterial(); });
  startWatcher();
}

// ---------- 拖动窗口（自己实现，比系统拖动区域更可靠） ----------
let dragFrom = null, dragTimer = null;
function dragStep() {
  if (!dragFrom || !alive()) return;
  if (Date.now() - dragFrom.t0 > 120000) { dragFrom = null; clearInterval(dragTimer); return; }   // 保险：最多 2 分钟
  const p = screen.getCursorScreenPoint();
  const x = Math.round(dragFrom.wx + p.x - dragFrom.cx), y = Math.round(dragFrom.wy + p.y - dragFrom.cy);
  const b = win.getBounds();
  if (b.x !== x || b.y !== y || b.width !== dragFrom.w || b.height !== dragFrom.h) {
    win.setBounds({ x, y, width: dragFrom.w, height: dragFrom.h });   // 每次都锁定原始宽高：Windows 缩放(125% 等)下单纯移动会让窗口越拖越大
  }
}
ipcMain.on('drag', (_e, t) => {
  if (!alive()) return;
  if (t === 'start') {
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    dragFrom = { cx: p.x, cy: p.y, wx: b.x, wy: b.y, w: b.width, h: b.height, t0: Date.now() };
    clearInterval(dragTimer);
    dragTimer = setInterval(dragStep, 10);       // 鼠标移出工具栏也能跟随
  } else if (t === 'move') dragStep();
  else { dragStep(); dragFrom = null; clearInterval(dragTimer); }
});

// ---------- 播报条（单行向左滚动，像新闻播报条） ----------
// 原理：网页把正文一个字一个字画到画布上，page-preload.js 记录下这些字，inject.js 按行拼成当前页的文字；
// 播报条快滚完时在后台自动翻到下一页，把新一页的文字接到后面。书页保持原大小藏在播报条后面，不会重新分页。
const TICKER_SPEEDS = [20, 30, 40, 50, 60, 80, 100, 120, 150, 200];   // 像素/秒
const TICKER_FONTS = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40];      // 播报条字号（像素）
const tickerHeight = () => Math.round(cfg.tickerFont * 2 + 8);           // 条的高度随字号变化
const ticker = { on: false, view: null, saved: null, pageBounds: null, sent: 0, reading: 0, busy: false, lastText: '',
  turns: 0, turnAt: {}, awaiting: false };   // turns：播报条实际翻过的页数；turnAt：每段文字对应翻到第几次
function tickerSend(m) { if (ticker.view && !ticker.view.webContents.isDestroyed()) ticker.view.webContents.send('ticker', m); }
async function tickerNextText(turn) {
  // turn=true：先翻到下一页；然后等新一页画完，取出文字（和上一段不同才算拿到）
  const before = ticker.lastText;
  if (turn) {
    const r = await pageJS('window.__wrm ? window.__wrm.next() : "none"');
    if (r === 'ok') ticker.turns++;
    else if (r === 'busy') return '';             // 网页正在排版，稍后再试（这次没翻页）
    else { pageKey('Right'); ticker.turns++; }
  }
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    const t = await pageJS('window.__wrm ? window.__wrm.pageText() : ""');
    if (t && t !== before) return t;
  }
  return '';
}
async function tickerFeed(turn) {
  if (!ticker.on || ticker.busy) return;
  ticker.busy = true;
  try {
    await pageJS('window.__wrm && window.__wrm.tickerHide(true)');   // 换章后网页可能重建，每次都确认书页是隐形的
    if (turn && ticker.awaiting) turn = false;    // 上次已经翻了页但还没拿到文字：不再重复翻，只等它画完
    let t = await tickerNextText(turn);
    ticker.awaiting = !t && (turn || ticker.awaiting);
    if (!t && !turn) {                           // 当前页还没记录到：让网页重画一次
      await pageJS('window.__wrm && window.__wrm.redraw()');
      t = await tickerNextText(false);
    }
    if (!ticker.on) return;
    if (t) { ticker.sent++; ticker.lastText = t; ticker.turnAt[ticker.sent] = ticker.turns; tickerSend({ type: 'seg', text: t, id: ticker.sent }); }
    else tickerSend({ type: 'retry' });
  } finally { ticker.busy = false; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function enterTicker() {
  if (ticker.on || !alive()) return;
  if (!isReader()) { flashBar('先打开一本书'); return; }
  const mode = await pageJS('window.__wrm ? window.__wrm.mode() : null');
  if (mode === 'scroll') { flashBar('播报条需要左右翻页模式，正在切换…'); await switchReadMode(); await sleep(2500); }
  if (autoOn) setAuto(false);
  ticker.saved = win.getBounds();
  ticker.pageBounds = page.getBounds();
  ticker.sent = 0; ticker.reading = 1; ticker.turns = 0; ticker.turnAt = {}; ticker.awaiting = false; ticker.lastText = '';
  if (!ticker.view) {
    ticker.view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    ticker.view.setBackgroundColor('#00000000');
    await ticker.view.webContents.loadFile(path.join(__dirname, 'ticker.html'));
  }
  await pageJS('window.__wrm && window.__wrm.tickerHide(true)');
  win.contentView.addChildView(ticker.view);
  ticker.on = true;
  win.setMinimumSize(160, 24);
  const h = tickerHeight();
  const b = ticker.saved;
  win.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h });   // 贴着原窗口底部收成一条
  layout();
  tickerSend({ type: 'reset' });
  tickerSend({ type: 'speed', speed: cfg.tickerSpeed });
  tickerSend({ type: 'font', size: cfg.tickerFont });
  tickerSend({ type: 'clear', clear: cfg.tickerClear });
  applyMaterial();
  syncTickerHold();
  tickerSend({ type: 'tip', text: '双击或 Esc 退出 · 滚轮调速度 · Ctrl+滚轮调字号' });
  refreshTrayMenu(); sendState();
  tickerFeed(false);
}
async function exitTicker() {
  if (!ticker.on || !alive()) return;
  const at = ticker.turnAt[ticker.reading];
  const back = Math.max(0, ticker.turns - (at === undefined ? ticker.turns : at));   // 预先翻过去、还没播到的页数
  ticker.on = false;
  applyMaterial();
  await pageJS('window.__wrm && window.__wrm.tickerHide(false)');
  win.contentView.removeChildView(ticker.view);
  win.setMinimumSize(260, 200);
  const s = ticker.saved, cur = win.getBounds();
  win.setBounds({ x: cur.x, y: cur.y + cur.height - s.height, width: s.width, height: s.height });
  layout(); saveCfg(); refreshTrayMenu(); sendState();
  for (let i = 0; i < back; i++) { await pageJS('window.__wrm && window.__wrm.prev()'); await sleep(350); }   // 回到正在播的那一页
}
function toggleTicker() { if (ticker.on) exitTicker(); else enterTicker(); }
function tickerSpeed(dir, show = true) {
  const i = TICKER_SPEEDS.indexOf(cfg.tickerSpeed);
  const j = Math.max(0, Math.min(TICKER_SPEEDS.length - 1, (i < 0 ? 4 : i) + dir));
  cfg.tickerSpeed = TICKER_SPEEDS[j]; saveCfg();
  tickerSend({ type: 'speed', speed: cfg.tickerSpeed, show });
  refreshTrayMenu();
}
function tickerFont(dir) {
  const i = TICKER_FONTS.indexOf(cfg.tickerFont);
  const j = Math.max(0, Math.min(TICKER_FONTS.length - 1, (i < 0 ? 3 : i) + dir));
  setTickerFont(TICKER_FONTS[j]);
}
function setTickerFont(px) {
  cfg.tickerFont = px; saveCfg();
  tickerSend({ type: 'font', size: px, show: true });
  if (ticker.on && alive()) {                     // 高度跟着字号变，底边位置不动
    const b = win.getBounds(), h = tickerHeight();
    win.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h });
    layout();
  }
  refreshTrayMenu();
}
function setTickerClear(v) {
  cfg.tickerClear = v; saveCfg();
  tickerSend({ type: 'clear', clear: v });
  applyMaterial(); refreshTrayMenu();
}
function tickerMenu() {
  return [
    { label: ticker.on ? '退出播报条' : '开启播报条（单行滚动）', accelerator: 'Alt+L', click: () => { showWin(); toggleTicker(); } },
    { label: `滚动速度（${cfg.tickerSpeed} 像素/秒）`, submenu: TICKER_SPEEDS.map((v) => ({
      label: `${v} 像素/秒${v === 60 ? '（默认）' : ''}`, type: 'radio', checked: cfg.tickerSpeed === v,
      click: () => { cfg.tickerSpeed = v; saveCfg(); tickerSend({ type: 'speed', speed: v, show: true }); refreshTrayMenu(); },
    })) },
    { label: `字号（${cfg.tickerFont}）`, submenu: TICKER_FONTS.map((v) => ({
      label: `${v}${v === 18 ? '（默认）' : ''}`, type: 'radio', checked: cfg.tickerFont === v, click: () => setTickerFont(v),
    })) },
    { label: '背景透明', type: 'checkbox', checked: cfg.tickerClear, click: (i) => setTickerClear(i.checked) },
  ];
}
ipcMain.on('ticker', (_e, type, val) => {
  if (!alive()) return;
  if (type === 'more') tickerFeed(true);
  else if (type === 'passed') ticker.reading = Math.max(ticker.reading, val || ticker.reading);
  else if (type === 'speed') tickerSpeed(val);
  else if (type === 'font') tickerFont(val);
  else if (type === 'bg') setTickerClear(!cfg.tickerClear);
  else if (type === 'exit') exitTicker();
  else if (type === 'menu') Menu.buildFromTemplate([...tickerMenu(), { type: 'separator' }, { label: '隐藏到托盘', click: hideToTray }]).popup({ window: win });
  else if (type === 'drag') ipcMain.emit('drag', _e, val);
  else if (type === 'rsz') { ipcMain.emit('rsz', _e, val); if (val === 'start' && rszFrom) rszFrom.widthOnly = true; }
});

// ---------- 右下角拖动调整窗口大小 ----------
function rszStep() {
  if (!rszFrom || !alive()) return;
  if (Date.now() - rszFrom.t0 > 120000) { rszFrom = null; clearInterval(rszTimer); return; }
  const p = screen.getCursorScreenPoint();
  const w = Math.max(ticker.on ? 160 : 260, Math.round(rszFrom.w + p.x - rszFrom.cx));
  const h = ticker.on && rszFrom.widthOnly ? rszFrom.h : Math.max(ticker.on ? 24 : 200, Math.round(rszFrom.h + p.y - rszFrom.cy));
  const b = win.getBounds();
  if (b.width !== w || b.height !== h || b.x !== rszFrom.x || b.y !== rszFrom.y) win.setBounds({ x: rszFrom.x, y: rszFrom.y, width: w, height: h });
}
let rszFrom = null, rszTimer = null;
ipcMain.on('rsz', (_e, t) => {
  if (!alive()) return;
  if (t === 'start') {
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    rszFrom = { cx: p.x, cy: p.y, x: b.x, y: b.y, w: b.width, h: b.height, t0: Date.now() };
    clearInterval(rszTimer); rszTimer = setInterval(rszStep, 16);
  } else { rszStep(); rszFrom = null; clearInterval(rszTimer); layout(); }
});

// ---------- 切换阅读方式（左右翻页 ⇄ 上下滚动） ----------
// 网页只认真实点击，这里在“切换”按钮的位置模拟一次鼠标点击
async function switchReadMode() {
  if (!isReader()) { flashBar('先打开一本书'); return; }
  const r = await pageJS('window.__wrm ? window.__wrm.toggleRect() : null');
  if (!r) { flashBar('暂时无法切换，请稍后再试'); return; }
  const z = page.webContents.getZoomFactor();
  const x = Math.round(r.x * z), y = Math.round(r.y * z);
  const wc = page.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  flashBar(r.to === 'scroll' ? '已切换为上下滚动' : '已切换为左右翻页');
  modeCheckAt = 0;
}

// Esc：先关闭网页里的弹窗（划线/想法等），没有弹窗时再退出沉浸模式
async function closePanelOrImmersive(onlyPanel) {
  const open = await pageJS('window.__wrm ? window.__wrm.panelOpen() : false');
  if (open) {
    const { width, height } = page.getBounds();
    const x = 10, y = Math.max(0, height - 6);   // 左下角（弹窗都不会盖到这里）
    const wc = page.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return;
  }
  if (!onlyPanel && !cfg.showBar) setImmersive(false);
}

// “⋯ 更多”菜单：窗口太窄时被收起的工具栏按钮，按工具栏上的顺序列出
function moreMenu(hidden) {
  const has = (id) => hidden.includes(id);
  const items = [];
  if (has('back')) items.push({ label: '后退', enabled: page.webContents.navigationHistory.canGoBack(), click: () => page.webContents.navigationHistory.goBack() });
  if (has('home')) items.push({ label: '返回书架', click: () => page.webContents.loadURL(HOME + 'web/shelf') });
  if (has('reload')) items.push({ label: '刷新', accelerator: 'F5', click: () => page.webContents.reload() });
  if (has('zoomGroup') || has('zv')) {
    if (items.length) items.push({ type: 'separator' });
    if (has('zoomGroup')) {
      items.push({ label: '字体放大', accelerator: 'CmdOrCtrl+=', click: () => zoomStep(1) });
      items.push({ label: '字体缩小', accelerator: 'CmdOrCtrl+-', click: () => zoomStep(-1) });
    }
    items.push({ label: `恢复字体大小（当前 ${Math.round(cfg.zoom * 100)}%）`, accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) });
  }
  if (has('autoGroup') || has('autoMore')) {
    if (items.length) items.push({ type: 'separator' });
    if (has('autoGroup')) items.push({ label: autoOn ? '停止自动翻页' : '开始自动翻页', accelerator: 'Alt+P', click: () => setAuto(!autoOn) });
    items.push({ label: '自动翻页设置', submenu: autoMenu() });
  }
  if (has('ticker')) items.push({ label: ticker.on ? '退出播报条' : '播报条（单行滚动）', accelerator: 'Alt+L', click: toggleTicker });
  if (has('tone')) items.push({ label: `阅读色调（${TONES[cfg.tone].label}）`, submenu: toneMenu() });
  if (has('op')) items.push({ label: `窗口不透明度（${Math.round(cfg.opacity * 100)}%）`, submenu: [100, 90, 80, 70, 60, 50, 40, 30].map((v) => ({
    label: `${v}%`, type: 'radio', checked: Math.round(cfg.opacity * 100) === v,
    click: () => { cfg.opacity = v / 100; applyOpacity(); saveCfg(); sendState(); },
  })) });
  if (has('fade') || has('pin') || has('immersive')) {
    items.push({ type: 'separator' });
    if (has('fade')) items.push({ label: '鼠标移开自动隐身', type: 'checkbox', checked: cfg.fade, click: (i) => setFade(i.checked) });
    if (has('pin')) items.push({ label: '窗口置顶', type: 'checkbox', checked: cfg.onTop, click: (i) => setOnTop(i.checked) });
    if (has('immersive')) items.push({ label: '沉浸模式（工具栏自动隐藏）', type: 'checkbox', checked: !cfg.showBar, accelerator: 'CmdOrCtrl+H', click: (i) => setImmersive(i.checked) });
  }
  if (has('min')) { items.push({ type: 'separator' }); items.push({ label: '隐藏到托盘', click: hideToTray }); }
  if (has('donate')) items.push({ type: 'separator' }, { label: '请作者喝瓶水', click: openDonate });   // 打赏收起时放在最底部，不抢眼
  while (items.length && items[0].type === 'separator') items.shift();
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: win, x: Math.max(0, win.getContentBounds().width - 220), y: BAR_H });
}

// ---------- 请作者喝水（打赏） ----------
// 收款码查找顺序：exe 旁边的 donate-wechat.png / donate-alipay.png（用户可自行替换）→ 打包进来的 donate/wechat.png / alipay.png
const XHS_URL = 'https://xhslink.cn/o/32REWxd38Tp';   // 作者小红书主页：反馈与新版本发布
let donateWin = null;
function donateCode(name) {
  const dirs = [[path.dirname(process.execPath), `donate-${name}`], [path.join(__dirname, 'donate'), name]];
  for (const [dir, base] of dirs) {
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const f = path.join(dir, `${base}.${ext}`);
      try { if (fs.existsSync(f)) return `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,` + fs.readFileSync(f).toString('base64'); } catch {}
    }
  }
  return '';
}
function openDonate() {
  if (donateWin && !donateWin.isDestroyed()) { donateWin.show(); donateWin.focus(); return; }
  const W = 280, H = 494;
  const area = screen.getDisplayMatching(alive() ? win.getBounds() : { x: 0, y: 0, width: 1, height: 1 }).workArea;
  // 透明窗口 + 页面里画 8px 圆角卡片，和小窗的圆角一致（系统毛玻璃只能是方的，所以不用）
  donateWin = new BrowserWindow({
    width: W, height: H, x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + (area.height - H) / 2),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  donateWin.setMenu(null);
  donateWin.webContents.setWindowOpenHandler(({ url }) => {   // 弹窗里的链接用系统浏览器打开
    if (url === XHS_URL) shell.openExternal(url);
    return { action: 'deny' };
  });
  donateWin.loadFile(path.join(__dirname, 'donate.html'));
  donateWin.webContents.once('did-finish-load', () => {
    if (!donateWin || donateWin.isDestroyed()) return;
    donateWin.webContents.executeJavaScript(`setCodes(${JSON.stringify({ wx: donateCode('wechat'), ali: donateCode('alipay'), xhs: XHS_URL, xhsIcon: donateCode('xhs') })}); new Promise((r) => setTimeout(() => r(contentHeight()), 60))`)
      .then((h) => {                                       // 窗口高度贴合内容，上下留白一致
        if (!donateWin || donateWin.isDestroyed()) return;
        if (h > 200 && h < 900) { donateWin.setContentSize(W, h); const b = donateWin.getBounds(); donateWin.setBounds({ ...b, y: Math.round(area.y + (area.height - b.height) / 2) }); }
      })
      .catch(() => {})
      .finally(() => { if (donateWin && !donateWin.isDestroyed()) donateWin.show(); });
  });
  donateWin.on('closed', () => { donateWin = null; });
}

// ---------- 工具栏事件 ----------
ipcMain.on('cmd', (_e, cmd, val) => {
  if (!alive()) return;
  switch (cmd) {
    case 'home': page.webContents.loadURL(HOME + 'web/shelf'); break;
    case 'back': if (page.webContents.navigationHistory.canGoBack()) page.webContents.navigationHistory.goBack(); break;
    case 'reload': page.webContents.reload(); break;
    case 'pin': setOnTop(!cfg.onTop); return;
    case 'fade': setFade(!cfg.fade); return;
    case 'zoomIn': zoomStep(1); return;
    case 'zoomOut': zoomStep(-1); return;
    case 'zoomReset': setZoom(1); return;
    case 'tone': cycleTone(); return;
    case 'switchMode': switchReadMode(); return;
    case 'auto': setAuto(!autoOn); return;
    case 'ticker': toggleTicker(); return;
    case 'more': moreMenu(Array.isArray(val) ? val : []); return;
    case 'autoFaster': autoAdjust(1); return;
    case 'autoSlower': autoAdjust(-1); return;
    case 'autoMenu': Menu.buildFromTemplate(autoMenu()).popup({ window: win }); return;
    case 'opacity':
      cfg.opacity = Math.min(1, Math.max(0.2, Number(val) || 1)); applyOpacity(); saveCfg(); return;
    case 'immersive': setImmersive(cfg.showBar); return;
    case 'min': hideToTray(); break;
    case 'donate': openDonate(); break;
    case 'close': hideToTray(); break;
  }
  sendState();
});

function setOnTop(v) {
  cfg.onTop = v; win.setAlwaysOnTop(v, 'floating'); saveCfg(); sendState();
}
function setFade(v) {
  cfg.fade = v; hovering = true; hoverSince = 0; graceUntil = Date.now() + 800; applyOpacity(); saveCfg(); sendState();
}

// ---------- 托盘 ----------
// ---------- 检查新版本 ----------
// 仓库里的 version.json 写着最新版本号和下载地址；先走国内能访问的 jsDelivr 镜像，再走 GitHub 原站。
// 启动 15 秒后查一次，之后每 12 小时查一次；有新版时托盘菜单第一项提示，工具栏书名处闪一下（每个新版本只闪一次）。
const UPDATE_SOURCES = [
  'https://cdn.jsdelivr.net/gh/eightttttt/weread-mini@main/version.json',
  'https://fastly.jsdelivr.net/gh/eightttttt/weread-mini@main/version.json',
  'https://raw.githubusercontent.com/eightttttt/weread-mini/main/version.json',
];
let update = null;          // { version, url, notes }：发现的新版本
let updateTimer = null;
function verNum(v) { return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0); }
function newerThan(a, b) {
  const x = verNum(a), y = verNum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function fetchVersionInfo() {
  for (const src of UPDATE_SOURCES) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await net.fetch(src + '?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.version) return j; }
    } catch {} finally { clearTimeout(t); }
  }
  return null;
}
async function checkUpdate(manual) {
  const info = await fetchVersionInfo();
  if (quitting) return;
  if (!info) {
    if (manual) dialog.showMessageBox({ type: 'info', title: '检查新版本', message: '暂时连不上更新服务器',
      detail: `请稍后再试，也可以在小红书 @东尼滝谷 查看新版本。\n当前版本：v${app.getVersion()}`, buttons: ['好的'] });
    return;
  }
  const has = newerThan(info.version, app.getVersion());
  update = has ? { version: String(info.version).replace(/^v/i, ''), url: info.url || XHS_URL, notes: info.notes || '' } : null;
  refreshTrayMenu();
  if (has && cfg.updNotified !== update.version) {
    cfg.updNotified = update.version; saveCfg();
    flashBar({ text: `新版本 v${update.version}`, ms: 5000 });   // 详情和下载在托盘菜单第一项
  }
  if (manual) {
    if (has) {
      const r = await dialog.showMessageBox({ type: 'info', title: '检查新版本', message: `发现新版本 v${update.version}`,
        detail: `当前版本：v${app.getVersion()}${update.notes ? '\n\n' + update.notes : ''}`, buttons: ['去下载', '以后再说'], defaultId: 0, cancelId: 1 });
      if (r.response === 0) shell.openExternal(update.url);
    } else {
      dialog.showMessageBox({ type: 'info', title: '检查新版本', message: '已经是最新版本', detail: `当前版本：v${app.getVersion()}`, buttons: ['好的'] });
    }
  }
}
function startUpdateCheck() {
  setTimeout(() => { if (!quitting) checkUpdate(false); }, 15000);
  updateTimer = setInterval(() => { if (!quitting) checkUpdate(false); }, 12 * 3600 * 1000);
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed() || quitting) return;
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(update ? [{ label: `⬆ 有新版本 v${update.version}（点击下载）`, click: () => shell.openExternal(update.url) }, { type: 'separator' }] : []),
    ...(compatMode ? [{ label: '兼容模式：微信读书网页有变化，暂用原版排版', enabled: false }, { label: '检查有没有修复的新版本', click: () => checkUpdate(true) }, { type: 'separator' }] : []),
    { label: `显示 / 隐藏　${ALT}Q`, click: toggleShow },
    { type: 'separator' },
    { label: `字体大小（${Math.round(cfg.zoom * 100)}%）`, submenu: zoomMenu() },
    { label: `阅读色调（${TONES[cfg.tone].label}）`, submenu: toneMenu() },
    { label: autoOn ? '自动翻页（运行中）' : '自动翻页', submenu: autoMenu() },
    { label: '切换阅读方式（左右翻页 ⇄ 上下滚动）', click: () => { showWin(); switchReadMode(); } },
    { label: ticker.on ? '播报条（运行中）' : '播报条（单行滚动）', submenu: tickerMenu() },
    { label: `页面边距（${(MARGINS.find(x => x[0] === cfg.margin) || [0, ''])[1]}）`, submenu: marginMenu() },
    { type: 'separator' },
    { label: '窗口置顶', type: 'checkbox', checked: cfg.onTop, click: (i) => setOnTop(i.checked) },
    { label: '鼠标移开自动隐身', type: 'checkbox', checked: cfg.fade, click: (i) => setFade(i.checked) },
    { label: '隐身程度', submenu: [[0, '完全透明'], [0.05, '5%'], [0.12, '12%'], [0.25, '25%'], [0.4, '40%']].map(([v, l]) => ({
      label: l, type: 'radio', checked: Math.abs(cfg.fadeLevel - v) < 0.001,
      click: () => { cfg.fadeLevel = v; applyOpacity(); saveCfg(); },
    })) },
    { label: '圆角窗口', type: 'checkbox', checked: !!cfg.round, click: (i) => setRound(i.checked) },
    { label: '沉浸模式（工具栏自动隐藏）', type: 'checkbox', checked: !cfg.showBar, click: (i) => setImmersive(i.checked) },
    { label: '开机自动启动', type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: '回到书架', click: () => { page.webContents.loadURL(HOME + 'web/shelf'); win.show(); } },
    { label: '窗口复位到右下角', click: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      win.setBounds({ width: 440, height: 660, x: wa.x + wa.width - 460, y: wa.y + wa.height - 680 });
      win.show();
    } },
    { label: '退出登录（清除登录信息）', click: async () => {
      await session.fromPartition('persist:weread').clearStorageData();
      page.webContents.loadURL(HOME);
    } },
    { type: 'separator' },
    { label: `检查新版本（当前 v${app.getVersion()}）`, click: () => checkUpdate(true) },
    { label: '反馈与更新（小红书 @东尼滝谷）', click: () => shell.openExternal(XHS_URL) },
    { label: '请作者喝瓶水', click: openDonate },
    { label: '退出', click: () => { shutdown(); app.quit(); } },
  ]));
}

function createTray() {
  // Mac 顶部菜单栏用黑白模板图标（自动适配深色/浅色菜单栏）
  const icon = nativeImage.createFromPath(path.join(__dirname, IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  if (IS_MAC) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(`微信读书 · 桌面小窗（${ALT}Q 显示/隐藏）`);
  if (!IS_MAC) tray.on('click', toggleShow);        // Mac 上点图标直接弹出菜单
  refreshTrayMenu();
}

// ---------- 全局快捷键 ----------
function registerKeys() {
  const keys = {
    'Alt+Q': toggleShow,                       // 老板键：显示/隐藏
    'Alt+Right': async () => {                                      // 不切窗口也能翻下一页
      const r = await pageJS('window.__wrm ? window.__wrm.next() : "none"');
      if (r !== 'ok') pageKey('Right'); autoResetCountdown();
    },
    'Alt+Left': async () => {                                       // 上一页
      const r = await pageJS('window.__wrm ? window.__wrm.prev() : false');
      if (!r) pageKey('Left'); autoResetCountdown();
    },
    'Alt+P': () => setAuto(!autoOn),                                  // 自动翻页 开/停
    'Alt+L': () => { showWin(); toggleTicker(); },                    // 播报条 开/关
    'Alt+]': () => autoAdjust(1),                                     // 自动翻页 加快
    'Alt+[': () => autoAdjust(-1),                                    // 自动翻页 减慢
    'Alt+Up': () => { cfg.opacity = Math.min(1, cfg.opacity + 0.1); applyOpacity(); saveCfg(); sendState(); },
    'Alt+Down': () => { cfg.opacity = Math.max(0.2, cfg.opacity - 0.1); applyOpacity(); saveCfg(); sendState(); },
  };
  for (const [k, fn] of Object.entries(keys)) {
    try { globalShortcut.register(k, fn); } catch {}
  }
}

app.on('second-instance', () => { if (win) showWin(); });
function shutdown() {
  if (quitting) return;
  quitting = true;
  clearInterval(watchTimer); clearInterval(autoTimer); clearInterval(updateTimer); clearInterval(dragTimer); clearInterval(rszTimer);
  clearTimeout(saveTimer);
  try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {}   // 退出前立即保存设置
}
app.on('before-quit', shutdown);
// 兜底：任何意外错误只写日志，不弹窗打扰
process.on('uncaughtException', (err) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${err && err.stack || err}\n`); } catch {}
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(() => {
  if (IS_MAC) {
    if (app.dock) app.dock.hide();                  // 不在 Dock 显示，只在顶部菜单栏
    // 精简的应用菜单：保留 ⌘C/⌘V/⌘A 和 ⌘Q，去掉系统默认的 ⌘H(隐藏)、⌘M(最小化)，让它们给小窗用
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '微信读书小窗', submenu: [{ role: 'about', label: '关于微信读书小窗' }, { type: 'separator' },
        { label: '退出', accelerator: 'Cmd+Q', click: () => { shutdown(); app.quit(); } }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    ]));
  }
  app.setAppUserModelId('weread.mini.desktop');
  loadCfg();
  session.fromPartition('persist:weread').setUserAgent(desktopUA());
  createWindow();
  createTray();
  registerKeys();
  startUpdateCheck();
});
