// main/share.js —— 发送到工作软件：文件入剪贴板 + 唤起客户端
// 诚实边界：微信/QQ/钉钉（及 Slack/Teams）均无公开的"第三方直发文件"接口；
// 本模块实现业界标准做法——文件对象写入系统剪贴板 + 唤起客户端，用户到聊天窗口 Ctrl+V 即发送。
// 依赖注入（_deps）便于测试：run / exists / spawnDetached / platform。
'use strict';
const { execFile, spawn } = require('child_process');
const fs = require('fs');

// —— 目标清单 ——
const TARGETS_ZH = [
  {
    id: 'wechat', name: '微信',
    procs: ['WeChat.exe'],
    paths: ['%ProgramFiles(x86)%\\Tencent\\WeChat\\WeChat.exe', '%ProgramFiles%\\Tencent\\WeChat\\WeChat.exe'],
    reg: ['HKCU\\Software\\Tencent\\WeChat', 'InstallPath'],
  },
  {
    id: 'qq', name: 'QQ',
    procs: ['QQ.exe', 'QQScLauncher.exe'],
    paths: [
      '%ProgramFiles%\\Tencent\\QQNT\\QQ.exe',
      '%ProgramFiles(x86)%\\Tencent\\QQNT\\QQ.exe',
      '%ProgramFiles%\\Tencent\\QQ\\Bin\\QQ.exe',
      '%ProgramFiles(x86)%\\Tencent\\QQ\\Bin\\QQ.exe',
    ],
    reg: null,
  },
  {
    id: 'dingtalk', name: '钉钉',
    procs: ['DingTalk.exe', 'DingtalkLite.exe'],
    paths: [
      '%ProgramFiles(x86)%\\DingDing\\main\\current\\DingTalk.exe',
      '%ProgramFiles%\\DingDing\\main\\current\\DingTalk.exe',
      '%LocalAppData%\\DingTalk\\DingTalk.exe',
    ],
    reg: null,
  },
];
const TARGETS_INTL = [
  {
    id: 'slack', name: 'Slack',
    procs: ['slack.exe'],
    paths: ['%LocalAppData%\\slack\\slack.exe', '%ProgramFiles%\\Slack\\slack.exe'],
    reg: null,
  },
  {
    id: 'teams', name: 'Microsoft Teams',
    procs: ['ms-teams.exe', 'Teams.exe'],
    paths: ['%LocalAppData%\\Microsoft\\Teams\\current\\Teams.exe'],
    reg: null,
  },
  {
    id: 'telegram', name: 'Telegram',
    procs: ['Telegram.exe'],
    paths: ['%AppData%\\Telegram Desktop\\Telegram.exe'],
    reg: null,
  },
];

function buildTargets(locale) {
  return (locale === 'intl' ? TARGETS_INTL : TARGETS_ZH).map(t => ({ ...t }));
}

function expandEnv(p, env) {
  return String(p).replace(/%([^%]+)%/g, (_, k) => env[k] || '');
}

class ShareService {
  constructor({ bus, store, startMenuApps, deps } = {}) {
    this.bus = bus;
    this.store = store || null; // 用户自选 exe 路径：settings 键 share.customPaths = {id: exePath}
    this.startMenuApps = startMenuApps || null; // 开始菜单寻路（固定路径之外兜底）
    const self = this;
    this.d = Object.assign({
      run: (cmd, args) => new Promise((res) => {
        execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (e, stdout) =>
          res({ ok: !e, out: (stdout || '').toString() }));
      }),
      exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
      spawnDetached: (exe) => { try { spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; } },
      env: process.env,
      platform: process.platform,
    }, deps || {});
    if (bus) this.registerIpc(bus);
    void self;
  }

  async isProcRunning(proc) {
    const r = await this.d.run('tasklist', ['/FI', `IMAGENAME eq ${proc}`, '/NH']);
    return r.out.toLowerCase().includes(proc.toLowerCase());
  }

  /** 用户自选路径（settings 里存过且文件存在 → 候选最优先） */
  customPath(id) {
    const p = this.store?.get('share.customPaths')?.[id];
    return (p && this.d.exists(p)) ? p : null;
  }

  /** 开始菜单寻路得到的 exe（无则 null） */
  async startMenuPath(id) {
    if (!this.startMenuApps) return null;
    try {
      const { apps } = await this.startMenuApps.quickLaunch({});
      const hit = (apps || []).find(a => a.category === id);
      return hit && this.d.exists(hit.exe) ? hit.exe : null;
    } catch { return null; }
  }

  /** 探测单个目标的安装/运行状态（自选 > 开始菜单 > 固定路径 > 注册表） */
  async detect(t) {
    if (this.d.platform !== 'win32') return { ...t, installed: false, running: false, unsupported: true };
    let running = false;
    for (const p of t.procs) {
      if (await this.isProcRunning(p)) { running = true; break; }
    }
    const custom = this.customPath(t.id);
    const smPath = running ? null : await this.startMenuPath(t.id);
    let installed = running || !!custom || !!smPath;
    if (!installed) {
      for (const p of t.paths) {
        if (this.d.exists(expandEnv(p, this.d.env))) { installed = true; break; }
      }
    }
    if (!installed && t.reg) {
      const r = await this.d.run('reg', ['query', t.reg[0], '/v', t.reg[1]]);
      if (r.ok && r.out.includes(t.reg[1])) installed = true;
    }
    return { ...t, installed, running, customPath: custom, menuPath: smPath };
  }

  /** 目标清单 + 状态（中文界面：微信/QQ/钉钉；其他语言：Slack/Teams/Telegram） */
  async targets(locale) {
    const list = buildTargets(locale);
    const out = [];
    for (const t of list) out.push(await this.detect(t));
    return out.map(t => ({
      id: t.id, name: t.name, installed: !!t.installed, running: !!t.running,
      unsupported: !!t.unsupported, hasCustomPath: !!t.customPath,
    }));
  }

  /** 把文件对象写入系统剪贴板 */
  async copyFileToClipboard(filePath) {
    if (this.d.platform === 'win32') {
      const ps = `Set-Clipboard -Path '${String(filePath).replace(/'/g, "''")}'`;
      const r = await this.d.run('powershell', ['-NoProfile', '-Command', ps]);
      if (!r.ok) throw new Error('写入剪贴板失败（PowerShell Set-Clipboard）');
      return;
    }
    if (this.d.platform === 'darwin') {
      const safe = String(filePath).replace(/"/g, '\\"');
      const r = await this.d.run('osascript', ['-e', `set the clipboard to (POSIX file "${safe}")`]);
      if (!r.ok) throw new Error('写入剪贴板失败（osascript）');
      return;
    }
    throw new Error('当前平台暂不支持文件剪贴板');
  }

  /** 唤起客户端（自选 > 开始菜单 > 固定路径，返回是否成功拉起） */
  launch(t) {
    const custom = this.customPath(t.id);
    const menu = t.menuPath || null;
    const candidates = [custom, menu, ...t.paths.map(p => expandEnv(p, this.d.env))].filter(Boolean);
    for (const exe of candidates) {
      if (this.d.exists(exe) && this.d.spawnDetached(exe)) return true;
    }
    return false;
  }

  /**
   * 发送：复制文件到剪贴板，并按状态唤起/提示
   * @returns {Promise<{ok, copied?, launched?, running?, name, reason?}>}
   */
  async sendFile({ target, path: filePath }) {
    const t = buildTargets('zh').concat(buildTargets('intl')).find(x => x.id === target);
    if (!t) return { ok: false, reason: 'unknown-target', name: target };
    const st = await this.detect(t);
    if (st.unsupported) return { ok: false, reason: 'unsupported', name: t.name };
    if (!st.installed) return { ok: false, reason: 'not-installed', name: t.name };
    if (!this.d.exists(filePath)) return { ok: false, reason: 'file-missing', name: t.name };
    await this.copyFileToClipboard(filePath);
    if (st.running) {
      return { ok: true, copied: true, running: true, launched: false, name: t.name };
    }
    const launched = this.launch(st);
    return { ok: true, copied: true, running: false, launched, name: t.name };
  }

  /** 自定义 exe 直发：复制文件 + 按给定路径唤起（外部手动寻路目标） */
  async sendToExe({ exe, name, path: filePath }) {
    if (!exe || !this.d.exists(exe)) return { ok: false, reason: 'not-installed', name: name || exe };
    if (!this.d.exists(filePath)) return { ok: false, reason: 'file-missing', name: name || exe };
    await this.copyFileToClipboard(filePath);
    const launched = this.d.spawnDetached(exe);
    return { ok: true, copied: true, running: false, launched, name: name || exe.split(/[\\/]/).pop() };
  }

  registerIpc(bus) {
    bus.handle('share:targets', async ({ locale } = {}) => this.targets(locale));
    bus.handle('share:sendToExe', async (p) => this.sendToExe(p));
    bus.handle('share:sendFile', async ({ target, path }) => this.sendFile({ target, path }));
  }
}

module.exports = ShareService;
module.exports.buildTargets = buildTargets;
