// W68a 双环引擎专项 Electron 实证。
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
import { scenes79 } from './scenes79.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'tests/e2e/shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
await seedFixtures(WS, WS);
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run79] 启动 Electron');
const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, MAZZ_E2E_FACTORY_MOCK: '1', MAZZ_E2E_DISABLE_GPU: '1', NODE_ENV: 'test' },
  timeout: 120000,
});
const processHandle = app.process?.();
processHandle?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
processHandle?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
const win = await app.firstWindow({ timeout: 120000 });
await win.waitForFunction(() => document.readyState !== 'loading');
const human = new Human(win, { tag: 'w68a' });
human.watchMain(app);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
await win.waitForTimeout(900);
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept'), masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length }));
  if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(150); continue; }
  if (!state.masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(150);
}
await scenes79({ app, win, human, scenario, shotDir: SHOT_DIR });
await scenario('异常警察·W68a 全程零主进程/渲染异常', async () => { await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] }); });
const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`W68a 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
process.exit(process.exitCode || 0);
