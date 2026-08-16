// tests/e2e/w71-file-change-runtime.mjs —— packaged 外部文件变化 / 冲突 / 自写回声真运行
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_EXTERNAL_FILE_CHANGE.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-file-change-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-file-change-ws-'));
const targetPath = path.join(workspace, 'external-change.md');
fs.writeFileSync(targetPath, '# 初始版本\n', 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  const rendererErrors = [];
  win.on('pageerror', error => rendererErrors.push(String(error?.stack || error)));
  win.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });
  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  await win.evaluate(async filePath => {
    await window.MazzShell.openFile(filePath);
    await window.mazz.invoke('fs:watch', { paths: [filePath] });
    const shell = window.MazzShell;
    const nativeReload = shell.reloadTabFromDisk.bind(shell);
    const nativeHandler = shell.handleExternalFileChanged.bind(shell);
    window.__w71ExternalChange = { reloadCalls: 0, outcomes: [], events: [], handlerCalls: [], handlerErrors: [] };
    window.mazz.on('file:changed', payload => window.__w71ExternalChange.events.push(payload));
    shell.handleExternalFileChanged = async payload => {
      window.__w71ExternalChange.handlerCalls.push({
        payload,
        matches: shell.tabsForPath(payload?.path).map(tab => ({ id: tab.id, path: tab.filePath, dirty: tab.dirty })),
      });
      try { return await nativeHandler(payload); }
      catch (error) {
        window.__w71ExternalChange.handlerErrors.push(String(error?.stack || error));
        throw error;
      }
    };
    shell.reloadTabFromDisk = async (...args) => {
      window.__w71ExternalChange.reloadCalls++;
      const result = await nativeReload(...args);
      window.__w71ExternalChange.outcomes.push(result);
      return result;
    };
  }, targetPath.replace(/\\/g, '/'));
  await win.waitForFunction(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = tab && window.MazzModules.instances.get(tab.id);
    return inst?.def.getContent(inst.state).includes('初始版本');
  }, null, { timeout: 15000 });

  fs.writeFileSync(targetPath, '# 外部干净版本\n', 'utf8');
  try {
    await win.waitForFunction(() => {
      const tab = window.MazzShell.tabs.active;
      const inst = tab && window.MazzModules.instances.get(tab.id);
      return inst?.def.getContent(inst.state).includes('外部干净版本');
    }, null, { timeout: 15000 });
  } catch (error) {
    const diagnostic = await win.evaluate(() => ({
      probe: window.__w71ExternalChange,
      tab: (() => { const tab = window.MazzShell.tabs.active; return tab && { id: tab.id, path: tab.filePath, dirty: tab.dirty }; })(),
      resources: null,
    }));
    diagnostic.resources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
    diagnostic.rendererErrors = rendererErrors;
    throw new Error(`首次外改未抵达：${JSON.stringify(diagnostic)}；${error.message}`);
  }
  await sleep(1200);
  const cleanReload = await win.evaluate(() => ({
    reloadCalls: window.__w71ExternalChange.reloadCalls,
    dirty: window.MazzShell.tabs.active.dirty,
    toast: document.querySelector('.mazz-toast')?.textContent || '',
  }));
  if (cleanReload.reloadCalls !== 1 || cleanReload.dirty) {
    throw new Error(`干净标签没有恰好重载一次：${JSON.stringify(cleanReload)}`);
  }

  await win.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent('# 本地未保存版本\n', inst.state);
    window.MazzHost.notifyChange(tab.view);
  });
  fs.writeFileSync(targetPath, '# 外部冲突版本\n', 'utf8');
  await win.waitForFunction(() => document.querySelector('.mazz-toast')?.textContent.includes('本地未保存内容已保留'), null, { timeout: 15000 });
  await sleep(800);
  const conflict = await win.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    return {
      dirty: tab.dirty,
      content: inst.def.getContent(inst.state),
      reloadCalls: window.__w71ExternalChange.reloadCalls,
      actions: [...document.querySelectorAll('.mazz-toast button')].map(button => button.textContent),
    };
  });
  if (!conflict.dirty || !conflict.content.includes('本地未保存版本') || conflict.content.includes('外部冲突版本')) {
    throw new Error(`脏标签被外部版本覆盖：${JSON.stringify(conflict)}`);
  }
  if (conflict.reloadCalls !== 1 || !conflict.actions.includes('另存当前…') || !conflict.actions.includes('从磁盘载入')) {
    throw new Error(`冲突决策入口不完整：${JSON.stringify(conflict)}`);
  }

  await win.locator('.mazz-toast button', { hasText: '从磁盘载入' }).click();
  await win.waitForFunction(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    return !tab.dirty && inst.def.getContent(inst.state).includes('外部冲突版本');
  }, null, { timeout: 15000 });
  const explicitReload = await win.evaluate(() => ({
    reloadCalls: window.__w71ExternalChange.reloadCalls,
    outcomes: window.__w71ExternalChange.outcomes,
  }));
  if (explicitReload.reloadCalls !== 2 || explicitReload.outcomes.at(-1) !== true) {
    throw new Error(`显式磁盘载入没有完成：${JSON.stringify(explicitReload)}`);
  }

  const beforeSelfSave = explicitReload.reloadCalls;
  const saveResult = await win.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    inst.def.setContent('# 应用自保存版本\n', inst.state);
    window.MazzHost.notifyChange(tab.view);
    return window.MazzShell.saveTab(tab);
  });
  if (!saveResult) throw new Error('应用自保存失败');
  await sleep(2200);
  const selfSave = await win.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = window.MazzModules.instances.get(tab.id);
    return {
      dirty: tab.dirty,
      content: inst.def.getContent(inst.state),
      reloadCalls: window.__w71ExternalChange.reloadCalls,
      conflictToast: [...document.querySelectorAll('.mazz-toast')].some(item => item.textContent.includes('磁盘版本已变化')),
    };
  });
  const diskAfterSelfSave = fs.readFileSync(targetPath, 'utf8');
  if (selfSave.dirty || selfSave.reloadCalls !== beforeSelfSave || selfSave.conflictToast
    || !selfSave.content.includes('应用自保存版本') || !diskAfterSelfSave.includes('应用自保存版本')) {
    throw new Error(`自保存回声没有被确定识别：${JSON.stringify({ selfSave, diskAfterSelfSave })}`);
  }

  await win.evaluate(async () => {
    const tab = window.MazzShell.tabs.active;
    tab.forceClose = true;
    await window.MazzShell.closeTabFlow(tab.id);
  });
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (finalResources.activeCount !== baseline.activeCount) {
    throw new Error(`资源未回基线：${baseline.activeCount}→${finalResources.activeCount}`);
  }
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    cleanReload,
    conflict: { dirtyPreserved: true, reloadCallsBeforeDecision: conflict.reloadCalls, actions: conflict.actions },
    explicitReload,
    selfSave: { ...selfSave, diskMatched: true },
    resources: { baseline: baseline.activeCount, final: finalResources.activeCount },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
