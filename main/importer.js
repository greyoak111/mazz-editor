// main/importer.js —— 外部文件/文件夹导入工作区 + Windows 资源管理器右键菜单注册
// 导入：递归复制进工作区根目录，重名自动「名称 (1)」避让
// 注册表：HKCU 写入（无需管理员），右键「导入到 Mazz 工作区」→ 启动参数 --import "<路径>"
'use strict';
const fs = require('fs');
const path = require('path');

/** 目标路径避让：name, name (1), name (2)… */
function uniqueDest(ws, base) {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 0; ; i++) {
    const name = i === 0 ? base : `${stem} (${i})${ext}`;
    const dest = path.join(ws, name);
    if (!fs.existsSync(dest)) return dest;
  }
}

/**
 * 导入若干外部路径到工作区
 * @param {string} ws 工作区绝对路径
 * @param {string[]} sources 文件/文件夹绝对路径
 * @returns {{imported: string[], skipped: string[], workspace: string}}
 */
function importExternal(ws, sources, { cp } = {}) {
  const copy = cp || ((s, d) => fs.cpSync(s, d, { recursive: true }));
  const imported = [];
  const skipped = [];
  for (const src of sources || []) {
    try {
      if (!src || !fs.existsSync(src)) { skipped.push(src); continue; }
      const dest = uniqueDest(ws, path.basename(src));
      copy(src, dest);
      imported.push(dest);
    } catch { skipped.push(src); }
  }
  return { imported, skipped, workspace: ws };
}

// ==================== Windows 资源管理器右键菜单 ====================
const VERB = 'MazzImport';
const LABEL = '导入到 Mazz 工作区';

/** 需要写入的注册表项（文件 * / 文件夹 Directory / 文件系统对象 AllFilesystemObjects） */
function explorerEntries(exePath, { appPath } = {}) {
  // 开发态（electron .）：exe 是裸 electron.exe，必须把应用目录作为首参，否则右键唤起的是空壳
  const cmd = appPath ? `"${exePath}" "${appPath}" --import "%1"` : `"${exePath}" --import "%1"`;
  // 注意：不要注册 AllFilesystemObjects——它与 *\\shell 对文件重复生效（右键菜单出现两次）
  return [
    { key: `HKCU\\Software\\Classes\\*\\shell\\${VERB}`, label: LABEL, icon: exePath, cmd },
    { key: `HKCU\\Software\\Classes\\Directory\\shell\\${VERB}`, label: LABEL, icon: exePath, cmd },
  ];
}

/** 注册/注销/查询（runner 可注入，便于测试与离线） */
async function registerExplorerMenu(exePath, { run, appPath } = {}) {
  if (process.platform !== 'win32' && !run) return { ok: false, reason: 'unsupported' };
  const exec = run || ((cmd, args) => new Promise((res) => {
    require('child_process').execFile(cmd, args, { windowsHide: true }, (e, so, se) => res({ ok: !e, out: ((so || '') + (se || '')).toString() }));
  }));
  // 先清历史误注册的 AllFilesystemObjects（与 *\\shell 重复，管家类工具会显示两次）
  await exec('reg', ['delete', `HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\${VERB}`, '/f']);
  for (const e of explorerEntries(exePath, { appPath })) {
    // 展示名：默认值为兼容旧壳，MUIVerb 为正规入口（两者都写）
    for (const step of [
      ['add', e.key, '/ve', '/d', e.label, '/f'],
      ['add', e.key, '/v', 'MUIVerb', '/d', e.label, '/f'],
      ['add', e.key, '/v', 'Icon', '/d', e.icon, '/f'],
      ['add', e.key + '\\command', '/ve', '/d', e.cmd, '/f'],
    ]) {
      const r = await exec('reg', step);
      if (!r.ok) return { ok: false, reason: `reg ${step[0]} ${step[1]} 失败：${r.out.trim() || '未知错误'}` };
    }
  }
  // 回读验证：写入后查不到 = 被杀软/组策略拦了
  const check = await exec('reg', ['query', `HKCU\\Software\\Classes\\*\\shell\\${VERB}\\command`, '/ve']);
  if (!check.ok || !check.out.includes('--import')) {
    return { ok: false, reason: '写入后回读失败（可能被安全软件拦截）' };
  }
  return { ok: true };
}

async function unregisterExplorerMenu({ run } = {}) {
  const exec = run || ((cmd, args) => new Promise((res) => {
    require('child_process').execFile(cmd, args, { windowsHide: true }, (e, so) => res({ ok: !e, out: (so || '').toString() }));
  }));
  await exec('reg', ['delete', `HKCU\\Software\\Classes\\*\\shell\\${VERB}`, '/f']);
  await exec('reg', ['delete', `HKCU\\Software\\Classes\\Directory\\shell\\${VERB}`, '/f']);
  await exec('reg', ['delete', `HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\${VERB}`, '/f']);
  return { ok: true };
}

async function explorerMenuStatus({ run, appPath } = {}) {
  const exec = run || ((cmd, args) => new Promise((res) => {
    require('child_process').execFile(cmd, args, { windowsHide: true }, (e, so) => res({ ok: !e, out: (so || '').toString() }));
  }));
  const r = await exec('reg', ['query', `HKCU\\Software\\Classes\\*\\shell\\${VERB}\\command`, '/ve']);
  const registered = r.ok && r.out.includes('--import');
  // 陈旧判定：命令缺 --import 标记（老版本注册残留），或开发态缺应用目录首参（右键唤起空壳）
  const stale = registered
    ? (appPath ? !r.out.includes(appPath) : false)
    : (r.ok && r.out.includes(VERB)); // 有 verb 但没 --import 也是陈旧
  return { registered: registered || (r.ok && r.out.includes(VERB)), stale, raw: r.out };
}

/** 从启动参数提取 --import 后的路径（文件或文件夹均可） */
function extractImportPaths(argv, { resolve = true } = {}) {
  const args = (argv || []).slice(1);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--import' && args[i + 1]) {
      const p = args[++i].replace(/^"+|"+$/g, '');
      try {
        if (fs.existsSync(p)) out.push(resolve ? path.resolve(p) : p);
      } catch { /* 路径不存在则跳过 */ }
    }
  }
  return out;
}

module.exports = { importExternal, uniqueDest, explorerEntries, registerExplorerMenu, unregisterExplorerMenu, explorerMenuStatus, extractImportPaths, VERB, LABEL };
