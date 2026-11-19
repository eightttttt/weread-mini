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
