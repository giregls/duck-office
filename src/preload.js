// The only bridge between the page and Electron: a handful of messages.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('duckApi', {
  onSnapshot: (cb) => ipcRenderer.on('snapshot', (_e, snap) => cb(snap)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  ready: () => ipcRenderer.send('ready'),
  setMode: (mode) => ipcRenderer.send('set-mode', mode),
  demoChanged: (on) => ipcRenderer.send('demo-changed', on),
  captureResult: (dataUrl) => ipcRenderer.send('capture-result', dataUrl),
  quit: () => ipcRenderer.send('quit'),
});
