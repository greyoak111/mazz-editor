// tests/contract/w71-viewer-lifecycle.test.mjs —— W71 Viewer/Player 资源生命周期契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('W71 Viewer：关签后异步任务不得复活资源', () => {
  test('20 次 Blob URL 打开/关闭全部回收，迟到读取不再物化 Blob', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let created = 0;
    const live = new Set();
    URL.createObjectURL = () => {
      const url = `blob:w71-viewer-${++created}`;
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => live.delete(url);

    window.MazzHost = { setTabFilePath() {}, setTabTitle() {} };
    window.mazz = {
      isElectron: false,
      invoke(channel) {
        if (channel === 'fs:readFileBase64') return Promise.resolve('AA==');
        if (channel === 'settings:get') return Promise.resolve(null);
        if (channel === 'fs:listDir') return Promise.resolve([]);
        return Promise.resolve(true);
      },
    };

    const viewer = (await import('../../renderer/modules/viewer/index.js')).default;
    try {
      for (let i = 0; i < 20; i++) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const state = viewer.create(container);
        viewer.setContent(`C:/samples/${i}.png`, state);
        await tick();
        await tick();
        viewer.deactivate(container, state);
        viewer.dispose(state);
        viewer.dispose(state); // dispose/destroy 必须幂等
        viewer.activate(container, state); // 已退役实例不得重新挂回
        assert.equal(container.querySelector('.viewer-root'), null);
        container.remove();
      }
      assert.equal(created, 20, '每轮图片读取应只产生一个 Blob URL');
      assert.equal(live.size, 0, '关签后不得残留 Blob URL');

      let resolveRead;
      window.mazz.invoke = (channel) => {
        if (channel === 'fs:readFileBase64') return new Promise(resolve => { resolveRead = resolve; });
        return Promise.resolve(null);
      };
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = viewer.create(container);
      viewer.setContent('C:/samples/late.png', state);
      viewer.deactivate(container, state);
      viewer.dispose(state);
      resolveRead('AA==');
      await tick();
      await tick();
      assert.equal(created, 20, '关签后才返回的读取不得再创建 Blob URL');
      assert.equal(live.size, 0);
      assert.equal(container.children.length, 0, '迟到 load 不得复活 Viewer DOM');
      container.remove();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe('W71 Player：全局监听与定时器必须对称退役', () => {
  test('destroy 清理 resize/fullscreen/key/拖拽监听、interval 与媒体源', async () => {
    const { createPlayer } = await import('../../renderer/modules/viewer/player.js');
    const mediaProto = window.HTMLMediaElement.prototype;
    const originalPlay = mediaProto.play;
    const originalPause = mediaProto.pause;
    const originalLoad = mediaProto.load;
    const canvasProto = window.HTMLCanvasElement.prototype;
    const originalGetContext = canvasProto.getContext;
    mediaProto.play = () => Promise.resolve();
    mediaProto.pause = () => {};
    mediaProto.load = () => {};
    canvasProto.getContext = () => null;

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const activeIntervals = new Set();
    globalThis.setInterval = (fn, ms, ...args) => {
      const id = originalSetInterval(fn, ms, ...args);
      activeIntervals.add(id);
      return id;
    };
    globalThis.clearInterval = (id) => {
      activeIntervals.delete(id);
      return originalClearInterval(id);
    };

    const tracked = [
      [window, 'resize'], [window, 'mousemove'], [window, 'mouseup'],
      [document, 'fullscreenchange'], [document, 'keydown'], [document, 'pointerdown'],
    ];
    const listeners = new Map(tracked.map(([target, type]) => [`${target === window ? 'w' : 'd'}:${type}`, new Set()]));
    const originals = new Map();
    for (const target of [window, document]) {
      originals.set(target, { add: target.addEventListener, remove: target.removeEventListener });
      const prefix = target === window ? 'w' : 'd';
      target.addEventListener = function (type, fn, options) {
        listeners.get(`${prefix}:${type}`)?.add(fn);
        return originals.get(target).add.call(this, type, fn, options);
      };
      target.removeEventListener = function (type, fn, options) {
        listeners.get(`${prefix}:${type}`)?.delete(fn);
        return originals.get(target).remove.call(this, type, fn, options);
      };
    }

    window.mazz = {
      isElectron: true,
      invoke(channel) {
        if (channel === 'settings:get') return Promise.resolve(null);
        if (channel === 'fs:listDir') return Promise.resolve([]);
        return Promise.resolve(true);
      },
    };

    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      const player = createPlayer(root, { url: null, name: 'W71', ext: '', path: null, kind: 'video' });
      root.querySelector('.mz-side-grip').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
      assert.equal(listeners.get('w:resize').size, 2, '侧栏 window 重钳与 Control Surface fallback 各一');
      assert.equal(listeners.get('w:mousemove').size, 1);
      assert.equal(listeners.get('w:mouseup').size, 1);
      assert.equal(listeners.get('d:fullscreenchange').size, 1);
      assert.equal(listeners.get('d:keydown').size, 2, '媒体快捷键与 More Escape 门各一');
      assert.equal(listeners.get('d:pointerdown').size, 1, 'More 外点关闭门必须在');
      // jsdom 以一个短命 interval 驱动 RAF；先让 Control Surface 的首帧布局收敛，
      // 再盘点真正长住的 Player 资源，不把测试环境实现细节误报成泄漏。
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(activeIntervals.size, 3, '进度记忆、陪看观察与每小时站点检测 interval 都应纳入生命周期');

      const media = root.querySelector('.mz-media');
      media.setAttribute('src', 'mazz-res://media/test.mp4');
      player.destroy();
      player.destroy();

      for (const set of listeners.values()) assert.equal(set.size, 0, '全局监听必须 add/remove 对称');
      assert.equal(activeIntervals.size, 0, 'destroy 后不得残留 interval');
      assert.equal(media.hasAttribute('src'), false, 'destroy 必须主动卸载媒体源');
    } finally {
      root.remove();
      for (const [target, original] of originals) {
        target.addEventListener = original.add;
        target.removeEventListener = original.remove;
      }
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      mediaProto.play = originalPlay;
      mediaProto.pause = originalPause;
      mediaProto.load = originalLoad;
      canvasProto.getContext = originalGetContext;
      for (const id of activeIntervals) originalClearInterval(id);
    }
  });

  test('源码契约覆盖 RAF、GIF、AudioContext、临时转码文件与 dispose', () => {
    const player = readSrc('renderer/modules/viewer/player.js');
    const viewer = readSrc('renderer/modules/viewer/index.js');
    assert.ok(player.includes("removeEventListener('fullscreenchange', onFullscreenChange)"));
    assert.ok(player.includes("removeEventListener('resize', applySide)"));
    assert.ok(player.includes('controlSurface.destroy()'));
    assert.ok(player.includes("removeEventListener('playercontrolsurfacechange', onControlSurfaceChange)"));
    assert.ok(player.includes('cancelAnimationFrame(waveRaf)'));
    assert.ok(player.includes('stream.getTracks().forEach(t => t.stop())'));
    assert.ok(player.includes("if (rec.state !== 'inactive') rec.stop()"));
    assert.equal(player.includes('rec.rec.stop()'), false, 'GIF 停止不得把 MediaRecorder 误当包装对象');
    assert.ok(player.includes("new Set([ctl._actx, ctl._chain?.ctx].filter(Boolean))"));
    assert.ok(player.includes('const context = ctl._chain?.ctx || ctl._actx'));
    assert.ok(player.includes('context?.resume?.()'));
    assert.ok(viewer.includes('dispose(state)'));
    assert.ok(viewer.includes("invoke?.('fs:delete', { path: tempPath })"));
    assert.ok(viewer.includes('instances.delete(container)'));
  });

  test('多轮 Player create/destroy 后 selmenu 命令严格回到基线，迟到 import 不得复活', async () => {
    const { createPlayer } = await import('../../renderer/modules/viewer/player.js');
    const { commands } = await import('../../renderer/core/command-registry.js');
    const { menus } = await import('../../renderer/core/menu-service.js');
    const mediaProto = window.HTMLMediaElement.prototype;
    const originalPlay = mediaProto.play;
    const originalPause = mediaProto.pause;
    const originalLoad = mediaProto.load;
    const canvasProto = window.HTMLCanvasElement.prototype;
    const originalGetContext = canvasProto.getContext;
    mediaProto.play = () => Promise.resolve();
    mediaProto.pause = () => {};
    mediaProto.load = () => {};
    canvasProto.getContext = () => null;

    window.mazz = {
      isElectron: true,
      invoke(channel) {
        if (channel === 'settings:get') return Promise.resolve(null);
        if (channel === 'fs:listDir') return Promise.resolve([]);
        return Promise.resolve(true);
      },
    };

    const selmenuCount = () => commands.list({ includeDisabled: true }).filter(command => command.source?.startsWith('selmenu-')).length;
    const selmenuMenuCount = () => [...menus.contributions.keys()].filter(id => id.startsWith('selmenu/')).length;
    const baseline = selmenuCount();
    const baselineMenus = selmenuMenuCount();
    const live = [];
    try {
      for (let i = 0; i < 12; i++) {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const player = createPlayer(root, { url: null, name: `W71-cycle-${i}`, ext: '', path: null, kind: 'video' });
        live.push({ root, player });

        if (i % 2) {
          // 奇数轮让 selectProxy 真正注册，再验证 destroy 的同源反注册。
          await tick();
          await tick();
          assert.ok(selmenuCount() > baseline, '存活 Player 的倍速代理应贡献临时命令');
          assert.ok(selmenuMenuCount() > baselineMenus, '存活 Player 的倍速代理应贡献临时菜单');
        }
        // 偶数轮同拍销毁，专门覆盖 dynamic import 回调迟到的竞态。
        player.destroy();
        player.destroy();
        root.remove();
        live.pop();
        await tick();
        await new Promise(resolve => requestAnimationFrame(resolve));
        await tick();
        assert.equal(selmenuCount(), baseline, `第 ${i + 1} 轮异步收敛后 selmenu 命令必须精确回基线`);
        assert.equal(selmenuMenuCount(), baselineMenus, `第 ${i + 1} 轮异步收敛后 selmenu 菜单键必须精确回基线`);
      }
    } finally {
      for (const entry of live.splice(0)) {
        entry.player.destroy();
        entry.root.remove();
      }
      await tick();
      await new Promise(resolve => requestAnimationFrame(resolve));
      await tick();
      mediaProto.play = originalPlay;
      mediaProto.pause = originalPause;
      mediaProto.load = originalLoad;
      canvasProto.getContext = originalGetContext;
    }
    assert.equal(selmenuCount(), baseline, '清理出口不得放宽命令基线');
    assert.equal(selmenuMenuCount(), baselineMenus, '清理出口不得遗留空 selmenu 菜单墓碑');
  });
});
