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
    this.data[key] = value;
    this.flush();
  }
  merge(obj) {
    Object.assign(this.data, obj);
    this.flush();
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file); // 原子写，防半文件
    } catch (e) { console.error('[store] flush failed:', e.message); }
  }
}
module.exports = Store;
