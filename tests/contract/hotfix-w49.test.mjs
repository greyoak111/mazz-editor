// tests/contract/hotfix-w49.test.mjs —— W49 契约（工具坞回滚+命中测试制遮挡隐身）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('命中测试制遮挡隐身（渲染方案调整）', () => {
  test('elementsFromPoint 通用判定', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    const src2 = readSrc('main/browser-views.js');
    assert.ok(!src2.includes('offscreen: true'), 'W52 起离屏弯路清算（三重税不交——回正原生）');
    assert.ok(!src.includes('elementsFromPoint'), '命中测试制已退（W52 浮层三路遣散替代——不再打地鼠）');
  });
});

describe('工具坞回滚（W46 未改动态）', () => {
  test('内嵌坞行为复原', () => {
    const side = readSrc('renderer/shell/side-dock.js');
    assert.ok(side.includes('const GROUPS = this._toolsGroups = ['), '内联 GROUPS 必须复原（W53 起兼 toolsGroups 出口）');
    assert.ok(side.includes("cmd: 'file.newViewer'"), '空手起播入口必须在（w46 定版）');
    assert.ok(!side.includes('dock-items.js'), '不得再吃共享清单（已撤）');
  });
});
