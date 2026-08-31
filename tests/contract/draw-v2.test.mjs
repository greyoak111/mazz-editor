// tests/contract/draw-v2.test.mjs —— 笔刷引擎/ABR 校验/Ribbon 折叠/转换映射契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import JSZip from 'jszip';

const { BRUSH_TYPES, DEFAULT_BRUSHES, colorWithAlpha, parseAbr } = await import('../../renderer/modules/draw/brushes.js');
const { needsConvert, extOf, drawSidecarExtension } = await import('../../renderer/lib/extern-convert.js');
const { exportOra } = await import('../../renderer/modules/draw/ora.js');
const { Ribbon } = await import('../../renderer/shell/ribbon.js');

describe('笔刷引擎', () => {
  test('笔型注册表完整（7 类 + 印章）', () => {
    for (const t of ['pen', 'pencil', 'marker', 'airbrush', 'watercolor', 'calligraphy', 'soft', 'stamp']) {
      assert.ok(BRUSH_TYPES[t], '缺笔型: ' + t);
    }
    assert.ok(BRUSH_TYPES.airbrush.stamp && BRUSH_TYPES.soft.stamp, '喷枪/柔边应为印章渲染');
  });
  test('默认笔刷参数合法且互不相同', () => {
    assert.ok(DEFAULT_BRUSHES.length >= 7);
    assert.ok(DEFAULT_BRUSHES.every(b => b.size > 0 && b.opacity > 0 && b.opacity <= 1));
    assert.ok(DEFAULT_BRUSHES.find(b => b.type === 'airbrush').size > DEFAULT_BRUSHES.find(b => b.type === 'pen').size);
  });
  test('colorWithAlpha 解析', () => {
    assert.equal(colorWithAlpha('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
    assert.equal(colorWithAlpha('#1a1a1a', 1), 'rgba(26,26,26,1)');
  });
});

describe('ABR 解析（校验路径）', () => {
  test('非 abr 版本头 → 明确报错', () => {
    const buf = new Uint8Array([0, 3, 0, 0]).buffer; // version=3 不支持
    assert.throws(() => parseAbr(buf), /v6/);
  });
});

describe('外部打开格式映射', () => {
  test('自创格式判定', () => {
    assert.ok(needsConvert('mazzsheet'));
    assert.ok(needsConvert('mazzslide'));
    assert.ok(needsConvert('mazzdraw'));
    assert.ok(!needsConvert('docx'));
    assert.ok(!needsConvert('md'));
    assert.equal(extOf('a/b/c.mazzdraw'), 'mazzdraw');
    assert.equal(drawSidecarExtension('ora'), 'ora', 'ORA 回写必须保留 ZIP/ORA 扩展名');
    assert.equal(drawSidecarExtension('png'), 'png');
  });

  test('ORA 保留填充、形状、隐藏图层与正确 stack 顺序', async () => {
    const originalCreate = document.createElement.bind(document);
    const OriginalPath2D = globalThis.Path2D;
    let canvasSeq = 0;
    class FakeContext {
      constructor(label) { this.label = label; this.ops = []; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.stack = []; }
      save() { this.stack.push([this.globalAlpha, this.globalCompositeOperation]); this.ops.push(['save']); }
      restore() {
        [this.globalAlpha, this.globalCompositeOperation] = this.stack.pop() || [1, 'source-over'];
        this.ops.push(['restore']);
      }
      drawImage(image, ...args) { this.ops.push(['drawImage', image?.label || image?.id || 'image', ...args, this.globalAlpha]); }
      createRadialGradient() { return { addColorStop() {} }; }
      fillRect(...args) { this.ops.push(['fillRect', ...args, this.globalAlpha]); }
      strokeRect(...args) { this.ops.push(['strokeRect', ...args, this.globalAlpha]); }
      beginPath() { this.ops.push(['beginPath']); }
      ellipse(...args) { this.ops.push(['ellipse', ...args]); }
      moveTo(...args) { this.ops.push(['moveTo', ...args]); }
      lineTo(...args) { this.ops.push(['lineTo', ...args]); }
      fillText(...args) { this.ops.push(['fillText', ...args]); }
      fill() { this.ops.push(['fill', this.globalAlpha, this.globalCompositeOperation]); }
      stroke() { this.ops.push(['stroke', this.globalAlpha]); }
    }
    class FakeCanvas {
      constructor() { this.label = `canvas-${canvasSeq++}`; this.ctx = new FakeContext(this.label); }
      getContext() { return this.ctx; }
      toDataURL() { return `data:image/png;base64,${Buffer.from(JSON.stringify(this.ctx.ops)).toString('base64')}`; }
    }
    document.createElement = tag => tag === 'canvas' ? new FakeCanvas() : originalCreate(tag);
    globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
    try {
      const frame = { layers: [
        { name: '底层', visible: true, opacity: 0.4, _fillEl: { id: 'fill-patch' }, images: [], shapes: [{ kind: 'rect', x1: 1, y1: 2, x2: 11, y2: 12, color: '#f00', fill: true }], strokes: [{ brush: 'airbrush', color: '#00f', size: 8, pts: [{ x: 1, y: 1 }, { x: 12, y: 12 }] }] },
        { name: '隐藏顶层', visible: false, opacity: 1, images: [{ _el: { id: 'hidden-image' }, x: 0, y: 0, w: 5, h: 5 }], shapes: [], strokes: [{ erase: true, size: 4, pts: [{ x: 1, y: 1 }, { x: 6, y: 6 }] }] },
      ] };
      const archive = await exportOra(frame, { width: 20, height: 20 });
      const archiveBytes = new Uint8Array(archive);
      const localHeader = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
      const firstNameLength = localHeader.getUint16(26, true);
      assert.equal(localHeader.getUint32(0, true), 0x04034b50, 'ORA 必须以 ZIP local header 开头');
      assert.equal(new TextDecoder().decode(archiveBytes.subarray(30, 30 + firstNameLength)), 'mimetype', 'mimetype 必须是 ORA 首项');
      assert.equal(localHeader.getUint16(8, true), 0, 'mimetype 必须 STORE，不得 DEFLATE');
      const zip = await JSZip.loadAsync(archive);
      const stack = await zip.file('stack.xml').async('string');
      assert.ok(stack.indexOf('隐藏顶层') < stack.indexOf('底层'), 'stack.xml 必须顶层在前');
      assert.match(stack, /name="隐藏顶层"[^>]+visibility="hidden"/);
      const bottomOps = JSON.parse(await zip.file('data/layer0.png').async('string'));
      assert.ok(bottomOps.some(op => op[0] === 'drawImage' && op[1] === 'fill-patch'), '填充补丁未进入 ORA 图层');
      assert.ok(bottomOps.some(op => op[0] === 'fillRect'), '形状未进入 ORA 图层');
      assert.ok(bottomOps.some(op => op[0] === 'drawImage' && String(op[1]).startsWith('canvas-')), '喷枪/印章笔刷必须保留点阵渲染语义');
      const hiddenOps = JSON.parse(await zip.file('data/layer1.png').async('string'));
      assert.ok(hiddenOps.some(op => op[0] === 'fill' && op[2] === 'destination-out'), '擦除笔画必须在当前 ORA 图层内扣除');
      const mergedOps = JSON.parse(await zip.file('mergedimage.png').async('string'));
      assert.equal(mergedOps.filter(op => op[0] === 'drawImage').length, 1, '隐藏图层不得进入 mergedimage');
      assert.ok(mergedOps.some(op => op[0] === 'drawImage' && op.at(-1) === 0.4), '图层透明度应在 merged 合成时应用一次');
    } finally {
      document.createElement = originalCreate;
      if (OriginalPath2D === undefined) delete globalThis.Path2D;
      else globalThis.Path2D = OriginalPath2D;
    }
  });
});

describe('Ribbon 二级折叠', () => {
  test('超 7 个按钮自动收进「更多」', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const rb = new Ribbon(host);
    const buttons = Array.from({ length: 12 }, (_, i) => ({ command: 'c' + i, icon: '·', label: 'btn' + i }));
    const g = rb.group('测试组', buttons);
    const direct = g.querySelectorAll(':scope > .rb-btn:not(.rb-more)').length;
    assert.equal(direct, 7, '一级只显示 7 个');
    const more = g.querySelector('.rb-more');
    assert.ok(more, '应有「更多」按钮');
    // 点更多 → 弹出二级菜单含 5 个
    more.click();
    const pop = document.querySelector('.rb-more-pop');
    assert.ok(pop, '二级菜单应弹出');
    assert.equal(pop.querySelectorAll('.rb-btn').length, 5);
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  });
});
