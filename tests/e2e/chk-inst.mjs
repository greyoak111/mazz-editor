import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-in-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-inw-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(() => window.MazzCommands?.execute('file.newSheet'));
await win.waitForTimeout(2000);
console.log(await win.evaluate(() => {
  const tab = window.MazzShell.tabs.active;
  const keys = [...window.MazzModules.instances.keys()];
  const names = [...window.MazzModules.instances.values()].map(i => i.name);
  return JSON.stringify({ activeId: tab?.id, activeModule: tab?.module, keys, names });
}));
await app.close();
