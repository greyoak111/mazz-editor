// Browser/Webbridge WebContentsView 回归：产品动作必须复用唯一客页执行通道。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = file => fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');

describe('Browser 密码手动填充 WebContentsView 链', () => {
  test('指定密码沿 ctl.execJs → bv:js 执行，不再访问空 tab.view', () => {
    const source = readSrc('renderer/modules/browser/index.js');
    const start = source.indexOf('async function fillPassword(pwId = null)');
    const end = source.indexOf('\n  ctl.activeTab = activeTab;', start);
    const fill = source.slice(start, end);
    assert.ok(start >= 0 && end > start, 'fillPassword 实现必须存在');
    assert.match(fill, /ctl\.execJs\(t\.viewId, js, \{ userGesture: true \}\)/,
      '手动填充必须复用 Browser controller 的 WebContentsView 客页执行口');
    assert.doesNotMatch(fill, /t\.view(?:\?|\.)?\.executeJavaScript|querySelector\([^)]*webview/,
      '手动填充不得再触碰已退役 tab.view/webview DOM');
    assert.match(source, /ctl\.execJs = async \(tabId, code, \{ userGesture = false \} = \{\}\)/,
      '现有 ctl.execJs 必须透传显式用户手势');
    assert.match(source, /invoke\('bv:js', \{ tabId: id, code, userGesture: userGesture === true \}\)/,
      'ctl.execJs 必须继续落到现有 bv:js IPC');
  });
});

describe('Webbridge 投稿 WebContentsView 链', () => {
  test('投稿标签保留真实 viewId，等待导航并经 ctl.execJs 注入', () => {
    const source = readSrc('renderer/modules/webbridge/index.js');
    assert.match(source, /brTab = brCtl\.openTabRaw\(adapter\.url, \{ partition: AUTHOR_PARTITION \}\)/,
      '投稿必须复用 Browser controller 创建隔离会话标签');
    assert.match(source, /Promise\.resolve\(brTab\.navigationReady \|\| brTab\.navQueue\)/,
      '注入前必须等待真实 WebContentsView 导航队列');
    assert.match(source, /brCtl\.execJs\(brTab\.viewId, code, \{ userGesture: true \}\)/,
      '投稿注入必须复用 ctl.execJs/bv:js 真源');
    assert.doesNotMatch(source, /querySelectorAll\([^\n]*webview|\.tagName === ['"]WEBVIEW['"]|\.executeJavaScript\(/,
      'Webbridge renderer 不得再寻找或直调已退役 webview');
    assert.match(source, /return \{ ok: true, via: r\.via,[^}]*viewId: brTab\.viewId \}/,
      '队列必须等待并收到真实注入回执');
  });
});
