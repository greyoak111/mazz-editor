import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { AccompanyService, ARCHIVE_SCHEMA, normalizeArchive } = require('../../main/accompany-service.js');
const {
  COMPANION_PERSONAS, CompanionSession, chooseSpeakers, classifyBeat, enforceSpoilerLock,
  estimateCompanionCost, evaluatePersonaSample, normalizePersona,
} = await import('../../renderer/modules/viewer/companion.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withWorkspace(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w64-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

describe('W64 拍点、时机闸与话量', () => {
  test('高潮噤声、余韵等待、平缓开放、暂停开讲、倍速少话、片尾复盘确定', () => {
    assert.deepEqual(classifyBeat({ rms: 0.9 }), { type: 'climax', gate: 'silence', delayMs: 8000, talkLevel: 'silent' });
    assert.equal(classifyBeat({ previousBeat: 'climax', sincePreviousMs: 4_000 }).gate, 'wait');
    assert.equal(classifyBeat({}).gate, 'open');
    assert.equal(classifyBeat({ paused: true }).talkLevel, 'discussion');
    assert.equal(classifyBeat({ playbackRate: 2 }).gate, 'sparse');
    assert.equal(classifyBeat({ ended: true }).talkLevel, 'recap');
  });

  test('单拍最多两位、用户优先，预置人格不可变', () => {
    assert.equal(Object.isFrozen(COMPANION_PERSONAS), true);
    assert.equal(Object.isFrozen(COMPANION_PERSONAS[0]), true);
    assert.equal(chooseSpeakers(COMPANION_PERSONAS, 'climax').length, 2);
    assert.deepEqual(chooseSpeakers(COMPANION_PERSONAS, 'climax', { userPriority: true }), []);
  });

  test('防剧透锁阻断未来时间码和结局提示，只放行当前范围', () => {
    assert.equal(enforceSpoilerLock('看 42:10 的表情', 10 * 60_000).ok, false);
    assert.equal(enforceSpoilerLock('最终结局会说明', 10 * 60_000).ok, false);
    assert.equal(enforceSpoilerLock('刚才 08:10 那个停顿很妙', 10 * 60_000).ok, true);
  });
});

describe('W64 人格调谐、记忆、成本与观剧档', () => {
  test('.mazzperson 严格四象限/风味协议，试音间打回客服腔和说教腔', () => {
    const persona = normalizePersona({
      schema: 'mazz.persona/v0', id: 'custom.radio', name: '夜航电台', expertise: ['detail'],
      flavor: '电台风', quadrants: { warmth: 0.8, energy: 0.2, analysis: 0.7, chaos: 0.1 }, voicePrompt: '短句，留白',
    });
    assert.equal(persona.custom, true);
    assert.equal(evaluatePersonaSample('很高兴为您服务，我们应该理解这个道理。').pass, false);
    assert.equal(evaluatePersonaSample('这一下没说破，反而更狠。').pass, true);
    assert.throws(() => normalizePersona({ ...persona, schema: 'bad' }), /schema|未冻结字段/);
  });

  test('会话取回永不越过当前播放进度，成本估算可检查', () => {
    const session = new CompanionSession({ mediaName: 'sample.mp4', mediaPath: 'D:/sample.mp4', now: () => '2026-08-19T10:00:00.000Z' });
    session.addMessage({ role: 'assistant', speaker: '甲', text: '前段', mediaTimeMs: 5_000 });
    session.addMessage({ role: 'assistant', speaker: '乙', text: '后段', mediaTimeMs: 50_000 });
    assert.deepEqual(session.contextAt(10_000).map(row => row.text), ['前段']);
    assert.deepEqual(estimateCompanionCost({ durationSeconds: 100, intervalSeconds: 25, inputTokens: 100, outputTokens: 50, pricePerMillion: 2 }), {
      calls: 4, tokens: 600, estimatedCost: 0.0012, currency: 'provider-configured',
    });
  });

  test('关窗观剧档原子追加，一剧一档多场保留完整对话', () => withWorkspace(root => {
    const service = new AccompanyService({ rootProvider: () => root });
    const payload = {
      schema: ARCHIVE_SCHEMA, mediaPath: 'D:/shows/E01.mkv', mediaName: '第一集', sessionId: 'accompany:session-0001',
      startedAt: '2026-08-19T10:00:00Z', endedAt: '2026-08-19T10:30:00Z', mode: 'beat', personas: ['veteran'],
      beats: [{ type: 'climax', mediaTimeMs: 60_000 }],
      messages: [{ role: 'user', speaker: '你', text: '这一幕真狠', mediaTimeMs: 60_000, createdAt: '2026-08-19T10:01:00Z' }], stats: {},
    };
    assert.equal(normalizeArchive(payload, root).messages.length, 1);
    const first = service.archive(payload);
    service.archive({ ...payload, sessionId: 'accompany:session-0002' });
    const text = fs.readFileSync(first.path, 'utf8');
    assert.equal((text.match(/^## 场次/gm) || []).length, 2);
    assert.match(text, /这一幕真狠/);
    assert.equal(fs.readdirSync(path.dirname(first.path)).some(name => name.endsWith('.tmp')), false);
  }));

  test('main/preload/player 产品接线齐全且关闭会取消请求并归档', () => {
    const main = fs.readFileSync(path.join(repoRoot, 'main/main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'preload/bridge.js'), 'utf8');
    const player = fs.readFileSync(path.join(repoRoot, 'renderer/modules/viewer/player.js'), 'utf8');
    const companion = fs.readFileSync(path.join(repoRoot, 'renderer/modules/viewer/companion.js'), 'utf8');
    assert.match(main, /companion:archive/);
    assert.match(preload, /companion:archive/);
    assert.match(player, /mountCompanion/);
    assert.match(player, /companion\.destroy\(\)/);
    assert.match(companion, /abortController\?\.abort/);
    assert.match(companion, /防剧透锁/);
  });
});
