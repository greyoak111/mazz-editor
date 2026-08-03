// tests/contract/hotfix-w58f.test.mjs —— W58f 契约（播放器三栏自适应/面板滚动锁/新建文件窗控归位）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 播放器三栏自适应+底栏常驻', () => {
  test('自动隐藏只留全屏/无边框', () => {
    const pl = readSrc('renderer/modules/viewer/player.js');
    assert.ok(pl.includes('if (!document.fullscreenElement && !ctl.borderless) return;'), '窗口态 fade 必须绝迹');
  });
  test('右栏列表+左栏工作区自适应让位', () => {
    const css = readSrc('renderer/styles/base.css');
    assert.ok(/\.mz-side \{[^}]*max-width: 30%/.test(css), 'mz-side 30% 封顶必须有（W58h 与拖拽上界同函数——24% 旧值与拖拽脱同步实锤）');
    assert.ok(/\.mz-side \{[^}]*min-width: 150px/.test(css), 'mz-side 150 保底必须有');
    assert.ok(/\.sidebar \{[^}]*max-width: 32vw/.test(css), 'sidebar 32vw 封顶必须有');
  });
});

describe('② 面板滚动锁（外飘轨绝育）', () => {
  test('全部面板 html/body 锁溢出（覆盖面板豁免）', () => {
    const files = fs.readdirSync(path.resolve('renderer/panels')).filter(f => f.endsWith('.html') && !['annotate.html', 'splitpreview.html'].includes(f));
    assert.ok(files.length >= 16, '面板数底线');
    for (const f of files) {
      const s = readSrc('renderer/panels/' + f);
      assert.ok(/html, body \{[^}]*overflow: hidden/.test(s), f + ' 必须锁文档级滚动');
    }
  });
  test('内滚容器在位（防裁切回退）', () => {
    const files = fs.readdirSync(path.resolve('renderer/panels')).filter(f => f.endsWith('.html') && !['annotate.html', 'splitpreview.html'].includes(f));
    for (const f of files) {
      const s = readSrc('renderer/panels/' + f);
      assert.ok(s.includes('ps-scroll') || /overflow:\s*auto/.test(s) || /overflow-y:\s*auto/.test(s), f + ' 必须有内滚容器');
    }
  });
});

describe('③ 新建文件窗控三键归位+内滚唯一', () => {
  test('p-winbtns 同款右上悬浮+body flex 内滚', () => {
    const nf = readSrc('renderer/panels/newfile.html');
    assert.ok(nf.includes('.p-winbtns { position:absolute; top:2px; right:8px;'), '窗控三键必须右上悬浮（同款）');
    assert.ok(/\.body \{[^}]*flex: 1/.test(nf), 'body 必须 flex:1 内滚唯一');
    assert.ok(/\.pwin \{[^}]*height:100%/.test(nf), 'pwin 必须随文档高');
  });
});
