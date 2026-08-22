// main/store.js —— 极简 JSON 持久化（设置/最近文件/窗口状态）
'use strict';
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = { ...defaults };
    try {
      if (fs.existsSync(file)) {
        this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      }
    } catch { /* 损坏则回退默认值 */ }
  }
  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }
  set(key, value) {
    const next = { ...this.data, [key]: value };
    this._write(next);
    this.data = next;
    return true;
  }
  merge(obj) {
    const next = { ...this.data, ...(obj || {}) };
    this._write(next);
    this.data = next;
    return true;
  }
  flush() {
    this._write(this.data);
    return true;
  }
  _write(snapshot) {
    const tmp = this.file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      fs.renameSync(tmp, this.file); // 原子写，防半文件
    } catch (error) {
      // A failed rename/write is a failed transaction.  Keep the last durable
      // in-memory snapshot and propagate the error so IPC/CAS/close gates can
      // report failure instead of acknowledging data that never reached disk.
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
  }
}
module.exports = Store;
