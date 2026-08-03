// tests/contract/hotfix-w52b.test.mjs —— W52② 工具坞三件套契约（推挤+拉伸+折叠轨+滚动条军规）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('真推拉布局（W52e③ 结构同构平反：margin hack 退役，flex sibling 上岗）', () => {
  test('mount 搬家机制', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(src.includes('mount()'), 'mount 方法必须有');
    assert.ok(src.includes("ws.appendChild(this.el)"), '停靠必须挂 workspace（flex 兄弟=真布局成员）');
    assert.ok(src.includes('document.body.appendChild(this.el)'), '浮动/关闭必须挂回 body 浮层');
    assert.ok(src.includes('this.state.open && !this.state.float'), '浮动/关闭不得占推挤位');
    // 反摆烂：margin hack 必须绝迹
    assert.ok(!src.includes('applyPush'), 'applyPush margin hack 必须绝迹');
    assert.ok(!src.includes('--mz-dock-w'), '--mz-dock-w 推挤变量必须绝迹');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(!css.includes('margin-right: var(--mz-dock-w'), 'workspace margin 让位 hack 必须绝迹');
    assert.ok(css.includes('.side-dock { position: relative; flex: none;'), '坞停靠必须 flex 兄弟');
    assert.ok(css.includes('.side-dock.floating { position: fixed;'), '坞浮动才 fixed 浮层（非 Electron 预览兜底）');
  });
  test('show/hide/toggleFloat 全联动 mount（W53 浮动=dockfloat 子窗格）', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(/show\(\) \{[\s\S]{0,300}this\.mount\(\)/.test(src), 'show 必须归位');
    assert.ok(/hide\(\) \{[\s\S]{0,200}this\.mount\(\)/.test(src), 'hide 必须搬家');
    assert.ok(src.includes("panel:open', { kind: 'dockfloat' }"), '浮动必须开 dockfloat 子窗格（W53 纯原生浮动）');
    assert.ok(src.includes('backFromFloat'), '回停靠联动必须有');
    assert.ok(src.includes('toolsGroups'), '工具页数据出口必须有（坞浮动镜像）');
  });
});

describe('拉伸限位与折叠轨', () => {
  test('grip 限位钳', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(src.includes('innerWidth * 0.6'), '窗宽 60% 封顶必须有（全屏钮区不被挤掉同款纪律）');
  });
  test('折叠轨三件套', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(src.includes('setCollapsed') && src.includes('data-a="collapse"') && src.includes('data-a="expand"'), '折叠/展开双钮必须有');
    assert.ok(src.includes("iconHtml('›')") && src.includes("iconHtml('‹')"), '折叠钮必须 SVG（三铁律①零 emoji）');
    assert.ok(src.includes('state.collapsed'), '折叠态必须记忆');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.side-dock.collapsed .sd-rail'), '细轨展开钮必须有');
    assert.ok(css.includes('width: 36px !important'), '细轨宽度必须定');
  });
});

describe('滚动条军规（④溢出必滚动条）', () => {
  test('坞与面板统一滚动条族', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.sd-body::-webkit-scrollbar') && css.includes('.mazz-scroll::-webkit-scrollbar'), '滚动条族必须有');
    const fav = readSrc('renderer/panels/favmgr.html');
    const pw = readSrc('renderer/panels/pwmgr.html');
    assert.ok(fav.includes('mazz-scroll') && pw.includes('mazz-scroll'), '双面板必须吃滚动条族');
    assert.ok(css.includes('.sd-body { flex: 1; overflow: auto'), '坞体溢出滚动必须保');
  });
});
