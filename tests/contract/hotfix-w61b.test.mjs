// tests/contract/hotfix-w61b.test.mjs —— W61b 并行编辑窗与任务调度契约
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const panel = fs.readFileSync(new URL('../../main/panel-windows.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
const factory = fs.readFileSync(new URL('../../renderer/modules/factory/index.js', import.meta.url), 'utf8');
const edit = fs.readFileSync(new URL('../../renderer/panels/fedit.html', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../../renderer/panels/fpreview.html', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../renderer/panels/factorycfg.html', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');

describe('W61b fedit 源码编辑窗', () => {
  test('预览的去编辑动作按同一 taskId 开窗且不关闭预览', () => {
    assert(preview.includes("type: 'factoryPreviewEdit'"), '预览去编辑动作缺失');
    assert(factory.includes("kind: 'fedit', opts: { instanceId: taskId"), '编辑窗未按 taskId 多实例打开');
    assert(shell.includes("pl.type === 'factoryPreviewEdit'"), '去编辑主窗桥缺失');
    assert(!preview.includes("panel:close', { kind: 'fpreview'"), '去编辑不应关闭预览');
  });

  test('编辑器为轻量 textarea，带行号、源码着色和 Ctrl+S', () => {
    assert(edit.includes('<textarea class="editor"') && !edit.includes('new EditorView('), 'fedit 不得再建 ProseMirror');
    for (const pin of ['class="lines"', 'highlightLine', 'syn-head', 'syn-bold', "e.key.toLowerCase() === 's'"]) assert(edit.includes(pin), `编辑器能力缺 ${pin}`);
  });

  test('生成中与虚拟流文件不可编辑', () => {
    assert(preview.includes('taskRunning || virtual'), '预览未锁住生成中编辑入口');
    assert(factory.includes("task.status === 'running'"), '回写层未拒绝运行中任务');
  });
});

describe('W61b 回写与预览同步', () => {
  test('保存校验任务目录边界并写回真实 Markdown 文件', () => {
    assert(factory.includes('safeTaskPath(task, filePath)') && factory.includes("target.includes('/../')"), '任务目录边界校验缺失');
    assert(factory.includes("!/\\.(md|markdown)$/i.test(target)"), '仅允许 Markdown 的路径门禁缺失');
    assert(factory.includes("window.mazz.invoke('fs:writeFile', { path: target, content: text })"), '保存未写回文件');
  });

  test('保存后精确同步原预览并登记人工修订', () => {
    for (const pin of ['factoryPreviewSynced', '预览已同步 ✓', 'manualRevision', '✎人工修订×']) assert(factory.includes(pin) || preview.includes(pin) || edit.includes(pin), `回写闭环缺 ${pin}`);
    assert(factory.includes("this.previewPush(task.id, { type: 'factoryPreviewSynced'"), '同步消息未按任务精确路由');
    assert(factory.includes('manualRevision: task.manualRevision'), '任务状态未持久化人工修订标');
  });
});

describe('W61b 左右阶梯与收拢', () => {
  test('fedit 左列、fpreview 右列，均保持 44px 阶梯', () => {
    assert(panel.includes("kind === 'fedit' ? 'left' : 'right'"), '左右列分流缺失');
    assert(panel.includes('const step = 44'), '阶梯步长不是 44px');
    assert(panel.includes('area.x + 16 + col * step'), '编辑窗未左对齐换列');
  });

  test('一键收拢会重新编号并恢复阶梯坐标', () => {
    assert(bridge.includes("'panel:arrange'"), '收拢 IPC 未过白名单');
    assert(edit.includes("invoke('panel:arrange', { kind: 'fedit' })"), '编辑窗收拢按钮未接线');
    assert(panel.includes('win.__stairIndex = index') && panel.includes('win.setBounds({ ...pos'), '收拢算法未重排窗口');
  });
});

describe('W61b 独立任务调度器', () => {
  test('并发默认 1、持久化并钳制在 1～4', () => {
    assert(factory.includes("const CONCURRENCY_KEY = 'mazz.factory.concurrency'"), '并发持久化键缺失');
    assert(factory.includes('this.loadJSON(CONCURRENCY_KEY, 1)'), '并发默认值不是 1');
    assert(factory.includes('Math.max(1, Math.min(4'), '并发值未钳制 1～4');
    assert(config.includes('id="pj-concurrency"') && config.includes('[1, 2, 3, 4]'), '设置页未提供 1～4 选项');
    assert(shell.includes("pl.act === 'setConcurrency'"), '并发设置桥缺失');
  });

  test('队列用 worker pool 调度，运行集合限制额度', () => {
    assert(factory.includes('this.runningTasks = new Set()'), '独立运行集合缺失');
    assert(factory.includes('this.runningTasks.size >= this.concurrency'), '额度门禁缺失');
    assert(factory.includes('await Promise.all(Array.from({ length: Math.min(slots, queue.length) }, worker))'), '并行 worker pool 缺失');
    assert(factory.includes('await this.runTaskPool(sel)') && factory.includes('await this.runTaskPool(pendings)'), '选中/全部入口未统一走调度器');
  });

  test('直播上下文与推送都按 task 隔离', () => {
    assert(factory.includes('liveStart(task, chapterNo') && factory.includes('liveUpdate(task, text)') && factory.includes('liveDone(task, chapterNo'), '直播 API 未显式携带任务');
    assert(factory.includes("Object.defineProperty(task, '_live'") && factory.includes('this.previewPush(task.id'), '直播上下文或预览路由未按任务隔离');
    for (const legacy of ['this._activeTask', 'this._runFolder', 'this._runSnapshotSchema']) assert(!factory.includes(legacy), `仍残留全局单槽 ${legacy}`);
  });
});
