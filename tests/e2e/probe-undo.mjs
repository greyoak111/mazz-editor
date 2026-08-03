import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-ud-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-udws-'));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
await win.waitForTimeout(500);
await win.evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
await win.waitForFunction(() => !!window.__activeMindmapCtl, null, { timeout: 9000 });
await win.waitForTimeout(600);
await win.evaluate(() => {
  const ctl = window.__activeMindmapCtl;
  ctl.doc.roots = [{ id: 'root', text: '根', collapsed: false, children: [{ id: 'A', text: '甲', collapsed: false, children: [] }, { id: 'B', text: '乙', collapsed: false, children: [] }, { id: 'C', text: '丙', collapsed: false, children: [] }] }];
  ctl.toolMode = 'select';
  ctl.multiSel = new Set(['A', 'B']);
  // 直接调批删（mutate 入栈）
  const n = ctl.multiSel.size;
  (function() {
    const fn = () => {
      for (const id of ['A', 'B']) {
        // deleteMultiSel 同链——场景直调产品函数不可触，用快照栈直推
      }
    };
  })();
  // 直接触发模块内删除路径：调键盘 Delete 等价（直接 snapshot+remove）
  ctl.mutate(() => {
    for (const id of ['A', 'B']) {
      const idx = ctl.doc.roots[0].children.findIndex(c => c.id === id);
      if (idx >= 0) ctl.doc.roots[0].children.splice(idx, 1);
    }
    ctl.multiSel.clear();
  });
  return { n: ctl.doc.roots[0].children.length, stack: ctl.undoStack.length };
});
const r1 = await win.evaluate(() => ({ n: window.__activeMindmapCtl.doc.roots[0].children.length, stack: window.__activeMindmapCtl.undoStack.length }));
console.log('批删后:', JSON.stringify(r1));
// 1. 命令路由 undo
await win.evaluate(() => window.MazzCommands?.execute('mindmap.undo'));
await win.waitForTimeout(400);
const r2 = await win.evaluate(() => ({ n: window.__activeMindmapCtl.doc.roots[0].children.length, stack: window.__activeMindmapCtl.undoStack.length, redo: window.__activeMindmapCtl.redoStack.length }));
console.log('命令 undo 后:', JSON.stringify(r2));
// 2. 键盘 Ctrl+Z
await win.keyboard.press('z', { modifiers: ['Control'] });
await win.waitForTimeout(400);
const r3 = await win.evaluate(() => ({ n: window.__activeMindmapCtl.doc.roots[0].children.length, stack: window.__activeMindmapCtl.undoStack.length, mod: undefined }));
const mod = await win.evaluate(() => {
  const ck = window.MazzContextKeys || null;
  return { mod: ck?.get?.('module') ?? null };
});
console.log('键盘 Ctrl+Z 后:', JSON.stringify(r3), 'module键:', JSON.stringify(mod));
await app.close().catch(() => {});
