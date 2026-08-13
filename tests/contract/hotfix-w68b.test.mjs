// W68b 活稿车间契约：群档、类型视图、折叠记忆、百万字虚拟流、搜索与辩论线程。
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  FACTORY_ARCHIVE_FILE, FACTORY_EVENT_TYPES, FACTORY_VIEW_FILTERS,
  appendFactoryArchiveText, buildFactoryDebateThreads, buildFactoryVirtualItems,
  computeFactoryVirtualWindow, factoryArtifactEvent, filterFactoryEvents,
  findFactoryMatches, normalizeFactoryEvent, parseFactoryArchive, resolveFactoryCollapsed,
} from '../../renderer/modules/factory/workshop.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

describe('W68b 工厂群可移交归档', () => {
  test('事件元数据藏注释、正文保持 Markdown，重开无损且追加幂等', () => {
    const event = normalizeFactoryEvent({ id: 'unit-1-body', type: 'body', title: '第一章扩写稿', content: '# 正文\n\n一艘船启航。', unitNo: 1, unitName: '章', artifactPath: '工件/第一章/02-扩写稿.md', createdAt: '2026-08-13T10:00:00.000Z' });
    const first = appendFactoryArchiveText('', event, { title: '实证项目 · 工厂群' });
    const second = appendFactoryArchiveText(first, event, { title: '实证项目 · 工厂群' });
    assert.equal(first, second);
    assert(first.includes('<!-- MAZZ_FACTORY_EVENT') && first.includes('# 正文'));
    const rows = parseFactoryArchive(first);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, event.content);
    assert.equal(rows[0].artifactPath, event.artifactPath);
    assert.equal(FACTORY_ARCHIVE_FILE, '工厂群.md');
  });

  test('坏块不拖死后续可恢复块', () => {
    const good = appendFactoryArchiveText('', normalizeFactoryEvent({ id: 'good', type: 'system', title: '恢复', content: '仍可读取' }));
    const text = '<!-- MAZZ_FACTORY_EVENT {bad json} -->\n坏块\n<!-- /MAZZ_FACTORY_EVENT -->\n\n' + good;
    assert.equal(parseFactoryArchive(text).at(-1).id, 'good');
  });
});

describe('W68b 三视图、折叠与搜索', () => {
  const events = [
    normalizeFactoryEvent({ id: 'b1', type: 'body', title: '正文一', content: '第一章', unitNo: 1 }),
    normalizeFactoryEvent({ id: 'r1', type: 'review', title: '审理一', content: '证据蓝', unitNo: 1 }),
    normalizeFactoryEvent({ id: 'b4', type: 'body', title: '正文四', content: '第四章 星港', unitNo: 4 }),
    normalizeFactoryEvent({ id: 'v4', type: 'verdict', title: '裁决四', content: '准予封存', unitNo: 4 }),
  ];

  test('六类消息与三种过滤口径钉死', () => {
    assert.deepEqual(FACTORY_EVENT_TYPES, ['body', 'skeleton', 'review', 'verdict', 'help', 'system']);
    assert.deepEqual(FACTORY_VIEW_FILTERS.body, ['body']);
    assert.equal(filterFactoryEvents(events, 'body').length, 2);
    assert.equal(filterFactoryEvents(events, 'workshop').length, 4);
  });

  test('旧两单元自动一行桩，用户展开记忆优先；摘要视图强制全折叠', () => {
    assert.equal(resolveFactoryCollapsed(events[0], events, {}, { view: 'workshop', keepRecentUnits: 2 }), true);
    assert.equal(resolveFactoryCollapsed(events[0], events, { b1: false }, { view: 'workshop', keepRecentUnits: 2 }), false);
    assert.equal(resolveFactoryCollapsed(events[2], events, {}, { view: 'workshop', keepRecentUnits: 2 }), false);
    assert.equal(resolveFactoryCollapsed(events[2], events, { b4: false }, { view: 'summary' }), true);
  });

  test('窗内搜索命中事件，可供 UI 自动展开并定位', () => {
    assert.deepEqual(findFactoryMatches(events, '星港').map(x => x.eventId), ['b4']);
    assert.equal(findFactoryMatches(filterFactoryEvents(events, 'body'), '准予').length, 0);
  });
});

describe('W68b 百万字虚拟流与辩论线', () => {
  test('百万字符先分块，视口只取前后各两屏而非全量 DOM', () => {
    const huge = normalizeFactoryEvent({ id: 'million', type: 'body', title: '百万字工件', content: '长段落。'.repeat(125000), unitNo: 9 });
    const items = buildFactoryVirtualItems([huge], {}, { view: 'workshop', chunkChars: 12000 });
    assert(items.length > 40, '百万字符必须拆成可虚拟化块');
    const win = computeFactoryVirtualWindow(items, 0, 800, {}, 2);
    assert(win.items.length < items.length / 3, '首屏不得挂载大部分百万字块');
    assert(win.totalHeight > 100000, '高度台账不得用过低封顶压扁长稿');
    const tail = computeFactoryVirtualWindow(items, win.totalHeight - 800, 800, {}, 2);
    assert(tail.start > 0 && tail.end === items.length);
  });

  test('质询红、证据蓝、裁决金归入同一可跳线程', () => {
    const objection = factoryArtifactEvent('objection', '# 质询\n证据不足', { unitNo: 3 });
    const answer = factoryArtifactEvent('answer', '# 答辩\n见正文证据', { unitNo: 3 });
    const verdict = factoryArtifactEvent('verdict', '# 裁决\n驳回质询', { unitNo: 3 });
    const threads = buildFactoryDebateThreads([objection, answer, verdict]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].objection[0].tone, 'disagreement');
    assert.equal(threads[0].answer[0].tone, 'evidence');
    assert.equal(threads[0].verdict[0].tone, 'verdict');
  });
});

describe('W68b 正式模块与生产链接线', () => {
  test('Factory Desk 走正式模块契约与宿主分屏，而非孤立 BrowserWindow', () => {
    const app = src('renderer/app.js');
    const desk = src('renderer/modules/factory/desk.js');
    assert(app.includes("modules.register('factorydesk', factoryDeskModule)"));
    for (const method of ['create(container)', 'activate(container)', 'deactivate(container)', 'getContent(state)', 'setContent(data, state)', 'newDocument(state)']) assert(desk.includes(method), `缺模块契约 ${method}`);
    for (const pin of ['fd-directory', 'fd-stream', 'fd-compare', 'computeFactoryVirtualWindow', 'buildFactoryDebateThreads', 'mazz:factory-workshop']) assert(desk.includes(pin), `缺桌面钉 ${pin}`);
  });

  test('生产流追加群档、命令/Ribbon/侧坞三入口齐全', () => {
    const factory = src('renderer/modules/factory/index.js');
    const shell = src('renderer/shell/shell.js');
    const desk = src('renderer/modules/factory/desk.js');
    for (const pin of ['appendWorkshop', 'factoryArtifactEvent', 'FACTORY_ARCHIVE_FILE', "data-a=\"desk\""]) assert(factory.includes(pin), `缺生产集成 ${pin}`);
    assert(shell.includes("command: 'factory.openDesk'"));
    assert(desk.includes("id: 'factory.openDesk'"));
  });
});
