import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { Recorder, captureWithDeadline, mixAudio } from '../../renderer/lib/recorder.js';

describe('Recorder Preview 安全门', () => {
  test('重复停止幂等，采集轨只释放一次', () => {
    let trackStops = 0;
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    globalThis.MediaRecorder = FakeMediaRecorder;
    window.MediaRecorder = FakeMediaRecorder;
    const stream = { getTracks: () => [{ stop: () => { trackStops += 1; } }] };
    const recorder = new Recorder(stream, { name: 'test', maxDurationMs: 60_000 });
    assert.equal(recorder.start(), true);
    assert.equal(recorder.stop(), true);
    assert.equal(recorder.stop(), false);
    assert.equal(trackStops, 1);
  });

  test('权限等待超时后，迟到的采集流会立即释放', async () => {
    let resolveCapture;
    let stopped = 0;
    const pending = captureWithDeadline(() => new Promise(resolve => { resolveCapture = resolve; }), 5);
    await assert.rejects(pending, error => error.code === 'REC_CAPTURE_TIMEOUT');
    resolveCapture({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(stopped, 1);
  });

  test('混音 owner 停止麦克风轨、断开节点并关闭 AudioContext', async () => {
    let micStops = 0;
    let disconnects = 0;
    let closes = 0;
    class FakeMediaStream { constructor(tracks = []) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } }
    class FakeAudioContext {
      createMediaStreamDestination() { return { stream: new FakeMediaStream([]) }; }
      createMediaStreamSource() { return { connect() {}, disconnect() { disconnects += 1; } }; }
      async close() { closes += 1; }
    }
    globalThis.MediaStream = FakeMediaStream;
    globalThis.AudioContext = FakeAudioContext;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => new FakeMediaStream([{ stop: () => { micStops += 1; } }]) } } });
    const mixed = await mixAudio({ systemStream: null, micOn: true, sysOn: false });
    assert.equal(await mixed.stop(), true);
    assert.equal(await mixed.stop(), false);
    assert.equal(micStops, 1);
    assert.equal(disconnects, 1);
    assert.equal(closes, 1);
  });
});
