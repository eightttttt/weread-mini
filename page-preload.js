// 书页里的小助手：按住 Alt + 鼠标左键，在窗口任意位置拖动窗口
// 只向主进程发送“开始/结束拖动”，不向网页暴露任何接口
const { ipcRenderer, webFrame } = require('electron');

// 在网页脚本运行前，记录它画到画布上的每个字（微信读书正文是一个字一个字画上去的），供“播报条”读取当前页文字。
// 只做记录，不改变网页的任何显示。
webFrame.executeJavaScript(`(() => {
  window.__wrmInitDpr = window.devicePixelRatio;   // 网页启动时的缩放比例（微信读书只在启动时读取一次）
  // 微信读书用正文容器的 offsetTop/offsetLeft 把鼠标位置换算成文字位置，
  // 但小窗为了收窄边距把外层容器上移、加宽了，offsetTop/offsetLeft 不包含这部分位移，
  // 划线就会选到鼠标上方的文字。这里让正文容器报告它在页面上的真实位置。
  if (!HTMLElement.prototype.__wrmOffPatched) {
    HTMLElement.prototype.__wrmOffPatched = true;
    const H = HTMLElement.prototype;
    const oTop = Object.getOwnPropertyDescriptor(H, 'offsetTop');
    const oLeft = Object.getOwnPropertyDescriptor(H, 'offsetLeft');
    const isRT = (el) => el.classList && el.classList.contains('renderTargetContainer');
    Object.defineProperty(H, 'offsetTop', { configurable: true, get() {
      if (isRT(this) && this.isConnected) return this.getBoundingClientRect().top + window.scrollY;
      return oTop.get.call(this);
    } });
    Object.defineProperty(H, 'offsetLeft', { configurable: true, get() {
      if (isRT(this) && this.isConnected) return this.getBoundingClientRect().left + window.scrollX;
      return oLeft.get.call(this);
    } });
  }
  const P = CanvasRenderingContext2D.prototype;
  if (P.__wrmHooked) return;
  P.__wrmHooked = true;
  const bufs = new WeakMap();
  const oFill = P.fillText, oClear = P.clearRect;
  P.clearRect = function (x, y, w, h) {
    try { const c = this.canvas; if (w >= c.width * 0.9 && h >= c.height * 0.9) bufs.set(c, []); } catch (e) {}
    return oClear.apply(this, arguments);
  };
  P.fillText = function (t, x, y) {
    try {
      const c = this.canvas; let b = bufs.get(c);
      if (!b) { b = []; bufs.set(c, b); }
      const m = this.getTransform();
      b.push([String(t), x * m.a + m.e, y * m.d + m.f]);
      if (b.length > 30000) b.splice(0, 15000);
    } catch (e) {}
    return oFill.apply(this, arguments);
  };
  window.__wrmCanvasText = (c) => bufs.get(c) || [];
})();`);

let dragging = false;
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.altKey) return;
  e.preventDefault(); e.stopImmediatePropagation();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  dragging = true;
  ipcRenderer.send('drag', 'start');
}, true);
const end = (e) => {
  if (!dragging) return;
  dragging = false;
  if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
  ipcRenderer.send('drag', 'end');
};
window.addEventListener('pointerup', end, true);
window.addEventListener('pointercancel', end, true);
window.addEventListener('blur', () => end());
// 拖动时屏蔽网页的点击/选中，避免误翻页或误划线
for (const t of ['mousedown', 'mouseup', 'click']) {
  window.addEventListener(t, (e) => { if (dragging || (e.altKey && e.button === 0)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

// 右下角拖动调整窗口大小（窗口是透明的，部分系统上不能拖边框调大小）
const CORNER = 7;    // 只占最角落 7px，☰ 按钮在它内侧，互不干扰
let resizing = false;
const inCorner = (e) => e.clientX >= innerWidth - CORNER && e.clientY >= innerHeight - CORNER;
window.addEventListener('pointermove', (e) => {
  if (resizing) return;
  const on = inCorner(e);
  if (on !== window.__wrmCornerCursor) {
    window.__wrmCornerCursor = on;
    document.documentElement.style.cursor = on ? 'nwse-resize' : '';
  }
}, true);
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.altKey || !inCorner(e)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  resizing = true;
  ipcRenderer.send('rsz', 'start');
}, true);
const endResize = (e) => {
  if (!resizing) return;
  resizing = false;
  if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
  ipcRenderer.send('rsz', 'end');
};
window.addEventListener('pointerup', endResize, true);
window.addEventListener('pointercancel', endResize, true);
window.addEventListener('blur', () => endResize());
// 调整大小时屏蔽这次点击，避免误翻页
window.addEventListener('click', (e) => { if (inCorner(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
