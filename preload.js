const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  cmd: (c, v) => ipcRenderer.send('cmd', c, v),
  drag: (t) => ipcRenderer.send('drag', t),
  ticker: (type, val) => ipcRenderer.send('ticker', type, val),
  onTicker: (fn) => ipcRenderer.on('ticker', (_e, m) => fn(m)),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onAuto: (fn) => ipcRenderer.on('auto', (_e, s) => fn(s)),
  onFlash: (fn) => ipcRenderer.on('flash', (_e, s) => fn(s)),
  onGlass: (fn) => ipcRenderer.on('glass', (_e, s) => fn(s)),
  onProg: (fn) => ipcRenderer.on('prog', (_e, s) => fn(s)),
});
