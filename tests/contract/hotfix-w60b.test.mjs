// tests/contract/hotfix-w60b.test.mjs —— W60b 表单与产出波契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';

const WS = '/mock-ws';
const fsStore = new Map();
window.mazz = {
  invoke: async (channel, payload = {}) => {
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFile') {
      if (!fsStore.has(payload.path)) throw new Error('ENOENT');
      return fsStore.get(payload.path);
    }
    if (channel === 'fs:writeFile') { fsStore.set(payload.path, payload.content); return true; }
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:listDir') {
      const prefix = payload.path + '/';
      const seen = new Map();
      for (const p of fsStore.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const seg = rest.split('/');
        if (seg.length === 1) seen.set(p, { name: seg[0], isDir: false, path: p });
        else {
          const dir = prefix + seg[0];
          if (!seen.has(dir)) seen.set(dir, { name: seg[0], isDir: true, path: dir });
        }
      }
      return [...seen.values()];
    }
    return null;
  },
};

const eng = await import('../../renderer/modules/factory/engine.js');
const projectPanelSrc = fs.readFileSync(new URL('../../renderer/panels/factorycfg.html', import.meta.url), 'utf8');
const novelGenreSrc = fs.readFileSync(new URL('../../renderer/modules/factory/genres/xiaoshuo.js', import.meta.url), 'utf8');

describe('W60b Output 目录协议', () => {
  test('按文体/作品类型/书名_时间尾5构造且清洗 Windows 非法字符', () => {
    const p = eng.buildFactoryOutputFolder('/工作区', {
      genreName: '小说/故事', workType: '科幻:悬疑', title: '星海*回声?', timestamp: 1723456789012,
    });
    assert(p === '/工作区/Output/小说-故事/科幻-悬疑/星海-回声-_89012', '目录协议失真：' + p);
  });

  test('作品类型缺失时固定落入未分类', () => {
    const p = eng.buildFactoryOutputFolder('/ws', { genreName: '公文', title: '通知', timestamp: 12345 });
    assert(p === '/ws/Output/公文/未分类/通知_12345', '未分类兜底失效：' + p);
  });

  test('章节文件名带三位序号与净化后的章题', () => {
    const stem = eng.buildFactoryUnitStem(7, '章', '## 第7章：星海#回声?');
    assert(stem === '第007章-星海回声-', '章题命名协议失真：' + stem);
  });

  test('新三级 Output 与旧创作产出均可扫描恢复', async () => {
    const modern = `${WS}/Output/小说/科幻/星海_10001`;
    const legacy = `${WS}/创作产出/旧任务`;
    await eng.writeTaskState(modern, { title: '星海', status: 'paused', currentChapter: 4 });
    await eng.writeTaskState(legacy, { title: '旧任务', status: 'stopped', currentChapter: 2 });
    const list = await eng.scanResumableTasks();
    assert(list.some(x => x.title === '星海' && x.outDir === modern), '新目录恢复扫描失败');
    assert(list.some(x => x.title === '旧任务' && x.outDir === legacy), '旧目录兼容扫描失败');
  });
});

describe('W60b 可选篇幅参考与无数量批量', () => {
  test('新项目默认不指定；参考数值不再派生连写模式或执行终点', () => {
    const empty = eng.resolveFactoryLengthPlan();
    assert.deepEqual(empty, { preset: 'custom', totalWords: 0, wordsPerUnit: 0, maxMode: false, maxChapters: 0 });
    const plan = eng.resolveFactoryLengthPlan({ preset: 'medium', totalWords: 52001, wordsPerUnit: 3000 });
    assert(!plan.maxMode && plan.maxChapters === 0, '参考字数不得开启连写或换算执行单元：' + JSON.stringify(plan));
    assert(plan.totalWords === 52001 && plan.wordsPerUnit === 3000, '智能行数值丢失');
    const unlimited = eng.resolveFactoryLengthPlan({ preset: 'unlimited' });
    assert(!unlimited.maxMode && unlimited.maxChapters === 0 && unlimited.totalWords === 0, '旧无限档只可作兼容参考，不能自动开连写');
  });

  test('任意数量的合法名单直接入队，不提示、不拒绝', () => {
    for (const count of [30, 31, 100, 101, 1001]) {
      const gate = eng.factoryBatchGate(count);
      assert(gate.allowed && !gate.warning && !gate.message, `${count} 条不应触发本地数量闸：${JSON.stringify(gate)}`);
    }
    const tpl = { input_fields: [{ id: '书名', label: '书名' }] };
    const csv = ['书名', ...Array.from({ length: 1001 }, (_, i) => `书${i + 1}`)].join('\n');
    assert(eng.parseCsvTasks(csv, tpl).length === 1001, '1000+ 行合法 CSV 应完整解析');
    assert(projectPanelSrc.includes('所有格式合法的书名都会入队'), '立项 UI 未说明无数量闸');
  });
});

describe('项目立项 UI 单一规格与确认事务', () => {
  test('设置与模板退出伪页签，项目态有明确标题和可见入口', () => {
    assert(projectPanelSrc.includes('class="head-title">新项目立项'), '项目态头部必须明确命名');
    assert(projectPanelSrc.includes('id="head-provider"') && projectPanelSrc.includes('AI 服务设置'), 'AI 服务设置必须是有文字的独立按钮');
    assert(projectPanelSrc.includes('id="pj-new-template"') && projectPanelSrc.includes('id="pj-genre"'), '新建模板动作必须靠近文体选择');
    assert(projectPanelSrc.includes('class="btn head-back"') && projectPanelSrc.includes('返回立项'), '设置/模板页必须可返回立项');
    assert(!projectPanelSrc.includes('class="tab" data-t="genre"'), '新建创作模板不得再伪装成同级页签');
  });

  test('新项目删除旧长度字段与数值档位，只保留空白可选参考', () => {
    for (const id of ["id: 'length'", "id: '篇幅长短'", "id: '每章字数'"]) {
      assert(!novelGenreSrc.includes(id), `${id} 不应继续成为新小说字段`);
    }
    assert(projectPanelSrc.includes("field.uiOwner !== 'lengthPlan'") && projectPanelSrc.includes('legacyLengthFieldIds'), '项目表单未隐藏旧长度字段');
    for (const stale of ['formatPresetTotal', '1万字', '10万字', '50万字', 'data-preset', 'word-chips', '按剩余字数安排']) {
      assert(!projectPanelSrc.includes(stale), `新项目仍暴露固定篇幅规格：${stale}`);
    }
    assert(projectPanelSrc.includes('id="pj-total"') && projectPanelSrc.includes('参考总字数（可选）'), '缺可选总字数参考');
    assert(projectPanelSrc.includes('id="pj-words"') && projectPanelSrc.includes('placeholder="不指定"'), '缺可选单元参考');
    assert(projectPanelSrc.includes('id="pj-max"') && projectPanelSrc.includes('关闭即单篇'), '连写必须独立显式选择');
    assert(projectPanelSrc.includes('id="pj-chapters"') && projectPanelSrc.includes('aria-live="polite"'), '规划预览缺可访问状态');
    assert(projectPanelSrc.includes('生成与验收不会按字数、字符数、段数或对话比例卡住'), '参考值非门禁语义未明示');
  });

  test('提交按 requestId 等结果，人工确认超时保持同一事务，失败保窗、成功才关闭', () => {
    for (const pin of ["act: 'projectSubmit'", 'requestId', 'genreId:', "p?.type === 'factoryActionResult'", 'result?.requestId !== projectSubmitTxn.requestId', 'noteProjectSubmitDelay', '为避免重复立项，本次请求保持锁定']) {
      assert(projectPanelSrc.includes(pin), `提交确认合同缺 ${pin}`);
    }
    const delayStart = projectPanelSrc.indexOf('function noteProjectSubmitDelay');
    const delayEnd = projectPanelSrc.indexOf('function makeRequestId', delayStart);
    const delayBody = projectPanelSrc.slice(delayStart, delayEnd);
    assert(!delayBody.includes('projectSubmitTxn = null') && !delayBody.includes('setProjectBusy(false)'), '等待人工确认不得解锁并产生新 requestId');
    assert(projectPanelSrc.includes('setTimeout(() => noteProjectSubmitDelay(requestId), 45000)'), '45 秒只允许进入 in-doubt 等待态');
    assert(projectPanelSrc.includes("if (projectSubmitTxn) {") && projectPanelSrc.includes("event.returnValue = ''") && projectPanelSrc.includes('收到持久收据前不能关闭本窗口'), 'in-doubt 事务必须拦截 Escape 与窗口关闭');
    const finishStart = projectPanelSrc.indexOf('function finishProjectSubmit');
    const finishEnd = projectPanelSrc.indexOf('function makeRequestId', finishStart);
    const finishBody = projectPanelSrc.slice(finishStart, finishEnd);
    assert(finishBody.indexOf('if (!result.ok)') < finishBody.indexOf("pwb('close')"), '失败分支必须先返回，不能提前关窗');
    assert(finishBody.includes("showProjectStatus(result.message") && finishBody.includes("'err'"), '失败必须在原窗给出明确错误');
    for (const pin of [
      'result?.receipt?.batch', '(result?.receipt?.taskId ? [result.receipt] : [])',
      'receiptTasks.filter(item => item?.taskId)', 'registered.filter(item => item?.accepted)',
      'projectSubmitTxn.retryable = true', 'const retryTxn = projectSubmitTxn?.retryable',
      'const requestId = retryTxn?.requestId || makeRequestId()', 'mode: submitMode',
    ]) assert(projectPanelSrc.includes(pin), `部分批量收据 exactly-once 合同缺 ${pin}`);
    assert(finishBody.indexOf('projectSubmitTxn.retryable = true') < finishBody.indexOf('projectSubmitTxn = null'), '部分成功必须保留原 requestId，不能先清事务');
  });

  test('岗位 picklist 发送屏幕锚点，主进程独占翻边与钳制', () => {
    for (const pin of ['window.screenX + rect.left', 'window.screenY + rect.bottom', 'width: rect.width', 'height: rect.height', 'devicePixelRatio: window.devicePixelRatio']) {
      assert(projectPanelSrc.includes(pin), `岗位锚点合同缺 ${pin}`);
    }
    assert(!projectPanelSrc.includes('window.screenY + rect.bottom + 4'), 'UI 不得重复叠加主进程负责的 4px 间距');
  });

  test('窄窗无 760 断崖，并保留标签、必填与 sticky 主操作', () => {
    for (const pin of ['grid-template-areas:"material plan" "dump plan"', 'grid-template-areas:"plan" "material" "dump"', 'position:sticky', 'bottom:0', 'for="pj-genre"', 'aria-required="true"', '<output id="pj-chapters"']) {
      assert(projectPanelSrc.includes(pin), `响应式/可访问性合同缺 ${pin}`);
    }
  });
});

describe('W60b 六格式尾巴', () => {
  test('扩展名与 pandoc 目标映射完整', () => {
    const expected = { rst: 'rst', adoc: 'asciidoc', textile: 'textile', opml: 'opml', org: 'org', mw: 'mediawiki' };
    for (const [fmt, pandoc] of Object.entries(expected)) {
      const spec = eng.factoryExportSpec(fmt);
      assert(spec.ext === fmt && spec.pandoc === pandoc && spec.text, `${fmt} 映射错误`);
    }
  });

  test('六种文本均生成非空且保留标题/正文，OPML 为可解析 XML', () => {
    const md = '# 第一章\n\n正文内容\n\n## 小节\n\n- 条目';
    for (const fmt of ['rst', 'adoc', 'textile', 'opml', 'org', 'mw']) {
      const out = eng.serializeFactoryText(md, fmt, '测试书');
      assert(out.includes('第一章') && out.includes('正文内容'), `${fmt} 正文不可读`);
      if (fmt === 'opml') assert(out.startsWith('<?xml') && out.includes('<opml'), 'OPML 不是 XML');
    }
  });
});
