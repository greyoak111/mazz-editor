import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-sp-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-spw-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(() => window.MazzCommands?.execute('file.newSheet'));
await win.waitForTimeout(2000);
const all = await win.evaluate(() => window.MazzCommands.list().filter(c => c.id.startsWith('sheet.')).map(c => c.id));
console.log('总数:', all.length);
for (const id of all) {
  const r = await win.evaluate(async ([x]) => {
    try { await window.MazzCommands.execute(x); return 'OK'; }
    catch (e) { return 'ERR: ' + (e.stack || e.message || JSON.stringify(e)).slice(0, 220); }
  }, [id]);
  console.log(id, '→', r);
}
await app.close();
