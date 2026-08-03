// tests/contract/hotfix-w58.test.mjs —— W58 契约（W57全语言运行体系+B12语言选择格子窗化+预览档三层根治）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W57 全语言运行体系（四级 RUNNERS）', () => {
  test('RUNNERS 对象形态四档俱全+扩展名权威映射', () => {
    const src = readSrc('renderer/modules/code/index.js');
    assert.ok(src.includes("type: 'run'"), 'A 档直跑必须有');
    assert.ok(src.includes("type: 'compile'"), 'B 档编译运行必须有');
    assert.ok(src.includes("type: 'preview'"), 'C 档预览必须有');
    assert.ok(src.includes("type: 'none'"), 'D 档明示不可运行必须有');
    assert.ok(src.includes('const EXT_LANG = {'), '扩展名→语言权威映射必须有');
    assert.ok(src.includes('langOfPath(p) { return langOf(p); }'), 'langOfPath 必须导出（saveTab 语言同步凭据）');
    assert.ok(src.includes('const runner = RUNNERS[lang];'), 'runFile 必须走 RUNNERS 单源');
  });
  test('工具链探测主进程化+人话缺链提示', () => {
    const tc = readSrc('main/toolchain.js');
    assert.ok(tc.includes("bus.handle('toolchain:detect'"), 'toolchain:detect 必须有');
    assert.ok(tc.includes("bus.handle('toolchain:detectAll'"), 'toolchain:detectAll 必须有');
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes("require('./toolchain')"), 'Toolchain 必须装配进主进程');
    const src = readSrc('renderer/modules/code/index.js');
    assert.ok(src.includes('缺少工具链'), '缺链人话提示必须有');
    assert.ok(src.includes('不可运行（数据/样式/标记类）'), 'D 档人话提示必须有');
  });
  test('保存后无法运行根治：create 返回 ctl 本体', () => {
    const src = readSrc('renderer/modules/code/index.js');
    assert.ok(src.includes('W58 根治：create 必须返回 ctl 本体'), '根治注释必须在');
    assert.ok(!src.includes('return { container };'), '畸形态 { container } 返回必须绝迹');
  });
});

describe('B12 语言选择格子窗化', () => {
  test('select 退役+按钮开 ctxmenu+模块页激活', () => {
    const src = readSrc('renderer/modules/code/index.js');
    assert.ok(src.includes('id="code-lang-btn"'), '语言按钮必须在');
    assert.ok(src.includes('const LANG_MENU = ['), 'LANG_MENU 贡献必须有');
    assert.ok(!src.includes('<select id="code-lang"'), '老 select 必须退役');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("this.ribbon.showPage?.('module')"), 'ribbon 模块页激活必须有（B12 按钮不在的总根）');
  });
});

describe('预览档三层根治', () => {
  test('① tryNav 轮询等页签就绪（file.newBrowser 异步竞态）', () => {
    const src = readSrc('renderer/modules/code/index.js');
    assert.ok(src.includes('const tryNav = () => {'), 'tryNav 轮询必须有');
    assert.ok(src.includes('Date.now() - t0 < 4000'), '4s 轮询窗必须有');
    assert.ok(!src.includes('}, 600);\n      return;'), '600ms 单次延时赌局必须绝迹');
  });
  test('② MEDIA_MIME 文档族（html 不再 octet-stream 下载）+ utf-8 明码', () => {
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes("html: 'text/html'"), 'html MIME 必须有');
    assert.ok(mj.includes('W58 文档族'), '文档族注释必须在');
    assert.ok(mj.includes("mime + '; charset=utf-8'"), '文档族 utf-8 明码必须有（无 meta 中文 html 乱码实锤）');
    assert.ok(mj.includes("'Content-Type': ct,"), 'media 双支必须走 ct（range/全量一致）');
  });
  test('③ mazz-res 逐会话注册（persist:mazz-browser 无 handler=about:blank 实锤）', () => {
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes('let mazzResHandler = null;'), 'handler 模块级引渡必须有');
    assert.ok(mj.includes('mazzResHandler = async (req) => {'), 'handler 本体必须具名化');
    assert.ok(mj.includes("protocol.handle('mazz-res', mazzResHandler);"), '默认会话注册必须保留');
    assert.ok(mj.includes("browserSess.protocol.handle('mazz-res', mazzResHandler);"), '浏览器独立会话注册必须有（预览档总根）');
  });
});

describe('W58 E2E 实证批在位', () => {
  test('run56+scenes56 双件+白名单补全', () => {
    assert.ok(fs.existsSync(path.resolve('tests/e2e/run56.mjs')), 'run56 必须在');
    const sc = readSrc('tests/e2e/scenes56.mjs');
    assert.ok(sc.includes('预览·html 运行开浏览器页签'), '预览场景必须有');
    assert.ok(sc.includes('w58mark'), '预览标记断言必须有');
    const rn = readSrc('tests/e2e/run56.mjs');
    assert.ok(rn.includes("'getFoldingRanges'"), 'Monaco worker 良性噪音白名单必须有');
  });
});
