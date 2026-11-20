// 书页里的小助手：按住 Alt + 鼠标左键，在窗口任意位置拖动窗口
// 只向主进程发送“开始/结束拖动”，不向网页暴露任何接口
const { ipcRenderer } = require('electron');

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
