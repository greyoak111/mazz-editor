// main/startmenu.js —— 读取开始菜单已安装软件 → 按模块类型提供「外部打开」快速拉起
// 扫描两个 Programs 目录的 .lnk，按类别规则匹配文件名，PowerShell COM 批量解析目标路径
// 结果缓存 7 天（settings: apps.quickLaunch），支持手动刷新
'use strict';
const fs = require('fs');
const path = require('path');

// —— 类别规则：模块 → 软件候选（lnk 文件名正则 + 展示名 + emoji）——
const CANDIDATES = {
  word: [
    { re: /^Microsoft Word/i, name: 'Word', icon: '📘' },
    { re: /^Word$/i, name: 'Word', icon: '📘' },
    { re: /WPS 文字|WPS Writer/i, name: 'WPS 文字', icon: '📘' },
    { re: /^WPS Office$/i, name: 'WPS Office', icon: '📘' },
    { re: /LibreOffice Writer/i, name: 'LibreOffice Writer', icon: '📘' },
  ],
  excel: [
    { re: /^Microsoft Excel/i, name: 'Excel', icon: '📗' },
    { re: /^Excel$/i, name: 'Excel', icon: '📗' },
    { re: /WPS 表格|WPS Spreadsheets/i, name: 'WPS 表格', icon: '📗' },
    { re: /LibreOffice Calc/i, name: 'LibreOffice Calc', icon: '📗' },
  ],
  powerpoint: [
    { re: /^Microsoft PowerPoint/i, name: 'PowerPoint', icon: '📙' },
    { re: /^PowerPoint$/i, name: 'PowerPoint', icon: '📙' },
    { re: /WPS 演示|WPS Presentation/i, name: 'WPS 演示', icon: '📙' },
    { re: /LibreOffice Impress/i, name: 'LibreOffice Impress', icon: '📙' },
  ],
  code: [
    { re: /^Visual Studio Code/i, name: 'VS Code', icon: '💻' },
    { re: /^IntelliJ IDEA/i, name: 'IntelliJ IDEA', icon: '💻' },
    { re: /^PyCharm/i, name: 'PyCharm', icon: '💻' },
    { re: /^WebStorm/i, name: 'WebStorm', icon: '💻' },
    { re: /^GoLand/i, name: 'GoLand', icon: '💻' },
    { re: /^CLion/i, name: 'CLion', icon: '💻' },
    { re: /^Visual Studio(?! Code)/i, name: 'Visual Studio', icon: '💻' },
    { re: /^Notepad\+\+/i, name: 'Notepad++', icon: '💻' },
    { re: /^Sublime Text/i, name: 'Sublime Text', icon: '💻' },
    { re: /^DevEco Studio/i, name: 'DevEco Studio', icon: '💻' },
    { re: /^Trae/i, name: 'Trae', icon: '💻' },
    { re: /^Cursor/i, name: 'Cursor', icon: '💻' },
  ],
  // —— 绘画软件（画板模块外部打开）——
  draw: [
    { re: /^(Adobe )?Photoshop/i, name: 'Photoshop', icon: '🎨' },
    { re: /^Adobe (Illustrator|Fresco)/i, name: 'Adobe Illustrator/Fresco', icon: '🎨' },
    { re: /^CLIP STUDIO( PAINT)?|^CLIPStudioPaint/i, name: 'Clip Studio Paint', icon: '🎨' },
    { re: /^PaintTool SAI|^SAI/i, name: 'PaintTool SAI', icon: '🎨' },
    { re: /^Krita/i, name: 'Krita', icon: '🎨' },
    { re: /^MediBang Paint/i, name: 'MediBang Paint', icon: '🎨' },
    { re: /^Aseprite/i, name: 'Aseprite', icon: '🎨' },
    { re: /^Affinity (Photo|Designer)/i, name: 'Affinity Photo', icon: '🎨' },
    { re: /^GIMP/i, name: 'GIMP', icon: '🎨' },
    { re: /^FireAlpaca/i, name: 'FireAlpaca', icon: '🎨' },
  ],
  // —— 聊天/协作软件（发送到工作软件寻路复用；类别 id 与分享目标一致）——
  wechat: [{ re: /^微信(?!开发者)|^WeChat(?! DevTools)/i, name: '微信', icon: '💬' }],
  qq: [{ re: /^腾讯QQ$|^QQ$/i, name: 'QQ', icon: '💬' }],
  dingtalk: [{ re: /^钉钉$|^DingTalk/i, name: '钉钉', icon: '💬' }],
  slack: [{ re: /^Slack/i, name: 'Slack', icon: '💬' }],
  teams: [{ re: /^Microsoft Teams|^Teams$/i, name: 'Microsoft Teams', icon: '💬' }],
  telegram: [{ re: /^Telegram/i, name: 'Telegram', icon: '💬' }],
};
const MODULE_TO_CATEGORY = { markdown: 'word', text: 'word', sheet: 'excel', slide: 'powerpoint', code: 'code' };
const CACHE_KEY = 'apps.quickLaunch';
const CACHE_TTL = 7 * 86400e3;

function programsDirs(env = process.env) {
  return [
    path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
}

/** 递归列出 .lnk（深度 ≤3），返回 [{file, lnk}] */
function listLnk(dirs, { existsSync = fs.existsSync, readdirSync = fs.readdirSync } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.lnk$/i.test(e.name)) out.push({ file: e.name.replace(/\.lnk$/i, ''), lnk: p });
    }
  };
  for (const d of dirs) if (d && existsSync(d)) walk(d, 0);
  return out;
}

/** lnk 文件名 → [{category, name, icon, lnk}]（每类同名去重） */
function matchCandidates(links) {
  const hits = [];
  const seen = new Set();
  for (const { file, lnk } of links) {
    for (const [category, rules] of Object.entries(CANDIDATES)) {
      for (const r of rules) {
        if (r.re.test(file)) {
          const key = category + '|' + r.name;
          if (!seen.has(key)) { seen.add(key); hits.push({ category, name: r.name, icon: r.icon, lnk }); }
          break;
        }
      }
    }
  }
  return hits;
}

/** PowerShell WScript.Shell COM 批量解析 lnk → exe 路径 */
async function resolveTargets(hits, { run }) {
  if (!hits.length) return hits;
  const list = hits.map(h => h.lnk.replace(/'/g, "''"));
  const ps = `$ws = New-Object -ComObject WScript.Shell; @('${list.join("','")}') | ForEach-Object { try { $s = $ws.CreateShortcut($_); "$($_)|$($s.TargetPath)" } catch { "$($_)|" } }`;
  const r = await run('powershell', ['-NoProfile', '-Command', ps]);
  const map = new Map();
  for (const line of r.out.split(/\r?\n/)) {
    const i = line.lastIndexOf('|');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  return hits
    .map(h => ({ ...h, exe: map.get(h.lnk) || '' }))
    .filter(h => h.exe && fs.existsSync(h.exe));
}

class StartMenuApps {
  constructor({ store, run } = {}) {
    this.store = store;
    this.run = run || ((cmd, args) => new Promise((res) => {
      require('child_process').execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (e, so) =>
        res({ ok: !e, out: (so || '').toString() }));
    }));
  }

  /** 读取（缓存优先；refresh=true 强制重扫） */
  async quickLaunch({ refresh = false, platform = process.platform } = {}) {
    if (platform !== 'win32') return { apps: [], cachedAt: 0, unsupported: true };
    const cache = this.store?.get(CACHE_KEY);
    if (!refresh && cache?.apps && (Date.now() - (cache.cachedAt || 0) < CACHE_TTL)) return cache;
    const links = listLnk(programsDirs());
    const hits = matchCandidates(links);
    const apps = await resolveTargets(hits, { run: this.run });
    const result = { apps, cachedAt: Date.now() };
    this.store?.set(CACHE_KEY, result);
    return result;
  }

  /** 拉起外部软件（可带文件路径参数） */
  launch({ exe, args = [] }, { spawnDetached } = {}) {
    const spawnFn = spawnDetached || ((x, a) => {
      try { require('child_process').spawn(x, a, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
    });
    if (!exe || !fs.existsSync(exe)) return { ok: false, reason: 'not-found' };
    return { ok: spawnFn(exe, args.filter(a => typeof a === 'string')) };
  }
}

module.exports = StartMenuApps;
module.exports.CANDIDATES = CANDIDATES;
module.exports.MODULE_TO_CATEGORY = MODULE_TO_CATEGORY;
module.exports.matchCandidates = matchCandidates;
module.exports.programsDirs = programsDirs;
