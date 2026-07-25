// tests/contract/import-split.test.mjs —— 外部导入 + 资源管理器菜单 + 分屏带签契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const Importer = (await import('../../main/importer.js')).default || await import('../../main/importer.js');

describe('外部导入工作区', () => {
  test('文件+文件夹递归导入，重名自动 (1) 避让', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-ws-'));
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-src-'));
    fs.writeFileSync(path.join(src, '报告.docx'), 'A');
    fs.mkdirSync(path.join(src, '资料'));
    fs.writeFileSync(path.join(src, '资料', '图.png'), 'B');
    fs.writeFileSync(path.join(ws, '报告.docx'), '旧');

    const r = Importer.importExternal(ws, [path.join(src, '报告.docx'), path.join(src, '资料')]);
    assert.equal(r.imported.length, 2);
    assert.equal(r.skipped.length, 0);
    assert.ok(fs.existsSync(path.join(ws, '报告 (1).docx')), '重名应避让');
    assert.ok(fs.existsSync(path.join(ws, '资料', '图.png')), '文件夹应递归');
    assert.equal(fs.readFileSync(path.join(ws, '报告.docx'), 'utf8'), '旧', '原文件不被覆盖');
  });

  test('不存在路径 → skipped', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-ws-'));
    const r = Importer.importExternal(ws, [path.join(ws, '不存在.md')]);
    assert.equal(r.imported.length, 0);
    assert.equal(r.skipped.length, 1);
  });
});

describe('资源管理器右键菜单', () => {
  test('注册项：文件/文件夹两组（AllFilesystemObjects 与 *\\shell 重复会显示两次菜单，v33 起移除），命令带 --import "%1"', () => {
    const entries = Importer.explorerEntries('D:\\apps\\Mazz Editor.exe');
    assert.equal(entries.length, 2);
    assert.ok(entries[0].key.includes('Classes\\*\\shell\\'));
    assert.ok(entries[1].key.includes('Directory\\shell\\'));
    assert.ok(!entries.some(e => e.key.includes('AllFilesystemObjects')), '不得注册重复组');
    assert.ok(entries.every(e => e.cmd === '"D:\\apps\\Mazz Editor.exe" --import "%1"'));
    assert.ok(entries.every(e => e.label === '导入到 Mazz 工作区'));
  });

  test('开发态注册：命令首参带应用目录（裸 electron 不空转）', () => {
    const entries = Importer.explorerEntries('D:\\node\\electron.exe', { appPath: 'D:\\apps\\mazz' });
    assert.ok(entries.every(e => e.cmd === '"D:\\node\\electron.exe" "D:\\apps\\mazz" --import "%1"'));
  });

  test('注册/注销调用 reg 序列正确（注入伪 runner）', async () => {
    const calls = [];
    const run = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      // 回读验证：query 时返回含 --import 的输出
      if (args[0] === 'query') return { ok: true, out: '    (默认)    REG_SZ    "D:\\M.exe" --import "%1"' };
      return { ok: true, out: '' };
    };
    const r = await Importer.registerExplorerMenu('D:\\M.exe', { run });
    assert.equal(r.ok, true, '写入+回读验证通过应返回 ok');
    assert.ok(calls.some(c => c.includes('reg add') && c.includes('导入到 Mazz 工作区')));
    assert.ok(calls.some(c => c.includes('MUIVerb')), 'MUIVerb 与默认值双写');
    assert.ok(calls.some(c => c.includes('--import "%1"')));
    calls.length = 0; // 清空注册期调用（注册会先清一次历史 AllFilesystemObjects）
    await Importer.unregisterExplorerMenu({ run });
    assert.ok(calls.filter(c => c.includes('reg delete')).length === 3); // * / Directory / 历史 AllFilesystemObjects 清理
    const st = await Importer.explorerMenuStatus({ run: async () => ({ ok: true, out: 'MazzImport' }) });
    assert.equal(st.registered, true);
  });

  test('注册失败如实上报（不再假成功）', async () => {
    const r = await Importer.registerExplorerMenu('D:\\M.exe', { run: async () => ({ ok: false, out: '拒绝访问' }) });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });

  test('extractImportPaths：解析 --import 后的路径，容忍引号与缺项', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-imp-'));
    fs.writeFileSync(path.join(tmp, 'a.md'), 'x');
    const out = Importer.extractImportPaths(['app.exe', '--import', `"${tmp}"`, '--import', path.join(tmp, 'a.md'), '--other', '--import']);
    assert.equal(out.length, 2);
    assert.ok(out.some(p => p.endsWith('a.md')));
    assert.equal(Importer.extractImportPaths(['app.exe', '--import']).length, 0);
  });
});

describe('分屏带签', () => {
  test('split 后 moveTabToPane 把活动标签送入新窗格', async () => {
    const { PaneTree } = await import('../../renderer/shell/panes.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const tree = new PaneTree(host);
    const leaf = tree.leaves()[0];
    tree.setActive(leaf);
    const t1 = leaf.tabs.add({ title: '一.md', moduleId: 'markdown' });
    const t2 = leaf.tabs.add({ title: '二.md', moduleId: 'markdown' });
    // 模拟 shell.splitAndMove 的序列
    const srcLeaf = tree.active;
    const tab = srcLeaf?.tabs.active;
    const newLeaf = tree.splitActive('row');
    assert.ok(tab && newLeaf);
    tree.moveTabToPane(tab.id, newLeaf);
    assert.equal(newLeaf.tabs.tabs.length, 1);
    assert.equal(newLeaf.tabs.tabs[0].id, tab.id);
    assert.equal(leaf.tabs.tabs.length, 1);
    assert.equal(leaf.tabs.tabs[0].id, t1.id);
    assert.equal(newLeaf.tabs.active?.id, tab.id, '新窗格应激活迁入标签');
  });
});
