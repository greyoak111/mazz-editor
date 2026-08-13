// W62d 右键 AI 提炼成图专项 Electron 实证。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Human } from './human.mjs';
import { scenes84 } from './scenes84.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const SOURCE = path.join(WS, 'W62d-源文档.md');
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'tests/e2e/shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.writeFileSync(SOURCE, '# 海上行动\n\n## 目标\n\n安全抵达星港\n\n## 证据\n\n潮位表已复核\n', 'utf8');

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run84] 启动 Electron');
const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_E2E_FACTORY_MOCK: '1', MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test' },
  timeout: 120000,
});
const proc = app.process?.();
proc?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
proc?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
const win = await app.firstWindow({ timeout: 120000 });
await win.waitForFunction(() => document.readyState !== 'loading');
const human = new Human(win, { tag: 'w62d' });
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
await scenes84({ win, human, scenario, shotDir: SHOT_DIR, sourcePath: SOURCE });
await scenario('异常警察·W62d 全程零主进程/渲染异常', async () => { await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] }); });
const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`W62d 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
process.exit(process.exitCode || 0);

