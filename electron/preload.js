'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xmage', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  runInstall: (cfg) => ipcRenderer.invoke('install:run', cfg),
  launchClient: () => ipcRenderer.invoke('client:launch'),
  launchServer: () => ipcRenderer.invoke('server:launch'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  winClose: () => ipcRenderer.invoke('win:close'),
  winMin: () => ipcRenderer.invoke('win:min'),
  onConsole: (cb) => ipcRenderer.on('console:line', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onPhase: (cb) => ipcRenderer.on('phase', (_e, p) => cb(p)),
  onProcState: (cb) => ipcRenderer.on('proc:state', (_e, p) => cb(p)),
});
