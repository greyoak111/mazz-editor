// tests/contract/v22.test.mjs —— 桥接合并/工具条布局契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

describe('桥接合并逻辑（非覆盖）', () => {
  test('Markdown 目标：新内容以分隔线续接在旧内容后', async () => {
    const files = new Map([['/workspace/桥接/代码片段.md', '# 旧内容\n']]);
    window.mazz = {
      isElectron: true,
      invoke: async (ch, p = {}) => {
        if (ch === 'workspace:get') return '/workspace';
        if (ch === 'fs:readFile') {
          if (!files.has(p.path)) throw new Error('ENOENT');
          return files.get(p.path);
        }
        if (ch === 'fs:writeFile') { files.set(p.path, p.content); return true; }
        if (ch === 'fs:listDir') return [];
        if (ch === 'fs:mkdir') return true;
        return null;
      },
      on() {},
    };
    window.MazzHost = { openTab: () => {} };
    const { bridges } = await import('../../renderer/bridge.js');
    const p1 = bridges.execute('code.toMarkdown', { text: 'const a=1;', language: 'js', sourceTabId: 't1' });
    // 选择器弹层必等点击（picker modal 设计如此）——模拟点「自动新建」防挂死（定时炸弹拆线）
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.bt-opt')?.click();
    await p1;
    await bridges.execute('code.toMarkdown', { text: 'const b=2;', language: 'js', sourceTabId: 't1' });
    const merged = files.get('/workspace/桥接/代码片段.md') || '';
    assert.ok(merged.includes('# 旧内容'), `旧内容必须保留（${JSON.stringify(merged.slice(0, 40))}）`);
    assert.ok(merged.includes('const a=1') && merged.includes('const b=2'), '两次桥接必须合并续接（非覆盖实锤）');
    // 第一次是选择器：自动新建（模拟点击自动新建路径不可行于无 DOM 交互，改直接验证 upsert 二次合并）
    const code = fs.readFileSync(new URL('../../renderer/bridge.js', import.meta.url), 'utf8');
    assert.ok(code.includes('合并式更新'), '必须有合并注释标识');
    assert.ok(code.includes("merged = old.replace"), '必须读取旧内容并续接');
    assert.ok(!code.includes('覆盖式'), '不得再是覆盖式');
  });

  test('mazzslide 目标：新页用 --- 续接', () => {
    const code = fs.readFileSync(new URL('../../renderer/bridge.js', import.meta.url), 'utf8');
    assert.ok(code.includes("'\\n---\\n'"), '演示应以 --- 分页续接');
  });
});

describe('工具条布局（防重叠守卫）', () => {
  test('工具条置底 + 色板独立成行（不再绝对定位摞叠）', () => {
    const css = fs.readFileSync(new URL('../../renderer/styles/base.css', import.meta.url), 'utf8');
    assert.ok(/\.draw-tool-strip \{[^}]*bottom: 10px/.test(css), '工具条必须默认在画板窗格下方');
    const pal = css.match(/\.draw-palette \{[^}]+\}/)[0];
    assert.ok(!pal.includes('position: absolute'), '色板不得再绝对定位（那是重叠根因）');
    assert.ok(pal.includes('flex-wrap: wrap'), '色板应换行自适应');
  });
});
