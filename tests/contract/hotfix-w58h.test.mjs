// tests/contract/hotfix-w58h.test.mjs —— W58h 契约（右栏拖拽/渲染同函数绝脱同步）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('右栏拖拽上界=渲染封顶同函数', () => {
  test('拖拽钳制含 30% 舞台系数+CSS 30% 封顶一致', () => {
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes('Math.floor(stage.clientWidth * 0.3)'), '拖拽上界必须含舞台 30%（与渲染封顶同函数——幽灵让位实锤）');
    assert.ok(pl.includes('W58h'), '同函数注释必须在');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(/\.mz-side \{[^}]*max-width: 30%/.test(css), 'CSS 必须 30% 封顶（与拖拽同系数）');
    assert.ok(!/\.mz-side \{[^}]*max-width: 24%/.test(css), '24% 旧封顶必须绝迹');
  });
});
