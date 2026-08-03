// tests/contract/hotfix-w58e.test.mjs —— W58e 契约（新建文件子窗/五区 emoji 清零/滚动条统一）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 新建文件全原生独立子窗', () => {
  test('kind 注册+标题+面板页+壳桥', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(/\|newfile[|)]/.test(pw), 'kind 白名单必须有 newfile（交替表增长兼容）');
    assert.ok(pw.includes("newfile: '新建文件'"), '标题表必须有');
    const html = readSrc('renderer/panels/newfile.html');
    assert.ok(html.includes("type: 'themeSnapshot'"), '主题快照桥必须有（不透明化全家桶）');
    assert.ok(html.includes("type !== 'newfileTypes'"), '类型下发消费必须有');
    assert.ok(html.includes("type: 'newfilePick'"), 'pick 桥必须有');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("kind: 'newfile'"), '壳必须走 panel:open');
    assert.ok(sh.includes('this._newfileDir = t.dir'), '落点 stash 必须有');
    assert.ok(sh.includes("pl.type === 'newfileQuery'") && sh.includes("pl.type === 'newfilePick'"), '双桥应答必须有');
  });
});

describe('② 五区 emoji 清零', () => {
  test('MAP 补六缺口', () => {
    const si = readSrc('renderer/lib/svg-icons.js');
    for (const e of ["'✂'", "'📑'", "'📱'", "'✏'", "'▭'", "'◯'"]) assert.ok(si.includes(e + ':'), e + ' 必须入 MAP');
  });
  test('浏览器 ribbon 三裸钉绝迹', () => {
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(br.includes("iconHtml('✂')") && br.includes("iconHtml('📁')") && br.includes("iconHtml('📑')"), '三钉必须 iconHtml 化');
    assert.ok(!/<i class="ico">✂<\/i>|<i class="ico">📁<\/i>|<i class="ico">📑<\/i>/.test(br), '裸 emoji 必须绝迹');
  });
  test('画板/演示 ribbon 收编', () => {
    const dr = readSrc('renderer/modules/draw/index.js');
    assert.ok(dr.includes("iconHtml('✏')") && !dr.includes('<i class="ico">✏️</i>'), '画笔必须 iconHtml 化');
    const sl = readSrc('renderer/modules/slide/index.js');
    for (const e of ["iconHtml('✏')", "iconHtml('▭')", "iconHtml('◯')", "iconHtml('▶')"]) assert.ok(sl.includes(e), e + ' 必须在 slide ribbon');
  });
  test('设置面板五钮 inline SVG 化', () => {
    const st = readSrc('renderer/panels/settings.html');
    for (const e of ['📄', '📥', '📂', '🖼', '🗑']) assert.ok(!st.includes(e), `设置面板 ${e} 必须清零（含删除钮漏网）`);
    assert.ok((st.match(/<svg /g) || []).length >= 5, 'inline SVG 必须≥5');
  });
});

describe('③ 子窗滚动条统一', () => {
  test('与主界面全局滚动条一族同款+hover accent', () => {
    const ps = readSrc('renderer/panels/panel-shared.css');
    assert.ok(ps.includes('width: 10px; height: 10px;'), '10px 轨必须镜像主界面');
    assert.ok(ps.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'), '滑块换色+透明化浮丸必须镜像');
    assert.ok(ps.includes('*::-webkit-scrollbar-thumb:hover { background: var(--accent);'), 'hover accent 美化必须有');
    const base = readSrc('renderer/styles/base.css');
    assert.ok(base.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'), '主界面一族必须在（镜像源）');
  });
});
