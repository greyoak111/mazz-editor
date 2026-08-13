// R1+R2 进度接力 + 通知抽屉专项 Electron 实证。
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { makeWav } from './fixtures.mjs';
import { scenes82 } from './scenes82.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'tests/e2e/shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const relayPath = path.join(WS, '进度接力.txt');
fs.writeFileSync(relayPath, Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行 · R1 光标接力验证`).join('\n'));
const bookPath = path.join(WS, '跨设备阅读接力.txt');
fs.writeFileSync(bookPath, Array.from({ length: 260 }, (_, i) => `第 ${i + 1} 段：跨设备书库屏位接力验证，内容锚与比例共同抵抗重排。`).join('\n\n'));
const mediaPath = path.join(WS, '跨设备播放接力.wav');
fs.writeFileSync(mediaPath, makeWav(12));
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

console.log('[run82] 启动 Electron');
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
const human = new Human(win, { tag: 'r1r2' });
human.watchMain(app);
await human.until(() => !!(window.MazzCommands && window.MazzShell && window.MazzActivity), { timeout: 15000, msg: '壳与通知中心初始化' });
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
await win.waitForTimeout(800);
for (let i = 0; i < 20; i++) {
  const state = await human.evaluate(() => ({ agree: !!document.querySelector('#agree-accept'), masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length }));
  if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(150); continue; }
  if (!state.masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(150);
}
await scenes82({ app, win, human, scenario, shotDir: SHOT_DIR, relayPath, bookPath, mediaPath });
await scenario('异常警察·R1+R2 全程零主进程/渲染异常', async () => { await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] }); });
const passed = results.filter(row => row[1] === 'PASS').length;
console.log(`R1+R2 实证批：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exitCode = 1;
await app.close().catch(() => {});
process.exit(process.exitCode || 0);
