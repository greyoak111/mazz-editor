// tests/contract/player-w44.test.mjs —— 波次四十四「播放器与媒体库已知问题专修」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('播放器四修', () => {
  test('缩略图切源失效', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('previewVideo._src !== url'), '切源必须判旧（previewVideo 一建不换 src 的根因闸）');
    assert.ok(src.includes('previewVideo._src = url'), '新源必须记档');
    assert.ok(/previewVideo = null;[\s\S]{0,200}previewVideo = document.createElement/.test(src), '旧预览必须销毁重建');
  });
  test('保存路径明白话', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('已存到：${dest}'), 'toast 必须带完整落点');
    assert.ok(src.includes('打开所在文件夹'), '必须带打开所在文件夹动作');
    assert.ok(!/toast\('已存到媒体库'\)/.test(src), '旧空话 toast 不得复活');
  });
  test('空起手（无视频启动）', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('if (url) media.src = url;'), '空源不得硬设 src（null 串化实锤闸）');
    assert.ok(src.includes('mz-empty'), '空起手占位必须有');
    assert.ok(src.includes("root.querySelector('.mz-empty')?.remove()"), '首次上源必须撤占位');
    const idx = readSrc('renderer/modules/viewer/index.js');
    assert.ok(idx.includes('url: null'), 'viewer 空档必须裸播放器起手');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('file.newViewer'), '新建查看器命令必须登记');
  });
});

describe('媒体库递归与工作区树', () => {
  test('递归树扫描', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('async function walk('), '递归扫描必须有');
    assert.ok(src.includes('includeDot: true'), '必须含点目录（download 残部全检）');
    assert.ok(src.includes("SKIP = new Set(['.audcache'])"), '抽轨缓存必须跳过');
    assert.ok(src.includes('mz-ml-dir') && src.includes('mz-ml-caret'), '树节点折叠必须有');
    assert.ok(src.includes('ctl._mlOpen'), '折叠态记忆必须有');
  });
  test('下载目录明面化', () => {
    const src = readSrc('main/torrent-daemon.js');
    assert.ok(src.includes("path.join(base, 'download')"), '下载目录必须明面（无点）');
    assert.ok(src.includes("path.join(base, '.download')") && src.includes('fs.renameSync(from, to)'), '旧 .download 必须一次性合并迁移');
    assert.ok(!src.includes("storeRoot() { return path.join(this.workspace(), '媒体库', '.download'); }"), '旧点目录直返不得复活');
  });
  test('fs:listDir includeDot 闸', () => {
    const src = readSrc('main/main.js');
    assert.ok(src.includes('includeDot = false'), '默认仍滤点（.git 不泄）');
    assert.ok(src.includes("e.name !== '.git'"), 'includeDot 也必须挡 .git');
  });
});
