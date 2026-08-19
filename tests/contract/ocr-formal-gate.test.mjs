import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createOcrRuntime, estimateDataUrlBytes } from '../../renderer/lib/ocr-runtime.js';

const image = 'data:image/png;base64,' + Buffer.from('ocr-image').toString('base64');

describe('OCR Formal 作业门禁', () => {
  test('成功结果返回后 worker 必释放，进度有界', async () => {
    let terminated = 0;
    const progress = [];
    const runtime = createOcrRuntime({
      loadEngine: async () => ({
        createWorker: async (_lang, _oem, options) => ({
          recognize: async () => {
            options.logger({ status: 'recognizing text', progress: 1.8 });
            return { data: { text: '识别正文\n', confidence: 94.6 } };
          },
          terminate: async () => { terminated += 1; },
        }),
      }),
      timeoutMs: 1000,
    });
    const result = await runtime.recognize({ imageDataUrl: image, lang: 'chi_sim+eng', onProgress: p => progress.push(p) });
    assert.equal(result.text, '识别正文');
    assert.equal(result.confidence, 94.6);
    assert.equal(progress[0].progress, 1);
    assert.equal(terminated, 1);
    assert.equal(runtime.active, false);
  });

  test('用户取消会拒绝悬挂作业并释放 worker', async () => {
    let terminated = 0;
    let workerReady;
    const ready = new Promise(resolve => { workerReady = resolve; });
    const runtime = createOcrRuntime({
      loadEngine: async () => ({ createWorker: async () => {
        workerReady();
        return { recognize: () => new Promise(() => {}), terminate: async () => { terminated += 1; } };
      } }),
      timeoutMs: 1000,
    });
    const pending = runtime.recognize({ imageDataUrl: image });
    await ready;
    assert.equal(await runtime.cancel(), true);
    await assert.rejects(pending, error => error.code === 'OCR_CANCELLED');
    assert.ok(terminated >= 1);
    assert.equal(runtime.active, false);
  });

  test('超时 fail closed，空图在加载引擎前拒绝', async () => {
    let loaded = 0;
    const timers = [];
    const runtime = createOcrRuntime({
      loadEngine: async () => { loaded += 1; return { createWorker: async () => ({ recognize: () => new Promise(() => {}), terminate: async () => {} }) }; },
      setTimer: fn => { timers.push(fn); return timers.length; },
      clearTimer: () => {},
      timeoutMs: 50,
    });
    await assert.rejects(() => runtime.recognize({ imageDataUrl: '' }), error => error.code === 'OCR_EMPTY_IMAGE');
    const pending = runtime.recognize({ imageDataUrl: image });
    await Promise.resolve();
    await timers[0]();
    await assert.rejects(pending, error => error.code === 'OCR_TIMEOUT');
    assert.equal(loaded, 1);
    assert.equal(estimateDataUrlBytes('data:x;base64,YQ=='), 1);
  });
});
