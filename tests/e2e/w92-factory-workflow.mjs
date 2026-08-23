// W92 智能创作专业流程：真实 Electron + OpenAI-compatible loopback 全链。
// 覆盖冷启动立项业务回执、任务注册、SSE/专业流程、断点 fail-closed、智能创作台与重启恢复。
import { _electron as electron } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectW92Artifacts } from './w92-evidence-artifacts.mjs';

const root = path.resolve('.');
const executablePath = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const coordinate = executablePath ? 'PACKAGED' : 'SOURCE';
const runLabel = String(process.env.MAZZ_E2E_RUN_LABEL || 'final').replace(/[^a-zA-Z0-9._-]/g, '_');
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const evidencePath = path.join(evidenceDir, `W92_FACTORY_WORKFLOW_${coordinate}.json`);
const screenshotPath = path.join(evidenceDir, `W92_FACTORY_WORKFLOW_${coordinate}.png`);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-factory-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-factory-ws-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = { calls: [], sockets: new Set() };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, message, timeout = 30000, interval = 80) {
  const until = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < until) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(interval);
  }
  throw new Error(`${message}${lastError ? `（末次：${lastError.message}）` : ''}`);
}

function jsonResponse(response, content, { status = 200 } = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(content));
}

function longNarrative() {
  const paragraph = '林澈在潮声里核对罗盘、值班簿和甲板刻度，把每一次偏航写进纸边。旧船穿过北闸港外的雾带，船员依次复核信标读数；没有人用判断替代证据，也没有记录被悄悄抹去。';
  return `${paragraph.repeat(9)}\n\n雾在黎明前退到防波堤外，最后一盏信标照亮归航线。`;
}

function nativeChapter() {
  return longNarrative();
}

function blueprint() {
  return `# 故事标题：回声航线

## 一句话简介
归航员林澈必须依据可复验的航海记录穿过雾带，否则整座港口会失去最后一条安全航线。

## 核心价值取向
可靠的共同事实来自公开证据、相互复核与承担后果，而不是权威语气。

## 主角详细人设
林澈是北闸港归航员，谨慎、克制，缺口是害怕再次承担错误判断的责任。他以行动修复信任。

## 配角群像
值班长苏弦负责交叉复核；轮机师白栎维护旧船；记录员唐汐守护原始台账。三人有不同立场但共享验收标准。

## 世界观设定
近未来港城长期被季风雾带包围，航线许可必须同时满足罗盘、信标、潮汐和纸面记录四类证据。

## 三幕结构大纲
第一幕确认失效航线与任务边界；第二幕在雾带中发现冲突读数并逐项验真；第三幕公开错误、修正航线并完成归港。

## 各章节详细纲要
第1章：林澈在黎明前核对罗盘与值班簿，带领旧船穿过雾带并完成可复验归航。

## 文风执行方案
第三人称限制视角；以动作、物件和对话潜台词外化情绪；不用直接心理报告，不写梗概式总结。

## 全文节奏控制表
开场以异常读数制造钩子；中段用三次独立复核升级冲突；结尾以归航灯和公开台账形成回响。

## 创作启动指令
严格保持人物身份、航线证据与时间顺序一致。每个判断必须落到可见动作或记录，禁止代替验收者宣布通过。`;
}

function systemReply(system, user) {
  if (system.includes('MAZZ_W68_POLISH')) return longNarrative();
  if (system.includes('MAZZ_W68_REPAIR')) return longNarrative();
  if (system.includes('MAZZ_W68_POINT')) return JSON.stringify({ decision: 'pass', findings: [], repairItems: [], consultation: null });
  if (system.includes('MAZZ_W68_REVIEW')) return JSON.stringify({ objections: [] });
  if (system.includes('MAZZ_W68_ANSWER')) return JSON.stringify({ answer: '证据已登记', evidenceRef: 'draft:正文', outcome: 'withdraw' });
  if (system.includes('MAZZ_W68_RECONSIDER')) return JSON.stringify({ outcome: 'withdraw', reason: '证据充分' });
  if (system.includes('MAZZ_W68_HEARING')) return JSON.stringify({ decision: 'overrule', reason: '证据一致', ruleRef: 'W92-R1' });
  if (system.includes('MAZZ_W68_FINAL')) return JSON.stringify({ decision: 'pass', reason: '四闸全开，进入人工最终审定' });
  if (/状态记录员|状态快照/.test(system + user)) return '## 人物状态\n- 林澈已归航\n\n## 伏笔台账\n- 信标读数已回收\n\n## 时间线\n- 黎明前完成\n\n## 冲突线\n- 公开记录解决分歧';
  if (/一致性校验员/.test(system)) return '下一章继续沿用航线、信标与值班簿口径，不改写既有正文。';
  return '测试响应';
}

function sendSse(response, text, finishReason = 'stop') {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (let index = 0; index < text.length; index += 180) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(index, index + 180) }, finish_reason: null }] })}\n\n`);
  }
  response.write(`data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: finishReason }],
    usage: { prompt_tokens: 321, completion_tokens: Math.max(1, Math.ceil(text.length / 4)), total_tokens: 321 + Math.max(1, Math.ceil(text.length / 4)) },
  })}\n\n`);
  response.end('data: [DONE]\n\n');
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && /\/models(?:\?|$)/.test(request.url || '')) {
    jsonResponse(response, { data: [{ id: 'w92-complete' }, { id: 'w92-length' }] });
    return;
  }
  let body = '';
  for await (const chunk of request) body += String(chunk);
  let payload = {};
  try { payload = JSON.parse(body); } catch {}
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = String(messages.find(message => message.role === 'system')?.content || '');
  const user = String(messages.filter(message => message.role === 'user').at(-1)?.content || '');
  const call = {
    model: String(payload.model || ''), stream: payload.stream === true,
    phase: system.match(/MAZZ_W68_([A-Z_]+)/)?.[1] || (/蓝图生成要求/.test(user) ? 'BLUEPRINT' : payload.stream ? 'CHAPTER' : 'CHAT'),
  };
  state.calls.push(call);
  if (payload.stream === true) {
    if (payload.model === 'w92-length') sendSse(response, '这是一段只允许留在断点中的截断半稿。', 'length');
    else if (/蓝图生成要求/.test(user)) sendSse(response, blueprint(), 'stop');
    else sendSse(response, nativeChapter(), 'stop');
    return;
  }
  const content = systemReply(system, user);
  jsonResponse(response, {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 180, completion_tokens: Math.max(1, Math.ceil(content.length / 4)), total_tokens: 180 + Math.max(1, Math.ceil(content.length / 4)) },
  });
});
server.on('connection', socket => {
  state.sockets.add(socket);
  socket.once('close', () => state.sockets.delete(socket));
});

const port = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const baseURL = `http://127.0.0.1:${port}`;

let app = null;
let win = null;
let currentLog = null;
const runtimeErrors = [];

function assertHealthyFileWatcher(snapshot, phase) {
  const watchers = (snapshot?.active || []).filter(entry => entry?.type === 'file-watcher');
  assert(watchers.length === 1, `${phase} file-watcher 数量错误：${watchers.length}`);
  const watcher = watchers[0];
  assert(watcher.state === 'watching', `${phase} file-watcher 未处于 watching：${watcher.state || 'missing'}`);
  return {
    count: watchers.length,
    state: watcher.state,
    rootsCount: Number(watcher.meta?.roots || 0),
    reason: String(watcher.meta?.reason || ''),
  };
}

async function launch() {
  const options = {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_E2E_DISABLE_GPU: '1',
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  };
  if (executablePath) options.executablePath = executablePath;
  else options.args = [root];
  currentLog = { stdout: '', stderr: '' };
  app = await electron.launch(options);
  app.process()?.stdout?.on?.('data', bytes => { currentLog.stdout += String(bytes); });
  app.process()?.stderr?.on?.('data', bytes => { currentLog.stderr += String(bytes); });
  win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.message}`));
  win.on('console', message => { if (message.type() === 'error' && !/Autofill|favicon/i.test(message.text())) runtimeErrors.push(`[console] ${message.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => (
    document.documentElement.dataset.appReady === '1'
    && !!window.MazzCommands
    && !!window.MazzShell
    && !!window.mazz
  ), null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
  });
  for (let index = 0; index < 20; index++) {
    const visible = await win.evaluate(() => ({
      accept: !!document.querySelector('#agree-accept')?.offsetParent,
      masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.offsetParent).length,
    }));
    if (visible.accept) await win.click('#agree-accept').catch(() => {});
    else if (visible.masks) await win.keyboard.press('Escape');
    else break;
    await win.waitForTimeout(100);
  }
  return await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
}

async function closeApp() {
  if (!app) return;
  const log = currentLog || { stdout: '', stderr: '' };
  await app.close().catch(() => {});
  // Shutdown is part of the release gate.  Give the child streams one bounded
  // turn to deliver close/dispose failures before the caller may publish PASS.
  await new Promise(resolve => setTimeout(resolve, 300));
  const fatal = `${log.stdout}\n${log.stderr}`.split(/\r?\n/).filter(line => /uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|\[main\].*Error|\[file-watcher\].*(?:degraded|fatal)/i.test(line) && !/Debugger listening|inspector/i.test(line));
  runtimeErrors.push(...fatal.map(line => `[main] ${line.trim()}`));
  app = null;
  win = null;
}

async function panelWindow() {
  return await waitFor(() => Promise.resolve(app.windows().find(page => /panels[\\/]factorycfg\.html/i.test(page.url())) || null), '立项面板未打开', 15000);
}

async function setPanelBounds(width, height) {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const target = BrowserWindow.getAllWindows().find(window => /factorycfg\.html/i.test(window.webContents.getURL()));
    if (!target) throw new Error('factorycfg window missing');
    const current = target.getBounds();
    target.setBounds({ x: current.x, y: current.y, width: bounds.width, height: bounds.height });
  }, { width, height });
}

async function saveLoopbackProvider(model) {
  await win.evaluate(async ({ endpoint, model: providerModel }) => {
    const provider = await import('./modules/factory/provider.js');
    await provider.saveProviderConfig({
      providerId: 'custom', name: 'W92 本机闭环', baseURL: endpoint,
      model: providerModel, models: ['w92-complete', 'w92-length'], apiKey: 'loopback-only', makeDefault: true,
    });
    // The FactoryPanel is a long-lived owner and may already have loaded its
    // provider snapshot. Use the same product notification emitted by the
    // provider settings workflow so the next receipt is created with the new
    // connection instead of a stale in-memory config.
    await window.mazz.invoke('panel:action', { type: 'factoryProviderSaved' });
  }, { endpoint: baseURL, model });
}

async function openProjectPanel() {
  await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'factorycfg' }));
  const panel = await panelWindow();
  panel.on('pageerror', error => runtimeErrors.push(`[factorycfg pageerror] ${error.message}`));
  panel.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`[factorycfg console] ${message.text()}`); });
  await panel.waitForSelector('#panel-head', { timeout: 15000 });
  if (!(await panel.locator('#pj-form').count())) {
    await panel.locator('[data-t="project"]').first().click();
  }
  await panel.waitForSelector('#pj-form', { timeout: 20000 });
  return panel;
}

async function validateProjectUi(panel) {
  // The positive production run is a novel. Select it before asserting the
  // narrative length-plan contract; the initial built-in genre is 公文 and its
  // short-form `length` field has a different, valid meaning.
  await panel.locator('#pj-genre').selectOption('xiaoshuo');
  await waitFor(async () => panel.evaluate(() => (
    document.querySelector('#pj-genre')?.value === 'xiaoshuo'
    && !document.querySelector('[data-p-field="length"]')
  )), '小说模板未切换到唯一篇幅方案', 10000);
  const structure = await panel.evaluate(() => {
    const settings = document.querySelector('#head-provider');
    const style = settings ? getComputedStyle(settings) : null;
    const header = document.querySelector('#panel-head')?.getBoundingClientRect();
    const settingRect = settings?.getBoundingClientRect();
    const staleFields = [...document.querySelectorAll('[data-p-field]')]
      .filter(node => ['length', '篇幅长短', '每章字数'].includes(node.dataset.pField))
      .map(node => ({ id: node.dataset.pField, label: node.labels?.[0]?.textContent || '', html: node.outerHTML.slice(0, 240) }));
    return {
      title: document.querySelector('.head-title')?.textContent || '',
      settingBorder: style ? [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth] : [],
      settingRightAligned: !!header && !!settingRect && settingRect.left > header.left + header.width / 2,
      presetCount: document.querySelectorAll('[data-preset]').length,
      totalValue: document.querySelector('#pj-total')?.value || '',
      wordsValue: document.querySelector('#pj-words')?.value || '',
      staleFields,
      labels: document.querySelectorAll('#pj-form label[for]').length,
      required: document.querySelectorAll('#pj-form [required][aria-required=true]').length,
      chapterTag: document.querySelector('#pj-chapters')?.tagName || '',
    };
  });
  assert(structure.title === '新项目立项', `立项标题错误：${structure.title}`);
  assert(structure.settingBorder.some(value => parseFloat(value) > 0), 'AI 服务设置仍无边框');
  assert(structure.settingRightAligned, 'AI 服务设置没有移到标题右侧操作区');
  assert(structure.presetCount === 0, '新项目仍预填短/中/长/无限篇幅档位');
  assert(structure.totalValue === '' && structure.wordsValue === '', '新项目仍预填参考字数');
  assert(structure.staleFields.length === 0, `旧篇幅字段仍与权威方案竞争：${JSON.stringify(structure.staleFields)}`);
  assert(structure.labels >= 8 && structure.required >= 3 && structure.chapterTag === 'OUTPUT', '表单 label/required/output 语义不完整');

  await setPanelBounds(480, 360);
  await panel.waitForTimeout(250);
  const compact = await panel.evaluate(() => {
    const cta = document.querySelector('#pj-generate')?.getBoundingClientRect();
    const body = document.documentElement;
    const main = document.querySelector('#m');
    return {
      ctaVisible: !!cta && cta.bottom <= innerHeight + 1 && cta.top >= 0,
      overflowX: Math.max(body.scrollWidth, main?.scrollWidth || 0) - innerWidth,
      headerHeight: document.querySelector('#panel-head')?.getBoundingClientRect().height || 0,
    };
  });
  assert(compact.ctaVisible, '480×360 时“立刻开工”不在可达 sticky 操作区');
  assert(compact.overflowX <= 1, `480×360 出现水平溢出 ${compact.overflowX}px`);
  assert(compact.headerHeight < 120, `窄窗标题区过高：${compact.headerHeight}px`);
  await setPanelBounds(920, 720);
  await panel.waitForTimeout(250);
}

async function fillProject(panel, title, { maxMode }) {
  await panel.selectOption('#pj-genre', 'xiaoshuo');
  await panel.waitForTimeout(250);
  const fillField = async (name, value) => {
    const locator = panel.locator(`[data-p-field="${name}"]`);
    assert(await locator.count(), `缺立项字段 ${name}`);
    await locator.fill(value);
  };
  await fillField('premise', '归航员必须依据公开记录穿过雾带，否则港口会失去最后一条安全航线。');
  await fillField('书名', title);
  await fillField('价值取向', '共同事实必须可复验，任何角色都不能绕过验收。');
  await fillField('作品类型', '科幻');
  await fillField('protagonist', '林澈，归航员，克制并坚持保留原始记录');
  await panel.fill('#pj-total', '2000');
  await panel.dispatchEvent('#pj-total', 'input');
  await panel.fill('#pj-words', '2000');
  await panel.dispatchEvent('#pj-words', 'input');
  const chapterText = await panel.textContent('#pj-chapters');
  assert(/^约\s*1章$/.test(String(chapterText).trim()), `参考规划预览错误：${chapterText}`);
  if (maxMode) await panel.check('#pj-max');
  else await panel.uncheck('#pj-max');
  await panel.locator('details.advanced').evaluate(node => { node.open = true; });
  await panel.uncheck('#pj-autopreview');
  await panel.selectOption('#pj-review-ritual', 'light');
}

async function submitAndReceipt(panel, title) {
  await panel.click('#pj-generate');
  await panel.waitForFunction(() => document.querySelector('#pj-form')?.getAttribute('aria-busy') === 'true', null, { timeout: 5000 }).catch(() => {});
  const task = await waitFor(async () => {
    const rows = await win.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]'); } catch { return []; }
    });
    return rows.find(row => row.label === title && row.folder && row.receiptAt) || null;
  }, `任务 ${title} 未在业务回执前写入注册表`, 20000);
  await waitFor(() => Promise.resolve(!app.windows().some(page => /factorycfg\.html/i.test(page.url()))), '业务成功后立项窗未关闭', 10000);
  return task;
}

function taskState(folder) {
  const file = path.join(folder, '任务状态.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listDeep(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  const out = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else out.push(target);
    }
  };
  walk(folder);
  return out;
}

let baseline = null;
let positiveTask = null;
let interruptedTask = null;
let positiveFiles = [];
let interruptedFiles = [];
let restartTaskIds = [];
let initialWatcherHealth = null;
let beforeRestartWatcherHealth = null;
let restartWatcherHealth = null;
let finalWatcherHealth = null;

try {
  baseline = await launch();
  initialWatcherHealth = assertHealthyFileWatcher(baseline, '首次启动');
  await saveLoopbackProvider('w92-complete');
  const panel = await openProjectPanel();
  await validateProjectUi(panel);
  await fillProject(panel, 'W92真实闭环', { maxMode: true });
  positiveTask = await submitAndReceipt(panel, 'W92真实闭环');
  assert(positiveTask.mode === 'max' && Number(positiveTask.maxChapters) === 0, `连写任务仍把参考字数换算为执行终点：${JSON.stringify({ mode: positiveTask.mode, maxChapters: positiveTask.maxChapters })}`);
  assert(Number(positiveTask.totalWords) === 2000 && Number(positiveTask.wordsPerUnit) === 2000, '可选参考字数未按参考值持久化');

  await waitFor(() => ['done', 'done-warn'].includes(taskState(positiveTask.folder)?.status), '正向项目未完成', 120000, 150);
  positiveFiles = listDeep(positiveTask.folder);
  const positiveNames = positiveFiles.map(file => path.basename(file));
  assert(positiveNames.includes('创作蓝图.md'), '正向链缺创作蓝图');
  assert(positiveNames.includes('章节大纲.md'), '正向链缺章节大纲');
  assert(positiveNames.includes('任务状态.json'), '正向链缺任务状态');
  assert(positiveNames.some(name => /^第0*1章-.*\.md$/i.test(name)), '正向链缺正式章节');
  assert(positiveNames.includes('工件清单.json') && positiveNames.includes('10-裁决书.md'), '智能创作专业流程工件未落盘');
  assert(!positiveNames.some(name => /\.checkpoint$/i.test(name)), '正向完成后仍遗留 checkpoint');
  const finalBody = fs.readFileSync(positiveFiles.find(file => /^第0*1章-.*\.md$/i.test(path.basename(file))), 'utf8');
  assert(!/\[本次续写字数：/.test(finalBody), '模型协议声明泄漏进正式正文');

  await win.evaluate(task => window.MazzCommands.execute('factory.openDesk', { taskId: task.id, folder: task.folder, title: `${task.label} · 智能创作台` }), positiveTask);
  await win.waitForSelector('.factory-desk', { timeout: 20000 });
  await win.waitForFunction(label => document.querySelector('.factory-desk .fd-task-select')?.textContent.includes(label), positiveTask.label, { timeout: 20000 });
  const desk = await win.evaluate(() => ({
    title: document.querySelector('.factory-desk .fd-brand b')?.textContent || '',
    process: document.querySelector('.factory-desk [data-flow-chain]')?.textContent || '',
    task: document.querySelector('.factory-desk .fd-task-select')?.textContent || '',
    empty: document.querySelector('.factory-desk .fd-empty')?.offsetParent != null,
  }));
  assert(desk.title === '智能创作台' && /自动校验.*节点验收.*交叉审校.*复核与仲裁.*人工最终审定/.test(desk.process), `创作台正式流程文案错误：${JSON.stringify(desk)}`);
  assert(desk.task.includes('W92真实闭环') && !desk.empty, '创作台未加载刚完成的真实项目');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await win.screenshot({ path: screenshotPath });

  await saveLoopbackProvider('w92-length');
  const interruptedPanel = await openProjectPanel();
  await fillProject(interruptedPanel, 'W92截断安全门', { maxMode: false });
  interruptedTask = await submitAndReceipt(interruptedPanel, 'W92截断安全门');
  assert(interruptedTask.mode === 'single' && Number(interruptedTask.maxChapters) === 0, '单篇任务仍携带固定章节终点');
  // The durable creation receipt is intentionally written as `paused` before
  // background ownership starts. Do not confuse that initial crash-safe receipt
  // with the terminal truncation result: the checkpoint is the commit boundary.
  await waitFor(() => {
    const status = taskState(interruptedTask.folder)?.status;
    const files = listDeep(interruptedTask.folder);
    return ['stopped', 'paused'].includes(status) && files.some(file => /\.checkpoint$/i.test(file));
  }, '截断项目未停在断点', 60000, 120);
  interruptedFiles = listDeep(interruptedTask.folder);
  const interruptedNames = interruptedFiles.map(file => path.basename(file));
  assert(interruptedNames.some(name => /\.checkpoint$/i.test(name)), 'finish_reason=length 未保留 checkpoint');
  assert(!interruptedNames.some(name => /^第0*1章-.*\.md$/i.test(name)), 'finish_reason=length 被伪装成正式章节');
  const checkpoint = fs.readFileSync(interruptedFiles.find(file => /\.checkpoint$/i.test(file)), 'utf8');
  assert(!/\[本次续写字数：/.test(checkpoint), '截断半稿被补造模型声明');

  const beforeRestart = await win.evaluate(() => JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]').filter(row => row.folder).map(row => row.id));
  const beforeResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  assert((beforeResources.byType?.['factory-ai-request'] || 0) === 0, '任务落定后仍有 Factory AI 请求 owner');
  assert((beforeResources.byType?.['factory-run-owner'] || 0) === 0, '任务落定后仍有 Factory run owner');
  beforeRestartWatcherHealth = assertHealthyFileWatcher(beforeResources, '任务落定');
  await closeApp();

  baseline = await launch();
  restartWatcherHealth = assertHealthyFileWatcher(baseline, '重启就绪');
  await win.evaluate(() => window.MazzCommands.execute('factory.openDesk'));
  await win.waitForSelector('.factory-desk', { timeout: 20000 });
  await win.waitForFunction(() => {
    const text = document.querySelector('.factory-desk .fd-task-select')?.textContent || '';
    return text.includes('W92真实闭环') && text.includes('W92截断安全门');
  }, null, { timeout: 30000 });
  restartTaskIds = await win.evaluate(() => JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]').filter(row => row.folder).map(row => row.id));
  assert(new Set(restartTaskIds).size === restartTaskIds.length, '重启磁盘合并制造重复任务');
  for (const id of beforeRestart) assert(restartTaskIds.includes(id), `重启后丢失任务 ${id}`);

  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  assert((finalResources.byType?.['factory-ai-request'] || 0) === 0, '重启恢复后出现幽灵 Factory AI 请求 owner');
  assert((finalResources.byType?.['factory-run-owner'] || 0) === 0, '重启恢复后出现幽灵 Factory run owner');
  finalWatcherHealth = assertHealthyFileWatcher(finalResources, '重启恢复完成');
  await closeApp();
  assert(runtimeErrors.length === 0, `运行时异常：${runtimeErrors.join(' | ')}`);

  const callPhases = [...new Set(state.calls.map(call => call.phase))];
  for (const phase of ['BLUEPRINT', 'CHAPTER', 'POINT', 'REVIEW']) assert(callPhases.includes(phase), `真实 OpenAI-compatible 链未执行 ${phase}`);
  assert(!callPhases.includes('FINAL'), '四闸全开且无仲裁事项时不应调用流程仲裁席');
  const artifacts = collectW92Artifacts({ root, executablePath, screenshotPath });
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    coordinate,
    runLabel,
    runtime: executablePath ? path.relative(root, executablePath).replace(/\\/g, '/') : 'electron-source',
    network: { transport: 'real-loopback-openai-compatible-http', host: '127.0.0.1', productMockFlagUsed: false },
    ui: { projectHeader: true, borderedSettingsAction: true, compact480x360: true, canonicalLengthPlan: true },
    positive: {
      taskId: positiveTask.id,
      folderName: path.basename(positiveTask.folder),
      finalStatus: taskState(positiveTask.folder)?.status,
      fileCount: positiveFiles.length,
      professionalWorkflowArtifacts: positiveFiles.filter(file => /工件|裁决|审理|质询|答辩|机检|对点/.test(path.basename(file))).length,
      deskVisible: true,
    },
    interrupted: {
      taskId: interruptedTask.id,
      folderName: path.basename(interruptedTask.folder),
      finalStatus: taskState(interruptedTask.folder)?.status,
      checkpointCount: interruptedFiles.filter(file => /\.checkpoint$/i.test(file)).length,
      finalChapterCount: interruptedFiles.filter(file => /^第0*1章-.*\.md$/i.test(path.basename(file))).length,
      forgedDeclaration: false,
    },
    restart: { taskIdsBefore: beforeRestart, taskIdsAfter: restartTaskIds, duplicates: 0 },
    watcherHealth: {
      initial: initialWatcherHealth,
      beforeRestart: beforeRestartWatcherHealth,
      afterRestart: restartWatcherHealth,
      final: finalWatcherHealth,
    },
    providerCalls: { count: state.calls.length, phases: callPhases, models: [...new Set(state.calls.map(call => call.model))] },
    runtimeErrors,
    screenshot: path.relative(root, screenshotPath).replace(/\\/g, '/'),
    artifacts,
    bundleSha256: artifacts.sourceBundle?.sha256 || null,
    executableSha256: artifacts.executable?.sha256 || null,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await closeApp().catch(() => {});
  for (const socket of state.sockets) socket.destroy();
  await new Promise(resolve => server.close(() => resolve())).catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
