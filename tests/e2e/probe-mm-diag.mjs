import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-mm-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-mmws-'));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
await win.waitForTimeout(500);
await win.evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
await win.waitForFunction(() => !!window.__activeMindmapCtl, null, { timeout: 9000 });
await win.waitForTimeout(600);
await win.evaluate(() => {
  const ctl = window.__activeMindmapCtl;
  const roots = [];
  for (let i = 0; i < 7; i++) {
    const r = { id: 'R' + i, text: '根' + i, collapsed: false, children: [] };
    for (let j = 0; j < 10; j++) {
      const a = { id: `R${i}A${j}`, text: `支${i}-${j}`, collapsed: false, children: [] };
      for (let k = 0; k < 4; k++) a.children.push({ id: `R${i}A${j}B${k}`, text: `叶`, collapsed: false, children: [] });
      r.children.push(a);
    }
    roots.push(r);
  }
  ctl.doc.roots = roots;
  ctl.setDoc(ctl.doc);
});
await win.waitForTimeout(900);
const r = await win.evaluate(() => {
  const ctl = window.__activeMindmapCtl;
  const boxes = [...ctl.boxes.values()];
  return {
    cam: ctl.cam, vstats: ctl._vstats,
    boxN: boxes.length,
    box0: boxes[0] && { x: boxes[0].x, y: boxes[0].y },
    boxMax: boxes.length ? Math.max(...boxes.map(b => b.x)) : 0,
    dom: document.querySelectorAll('.mm-node').length,
    collapsed: ctl.doc.roots[0].children[0].collapsed,
    lazyTouched: ctl.doc._lazyTouched,
  };
});
console.log(JSON.stringify(r, null, 1));
await app.close().catch(() => {});
