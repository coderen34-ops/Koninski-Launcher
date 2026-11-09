'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  play: (data) => ipcRenderer.invoke('play', data),
  openFolder: (sel) => ipcRenderer.invoke('openFolder', sel),
  onStatus: (cb) => ipcRenderer.on('status', (_e, p) => cb(p)),
  onStarted: (cb) => ipcRenderer.on('started', () => cb()),
  onClosed: (cb) => ipcRenderer.on('closed', (_e, p) => cb(p))
});
