// tests/contract/theme-store.test.mjs —— 自定义主题包契约
// 覆盖：校验规整 · 持久化增删 · 导入避让 · 空白模板可用 · 应用注入（基底兜底 + 覆盖）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const { installBrowserBridge } = await import('../../renderer/lib/browser-bridge.js');
installBrowserBridge();
const ts = await import('../../renderer/lib/theme-store.js');

describe('主题包校验', () => {
  test('合法包规整：滤掉空值与未知键，基底默认 paper', () => {
    const p = ts.validatePack({ name: ' 夜幕 ', vars: { bg: ' #101010 ', fg: '', '不存在的键': 'x', accent: '#4f46e5' } });
    assert.equal(p.name, '夜幕');
    assert.equal(p.base, 'paper');
    assert.deepEqual(Object.keys(p.vars).sort(), ['accent', 'bg']);
  });
  test('非法输入 → null；空名回退文件名', () => {
    assert.equal(ts.validatePack('{bad json'), null);
    assert.equal(ts.validatePack({ foo: 1 }), null);
    const p = ts.validatePack({ vars: { bg: '#fff' } }, '回退名');
    assert.equal(p.name, '回退名');
  });
});

describe('持久化增删', () => {
  test('保存→列出→删除全链路', async () => {
    await ts.savePack('测试主题', { name: '测试主题', base: 'ink', vars: { bg: '#111', fg: '#eee' } });
    const packs = await ts.listPacks();
    const hit = packs.find(p => p.id === '测试主题');
    assert.ok(hit);
    assert.equal(hit.base, 'ink');
    assert.equal(hit.vars.bg, '#111');
    await ts.deletePack('测试主题');
    assert.ok(!(await ts.listPacks()).some(p => p.id === '测试主题'));
  });

  test('导入：JSON 校验 + 同名自动避让', async () => {
    const id1 = await ts.importPack(JSON.stringify({ name: '导入', vars: { bg: '#123456' } }), '导入.json');
    const id2 = await ts.importPack(JSON.stringify({ name: '导入', vars: { bg: '#654321' } }), '导入.json');
    assert.equal(id1, '导入');
    assert.equal(id2, '导入 (1)');
    await assert.rejects(() => ts.importPack('{"x":1}', 'bad.json'), /合法的主题包/);
    await ts.deletePack(id1);
    await ts.deletePack(id2);
  });

  test('空白主题包：可获取、内容通过校验、全变量为空', async () => {
    const path = await ts.obtainBlankPack();
    assert.ok(path.includes('空白主题包'));
    const text = await window.mazz.invoke('fs:readFile', { path });
    const pack = ts.validatePack(text, 'blank');
    assert.ok(pack, '空白模板自身必须能通过校验');
    assert.equal(Object.keys(pack.vars).length, 0); // 全空 → 全量沿用基底
    await ts.deletePack(path.split('/').pop().replace('.json', ''));
  });
});

describe('应用注入', () => {
  test('applyPack：切换 data-theme + 注入覆盖变量 + 基底兜底', () => {
    // jsdom 无 themes.css，手动注入基底规则模拟
    const st = document.createElement('style');
    st.textContent = '[data-theme="paper"] { --bg: #f7f6f3; --fg: #2c2c2a; }';
    document.head.appendChild(st);
    ts.applyPack('demo', { name: 'demo', base: 'paper', vars: { bg: '#222831', accent: '#ff5722' } });
    assert.equal(document.documentElement.dataset.theme, 'pack:demo');
    const injected = document.getElementById('mazz-pack-theme').textContent;
    assert.ok(injected.includes('--bg: #222831'));
    assert.ok(injected.includes('--accent: #ff5722'));
    const base = document.getElementById('mazz-pack-base').textContent;
    assert.ok(base.includes('pack:demo'), '基底规则应改写为当前选择器');
  });
});
