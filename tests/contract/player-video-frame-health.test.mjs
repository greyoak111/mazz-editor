import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { classifyVideoFrameHealth, ZERO_VIDEO_FRAMES } from '../../renderer/lib/video-frame-health.js';

const base = {
  isVideo: true,
  paused: false,
  ended: false,
  errorCode: 0,
  readyState: 4,
  elapsedMs: 4000,
  currentTimeDelta: 4,
  frameDelta: 0,
  frameCallbackDelta: 0,
  videoWidth: 0,
  qualityAvailable: true,
};

describe('Player decoded-frame truth gate', () => {
  test('时间推进但四秒零帧必须判定假播放黑屏', () => {
    assert.equal(classifyVideoFrameHealth(base), ZERO_VIDEO_FRAMES);
  });

  test('只要质量计数或 frame callback 有帧就不得误报', () => {
    assert.equal(classifyVideoFrameHealth({ ...base, frameDelta: 1, videoWidth: 1920 }), null);
    assert.equal(classifyVideoFrameHealth({ ...base, frameCallbackDelta: 1, videoWidth: 1920 }), null);
  });

  test('暂停、缓冲、短观察窗和纯时间停滞都不是黑屏证据', () => {
    assert.equal(classifyVideoFrameHealth({ ...base, paused: true }), null);
    assert.equal(classifyVideoFrameHealth({ ...base, readyState: 1 }), null);
    assert.equal(classifyVideoFrameHealth({ ...base, elapsedMs: 2000 }), null);
    assert.equal(classifyVideoFrameHealth({ ...base, currentTimeDelta: 0.1 }), null);
  });
});
