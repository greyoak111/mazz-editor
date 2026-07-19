// scripts/ensure-runtime.js —— postinstall 兜底：确保 Electron 二进制就位（GitHub 不通时自动走 npmmirror）
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
if (!fs.existsSync(electronDir)) {
  console.log('[ensure-runtime] 未安装 electron（可能仅安装了生产依赖），跳过');
  process.exit(0);
}

const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron';
const distExe = path.join(electronDir, 'dist', exeName);
if (fs.existsSync(distExe)) {
  console.log('[ensure-runtime] Electron 二进制已就位，跳过');
  process.exit(0);
}

console.log('[ensure-runtime] Electron 二进制缺失，执行补下载…');
const env = { ...process.env };
if (!env.ELECTRON_MIRROR && !env.electron_mirror) {
  env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  console.log('[ensure-runtime] 使用镜像:', env.ELECTRON_MIRROR);
}
try {
  execSync(`node "${path.join(electronDir, 'install.js')}"`, { stdio: 'inherit', env });
} catch (e) {
  console.warn('[ensure-runtime] 自动补下载失败。请手动执行：');
  console.warn('  Windows:  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && node node_modules\\electron\\install.js');
  console.warn('  macOS/Linux: export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && node node_modules/electron/install.js');
  process.exit(0); // 不阻塞 npm install 整体流程
}

if (fs.existsSync(distExe)) {
  console.log('[ensure-runtime] Electron 二进制补下载完成');
} else {
  console.warn('[ensure-runtime] 仍未发现二进制，请参考 README「常见问题」手动放置');
}
