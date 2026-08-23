// W91 智能创作项目事务 / 注册表 / 恢复链合同
import './_setup.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';
import {
  dismissFactoryResumables, factoryTaskState, mergeFactoryResumables,
  resumableRecoveryKey, visibleFactoryResumables,
} from '../../renderer/modules/factory/task-registry.js';
import { scanResumableTasks, writeTaskState } from '../../renderer/modules/factory/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = async relative => readFile(path.join(root, relative), 'utf8');

const state = (overrides = {}) => ({
  id: 'task-1', title: '真实项目', genreId: 'xiaoshuo', status: 'stopped',
  currentChapter: 2, maxChapters: 12, updatedAt: '2026-08-22T10:00:00.000Z',
  outDir: 'C:/workspace/Output/小说/未分类/真实项目_00001',
  ...overrides,
});

describe('W91 磁盘恢复状态与注册表收敛', () => {
  test('空注册表可从磁盘恢复，重复合并不复制项目且 id/folder 稳定', () => {
    const first = mergeFactoryResumables([], [state()]);
    assert(first.tasks.length === 1 && first.addedIds.length === 1, '首次恢复没有登记项目');
    assert(first.tasks[0].id === 'task-1' && first.tasks[0].folder.endsWith('真实项目_00001'), '恢复身份不稳定');
    const second = mergeFactoryResumables(first.tasks, [state()]);
    assert(second.tasks.length === 1 && second.tasks[0].id === 'task-1', '重复扫描制造了重复项目');
  });

  test('同目录优先于旧 id，活跃任务不被扫描误降级', () => {
    const task = { id: 'registry-id', label: '项目', folder: state().outDir, status: 'pending' };
    const result = mergeFactoryResumables([task], [state({ id: 'disk-id' })], { activeTaskIds: ['registry-id'] });
    assert(result.tasks.length === 1 && result.tasks[0].id === 'registry-id', '目录身份没有收敛到现有项目');
    assert(result.tasks[0].status === 'pending', '后台排队项目被错误改成暂停');
  });

  test('不同目录碰撞同一旧 id 时生成确定性恢复 id', () => {
    const existing = { id: 'task-1', label: '原项目', folder: 'C:/workspace/Output/原项目', status: 'paused' };
    const first = mergeFactoryResumables([existing], [state()]);
    const recovered = first.tasks.find(task => task.folder === state().outDir);
    assert(first.tasks.length === 2 && recovered?.id.startsWith('task-1-recovered-'), 'id 碰撞覆盖了另一项目');
    const second = mergeFactoryResumables(first.tasks, [state()]);
    assert(second.tasks.length === 2 && second.tasks.find(task => task.folder === state().outDir)?.id === recovered.id, '碰撞恢复 id 不稳定');
  });

  test('忽略只记录当前状态指纹；磁盘状态变化后会重新提示', () => {
    const original = state();
    const dismissals = dismissFactoryResumables({}, [original]);
    assert(dismissals[resumableRecoveryKey(original)], '未登记忽略指纹');
    assert(visibleFactoryResumables([original], dismissals).length === 0, '相同中断状态没有被收起');
    const advanced = state({ currentChapter: 3, updatedAt: '2026-08-22T11:00:00.000Z' });
    assert(visibleFactoryResumables([advanced], dismissals).length === 1, '新断点被旧忽略记录永久遮蔽');
  });

  test('单次任务收据经状态覆盖后，空注册表仍按原事务字段恢复', async () => {
    const priorBridge = window.mazz;
    const workspace = 'C:/workspace';
    const folder = `${workspace}/Output/小说/未分类/单次项目_00001`;
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const files = new Map();
    const children = new Map([
      [normalize(`${workspace}/Output`), [{ name: '小说', path: `${workspace}/Output/小说`, isDir: true }]],
      [normalize(`${workspace}/Output/小说`), [{ name: '未分类', path: `${workspace}/Output/小说/未分类`, isDir: true }]],
      [normalize(`${workspace}/Output/小说/未分类`), [{ name: '单次项目_00001', path: folder, isDir: true }]],
      [normalize(`${workspace}/创作产出`), []],
    ]);
    window.mazz = {
      isElectron: true,
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return workspace;
        if (channel === 'fs:listDir') return children.get(normalize(payload.path)) || [];
        if (channel === 'fs:writeFile') { files.set(normalize(payload.path), String(payload.content ?? '')); return { ok: true }; }
        if (channel === 'fs:stat') return { exists: files.has(normalize(payload.path)), isDir: false };
        if (channel === 'fs:readFile') {
          const key = normalize(payload.path);
          if (!files.has(key)) throw new Error('ENOENT');
          return files.get(key);
        }
        return null;
      },
    };
    try {
      const task = {
        id: 'single-transaction', label: '单次项目', genreId: 'xiaoshuo', folder,
        mode: 'single', requestId: 'project-submit-42', receiptAt: 1_777_000_001,
        createdAt: 1_777_000_000, maxChapters: 1,
        totalWords: 121, wordsPerUnit: 121, lengthPreset: 'short',
        reviewRitual: 'light', reviewBudgetCap: 12000,
        dualLoop: false, autoPreview: false,
        outputProtocol: 'W60b', reviewProtocol: 'W68a', exportFmt: 'html',
        values: { 书名: '单次项目' },
      };
      await writeTaskState(folder, factoryTaskState(task, { status: 'paused', currentChapter: 0 }));
      const statePath = normalize(`${folder}/任务状态.json`);
      const receipt = JSON.parse(files.get(statePath));
      await writeTaskState(folder, factoryTaskState(task, {
        ...receipt, status: 'stopped', currentChapter: 0,
        unsafeCompletion: { finishReason: 'length', completionKind: 'finish-reason' },
      }));

      const overwritten = JSON.parse(files.get(statePath));
      for (const [key, expected] of Object.entries({
        mode: 'single', requestId: 'project-submit-42', receiptAt: 1_777_000_001,
        createdAt: 1_777_000_000, maxChapters: 1,
        totalWords: 121, wordsPerUnit: 121, lengthPreset: 'short',
        reviewRitual: 'light', reviewBudgetCap: 12000,
        dualLoop: false, autoPreview: false,
        outputProtocol: 'W60b', reviewProtocol: 'W68a', exportFmt: 'html',
      })) assert.equal(overwritten[key], expected, `状态覆盖丢失 ${key}`);

      const scanned = await scanResumableTasks();
      const recovered = mergeFactoryResumables([], scanned).tasks[0];
      assert.equal(scanned.length, 1, '真实磁盘状态没有被扫描到');
      for (const key of [
        'mode', 'requestId', 'receiptAt', 'createdAt', 'maxChapters',
        'totalWords', 'wordsPerUnit', 'lengthPreset', 'reviewRitual',
        'reviewBudgetCap', 'dualLoop', 'autoPreview',
        'outputProtocol', 'reviewProtocol', 'exportFmt',
      ]) assert.equal(recovered[key], task[key], `冷恢复丢失单篇执行坐标 ${key}`);
      assert.equal(recovered.folder, folder);
    } finally {
      window.mazz = priorBridge;
    }
  });

  test('旧磁盘状态缺少 mode 时不覆盖注册表中的 single', () => {
    const task = { id: 'legacy-single', label: '旧单次', folder: state().outDir, status: 'paused', mode: 'single', maxChapters: 1 };
    const legacy = state({ id: 'legacy-single', mode: undefined, maxChapters: undefined });
    const recovered = mergeFactoryResumables([task], [legacy]).tasks[0];
    assert.equal(recovered.mode, 'single');
    assert.equal(recovered.maxChapters, 1);
  });

  test('非活跃项目以磁盘收据的显式 false/0 为准，活跃项目不被扫描改写', () => {
    const folder = state().outDir;
    const registry = {
      id: 'coordinate-task', label: '坐标项目', folder, status: 'paused', mode: 'max', maxChapters: 9,
      totalWords: 10000, wordsPerUnit: 2000, lengthPreset: 'long',
      reviewProtocol: 'legacy', reviewRitual: 'full', reviewBudgetCap: 32000,
      dualLoop: true, autoPreview: true, outputProtocol: 'legacy', exportFmt: 'md',
    };
    const durable = state({
      id: 'coordinate-task', outDir: folder, mode: 'single', maxChapters: 1,
      totalWords: 0, wordsPerUnit: 0, lengthPreset: 'short',
      reviewProtocol: 'W68a', reviewRitual: 'light', reviewBudgetCap: 0,
      dualLoop: false, autoPreview: false, outputProtocol: 'W60b', exportFmt: 'html',
    });
    const recovered = mergeFactoryResumables([{ ...registry }], [durable]).tasks[0];
    for (const [key, expected] of Object.entries({
      mode: 'single', maxChapters: 1, totalWords: 0, wordsPerUnit: 0,
      lengthPreset: 'short', reviewProtocol: 'W68a', reviewRitual: 'light',
      reviewBudgetCap: 0, dualLoop: false, autoPreview: false,
      outputProtocol: 'W60b', exportFmt: 'html',
    })) assert.equal(recovered[key], expected, `磁盘 durable coordinate 未覆盖旧 registry：${key}`);

    const active = mergeFactoryResumables([{ ...registry }], [durable], { activeTaskIds: ['coordinate-task'] }).tasks[0];
    for (const key of ['mode', 'maxChapters', 'totalWords', 'wordsPerUnit', 'lengthPreset', 'reviewProtocol', 'reviewRitual', 'reviewBudgetCap', 'dualLoop', 'autoPreview', 'outputProtocol', 'exportFmt']) {
      assert.equal(active[key], registry[key], `活跃任务被磁盘扫描改写：${key}`);
    }

    const legacyMissing = mergeFactoryResumables([{ ...registry }], [state({
      id: 'coordinate-task', outDir: folder, mode: undefined, maxChapters: undefined,
      totalWords: undefined, wordsPerUnit: undefined, lengthPreset: undefined,
      reviewProtocol: undefined, reviewRitual: undefined, reviewBudgetCap: undefined,
      dualLoop: undefined, autoPreview: undefined, outputProtocol: undefined, exportFmt: undefined,
    })]).tasks[0];
    assert.equal(legacyMissing.dualLoop, true);
    assert.equal(legacyMissing.reviewBudgetCap, 32000);
    assert.equal(legacyMissing.exportFmt, 'md');
  });

  test('批量收据经状态覆盖与空注册表恢复后，同 batchRequestId 重放零新增', async () => {
    const batchId = 'batch-submit-9';
    const folder = 'C:/workspace/Output/小说/未分类/批量项目_00001';
    const task = {
      id: 'batch-task-1', label: '批量项目一', genreId: 'xiaoshuo', folder,
      mode: 'max', requestId: `${batchId}:1`, batchRequestId: batchId,
      receiptAt: 1_777_100_001, createdAt: 1_777_100_000, maxChapters: 8,
    };
    const receipt = factoryTaskState(task, { status: 'paused', currentChapter: 0 });
    const overwritten = factoryTaskState(task, { ...receipt, status: 'stopped', currentChapter: 3 });
    const recoveredRegistry = mergeFactoryResumables([], [{ ...overwritten, outDir: folder, updatedAt: '2026-08-22T12:00:00.000Z' }]).tasks;
    assert.equal(recoveredRegistry[0].batchRequestId, batchId, '批事务关联键在恢复时丢失');
    assert.equal(recoveredRegistry[0].requestId, `${batchId}:1`, '子任务关联键在恢复时丢失');

    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    const before = recoveredRegistry.length;
    const replay = await FactoryPanel.prototype.addBatchTitles.call({ tasks: recoveredRegistry }, ['不应新增'], { requestId: batchId });
    assert.equal(recoveredRegistry.length, before, '同 batchRequestId 重放仍新增任务');
    assert.equal(replay.length, 1);
    assert.equal(replay[0].id, 'batch-task-1');
  });

  test('快速终态在 localStorage 丢失后仍回收进注册表，恢复提示只含可续跑状态', async () => {
    const priorBridge = window.mazz;
    const workspace = 'C:/workspace';
    const category = `${workspace}/Output/小说/未分类`;
    const folders = {
      done: `${category}/快速完成_00001`,
      failed: `${category}/快速失败_00002`,
      blocked: `${category}/快速阻断_00003`,
      paused: `${category}/仍可恢复_00004`,
    };
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const files = new Map();
    const children = new Map([
      [normalize(`${workspace}/Output`), [{ name: '小说', path: `${workspace}/Output/小说`, isDir: true }]],
      [normalize(`${workspace}/Output/小说`), [{ name: '未分类', path: category, isDir: true }]],
      [normalize(category), Object.values(folders).map(folder => ({ name: folder.split('/').pop(), path: folder, isDir: true }))],
      [normalize(`${workspace}/创作产出`), []],
    ]);
    window.mazz = {
      isElectron: true,
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return workspace;
        if (channel === 'fs:listDir') return children.get(normalize(payload.path)) || [];
        if (channel === 'fs:writeFile') { files.set(normalize(payload.path), String(payload.content ?? '')); return { ok: true }; }
        if (channel === 'fs:stat') return { exists: files.has(normalize(payload.path)), isDir: false };
        if (channel === 'fs:readFile') {
          const key = normalize(payload.path);
          if (!files.has(key)) throw new Error('ENOENT');
          return files.get(key);
        }
        return null;
      },
    };
    try {
      const tasks = [
        {
          id: 'quick-done', label: '快速完成', folder: folders.done, mode: 'single', requestId: 'request-done',
          maxChapters: 1, totalWords: 121, wordsPerUnit: 121, lengthPreset: 'short',
          reviewRitual: 'light', reviewBudgetCap: 12000, dualLoop: false, autoPreview: false,
          outputProtocol: 'W60b', reviewProtocol: 'W68a', exportFmt: 'html',
          status: 'done',
        },
        { id: 'quick-failed', label: '快速失败', folder: folders.failed, mode: 'max', requestId: 'request-batch:1', batchRequestId: 'request-batch', maxChapters: 6, status: 'failed' },
        { id: 'quick-blocked', label: '快速阻断', folder: folders.blocked, mode: 'max', requestId: 'request-blocked', maxChapters: 4, status: 'blocked' },
        { id: 'still-paused', label: '仍可恢复', folder: folders.paused, mode: 'max', requestId: 'request-paused', maxChapters: 5, status: 'paused' },
      ].map((task, index) => ({ ...task, genreId: 'xiaoshuo', receiptAt: 1_777_200_100 + index, createdAt: 1_777_200_000 + index }));

      // Every lifecycle begins with the durable receipt, then may finish before
      // localStorage gets another chance to persist the registry.
      for (const task of tasks) {
        await writeTaskState(task.folder, factoryTaskState(task, { status: 'paused', currentChapter: 0 }));
        if (task.status !== 'paused') {
          await writeTaskState(task.folder, factoryTaskState(task, { status: task.status, currentChapter: task.status === 'done' ? 1 : 0 }));
        }
      }

      const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
      const panel = {
        resumableMergePromise: null, tasks: [], runningTasks: new Set(), backgroundQueuedIds: new Set(),
        genre: { id: 'xiaoshuo' }, resumableDismissals: {}, persisted: 0,
        saveJSON() {}, persistTasks() { this.persisted++; }, renderTasks() {}, renderResumables() {},
      };
      const reconciled = await FactoryPanel.prototype.reconcileResumableTasks.call(panel);
      assert.equal(reconciled.scanned.length, 4, '终态事务没有全部进入 registry scan');
      assert.equal(panel.tasks.length, 4, '空注册表没有从全部事务状态重建');
      assert.equal(panel.tasks.find(task => task.id === 'quick-done')?.status, 'done');
      assert.equal(panel.tasks.find(task => task.id === 'quick-failed')?.status, 'failed');
      assert.equal(panel.tasks.find(task => task.id === 'quick-blocked')?.status, 'blocked');
      assert.deepEqual(panel.resumables.map(task => task.id), ['still-paused'], 'Desk 恢复提示混入终态项目');
      const coldDone = panel.tasks.find(task => task.id === 'quick-done');
      for (const [key, expected] of Object.entries({
        mode: 'single', maxChapters: 1, totalWords: 121, wordsPerUnit: 121,
        lengthPreset: 'short', reviewRitual: 'light', reviewBudgetCap: 12000,
        dualLoop: false, autoPreview: false,
        outputProtocol: 'W60b', reviewProtocol: 'W68a', exportFmt: 'html',
      })) assert.equal(coldDone?.[key], expected, `done 覆盖后空注册表恢复丢失 ${key}`);

      const before = panel.tasks.length;
      const singleFacade = {
        tasks: panel.tasks,
        transactionTask: FactoryPanel.prototype.transactionTask,
        taskReceipt: FactoryPanel.prototype.taskReceipt,
      };
      const replayReceipt = FactoryPanel.prototype.addTask.call(singleFacade, { requestId: 'request-done' });
      const batchReplay = await FactoryPanel.prototype.addBatchTitles.call({ tasks: panel.tasks }, ['不应新增'], { requestId: 'request-batch' });
      assert.equal(panel.tasks.length, before, '终态事务重放仍新增项目');
      assert.equal(replayReceipt.taskId, 'quick-done');
      assert.equal(replayReceipt.deduplicated, true);
      assert.equal(batchReplay[0].id, 'quick-failed');
    } finally {
      window.mazz = priorBridge;
    }
  });
});

describe('W91 立刻开工事务与关联回执源码合同', () => {
  test('可选工件只把明确缺档当空；EACCES/EIO 必须阻断且不得进入写入', async () => {
    const { readOptionalFile } = await import('../../renderer/modules/factory/index.js');
    const priorBridge = window.mazz;
    const writes = [];
    window.mazz = {
      isElectron: true,
      invoke: async (channel) => {
        if (channel === 'fs:stat') return { exists: false, code: 'EACCES' };
        if (channel === 'fs:writeFile') writes.push(channel);
        throw new Error(`unexpected ${channel}`);
      },
    };
    try {
      await assert.rejects(() => readOptionalFile('C:/workspace/Output/既有正文.md'), error => error?.code === 'EACCES');
      assert.deepEqual(writes, [], '读取故障后仍触发了覆盖写');
      window.mazz.invoke = async channel => channel === 'fs:stat' ? { exists: false, code: 'ENOENT' } : null;
      assert.equal(await readOptionalFile('C:/workspace/Output/不存在.md'), '');
    } finally {
      window.mazz = priorBridge;
    }
  });

  test('先登记、再建磁盘收据、最后后台调度；generateNow 不等待整次生成', async () => {
    const text = await source('renderer/modules/factory/index.js');
    const start = text.indexOf('async generateNow({ requestId');
    const end = text.indexOf('\n  makeTask(', start);
    const block = text.slice(start, end);
    const registered = block.indexOf('this.registerTask(task)');
    const receipted = block.indexOf('await this.establishTaskReceipt(task)');
    const scheduled = block.indexOf('this.scheduleBackgroundTasks([task])');
    assert(start >= 0 && registered >= 0 && registered < receipted && receipted < scheduled, '立刻开工事务顺序退化');
    assert(!/await\s+this\.scheduleBackgroundTasks/.test(block) && !/await\s+this\.runTask\(/.test(block), '立项窗仍等待整次生成');
  });

  test('registry durable commit 与 render/push 隔离，视图故障不反转已成功持久化', async () => {
    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    const captured = [];
    const priorError = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      const facade = {
        tasks: [{ id: 'durable-view-test' }], writes: 0,
        saveJSON() { this.writes++; },
        renderTasks() { throw new Error('render exploded'); },
        pushTasks() { throw new Error('push exploded'); },
        persistTaskRegistry: FactoryPanel.prototype.persistTaskRegistry,
        syncTaskViews: FactoryPanel.prototype.syncTaskViews,
      };
      assert.doesNotThrow(() => FactoryPanel.prototype.persistTasks.call(facade));
      assert.equal(facade.writes, 1, 'durable registry 没有先提交');
      assert.equal(captured.length, 2, '视图故障没有被隔离记录');
    } finally {
      console.error = priorError;
    }
  });

  test('单项 registry quota 失败原子回滚；同 requestId/任务 ID 可修复且零重复', async () => {
    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    let quota = true;
    const facade = {
      tasks: [], syncs: 0,
      saveJSON() { if (quota) throw new Error('QuotaExceededError: localStorage full'); },
      persistTaskRegistry: FactoryPanel.prototype.persistTaskRegistry,
      syncTaskViews() { this.syncs++; },
      taskReceipt: FactoryPanel.prototype.taskReceipt,
    };
    const task = {
      id: 'stable-single-id', label: '单项 quota', genreId: 'xiaoshuo',
      requestId: 'stable-single-request', createdAt: 1_777_400_000, status: 'pending',
    };
    assert.throws(
      () => FactoryPanel.prototype.registerTask.call(facade, task),
      error => error?.code === 'FACTORY_TASK_REGISTRY_PERSIST_FAILED'
        && error?.receipt?.requestId === task.requestId
        && error?.receipt?.taskId === task.id
        && error?.receipt?.rolledBack === true,
    );
    assert.equal(facade.tasks.length, 0, 'quota 失败后遗留了内存 owner');

    quota = false;
    const healed = FactoryPanel.prototype.registerTask.call(facade, task);
    const replay = FactoryPanel.prototype.registerTask.call(facade, task);
    assert.equal(healed.id, 'stable-single-id');
    assert.equal(replay, healed);
    assert.equal(facade.tasks.length, 1, '同事务修复后产生重复项目');
  });

  test('批量 registry quota 失败整批原子回滚；同 batchRequestId 修复与重放零重复', async () => {
    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    let quota = true;
    const facade = {
      tasks: [], values: {}, genre: { input_fields: [{ id: 'title', label: '标题', required: true }] },
      el: { querySelector(selector) { return selector === '.fc-maxmode' ? { checked: true } : { value: '3' }; } },
      async confirmBatchImport() { return true; }, collectValues() {}, syncTaskViews() {}, log() {},
      saveJSON() { if (quota) throw new Error('QuotaExceededError: batch registry full'); },
      persistTaskRegistry: FactoryPanel.prototype.persistTaskRegistry,
      taskReceipt: FactoryPanel.prototype.taskReceipt,
      makeTask(_maxMode, _maxChapters, overrides = {}) {
        const title = overrides.title;
        return { id: `stable-${title}`, label: title, genreId: 'xiaoshuo', status: 'pending', mode: 'max', maxChapters: 3 };
      },
    };
    let rejected;
    try {
      await FactoryPanel.prototype.addBatchTitles.call(facade, ['甲', '乙'], { requestId: 'stable-batch-request' });
    } catch (error) { rejected = error; }
    assert.equal(rejected?.code, 'FACTORY_BATCH_REGISTRY_PERSIST_FAILED');
    assert.equal(rejected?.receipt?.requestId, 'stable-batch-request');
    assert.equal(rejected?.receipt?.tasks?.length, 2);
    assert(rejected.receipt.tasks.every(item => item.rolledBack && !item.registered));
    assert.equal(facade.tasks.length, 0, '批量 quota 失败只回滚了部分任务');

    quota = false;
    const healed = await FactoryPanel.prototype.addBatchTitles.call(facade, ['甲', '乙'], { requestId: 'stable-batch-request' });
    const replay = await FactoryPanel.prototype.addBatchTitles.call(facade, ['甲', '乙'], { requestId: 'stable-batch-request' });
    assert.deepEqual(healed.map(task => task.id), ['stable-甲', 'stable-乙']);
    assert.deepEqual(replay.map(task => task.id), ['stable-甲', 'stable-乙']);
    assert.equal(facade.tasks.length, 2, '同 batchRequestId 重放复制了整批');
  });

  test('磁盘 receipt 成功后的 quota 附 durable receipt；失败补记不得遮蔽原始 IO 错误', async () => {
    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    const priorBridge = window.mazz;
    const writes = [];
    window.mazz = {
      isElectron: true,
      invoke: async (channel, payload = {}) => {
        if (channel === 'fs:writeFile') { writes.push(payload); return { ok: true }; }
        return null;
      },
    };
    try {
      let quota = true;
      const task = {
        id: 'durable-receipt-id', label: '磁盘收据', genreId: 'xiaoshuo', requestId: 'durable-receipt-request',
        createdAt: 1_777_500_000, status: 'pending', values: {}, mode: 'single', maxChapters: 1,
      };
      const facade = {
        genres: [{ id: 'xiaoshuo' }], genre: null,
        async ensureTaskFolder(row) { row.folder ||= 'C:/workspace/Output/磁盘收据'; return row.folder; },
        saveJSON() { if (quota) throw new Error('QuotaExceededError: post-receipt'); },
        persistTaskRegistry: FactoryPanel.prototype.persistTaskRegistry,
        syncTaskViews() {}, taskReceipt: FactoryPanel.prototype.taskReceipt,
      };
      let persistFailure;
      try { await FactoryPanel.prototype.establishTaskReceipt.call(facade, task); }
      catch (error) { persistFailure = error; }
      assert.equal(persistFailure?.code, 'FACTORY_TASK_REGISTRY_PERSIST_FAILED_AFTER_RECEIPT');
      assert.equal(persistFailure?.receipt?.accepted, true);
      assert.equal(persistFailure?.receipt?.durable, true);
      assert.equal(persistFailure?.receipt?.registryPersisted, false);
      assert.equal(persistFailure?.receipt?.requestId, task.requestId);
      assert(task.receiptAt && !task.receiptError, '磁盘成功后被误标成 receipt 写失败');
      assert.equal(writes.length, 1);

      quota = false;
      const healed = await FactoryPanel.prototype.establishTaskReceipt.call(facade, task);
      assert.equal(healed.taskId, task.id);
      assert.equal(healed.registryPersisted, true);
      assert.equal(task.requestId, 'durable-receipt-request');

      window.mazz.invoke = async channel => {
        if (channel === 'fs:writeFile') throw new Error('ENOSPC: receipt disk full');
        return null;
      };
      const broken = { ...task, id: 'broken-receipt-id', requestId: 'broken-receipt-request', folder: '', receiptAt: 0 };
      facade.saveJSON = () => { throw new Error('QuotaExceededError: failure-state'); };
      let diskFailure;
      try { await FactoryPanel.prototype.establishTaskReceipt.call(facade, broken); }
      catch (error) { diskFailure = error; }
      assert.match(diskFailure?.message || '', /ENOSPC/);
      assert.match(diskFailure?.registryPersistError || '', /QuotaExceededError/);
      assert.equal(diskFailure?.receipt?.accepted, false);
      assert.equal(diskFailure?.receipt?.requestId, broken.requestId);
    } finally {
      window.mazz = priorBridge;
    }
  });

  test('所有流式正式产物均改走 detailed；Provider 不安全终态失败关闭', async () => {
    const text = await source('renderer/modules/factory/index.js');
    assert(!/\bchatStream\s*\(/.test(text), '仍调用旧字符串流 API');
    assert(!/ensureTokenDeclaration\s*\(/.test(text), '仍补造模型完成声明');
    assert((text.match(/chatStreamDetailed\s*\(/g) || []).length === 3, '单次/蓝图/章节未全部切到 detailed');
    assert(!text.includes('validateNativeContinuationDeclaration'), '仍把模型自报字数声明当成完成证据');
    assert(text.includes('function providerCompletionReady')
      && text.includes('completion.safeToCommit === true')
      && text.includes("String(completion.finishReason || '').trim().toLowerCase() === 'stop'")
      && text.includes('!!body.trim()'), 'Provider stop + 非空 final 完成门不完整');
    assert(text.includes('UNSAFE_STREAM_COMPLETION') && text.includes('未通过 Provider 完成门'), '单次生成没有 fail-closed 到断点暂停');
    assert(text.includes('UNSAFE_CHAPTER_COMPLETION') && text.includes('未通过 Provider 完成门'), '章节没有 fail-closed 到断点暂停');
    assert(!text.includes('断点已带 TOKEN 声明，直接收口'), '旧断点的未验证声明仍可绕过 Provider 终态');
  });

  test('Shell 等待 FactoryPanel ready 并回传 requestId 精确结果；批量 generate 真开工', async () => {
    const [shell, dock] = await Promise.all([
      source('renderer/shell/shell.js'), source('renderer/shell/side-dock.js'),
    ]);
    assert(shell.includes('await this.whenFactoryPanelReady(10000)'), 'factoryAction 仍可能在 owner 未就绪时静默丢失');
    assert(shell.includes("type: 'factoryActionResult', requestId, ok: !!ok") && shell.includes('receipt },'), '缺少关联业务回执');
    assert(shell.includes('fp.generateBatchNow(draft.batchTitles, { requestId })'), '批量立刻开工仍只入队');
    assert(dock.includes('async whenFactoryReady(') && dock.includes('Promise.resolve(this.factoryPanel.ready)'), 'FactoryPanel ready 没覆盖异步 reload');
  });

  test('批量收据只承认已落 folder + receiptAt 的项目，未尝试项不得误报成功', async () => {
    const text = await source('renderer/modules/factory/index.js');
    const start = text.indexOf('async generateBatchNow(');
    const end = text.indexOf('\n  selectedTasks()', start);
    const block = text.slice(start, end);
    assert(start >= 0 && block.includes('accepted: !!task.folder && !!task.receiptAt && !task.receiptError'),
      '批量异常回执仍会把未落盘、未尝试的后续任务标成 accepted');
  });

  test('单项与批量首项收据写失败后，同 requestId 重试只修复原登记任务', async () => {
    const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');
    const heal = async task => {
      task.folder ||= `C:/workspace/Output/${task.id}`;
      task.receiptAt = 1_777_300_001;
      task.status = 'pending';
      delete task.receiptError;
      return FactoryPanel.prototype.taskReceipt.call({}, task, { accepted: true });
    };
    const single = {
      id: 'single-write-failed', label: '单项', requestId: 'retry-single',
      status: 'failed', folder: 'C:/workspace/Output/single-write-failed', receiptAt: 0,
      receiptError: 'ENOSPC', createdAt: 1_777_300_000,
    };
    const scheduled = [];
    const singleFacade = {
      tasks: [single],
      transactionTask: FactoryPanel.prototype.transactionTask,
      establishTaskReceipt: heal,
      scheduleBackgroundTasks(tasks) { scheduled.push(...tasks); },
      taskReceipt: FactoryPanel.prototype.taskReceipt,
    };
    const singleReceipt = await FactoryPanel.prototype.generateNow.call(singleFacade, { requestId: 'retry-single' });
    assert.equal(singleFacade.tasks.length, 1, '单项重试新建了第二个项目');
    assert.equal(singleReceipt.taskId, single.id);
    assert.equal(singleReceipt.deduplicated, true);

    const batchId = 'retry-batch';
    const batchTasks = [1, 2].map(index => ({
      id: `batch-write-failed-${index}`, label: `批量${index}`,
      requestId: `${batchId}:${index}`, batchRequestId: batchId,
      status: 'failed', folder: index === 1 ? 'C:/workspace/Output/batch-write-failed-1' : '',
      receiptAt: 0, receiptError: index === 1 ? 'ENOSPC' : '', createdAt: 1_777_300_010 + index,
    }));
    const batchFacade = {
      cfg: { providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'encrypted-test-placeholder' },
      tasks: batchTasks,
      addBatchTitles: FactoryPanel.prototype.addBatchTitles,
      establishTaskReceipt: heal,
      scheduleBackgroundTasks(tasks) { scheduled.push(...tasks); },
      taskReceipt: FactoryPanel.prototype.taskReceipt,
      log() {},
    };
    const batchReceipt = await FactoryPanel.prototype.generateBatchNow.call(batchFacade, ['批量1', '批量2'], { requestId: batchId });
    assert.equal(batchFacade.tasks.length, 2, '批量首项失败后的同 ID 重试复制了整批');
    assert.equal(batchReceipt.tasks.length, 2);
    assert(batchReceipt.tasks.every(item => item.accepted && item.receiptAt), '批量同 ID 重试没有补齐原任务收据');
  });

  test('全部磁盘状态写入都经过事务封套；恢复按保留后的 mode 分流', async () => {
    const text = await source('renderer/modules/factory/index.js');
    const writes = text.split(/\r?\n/).filter(line => line.includes('writeTaskState('));
    const rawWrites = writes.filter(line => !line.includes('factoryTaskState(') && !line.includes('writeTaskState(task.folder, state)'));
    assert.equal(rawWrites.length, 0, `仍有 ${rawWrites.length} 处状态写入绕过事务封套`);
    assert(writes.length >= 12, '状态写入合同没有覆盖当前完整写路径');
    assert(text.includes("task.mode === 'single'"), '恢复入口没有按 single/max 分流');
    assert(text.includes('const recoveredMode = recovered.recoveryModeExplicit'), '旧磁盘状态仍可能覆盖注册表中的 single');
  });

  test('双环与单篇执行坐标固化在 task，旧任务才回退当前 UI', async () => {
    const text = await source('renderer/modules/factory/index.js');
    const makeStart = text.indexOf('  makeTask(');
    const makeEnd = text.indexOf('\n  async ensureTaskFolder(', makeStart);
    const make = text.slice(makeStart, makeEnd);
    assert.match(make, /dualLoop:\s*!!this\.el\.querySelector\('\.fc-dualloop'\)\?\.checked/);
    assert.match(make, /autoPreview:\s*this\.autoPreview/);

    const runStart = text.indexOf('  async runTask(task,');
    const runEnd = text.indexOf('\n  async runTaskPool(', runStart);
    const run = text.slice(runStart, runEnd);
    assert.match(run, /typeof task\.dualLoop === 'boolean'[\s\S]*\? task\.dualLoop[\s\S]*:\s*!!this\.el\.querySelector\('\.fc-dualloop'\)\?\.checked/);
    assert.match(run, /if \(typeof task\.dualLoop !== 'boolean'\) task\.dualLoop = dual/);

    const singleStart = text.indexOf('  async runSingleTask(');
    const maxStart = text.indexOf('  async runMaxTask(', singleStart);
    const single = text.slice(singleStart, maxStart);
    const maxEnd = text.indexOf('\n  //', maxStart + 10);
    const max = text.slice(maxStart, maxEnd > maxStart ? maxEnd : undefined);
    assert.match(single, /dual = typeof task\.dualLoop === 'boolean' \? task\.dualLoop : !!dual/);
    assert.match(max, /dual = typeof task\.dualLoop === 'boolean' \? task\.dualLoop : !!dual/);

    const resumeStart = text.indexOf('  async resumeFromState(');
    const resumeEnd = text.indexOf('\n  log(msg)', resumeStart);
    const resume = text.slice(resumeStart, resumeEnd);
    assert.match(resume, /dualLoop: typeof recovered\.dualLoop === 'boolean' \? recovered\.dualLoop : task\.dualLoop/);
    assert.match(resume, /await this\.runSingleTask\(task, tpl, dual\)/);
    assert.match(resume, /await this\.runMaxTask\(task, tpl, dual, progress\)/);

    const resumeSelectedStart = text.indexOf('  async resumeSelected(');
    const resumeSelectedEnd = text.indexOf('\n  confirmBatchImport(', resumeSelectedStart);
    const resumeSelected = text.slice(resumeSelectedStart, resumeSelectedEnd);
    assert.match(resumeSelected, /typeof task\.dualLoop === 'boolean'[\s\S]*\? task\.dualLoop[\s\S]*runMaxTask\(task, tpl, dual, prog\)/);

    const importStart = text.indexOf('  async importCsv(');
    const importEnd = text.indexOf('\n  \/\/ ====================', importStart);
    const csv = text.slice(importStart, importEnd);
    assert.match(csv, /const dualLoop = !!this\.el\.querySelector\('\.fc-dualloop'\)\?\.checked/);
    assert.match(csv, /maxChapters: maxMode \? maxChapters : 0/);
    assert.match(csv, /autoPreview: this\.autoPreview, dualLoop/);

    const retryStart = text.indexOf("this.taskListEl.querySelectorAll('[data-retry]')");
    const retryEnd = text.indexOf('\n    this.hisListEl', retryStart);
    const retry = text.slice(retryStart, retryEnd);
    assert.match(retry, /typeof task\.dualLoop === 'boolean'[\s\S]*\? task\.dualLoop[\s\S]*runMaxTask\(task, tpl, dual/);
  });

  test('旧审校预算值只作兼容输入，不得降级、硬停或进入 W68 控制流', async () => {
    const { evaluateBudgetCap } = await import('../../renderer/modules/factory/command-gate.js');
    for (const capTokens of [0, 1, 32000, Number.MAX_SAFE_INTEGER]) {
      const state = evaluateBudgetCap({ capTokens, usedTokens: capTokens + 1, requestedRitual: 'full' });
      assert.equal(state.status, 'ok');
      assert.deepEqual(state.actions, []);
      assert.equal(state.enforcement, 'provider-native');
    }

    const text = await source('renderer/modules/factory/index.js');
    assert(!text.includes('resolveReviewBudgetCap'), '执行层仍保留产品 Token 预算解析器');
    assert(!text.includes('reviewBudgetCap'), '新任务/执行/日志仍携带产品 Token 预算');
    assert(!text.includes('advisoryBudgetTokens'), 'W68 仍收到产品预算参数');
  });

  test('忽略中断任务不再把磁盘状态伪造为 done，Desk 打开会先合并磁盘注册表', async () => {
    const [index, desk] = await Promise.all([
      source('renderer/modules/factory/index.js'), source('renderer/modules/factory/desk.js'),
    ]);
    assert(!/writeTaskState\(r\.outDir,\s*\{\s*\.\.\.r,\s*status:\s*'done'/.test(index), '忽略仍会伪写 done');
    assert(desk.includes('await panel?.reconcileResumableTasks?.()') && desk.includes('await syncRegistryFromDisk(taskSelect.value)'), 'Desk 没有在打开时合并磁盘任务');
  });
});
