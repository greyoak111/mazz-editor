import './_setup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';

const {
  DanmakuScheduler, DanmakuTimeline, MAX_ACTIVE, MAX_EVENTS, lowerBound,
  normalizeDanmakuEvent, parseAssDanmaku, parseBilibiliXml, parseJsonTrack,
} = await import('../../renderer/modules/viewer/danmaku.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function event(index, overrides = {}) {
  return normalizeDanmakuEvent({
    eventId: `event-${String(index).padStart(5, '0')}`, mediaTimeMs: index * 10,
    mode: index % 11 === 0 ? 'top' : index % 17 === 0 ? 'bottom' : 'scroll', text: `弹幕 ${index}`,
    style: { fontSize: 24, color: '#ffffff' }, priority: index % 101, ...overrides,
  }, { sourceRef: { kind: 'fixture', id: 'sample-f' }, index });
}

describe('W83a Clock / Event / Source Contract', () => {
  test('XML/ASS/JSON 三类本地轨归一且来源不丢', () => {
    const xml = parseBilibiliXml('<i><d p="1.5,1,25,16711680,1700000000,0,u,42">红色 &amp; 弹幕</d></i>', 'bili.xml');
    assert.equal(xml[0].mediaTimeMs, 1500);
    assert.deepEqual(xml[0].sourceRef, { kind: 'bilibili-xml', id: 'bili.xml' });
    assert.equal(xml[0].style.color, '#ff0000');
    const ass = parseAssDanmaku('[Events]\nDialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,{\\an8}顶部', 'track.ass');
    assert.equal(ass[0].mode, 'top');
    assert.equal(ass[0].sourceRef.kind, 'ass-local-track');
    const json = parseJsonTrack(JSON.stringify([{ mediaTimeMs: 3000, text: '本地 JSON' }]), 'track.json');
    assert.equal(json[0].sourceRef.id, 'track.json');
  });

  test('Timeline 稳定排序、增量、二分与撤回不修改 Publication blob', () => {
    const timeline = new DanmakuTimeline([event(2), event(0), event(1)]);
    assert.deepEqual(timeline.events.map(row => row.eventId), ['event-00000', 'event-00001', 'event-00002']);
    assert.equal(lowerBound(timeline.events, 15), 2);
    timeline.insert([event(3)]);
    timeline.withdraw('event-00001');
    assert.equal(timeline.events.find(row => row.eventId === 'event-00001').moderationState, 'withdrawn');
    assert.equal(timeline.events.length, 4);
  });
});

describe('W83b Scheduler / Lane / Density', () => {
  test('pause 依赖媒体时钟冻结，seek 清池重定位，过滤发生在分轨前', () => {
    const scheduler = new DanmakuScheduler({ events: [event(0), event(100), event(200)] });
    const first = scheduler.tick(0, { width: 800, height: 300 }).map(row => ({ id: row.event.eventId, x: row.x }));
    const paused = scheduler.tick(0, { width: 800, height: 300 }).map(row => ({ id: row.event.eventId, x: row.x }));
    assert.deepEqual(paused, first);
    scheduler.seek(2_000);
    assert.equal(scheduler.snapshot().activeCount, 0);
    scheduler.setFilters({ words: ['弹幕'], minPriority: 0 });
    assert.equal(scheduler.tick(2_000, { width: 800, height: 300 }).length, 0);
  });

  test('高密度有界降级，活动池不超过上限且有明确 dropped', () => {
    const events = Array.from({ length: 1_000 }, (_, index) => event(index, { mediaTimeMs: 1_000, mode: 'top' }));
    const scheduler = new DanmakuScheduler({ events, maxActive: 40 });
    scheduler.tick(1_000, { width: 640, height: 180 });
    assert.ok(scheduler.snapshot().activeCount <= 40);
    assert.ok(scheduler.snapshot().dropped > 0);
  });

  test('相同输入、媒体时钟和视口产生确定性调度', () => {
    const events = Array.from({ length: 120 }, (_, index) => event(index));
    const play = () => {
      const scheduler = new DanmakuScheduler({ events });
      for (let time = 0; time <= 1_200; time += 100) scheduler.tick(time, { width: 1280, height: 720 });
      return scheduler.active.map(row => [row.event.eventId, row.lane, Math.round(row.x)]);
    };
    assert.deepEqual(play(), play());
  });
});

describe('W83c/e Hard Sample F 与产品接线', () => {
  test('10,000 事件、2x 等价媒体时钟、前后 seek 20 次、撤回与关闭状态可收敛', () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, index) => event(index));
    const scheduler = new DanmakuScheduler({ events });
    for (let mediaTime = 0; mediaTime <= 60_000; mediaTime += 1_000) scheduler.tick(mediaTime, { width: 1920, height: 1080 });
    for (let index = 0; index < 20; index += 1) {
      const target = index % 2 ? 10_000 : 50_000;
      scheduler.seek(target);
      scheduler.tick(target, { width: index % 3 ? 1280 : 1600, height: 720 });
    }
    const withdrawn = scheduler.active[0]?.event.eventId;
    if (withdrawn) {
      scheduler.withdraw(withdrawn);
      scheduler.tick(scheduler.lastMediaTimeMs, { width: 1280, height: 720 });
      assert.equal(scheduler.active.some(row => row.event.eventId === withdrawn), false);
    }
    assert.ok(scheduler.snapshot().activeCount <= MAX_ACTIVE);
    scheduler.clear();
    assert.deepEqual(scheduler.snapshot(), { eventCount: 0, activeCount: 0, cursor: 0, dropped: 0 });
  });

  test('Canvas/有界 glyph cache/可访问性/AI 本地轨接 Player，销毁释放 timer/surface/cache', () => {
    const player = fs.readFileSync(path.join(repoRoot, 'renderer/modules/viewer/player.js'), 'utf8');
    const runtime = fs.readFileSync(path.join(repoRoot, 'renderer/modules/viewer/danmaku.js'), 'utf8');
    assert.match(player, /mountDanmaku/);
    assert.match(player, /parseBilibiliXml/);
    assert.match(player, /danmaku\.destroy\(\)/);
    assert.match(runtime, /GLYPH_CACHE_LIMIT/);
    assert.match(runtime, /aria-live/);
    assert.match(runtime, /ai-comment-local/);
    assert.match(runtime, /setMaskRegions/);
    assert.match(runtime, /clip\('evenodd'\)/);
    assert.match(runtime, /visibilitychange/);
    assert.match(runtime, /contextrestored/);
    assert.doesNotMatch(runtime, /publicationGranted\s*:\s*true/);
  });
});
