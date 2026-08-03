// tests/contract/hotfix-w58d.test.mjs —— W58d 契约（看图零连带/大文件降级通道）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 看图/PDF 连带播放器根治', () => {
  test('bootEmptyPlayer await 后重验闸（竞态装片不上台）', () => {
    const vw = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vw.includes('W58d：await 落锤前重验闸'), '重验闸注释必须在');
    assert.ok(vw.includes("if (ctl.path || ctl._player || ctl.body.children.length) { ctl._bootingEmpty = false; return; }"), '落锤前重验必须在');
  });
  test('image/pdf 分支裸播放器收尸+create 返 ctl（军规⑰第三起）', () => {
    const vw = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vw.includes("ctl._player = null; ctl._playerKind = null;"), '收尸并清型必须在（防 activate 空片误判）');
    assert.ok(vw.includes('W58d 根治：create 必须返回 ctl 本体'), 'viewer create 返 ctl 钉必须在');
    assert.ok(!vw.includes('return { container };'), 'viewer 畸形态必须绝迹');
  });
});

describe('② 大文件降级通道', () => {
  test('降级闸+阈值+Monaco 通道', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('openLargeFile(filePath, ext, size)'), 'openLargeFile 必须有');
    assert.ok(sh.includes("['md', 'markdown', 'mazz', 'txt', 'docx'].includes(ext)"), '降级闸扩展名族必须在');
    assert.ok(sh.includes('3 * 1024 * 1024 : 1.5 * 1024 * 1024'), '双阈值必须在（docx 3MB/文本 1.5MB）');
    assert.ok(sh.includes("this.openTab('code'"), '降级必须走 code（Monaco 虚拟化）');
    assert.ok(sh.includes('extractRawTextFromDocx'), 'docx 必须走轻提取');
    assert.ok(sh.includes('inst.def.langOfPath?.(filePath)'), '语言必须走 def 层（state 层无此法——plaintext 乌龙实锤）');
  });
  test('extractRawTextFromDocx 轻提取件', () => {
    const dx = readSrc('renderer/modules/markdown/docx-io.js');
    assert.ok(dx.includes('export async function extractRawTextFromDocx'), '轻提取件必须导出');
    assert.ok(dx.includes('mammoth.extractRawText'), 'mammoth 轻路径必须在');
  });
  test('③ 程序化装载免脏（幻影改动绝育）', () => {
    const ci = readSrc('renderer/modules/code/index.js');
    assert.ok(ci.includes('ctl._loading = true'), '装载窗必须有');
    assert.ok(ci.includes('if (!ctl._loading) window.MazzHost?.notifyChange'), '装载期免脏闸必须有');
  });
  test('④ PDF embed CSP 放行', () => {
    const ih = readSrc('renderer/index.html');
    assert.ok(ih.includes("object-src 'self' mazz-res:"), 'object-src 必须放行 mazz-res（PDF 白页实锤）');
    assert.ok(ih.includes("frame-src 'self' mazz-res:"), 'frame-src 必须放行 mazz-res（embed 内框实锤）');
  });
  test('⑤ 监看回刷不连坐降级 tab', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("!['markdown', 'sheet', 'slide'].includes(inst.name)) return;"), '二进制族回刷模块闸必须在（{__docx} 对象抹空白实锤）');
  });
});
