// tests/contract/hotfix-w61a.test.mjs —— W61a 多实例只读预览契约
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const panel = fs.readFileSync(new URL('../../main/panel-windows.js', import.meta.url), 'utf8');
const factory = fs.readFileSync(new URL('../../renderer/modules/factory/index.js', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../../renderer/panels/fpreview.html', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');

describe('W61a 受限多实例地基', () => {
  test('注册键为 kind:instanceId 且只放行 fpreview/fedit', () => {
    assert(panel.includes("static MULTI_KINDS = new Set(['fpreview', 'fedit'])"), '多实例白名单失真');
    assert(panel.includes('`${kind}:${this._instanceId(instanceId)}`'), '注册键未精确到 kind:instanceId');
    assert(panel.includes("return PanelWindows.MULTI_KINDS.has(kind) ?") && panel.includes(': kind;'), '旧面板单例回落丢失');
    assert(panel.includes('PanelWindows.register(panelKey, win)'), '静态主题注册表未使用实例键');
  });

  test('预览窗按右列 44px 阶梯排列且满列换列', () => {
    assert(panel.includes('const step = 44'), '阶梯步长不是 44px');
    assert(panel.includes('row = index % rows') && panel.includes('col = Math.floor(index / rows)'), '满列换列算法缺失');
    assert(panel.includes('area.x + area.width - width - 16 - col * step'), '未右对齐逐列定位');
  });

  test('推送可按实例精确路由且加载前消息排队', () => {
    assert(panel.includes("bus.handle('panel:push', async ({ kind, instanceId, payload })"), 'push 未接 instanceId');
    assert(panel.includes("win.webContents.on('did-finish-load'") && panel.includes('win.__panelQueue'), '首屏消息队列缺失');
  });
});

describe('W61a fpreview 纯只读预览', () => {
  test('页面没有任何输入控件并明确 READ ONLY', () => {
    assert(!/<input\b/i.test(preview), 'fpreview 禁止 input');
    assert(!/<textarea\b/i.test(preview), 'fpreview 禁止 textarea');
    assert(preview.includes('READ ONLY') && preview.includes('任务目录 · 只读'), '只读标识缺失');
  });

  test('轻量 Markdown 覆盖标题/粗体/列表/代码块', () => {
    for (const pin of ['/^(#{1,6})', '<strong>', '<li>', '<pre><code>']) assert(preview.includes(pin), `Markdown 渲染缺 ${pin}`);
  });

  test('目录含蓝图/大纲/正文/快照并支持点击换档', () => {
    for (const pin of ['创作蓝图.md', '章节大纲.md', '状态快照', "type: 'factoryPreviewRead'"]) assert(preview.includes(pin), `目录档缺 ${pin}`);
    assert(shell.includes("pl.type === 'factoryPreviewRead'") && factory.includes('readPreviewFile(taskId, filePath'), '主窗安全读档桥缺失');
  });
});

describe('W61a taskId 流式路由', () => {
  test('自动预览默认开启且随任务固化', () => {
    assert(factory.includes("this.loadJSON(AUTO_PREVIEW_KEY, true) !== false"), '自动预览默认值不是 ON');
    assert(factory.includes('autoPreview: this.autoPreview'), '任务未固化自动预览设置');
  });

  test('开窗、流式、完成、失败均绑定 taskId 实例', () => {
    assert(factory.includes("kind: 'fpreview', opts: { instanceId: task.id"), '开窗未绑定 taskId');
    assert(factory.includes("kind: 'fpreview', instanceId: taskId"), '推送未按 taskId 路由');
    for (const type of ['factoryPreviewStream', 'factoryPreviewDone', 'factoryPreviewTaskDone', 'factoryPreviewFail']) assert(factory.includes(type), `缺 ${type}`);
  });
});
