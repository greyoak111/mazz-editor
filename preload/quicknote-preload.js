// preload/quicknote-preload.js —— 快速笔记小窗的最小桥
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mazzNote', {
  async save(text) {
    const res = await ipcRenderer.invoke('mazz:invoke', { channel: 'quicknote:save', payload: { text } });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  async close() {
    await ipcRenderer.invoke('mazz:invoke', { channel: 'quicknote:close', payload: {} });
  },
  onFocus(callback) {
    ipcRenderer.on('mazz:event', (_e, { channel, payload }) => {
      if (channel === 'quicknote:focus') callback(payload);
    });
  },
});
