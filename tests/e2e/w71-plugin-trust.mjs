// W71：app-unpacked 插件默认隔离、显式授权、重启加载与内容变更撤权
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`app-unpacked 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-plugin-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-plugin-ws-'));
const pluginDir = path.join(workspace, 'plugins');
const pluginPath = path.join(pluginDir, 'security-probe.maz');
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
fs.mkdirSync(pluginDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

async function makePlugin(version, marker) {
  const zip = new JSZip();
  zip.file('plugin.json', JSON.stringify({
    id: 'w71-packaged-security-probe',
    name: 'W71 Packaged Security Probe',
    version,
    permissions: ['workspace.read'],
  }));
  zip.file('main.js', `
    globalThis.__w71PackagedPluginMarker = ${JSON.stringify(marker)};
    export default {
      displayName: 'W71 Packaged Security Probe', icon: '🧩',
      create(container) { return { container }; },
      activate() {}, deactivate() {},
      getContent() { return ''; }, setContent() {}, newDocument() {},
      contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
    };
  `);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const liveApps = new Set();
async function launch() {
  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  liveApps.add(app);
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  await win.waitForFunction(() => !!window.MazzShell && !!window.MazzCommands, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('panel:close', { kind: 'agreement' });
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await win.evaluate(() => window.mazz.invoke('panel:close', { kind: 'agreement' }));
  return { app, win };
}

async function close(app) {
  await app.close().catch(() => {});
  liveApps.delete(app);
}

async function openPluginPanel(app, win) {
  await win.evaluate(() => window.MazzCommands.execute('plugin.manage'));
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const panel = app.windows().find(page => page.url().includes('/panels/plugins.html'));
    if (panel) {
      await panel.waitForSelector('.plg', { timeout: 10000 });
      return panel;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('插件管理原生面板未打开');
}

async function moduleLoaded(win) {
  return win.evaluate(() => {
    const registry = window.MazzModulesReal || window.MazzModules;
    return !!registry?.defs?.has('plugin:w71-packaged-security-probe');
  });
}

try {
  const v1 = await makePlugin('1.0.0', 'trusted-v1');
  const v1Hash = createHash('sha256').update(v1).digest('hex');
  fs.writeFileSync(pluginPath, v1);

  const first = await launch();
  await new Promise(resolve => setTimeout(resolve, 800));
  if (await moduleLoaded(first.win)) throw new Error('新放入工作区的插件被默认执行');
  if (await first.win.evaluate(() => globalThis.__w71PackagedPluginMarker) != null) throw new Error('未授权插件产生了顶层副作用');
  const firstPanel = await openPluginPanel(first.app, first.win);
  const firstText = await firstPanel.locator('.plg').innerText();
  if (!firstText.includes('隔离中') || !firstText.includes('SHA-256')) throw new Error(`隔离态 UI 不完整：${firstText}`);
  await firstPanel.screenshot({ path: path.join(evidenceDir, 'W71_PLUGIN_QUARANTINED.png'), omitBackground: true });
  firstPanel.once('dialog', dialog => dialog.accept());
  await firstPanel.locator('[data-a="trust"]').click();
  await firstPanel.waitForFunction(() => document.querySelector('.plg')?.textContent?.includes('运行中'), null, { timeout: 15000 });
  await first.win.waitForFunction(() => {
    const registry = window.MazzModulesReal || window.MazzModules;
    return registry?.defs?.has('plugin:w71-packaged-security-probe') && globalThis.__w71PackagedPluginMarker === 'trusted-v1';
  }, null, { timeout: 15000 });
  await firstPanel.screenshot({ path: path.join(evidenceDir, 'W71_PLUGIN_TRUSTED.png'), omitBackground: true });
  await close(first.app);

  const second = await launch();
  await second.win.waitForFunction(() => {
    const registry = window.MazzModulesReal || window.MazzModules;
    return registry?.defs?.has('plugin:w71-packaged-security-probe') && globalThis.__w71PackagedPluginMarker === 'trusted-v1';
  }, null, { timeout: 15000 });
  await close(second.app);

  const v2 = await makePlugin('1.0.1', 'changed-v2');
  const v2Hash = createHash('sha256').update(v2).digest('hex');
  fs.writeFileSync(pluginPath, v2);
  const third = await launch();
  await new Promise(resolve => setTimeout(resolve, 800));
  if (await moduleLoaded(third.win)) throw new Error('内容变化后仍沿用旧授权执行插件');
  if (await third.win.evaluate(() => globalThis.__w71PackagedPluginMarker) != null) throw new Error('变化后的插件产生了顶层副作用');
  const thirdPanel = await openPluginPanel(third.app, third.win);
  const thirdText = await thirdPanel.locator('.plg').innerText();
  if (!thirdText.includes('内容已变化') || !thirdText.includes('旧授权失效')) throw new Error(`内容变化撤权 UI 不完整：${thirdText}`);
  await thirdPanel.screenshot({ path: path.join(evidenceDir, 'W71_PLUGIN_CHANGED.png'), omitBackground: true });
  await close(third.app);

  const evidence = {
    generatedAt: new Date().toISOString(),
    executable: 'release/win-unpacked/Mazz Editor.exe',
    packageHashes: { trustedV1: v1Hash, changedV2: v2Hash, different: v1Hash !== v2Hash },
    screenshots: {
      quarantined: 'evidence/W71_PLUGIN_QUARANTINED.png',
      trusted: 'evidence/W71_PLUGIN_TRUSTED.png',
      changed: 'evidence/W71_PLUGIN_CHANGED.png',
    },
    ok: true,
    defaultQuarantine: true,
    explicitHashTrust: true,
    trustedRestartLoad: true,
    changedContentRevoked: true,
    nativePanelEvidence: true,
  };
  fs.writeFileSync(path.join(evidenceDir, 'W71_PLUGIN_TRUST.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence));
} finally {
  for (const app of liveApps) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
