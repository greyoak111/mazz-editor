import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-fd-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-fdw-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
await win.waitForTimeout(2000);
console.log(await win.evaluate(() => {
  const ctl = window.__activeMindmapCtl;
  const root = ctl.doc.roots[0];
  root.children = root.children || [];
  root.children.push({ id: 'e2e-a', text: '甲', children: [] });
  root.children.push({ id: 'e2e-b', text: '乙', children: [] });
  ctl.render();
  const svgs = [...document.querySelectorAll('.mm-svg')];
  const active = svgs.find(x => x.offsetParent);
  const rootId = ctl.doc.roots[0].id;
  const btn = active?.querySelector(`.mm-fold[data-id="${rootId}"]`);
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const dbg = {
    activeTabId: window.MazzShell.tabs.active?.id,
    tabs: window.MazzShell.tabs.tabs.map(t => t.id + ':' + t.moduleId),
    mmViewOn: !!document.querySelector('.module-view.on'),
    svgParentVisible: svgs[0] ? (function(){ let el = svgs[0]; while(el){ if(el.classList?.contains('module-view')) return el.classList.contains('on'); el = el.parentElement; } return 'no-mv'; })() : 'nosvg',
  };
  const info = {
    svgCount: svgs.length,
    visibleSvg: svgs.filter(x => x.offsetParent).length,
    folds: active ? active.querySelectorAll('.mm-fold').length : -1,
    nodes: active ? active.querySelectorAll('.mm-node').length : -1,
    kids: root.children.length,
    hasRender: typeof ctl.render,
  };
  return JSON.stringify({ ...dbg, ...info,
    hasBtn: !!btn, btnTag: btn?.tagName, rootId,
    collapsed: ctl.doc.roots[0].collapsed,
    kids: active?.querySelectorAll('.mm-node').length,
  });
}));
await app.close();
