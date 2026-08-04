// tests/contract/hotfix-w59d.test.mjs —— 59d 契约（查看态滚动条全族/双态横向条/左右不绑滚轮）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('① 查看态滚动条全族（上下+左右）', () => {
  test('安全居中：place-items 起对齐+margin:auto 吸收', () => {
    const css = stripComments(readSrc('renderer/styles/base.css'));
    const body = css.split('\n').filter((l) => l.includes('.viewer-body'));
    assert.ok(body.some((l) => l.includes('.viewer-body {') && l.includes('place-items: start')), '查看容器必须起对齐（居中压钉负空间裁上左缘=滚动条不可达实锤）');
    assert.ok(!body.some((l) => l.includes('.viewer-body {') && l.includes('place-items: center')), '查看容器居中压钉必须拔除');
    assert.ok(css.includes('.viewer-body > * { margin: auto; }'), '子件 margin:auto 安全居中必须在（小居中/大归零全向可滚）');
    assert.ok(body.some((l) => l.includes('overflow: auto')), '溢出必须 auto');
  });
});

describe('② 查看态滚轮=缩放不滚屏，横手势不缩放', () => {
  test('滚轮闸：压默认+横向手势豁免', () => {
    const vi = readSrc('renderer/modules/viewer/index.js');
    assert.ok(vi.includes('e.preventDefault(); // 滚轮=缩放不滚屏'), '查看态滚轮必须全压默认（滚动条不绑滚轮）');
    assert.ok(vi.includes('Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;'), '横向手势必须只压默认不缩放（左右滚动不绑滚轮）');
    assert.ok(vi.includes('setZoom(ctl.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))'), '纵向滚轮缩放链必须在');
  });
});

describe('③ 编辑态横向条+滚轮纵不横', () => {
  test('台面板起对齐+手动纵向滚动', () => {
    const css = stripComments(readSrc('renderer/styles/base.css'));
    const stage = css.split('\n').filter((l) => l.includes('.ie-stage {'));
    assert.ok(stage.some((l) => l.includes('place-items: start;')), '台面板必须全起对齐（justify-items:center 压钉裁左缘实锤）');
    assert.ok(!stage.some((l) => l.includes('start center')), '台面板横向居中压钉必须拔除');
    const root = css.split('\n').filter((l) => l.includes('.ie-root {'));
    assert.ok(root.some((l) => l.includes('width: 100%') && l.includes('min-width: 0')), '编辑器根必须钉满宿主（fit-content 逃逸=台面板永无横向溢出实锤）');
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes("this.stage = this.el.querySelector('.ie-stage');"), '台面板引用必须在');
    assert.ok(ie.includes("this.stage.addEventListener('wheel'"), '编辑态滚轮闸必须在');
    assert.ok(ie.includes('this.stage.scrollTop += e.deltaY;'), '手动纵向滚动必须在（Chromium 纵尽暗渡横向实锤平反）');
    assert.ok((ie.match(/Math\.abs\(e\.deltaX\) > Math\.abs\(e\.deltaY\)/g) || []).length >= 1, '编辑态横向手势闸必须在');
  });
});
