// tests/contract/r1r2-progress-notif.test.mjs —— R1+R2 进度接力 + 被动通知抽屉
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { ProgressRelay } from '../../renderer/core/progress-relay.js';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

function loadActivityCenter() {
  const code = esbuild.transformSync(read('renderer/core/activity-center.js'), { loader: 'js', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports.ActivityCenter;
}

describe('R1+R2 进度接力与通知中心', () => {
  test('进度写失败保留 pending：交互拿失败回执，严格 flush 重试并拒绝伪成功', async () => {
    let fail = true;
    const calls = [];
    const relay = new ProgressRelay(async (channel, payload) => {
      calls.push({ channel, payload });
      if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return { key: `${payload.kind}:${payload.path}`, value: payload.value };
    }, { delay: 5 });
    const first = await relay.put('library', 'D:/ws/a.epub', { chapter: 3 }, { immediate: true });
    assert.equal(first.ok, false, '普通输入事件以回执收口，不产生 unhandled rejection');
    assert.equal(relay.pending.size, 1, '失败 payload 必须保留给关闭耐久闸重试');
    await assert.rejects(() => relay.flushAll(), error => error?.code === 'ENOSPC');
    assert.equal(relay.pending.size, 1);
    fail = false;
    const retried = await relay.flushAll();
    assert.equal(retried.length, 1);
    assert.equal(relay.pending.size, 0);
    assert.equal(calls.length, 3, 'immediate、失败 flush、成功重试各执行一次');
  });

  test('事件账：未读、更新去重、已读清理与重启水合', async () => {
    const ActivityCenter = loadActivityCenter();
    let now = 1000, persisted = null;
    const c = new ActivityCenter({ clock: () => ++now, persist: s => { persisted = s; } });
    c.publish({ id: 'sync-1', source: 'sync', title: '同步完成', detail: '接收 2' });
    c.publish({ id: 'sync-1', source: 'sync', title: '同步完成', detail: '接收 3' });
    c.publish({ id: 'ai-1', source: 'factory', title: 'AI 写作完成' });
    assert.equal(c.snapshot().items.length, 2, '同 id 更新不得刷出重复通知');
    assert.equal(c.unreadCount(), 2);
    c.markRead('sync-1');
    assert.equal(c.unreadCount(), 1);
    assert.equal(c.clearRead(), 1);
    await new Promise(r => setTimeout(r, 150));
    assert.ok(persisted?.items?.length === 1, '事件账应持久化');
    const restored = new ActivityCenter({ clock: () => ++now });
    restored.hydrate(persisted);
    assert.equal(restored.get('ai-1').title, 'AI 写作完成', '重启后应能回看');
  });

  test('三位置控制器全部入账：书库页码、播放器秒、编辑器光标', () => {
    const shell = read('renderer/shell/shell.js');
    const lib = read('renderer/modules/library/index.js');
    const locatorStore = read('renderer/modules/library/locator-store.js');
    const player = read('renderer/modules/viewer/player.js');
    const viewer = read('renderer/modules/viewer/index.js');
    const text = read('renderer/modules/text/index.js');
    const md = read('renderer/modules/markdown/index.js');
    const code = read('renderer/modules/code/index.js');
    assert.ok(shell.includes('ProgressRelay') && shell.includes('sync:positionChanged'));
    assert.ok(lib.includes("progressKind: 'library'")
      && lib.includes('createLibraryLocatorStore')
      && locatorStore.includes("this.progress.put('library'"),
    '书库位置应由 locator-store 以调用点快照投影到 MazzProgress');
    assert.ok(viewer.includes("progressKind: 'player'") && player.includes('seconds: Math.max'));
    for (const src of [text, md, code]) assert.ok(src.includes("progressKind: 'editor'"), '三个编辑内核都应接光标接力');
  });

  test('通知抽屉准入、持久化、五类完工汇流与点击跳转', () => {
    const panelWin = read('main/panel-windows.js');
    const preload = read('preload/bridge.js');
    const shell = read('renderer/shell/shell.js');
    const panel = read('renderer/panels/notif.html');
    assert.ok(panelWin.includes('|notif|') && panelWin.includes("notif: '通知中心'"));
    assert.ok(preload.includes("'sync:positionPut'") && preload.includes("'sync:completed'"));
    assert.ok(shell.includes('activity.center.v1') && shell.includes("type === 'notifOpen'"));
    assert.ok(panel.includes('全部已读') && panel.includes('清理已读') && panel.includes('可回看'));
    const sources = [
      ['renderer/modules/viewer/index.js', "source: 'transcode'"],
      ['renderer/modules/factory/index.js', "source: 'factory'"],
      ['renderer/shell/shell.js', "source: 'sync'"],
      ['renderer/modules/library/index.js', "source: 'download'"],
      ['renderer/shell/shell.js', "source: 'archive'"],
    ];
    for (const [file, token] of sources) assert.ok(read(file).includes(token), `${file} 缺 ${token}`);
    for (const kind of ['file', 'folder', 'panel', 'library', 'factory']) assert.ok(shell.includes(`target.kind === '${kind}'`), `缺点击跳转 ${kind}`);
  });

  test('移动端 WebSocket 同步也携带 positions，桌面/手机协议保持同构', () => {
    const web = read('renderer/lib/sync-web.js');
    const host = read('renderer/lib/ws-host.js');
    const bridge = read('renderer/lib/browser-bridge.js');
    for (const src of [web, host]) assert.ok(src.includes("op: 'manifest', files: mine, positions") && src.includes("'sync:positionsMerge'"));
    assert.ok(bridge.includes("case 'sync:positionPut'") && bridge.includes("case 'sync:positionsMerge'"));
  });
});
