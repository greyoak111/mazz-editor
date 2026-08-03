// tests/contract/mindmap-w33.test.mjs —— 波次三十三「演示叙事模式」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('帧模型与镜头动画器', () => {
  test('帧模型与序列化', () => {
    const src = readSrc('renderer/modules/mindmap/mm-present.js');
    assert.ok(src.includes('createFrame'), '帧工厂必须有');
    const model = readSrc('renderer/modules/mindmap/model.js');
    assert.ok(model.includes('frames: doc.frames || []') && model.includes('frames: obj.frames || []'), '序列化往返必须有帧');
  });
  test('camTween 与 camOfFrame 通用镜头引擎', () => {
    const src = readSrc('renderer/modules/mindmap/mm-present.js');
    assert.ok(src.includes('camTween') && src.includes('requestAnimationFrame'), '镜头动画器必须 rAF 驱动');
    assert.ok(src.includes('easeInOutCubic') || src.includes('4 * t * t * t'), '缓动必须 easeInOutCubic');
    assert.ok(src.includes('cancelAnimationFrame'), '旧趟必须取消');
    assert.ok(src.includes('camOfFrame'), '帧→镜头适配必须有');
  });
});

describe('放映态状态机与命令化', () => {
  test('status 单字段+rollback', () => {
    const src = readSrc('renderer/modules/mindmap/mm-present.js');
    assert.ok(src.includes("ctl.mmStatus = 'present'") && src.includes("ctl.mmStatus = 'normal'"), 'status 双态必须有');
    assert.ok(src.includes('_prevCam'), '还原快照必须有（rollback）');
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes("ctl.mmStatus = 'normal'"), '实例必须初始化状态');
  });
  test('命令化与三态纪律', () => {
    const src = readSrc('renderer/modules/mindmap/mm-present.js');
    for (const c of ['addFrame', 'removeFrame', 'moveFrame', 'startPresent', 'exitPresent']) assert.ok(src.includes(c), `缺命令 ${c}`);
    assert.ok((src.match(/queryState\(ctl\) \{ return ctl\.mmStatus === 'present' \? -1/g) || []).length >= 3, 'present 态编辑命令必须自判禁用');
  });
});

describe('放映 UX 与禁用闸', () => {
  test('覆盖层 HUD 与键路由', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes('mm-present-stage'), '覆盖层必须有');
    assert.ok(idx.includes('mm:present-change'), '状态变更事件必须有');
    assert.ok(idx.includes("e.key === 'F5'"), 'F5 启动必须有');
    assert.ok(idx.includes('mm:present-key'), '放映键路由必须有');
    const src = readSrc('renderer/modules/mindmap/mm-present.js');
    assert.ok(src.includes("'ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'"), '下一帧键组必须有');
    assert.ok(src.includes("(e.detail || e).key"), '键载荷必须走 detail（CustomEvent 无 .key 实锤）');
    assert.ok(src.includes("key === 'Escape'"), 'Esc 退出必须有');
  });
  test('编辑禁用闸', () => {
    const idx = readSrc('renderer/modules/mindmap/index.js');
    assert.ok(idx.includes("if (ctl.mmStatus === 'present') return; // 放映态编辑禁用"), 'startEdit 必须有闸');
    assert.ok((idx.match(/mmStatus === 'present'\) return;/g) || []).length >= 5, '节点/拖拽/缩放/菜单必须全上闸');
    assert.ok(idx.includes("data-k=\"__frame-add\"") && idx.includes('renderFramesBar'), '帧侧栏必须有');
  });
});
