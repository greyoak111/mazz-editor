// W62c Quick Switcher 四路同框 + Ctrl+P + 全文命中行直达 Electron 实证。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Human } from './human.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'tests/e2e/shots');
const RECENT = path.join(WS, 'SwitcherAlpha-最近.md');
const FILE = path.join(WS, 'SwitcherAlpha-文件.md');
const CONTENT = path.join(WS, 'opaque.txt');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.writeFileSync(RECENT, '# SwitcherAlpha 最近入口\n', 'utf8');
fs.writeFileSync(FILE, '# SwitcherAlpha 文件入口\n', 'utf8');
fs.writeFileSync(CONTENT, ['第一行', '第二行', '深海唯一航标 SwitcherAlpha 已确认', '第四行'].join('\n'), 'utf8');

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run85] 启动 Electron');
const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test' },
  timeout: 120000,
});
const proc = app.process?.();
proc?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
proc?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
const win = await app.firstWindow({ timeout: 120000 });
await win.waitForFunction(() => document.readyState !== 'loading');
const human = new Human(win, { tag: 'w62c' });
human.watchMain(app);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
await win.waitForTimeout(800);
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept'), masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length }));
  if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(150); continue; }
  if (!state.masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(150);
}

async function openSwitcher() {
  await win.bringToFront();
  await win.keyboard.press('Control+P');
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const panel = app.windows().find(page => page !== win && /panels\/palette\.html/.test(page.url()));
    if (panel) {
      await panel.waitForSelector('#q', { timeout: 5000 });
      panel.on('pageerror', error => human.errors.push('[palette pageerror] ' + error.message));
      panel.on('console', message => { if (message.type() === 'error') human.errors.push('[palette console.error] ' + message.text()); });
      return panel;
    }
    await win.waitForTimeout(100);
  }
  throw new Error('Ctrl+P 未打开 Quick Switcher 子窗');
}

await scenario('Ctrl+P 四路同框、来源标识与最近优先', async () => {
  await human.evaluate(async (recent) => {
    window.MazzCommands.register('e2e.switcherAlpha', {
      title: 'SwitcherAlpha 命令', group: 'E2E', source: 'e2e-w62c',
      run: () => { window.__w62cCommandRan = true; },
    });
    await window.MazzCommands.execute('file.openPath', { path: recent });
  }, RECENT);
  await human.until(() => window.MazzShell.tabs.active?.title === 'SwitcherAlpha-最近.md', { timeout: 8000, msg: '最近文件打开' });
  const panel = await openSwitcher();
  await panel.fill('#q', 'SwitcherAlpha');
  await panel.waitForFunction(() => new Set([...document.querySelectorAll('.row .kind')].map(node => node.textContent.trim())).size >= 4, null, { timeout: 15000 });
  const state = await panel.evaluate(() => ({
    kinds: [...new Set([...document.querySelectorAll('.row .kind')].map(node => node.textContent.trim()))],
    first: document.querySelector('.row .kind')?.textContent.trim(),
    hasPreview: !!document.querySelector('.row .preview'),
  }));
  await human.assert(['最近', '文件', '命令', '全文'].every(kind => state.kinds.includes(kind)), `应同框出现四路来源（${state.kinds.join('/')}）`);
  await human.assert(state.first === '最近', `最近+前缀加权应排首位（实际 ${state.first}）`);
  await human.assert(state.hasPreview, '全文结果应显示命中行预览');
  await panel.screenshot({ path: path.join(SHOT_DIR, 'w62c-quick-switcher-four-sources.png') });
  await panel.locator('.row').filter({ has: panel.locator('.kind-command') }).first().click();
  await human.until(() => window.__w62cCommandRan === true, { timeout: 5000, msg: '命令候选执行' });
});

await scenario('全文候选回车直达命中行', async () => {
  const panel = await openSwitcher();
  await panel.fill('#q', '深海唯一航标');
  await panel.waitForSelector('.row .kind-content', { timeout: 15000 });
  const preview = await panel.locator('.row').filter({ has: panel.locator('.kind-content') }).first().textContent();
  await human.assert(preview.includes('第 3 行') && preview.includes('深海唯一航标'), `应展示行号与命中原文（${preview.slice(0, 80)}）`);
  await panel.locator('.row').filter({ has: panel.locator('.kind-content') }).first().click();
  await human.until(() => {
    const ta = document.querySelector('.txt-editor');
    return window.MazzShell.tabs.active?.title === 'opaque.txt' && ta?.value.slice(ta.selectionStart, ta.selectionEnd).includes('深海唯一航标');
  }, { timeout: 8000, msg: '全文命中打开并选中第 3 行' });
  await win.screenshot({ path: path.join(SHOT_DIR, 'w62c-content-line-jump.png') });
});

await scenario('异步连打只采纳末次查询', async () => {
  const panel = await openSwitcher();
  await panel.fill('#q', '深海唯一航标');
  await panel.fill('#q', 'SwitcherAlpha 命令');
  await panel.waitForSelector('.row .kind-command', { timeout: 10000 });
  await panel.waitForTimeout(500);
  const stale = await panel.locator('.row .kind-content').count();
  await human.assert(stale === 0, '旧全文查询响应不得覆盖末次命令查询');
  await panel.close().catch(() => {});
});

await scenario('异常警察·W62c 全程零主进程/渲染异常', async () => {
  await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
});
const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`W62c 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
process.exit(process.exitCode || 0);
