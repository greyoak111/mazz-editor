// tests/e2e/probe-panes.mjs —— 定向探针：连续右分三次，看三竖条是否成形（真实事件路径）
import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-pn-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-pnw-'));
fs.writeFileSync(path.join(WS, 'a.md'), '# A\n\n甲');
fs.writeFileSync(path.join(WS, 'b.md'), '# B\n\n乙');
fs.writeFileSync(path.join(WS, 'c.md'), '# C\n\n丙');
fs.writeFileSync(path.join(WS, 'd.md'), '# D\n\n丁');

const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3200);
win.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 160)));
for (let i = 0; i < 15; i++) {
  const a = await win.$('#agree-accept');
  if (a) { await a.click().catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.offsetParent).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

const dump = async (tag) => console.log(tag, await win.evaluate(() => {
  const t = window.MazzShell.paneTree;
  const walk = (n) => n.tabs ? { leaf: true, tabs: n.tabs.tabs.map(x => x.id) } : { dir: n.direction, a: walk(n.a), b: walk(n.b) };
  return JSON.stringify({ panes: t.leaves().length, tree: walk(t.root) });
}));

// 打开四个文档四个签
for (const f of ['a.md', 'b.md', 'c.md', 'd.md']) {
  await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + f]);
  await win.waitForTimeout(400);
}
await dump('初始:');

// 合成拖拽：把活动签拖到目标窗格指定区（renderer DragEvent 状态机；不冒充 Windows 物理输入）
async function dragSplit(zone) {
  const r = await win.evaluate(([z]) => {
    const sh = window.MazzShell;
    const tid = sh.tabs?.active?.id;
    if (!tid) return 'no-tab';
    const panes = sh.paneTree.leaves();
    const target = panes[panes.length - 1]; // 拖到最后一个竖条的对应区
    const rect = target.el.getBoundingClientRect();
    const x = z === 'right' ? rect.right - 8 : rect.left + rect.width / 2;
    const y = z === 'right' ? rect.top + rect.height / 2 : rect.bottom - 8;
    const dt = new DataTransfer();
    dt.setData('mazz/tab', tid);
    document.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
    return 'ok:' + tid + ' → pane[' + panes.indexOf(target) + '] ' + z;
  }, [zone]);
  console.log('拖拽:', r);
  await win.waitForTimeout(600);
  await dump('  后:');
}

await dragSplit('right');
await dragSplit('right');
await dragSplit('right');

const final = await win.evaluate(() => {
  const t = window.MazzShell.paneTree;
  const leaves = t.leaves();
  return {
    count: leaves.length,
    dirs: (function walk(n) { return n.tabs ? [] : [n.direction, ...walk(n.a), ...walk(n.b)]; })(t.root),
    tabsEach: leaves.map(l => l.tabs.tabs.length),
    rects: leaves.map(l => { const r = l.el.getBoundingClientRect(); return Math.round(r.width); }),
  };
});
console.log('终态:', JSON.stringify(final));
// 样式实测：分支的 computed flex-direction 与类名
console.log('分支实测:', await win.evaluate(() => {
  const bs = [...document.querySelectorAll('.pane-branch')].map(b => b.className + ' → ' + getComputedStyle(b).flexDirection);
  return JSON.stringify(bs, null, 1);
}));
await win.screenshot({ path: 'tests/e2e/shots/probe-panes.png' }).catch(() => {});
await app.close();
EOF
