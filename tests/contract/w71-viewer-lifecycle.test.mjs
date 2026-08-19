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
      [document, 'fullscreenchange'], [document, 'keydown'],
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
      assert.equal(listeners.get('w:resize').size, 1);
      assert.equal(listeners.get('w:mousemove').size, 1);
      assert.equal(listeners.get('w:mouseup').size, 1);
      assert.equal(listeners.get('d:fullscreenchange').size, 1);
      assert.equal(listeners.get('d:keydown').size, 1);
      assert.equal(activeIntervals.size, 2, '进度记忆与 P2P 状态轮询 interval 都应纳入生命周期');

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
});
