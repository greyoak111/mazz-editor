// 复现探针：win.reload 后 pageerror 完整栈
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
const human = new Human(win);
await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳' });
await win.waitForTimeout(800);
await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
for (let i = 0; i < 20; i++) { const s = await human.evaluate(() => !!document.querySelector('#agree-accept')); if (s) { await human.click('#agree-accept').catch(()=>{}); await win.waitForTimeout(300); continue; } break; }
win.on('pageerror', (e) => console.log('PAGEERROR:', e.message, '\nSTACK:', (e.stack || '').slice(0, 500)));
win.on('response', async (r) => { if (r.url().startsWith('mazz-res:') && r.status() >= 400) console.log('BAD-RESP:', r.status(), r.url().slice(0, 120)); });
win.on('requestfailed', (r) => { if (r.url().startsWith('mazz-res:')) console.log('REQ-FAIL:', r.failure()?.errorText, r.url().slice(0, 120)); });
win.on('request', (r) => { if (r.url().includes('agreement') || r.url().includes('chunk')) console.log('REQ:', r.resourceType(), r.url().slice(0, 110)); });
win.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });
await win.reload();
await win.waitForTimeout(6000);
console.log('RELOAD 观察完毕');
await app.close().catch(() => {});
