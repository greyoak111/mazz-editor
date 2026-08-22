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

describe('W60b 篇幅联动与批量闸', () => {
  test('四档齐全；总字数与每章字数向上联动章节数', () => {
    assert(eng.FACTORY_LENGTH_PRESETS.map(x => x.id).join(',') === 'short,medium,long,unlimited', '四档不全');
    assert(eng.FACTORY_LENGTH_PRESETS.map(x => x.totalWords).join(',') === '10000,100000,500000,0', '四档字数未按 1万/10万/50万/无限定稿');
    assert(eng.FACTORY_LENGTH_PRESETS.map(x => x.wordsPerUnit).join(',') === '2000,4000,6000,4000', '四档默认单元字数失真');
    const plan = eng.resolveFactoryLengthPlan({ preset: 'medium', totalWords: 52001, wordsPerUnit: 3000 });
    assert(plan.maxMode && plan.maxChapters === 18, '联动应向上取整为 18：' + JSON.stringify(plan));
    assert(plan.totalWords === 52001 && plan.wordsPerUnit === 3000, '智能行数值丢失');
    const unlimited = eng.resolveFactoryLengthPlan({ preset: 'unlimited' });
    assert(unlimited.maxMode && unlimited.maxChapters === 0 && unlimited.totalWords === 0, '无限档协议失真');
  });

  test('30 条只软提示，100 条可入，101 条硬拒绝', () => {
    assert(!eng.factoryBatchGate(30).warning, '30 条不应提示');
    assert(eng.factoryBatchGate(31).allowed && eng.factoryBatchGate(31).warning, '31 条应软提示但允许');
    assert(eng.factoryBatchGate(100).allowed, '100 条应允许');
    assert(!eng.factoryBatchGate(101).allowed, '101 条必须拒绝');
    const tpl = { input_fields: [{ id: '书名', label: '书名' }] };
    const csv100 = ['书名', ...Array.from({ length: 100 }, (_, i) => `书${i + 1}`)].join('\n');
    assert(eng.parseCsvTasks(csv100, tpl).length === 100, '100 行解析失败');
    let msg = '';
    try { eng.parseCsvTasks(csv100 + '\n书101', tpl); } catch (e) { msg = e.message; }
    assert(msg.includes('100') && msg.includes('拒绝'), '101 行未硬拒绝：' + msg);
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

  test('旧长度字段仅保留兼容元数据，新项目表单只渲染 lengthPlan', () => {
    for (const id of ["id: 'length'", "id: '篇幅长短'", "id: '每章字数'"]) {
      const row = novelGenreSrc.split('\n').find(line => line.includes(id));
      assert(row?.includes("uiOwner: 'lengthPlan'"), `${id} 未交给 lengthPlan 单一所有者`);
    }
    assert(projectPanelSrc.includes("filter(field => field.uiOwner !== 'lengthPlan')"), '项目表单未隐藏旧长度字段');
    for (const pin of ['formatPresetTotal', '1万字', '10万字', '50万字', '自定义篇幅']) {
      assert(projectPanelSrc.includes(pin) || (pin.endsWith('万字') && projectPanelSrc.includes('total / 10000')), `篇幅卡契约缺 ${pin}`);
    }
    assert(projectPanelSrc.includes('aria-pressed=') && projectPanelSrc.includes('id="pj-chapters"') && projectPanelSrc.includes('aria-live="polite"'), '篇幅选择或预计章数缺可访问状态');
    assert(projectPanelSrc.includes('向上取整，末') && projectPanelSrc.includes('按剩余字数安排'), '预计章数规则必须明示');
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
