// tests/contract/hotfix-w58b.test.mjs —— W58b 契约（解压缩工具+集成三条）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('解压缩服务（main/archive.js）', () => {
  test('魔数识别五族+GBK 修复+2 并发+取消', () => {
    const a = readSrc('main/archive.js');
    for (const pin of ['ZIP_MAG', 'RAR_MAG', 'SZ_MAG', 'GZ_MAG', 'ustar']) assert.ok(a.includes(pin), pin + ' 魔数必须在');
    assert.ok(a.includes('rawNames'), 'GBK 原始名直读必须有');
    assert.ok(a.includes("TextDecoder('gbk')"), 'GBK 解码兜底必须有');
    assert.ok(a.includes('0x0800'), 'UTF-8 位 11 判定必须有');
    assert.ok(a.includes('this.running.size < 2'), '2 并发闸必须有');
    assert.ok(a.includes('job.cancelled'), '取消令牌必须有');
    assert.ok(a.includes("require('7zip-bin')"), '7zip-bin 兜底必须有');
    assert.ok(a.includes('..'), 'zip-slip 防穿越必须有');
  });
  test('装配+kind 注册+面板页', () => {
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes("require('./archive')"), 'ArchiveService 必须装配');
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('|archive)'), 'kind 白名单必须有 archive');
    assert.ok(pw.includes("archive: '压缩包'"), '标题必须有');
    const html = readSrc('renderer/panels/archive.html');
    for (const pin of ['archiveQuery', 'archiveExtract', 'archiveCancel', 'archiveProgress', 'archiveDone', 'themeSnapshot']) assert.ok(html.includes(pin), pin + ' 必须在');
  });
});

describe('集成三条', () => {
  test('右键加项（压缩包感知+打包）', () => {
    const sh = readSrc('renderer/shell/shell.js');
    for (const c of ["R('archive.view'", "R('archive.extractHere'", "R('archive.extractSub'", "R('archive.pack'"]) assert.ok(sh.includes(c), c + ' 必须注册');
    assert.ok(sh.includes("when: 'treeArchive'"), '压缩包感知显隐必须有');
    const ft = readSrc('renderer/shell/file-tree.js');
    assert.ok(ft.includes("contextKeys.set('treeArchive'"), '选中态键必须有');
  });
  test('树拖即开+树拖图即插', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('panesEl.addEventListener(\'drop\''), 'panes 拖开必须有');
    assert.ok(sh.includes('insertImageToMarkdown'), '图片插档件必须有');
    assert.ok(sh.includes('posAtCoords'), '落点定位必须有');
    assert.ok(!sh.includes('prompt('), '不得用 prompt（Electron 物理不支持）');
  });
});
