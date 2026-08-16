// packaged W71 damaged/large/unsupported file-open safety gate
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_FILE_OPEN_SAFETY.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-open-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-open-ws-'));
const malformedZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(96, 0x41)]);
const fixtures = [
  ['bad-header.docx', Buffer.from('not an office package')],
  ['broken.docx', malformedZip],
  ['broken.xlsx', malformedZip],
  ['broken.epub', malformedZip],
  ['broken.mazzsheet', Buffer.from('{broken', 'utf8')],
  ['empty.mazzdraw', Buffer.from('{"mark":"mazz-draw-v1","frames":[]}', 'utf8')],
  ['unknown.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6])],
  ['legacy-encoding.odd', Buffer.from([0x81, 0x81, 0x81])],
  ['large-broken.docx', Buffer.concat([malformedZip, Buffer.alloc(3 * 1024 * 1024 + 32, 0x41)])],
];
for (const [name, bytes] of fixtures) fs.writeFileSync(path.join(workspace, name), bytes);
const utf16Path = path.join(workspace, 'valid-utf16.txt');
fs.writeFileSync(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('W71 合法 UTF16 文本', 'utf16le')]));
const conversionTarget = path.join(workspace, 'conversion-must-not-overwrite.xlsx');
const conversionSentinel = Buffer.from('W71-CONVERSION-SENTINEL', 'utf8');
fs.writeFileSync(conversionTarget, conversionSentinel);
const blockedWriteTarget = path.join(workspace, 'write-blocked.md');
fs.mkdirSync(blockedWriteTarget);

const slash = value => value.replace(/\\/g, '/');
const snapshot = async win => win.evaluate(async () => ({
  paths: window.MazzShell.paneTree.leaves().flatMap(leaf => leaf.tabs.tabs.map(tab => tab.filePath)).filter(Boolean),
  recents: await window.mazz.invoke('recent:list'),
  snapshots: await window.mazz.invoke('snapshot:list'),
}));

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  const pageErrors = [];
  win.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.mazz.invoke('recent:clear');
    await window.mazz.invoke('snapshot:clearAll');
  });

  const outcomes = [];
  for (const [name] of fixtures) {
    const filePath = slash(path.join(workspace, name));
    const result = await win.evaluate(pathname => window.MazzShell.openFile(pathname), filePath);
    await win.waitForTimeout(100);
    const state = await snapshot(win);
    const leaked = state.paths.includes(filePath) || state.recents.includes(filePath)
      || state.snapshots.some(item => item.filePath === filePath);
    outcomes.push({ name, result, leaked, tabs: state.paths.length, recents: state.recents.length });
    if (result !== false || leaked) throw new Error(`${name} 未被确定性拒绝：${JSON.stringify(outcomes.at(-1))}`);
  }

  const validResult = await win.evaluate(pathname => window.MazzShell.openFile(pathname), slash(utf16Path));
  const valid = await win.evaluate(() => {
    const tab = window.MazzShell.tabs.active;
    const inst = tab && window.MazzModulesReal.instances.get(tab.id);
    return { path: tab?.filePath, content: inst?.def.getContent(inst.state) };
  });
  if (validResult !== true || valid.path !== slash(utf16Path) || valid.content !== 'W71 合法 UTF16 文本') {
    throw new Error(`UTF-16 LE 合法样本未通过：${JSON.stringify({ validResult, valid })}`);
  }

  const conversionFailure = await win.evaluate(async target => {
    const shell = window.MazzShell;
    const content = JSON.stringify({
      mark: 'mazz-sheet-v1', active: 0,
      sheets: [{ name: 'Sheet1', cells: {}, merges: [], freezeR: 0, freezeC: 0, colW: [], rowH: [] }],
    });
    const { tab, inst } = shell.openTab('sheet', { title: 'conversion-must-not-overwrite.xlsx', filePath: target, content });
    await inst.ready;
    shell.findTabById(tab.id)?.tabs.setDirty(tab.id, true);
    const original = inst.def.exportAs;
    inst.def.exportAs = async () => { throw new Error('W71 injected conversion failure'); };
    const result = await shell.saveTab(tab);
    inst.def.exportAs = original;
    const state = { result, dirty: tab.dirty, path: tab.filePath };
    shell.findTabById(tab.id)?.tabs.setDirty(tab.id, false);
    await shell.closeTabFlow(tab.id);
    return state;
  }, slash(conversionTarget));
  if (conversionFailure.result !== false || !conversionFailure.dirty
    || !fs.readFileSync(conversionTarget).equals(conversionSentinel)) {
    throw new Error(`失败转换破坏了原文件或脏态：${JSON.stringify(conversionFailure)}`);
  }

  const writeFailure = await win.evaluate(async target => {
    const shell = window.MazzShell;
    const { tab, inst } = shell.openTab('markdown', { title: 'write-blocked.md', filePath: target, content: '# 不得伪保存' });
    await inst.ready;
    shell.findTabById(tab.id)?.tabs.setDirty(tab.id, true);
    const result = await shell.saveTab(tab);
    const state = { result, dirty: tab.dirty, path: tab.filePath };
    shell.findTabById(tab.id)?.tabs.setDirty(tab.id, false);
    await shell.closeTabFlow(tab.id);
    return state;
  }, slash(blockedWriteTarget));
  if (writeFailure.result !== false || !writeFailure.dirty || fs.existsSync(blockedWriteTarget + '.mazztmp')) {
    throw new Error(`写盘失败未保持可恢复状态：${JSON.stringify(writeFailure)}`);
  }
  if (pageErrors.length) throw new Error(`渲染错误：${pageErrors.join('\n')}`);

  const evidence = {
    gate: 'W71 damaged-large-unsupported-file-open safety',
    executablePath: slash(executablePath),
    invalidCases: outcomes,
    validUtf16: { result: validResult, ...valid },
    conversionFailure,
    writeFailure,
    assertions: {
      invalidCasesRejected: outcomes.every(item => item.result === false),
      noPhantomTabsRecentOrSnapshots: outcomes.every(item => !item.leaked),
      validUtf16AcceptedLosslessly: valid.content === 'W71 合法 UTF16 文本',
      conversionFailurePreservedOriginalAndDirtyState: true,
      writeFailurePreservedDirtyStateAndCleanedTemporaryFile: true,
      noRendererErrors: true,
    },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
