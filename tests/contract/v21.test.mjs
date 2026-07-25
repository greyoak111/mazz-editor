// tests/contract/v21.test.mjs —— 桥接目标文件/引用线拐点/导图模板契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const { createRefLine, serializeDoc, parseDoc, createNode } = await import('../../renderer/modules/mindmap/model.js');
const { validateTemplate, PRESET_TEMPLATES } = await import('../../renderer/modules/mindmap/templates.js');

describe('引用线拐点与线型', () => {
  test('新建引用线默认曲线模式，可设直线与拐点', () => {
    const rl = createRefLine('a', 'node', 'b', 'note');
    assert.equal(rl.mode, 'curve');
    rl.mode = 'straight';
    rl.waypoints.push({ x: 10, y: 20 }, { x: 30, y: 40 });
    const doc = { mode: 'lr', scheme: 0, roots: [createNode('根')], notes: [], refLines: [rl], linkStyle: null };
    const back = parseDoc(serializeDoc(doc));
    assert.equal(back.refLines[0].mode, 'straight');
    assert.equal(back.refLines[0].waypoints.length, 2);
  });
});

describe('导图模板', () => {
  test('预置模板齐（经典/简约/暗夜/糖果）且合法', () => {
    assert.equal(PRESET_TEMPLATES.length, 4);
    for (const t of PRESET_TEMPLATES) {
      assert.ok(t.levels.length >= 4);
      assert.ok(t.builtin);
    }
  });
  test('validateTemplate：合法通过 / 非法拒绝 / 缺省补齐', () => {
    const ok = validateTemplate({ name: '我的', levels: ['#111', '#222'] });
    assert.ok(ok);
    assert.equal(ok.radius, 9);
    assert.equal(ok.connColor, '#d8d6cf');
    assert.equal(validateTemplate({ foo: 1 }), null);
    assert.equal(validateTemplate('{bad'), null);
  });
});

describe('工具条布局修复（CSS 守卫）', () => {
  test('draw-tool-strip 为纵向堆叠（防两行重叠）', () => {
    const css = fs.readFileSync(new URL('../../renderer/styles/base.css', import.meta.url), 'utf8');
    assert.ok(css.includes('flex-direction: column'), '工具条必须纵向堆叠防重叠');
    assert.ok(/max-height: 4[0-9]vh/.test(css), '工具条应有高度上限与滚动');
  });
});

describe('桥接目标文件逻辑（静态检查）', () => {
  test('bridge.js 含桥接/ 文件夹与同窗更新映射', () => {
    const src = fs.readFileSync(new URL('../../renderer/bridge.js', import.meta.url), 'utf8');
    assert.ok(src.includes('桥接/'), '应有桥接文件夹');
    assert.ok(src.includes('bridgeTargets'), '应有窗格-目标映射');
    assert.ok(src.includes("bus.on('tab:requestClose'"), '关窗格应清理映射');
    assert.ok(src.includes('upsertBridgeFile'), '应有统一更新入口');
  });
});
