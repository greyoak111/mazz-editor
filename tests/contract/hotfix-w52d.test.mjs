// tests/contract/hotfix-w52d.test.mjs —— W52④ 收官契约（批注墨迹子窗/devtools 主题/三铁律清扫）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('批注墨迹子窗', () => {
  test('透明罩与主窗跟随', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('openAnnotate'), '墨迹子窗方法必须有');
    assert.ok(pw.includes("alwaysOnTop: true") && pw.includes('skipTaskbar: true'), '透明罩层级必须有');
    assert.ok(pw.includes('transparent: true') && pw.includes("backgroundColor: '#00000000'"), '全透明必须有');
    assert.ok(pw.includes('_follow') && pw.includes("parent.on('move', sync)") && pw.includes("parent.on('resize', sync)"), 'bounds 跟随必须有（纹身级贴合）');
    assert.ok(pw.includes('_unfollow'), '闭窗解挂必须有');
    const html = readSrc('renderer/panels/annotate.html');
    assert.ok(html.includes('quadraticCurveTo'), '平滑笔迹必须有');
    assert.ok(html.includes('strokes') && html.includes('undo'), '笔画栈+撤销必须有');
  });
  test('分路与退出', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("contextKeys.get('module') === 'browser'"), '浏览器页必须走墨迹子窗');
    assert.ok(sh.includes("kind: 'annotate'"), '批注面板位必须有');
    assert.ok(sh.includes('toggleAnnotate'), 'DOM 老层必须保（非浏览器页）');
    assert.ok(sh.includes("pl.type === 'annotateExit'"), '退出应答必须有');
  });
});

describe('devtools 主题跟随', () => {
  test('uiTheme 注入与实时换', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('syncDevToolsTheme'), '主题注入方法必须有');
    assert.ok(bv.includes("localStorage.setItem('uiTheme'"), 'uiTheme 偏好注入必须有');
    assert.ok(bv.includes("['ink', 'indigo', 'moss'].includes(id)"), '暗系主题映射必须有');
    assert.ok(bv.includes('rethemeAllDevTools'), '实时换方法必须有');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('themeId: () => store.get') && main.includes('rethemeAllDevTools(id)'), '取数与广播钩必须有');
  });
});

describe('三铁律清扫（零 emoji 按钮）', () => {
  test('面板窗控全 SVG', () => {
    for (const f of ['renderer/panels/favmgr.html', 'renderer/panels/pwmgr.html', 'renderer/panels/palette.html', 'renderer/panels/shortcuts.html']) {
      const src = readSrc(f);
      assert.ok((src.match(/<svg/g) || []).length >= 3, `${f} 窗控必须全 SVG（三铁律①）`);
      assert.ok(!src.includes('>－</button>') && !src.includes('>▢</button>') && !src.includes('>✕</button>'), `${f} 文字符号钮不得残留`);
    }
    const an = readSrc('renderer/panels/annotate.html');
    assert.ok((an.match(/<svg/g) || []).length >= 4, '批注工具钮必须全 SVG');
  });
});
