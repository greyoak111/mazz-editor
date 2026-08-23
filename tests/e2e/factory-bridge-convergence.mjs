import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-factory-bridge-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-factory-bridge-ws-'));
const sourcePath = path.join(workspace, '跨模块材料.md');
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'FACTORY_BRIDGE_RUNTIME.json');
const screenshotPath = path.join(root, 'docs', 'engineering', 'evidence', 'FACTORY_BRIDGE_RUNTIME.png');
fs.writeFileSync(sourcePath, '# 跨模块材料\n\n这是由全局命令送入智能创作的事实材料。\n', 'utf8');
let app;

try {
  app = await electron.launch({
    args: [root], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace, MAZZ_GPU_MODE: 'safe' },
  });
  const mainLogs = [];
  const mainProcess = app.process();
  mainProcess.stdout?.on('data', chunk => mainLogs.push({ stream: 'stdout', text: String(chunk) }));
  mainProcess.stderr?.on('data', chunk => mainLogs.push({ stream: 'stderr', text: String(chunk) }));
  const page = await app.firstWindow({ timeout: 120000 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  await page.waitForFunction(() => !!window.MazzShell?.sideDock?.factoryPanel && !!window.MazzCommands, null, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' });
  });

  const seeded = await page.evaluate(async () => {
    const fp = window.MazzShell.sideDock.factoryPanel;
    const ws = String(await window.mazz.invoke('workspace:get')).replace(/\\/g, '/').replace(/\/$/, '');
    const folder = `${ws}/Output/FactoryBridge`;
    const artifactPath = `${folder}/正文.md`;
    const task = { id: 'factory-bridge-e2e', label: 'Factory 桥接实证', folder, genreId: 'tongyong', values: {}, status: 'done', mode: 'single', reviewProtocol: 'W68a', reviewState: { finalStatus: 'sealed' }, finalDecision: 'sealed' };
    fp.tasks = fp.tasks.filter(row => row.id !== task.id).concat(task); fp.persistTasks();
    await window.mazz.invoke('fs:mkdir', { path: folder });
    await window.mazz.invoke('fs:writeFile', { path: artifactPath, content: '# 正文\n\n已入库文本。\n' });
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/圣经.md`, content: '# 圣经\n\n- 旧口径\n' });
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/判例库.md`, content: '# 判例库\n' });
    const observedAt = new Date().toISOString();
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/成本台账.json`, content: JSON.stringify({
      protocol: 'W68a',
      units: [{
        unitNo: 1, at: observedAt,
        budget: {
          capTokens: null, usedTokens: 100, remainingTokens: null, source: 'provider-reported', enforced: false,
          entries: [{ seat: 'M1', phase: 'draft', tokens: 100, inputTokens: 60, outputTokens: 40, source: 'provider-reported', at: observedAt }],
        },
      }],
      usageRecords: [],
    }, null, 2) });
    const { normalizeFactoryEvent } = await import('./modules/factory/workshop.js');
    await fp.appendWorkshop(task, normalizeFactoryEvent({ id: 'factory-bridge-artifact', type: 'body', title: '入库正文', content: '供拖拽和看板钻取的真实工件。', stage: 'draft', artifactPath }));
    await window.MazzCommands.execute('factory.openDesk', { taskId: task.id, folder, title: 'Factory 桥接实证' });
    return { folder, artifactPath, taskId: task.id };
  });
  await page.waitForSelector('.factory-desk .fd-artifact[draggable=true]', { timeout: 30000 });

  const feed = await page.evaluate(async sourcePath => {
    await window.MazzCommands.execute('factory.feedActiveAsset', { path: sourcePath.replace(/\\/g, '/') });
    const fp = window.MazzShell.sideDock.factoryPanel;
    const row = fp.embeds.find(item => item.sourcePath === sourcePath.replace(/\\/g, '/'));
    return { found: !!row, automaticStart: row?.feedEnvelope?.automaticStart, executionAuthorized: row?.feedEnvelope?.executionAuthorized };
  }, sourcePath);

  const revision = await page.evaluate(async ({ taskId, artifactPath, folder }) => {
    const fp = window.MazzShell.sideDock.factoryPanel;
    const saved = await fp.saveTaskEditor(taskId, artifactPath, '# 正文\n\n人工修订后的入库文本。\n', taskId);
    const ledger = await window.mazz.invoke('fs:readFile', { path: `${folder}/工件修订台账.ndjson` });
    const task = fp.tasks.find(row => row.id === taskId);
    const archive = await window.mazz.invoke('fs:readFile', { path: `${folder}/工厂群.md` });
    return { saved, records: ledger.trim().split('\n').length, reviewStatus: task.reviewState?.finalStatus, flowHasDiff: archive.includes('等待重审') && archive.includes('diff') };
  }, seeded);

  const conflict = await page.evaluate(async ({ folder }) => {
    const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
    await ctl.processInstruction('以后术语一律统一');
    const pending = [...ctl.events].reverse().find(row => row.card?.kind === 'diff-confirm');
    await window.mazz.invoke('fs:writeFile', { path: `${folder}/圣经.md`, content: '# 圣经\n\n- 人工新口径\n' });
    await ctl.performCardAction(pending.id, 'diff:confirm');
    const conflictCard = [...ctl.events].reverse().find(row => row.card?.kind === 'bible-conflict');
    await ctl.performCardAction(conflictCard.id, 'conflict:human');
    const text = await window.mazz.invoke('fs:readFile', { path: `${folder}/圣经.md` });
    return { conflictCard: !!conflictCard, humanPreserved: text.includes('人工新口径'), aiWritten: text.includes('指令闸确认变更') };
  }, seeded);

  const mobile = await page.evaluate(async ({ folder }) => {
    const ctl = window.MazzModulesReal.get('factorydesk')._forTests.instances.values().next().value;
    await ctl.processInstruction('以后角色称谓必须统一');
    document.querySelector('[data-a=mobile]').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    return JSON.parse(await window.mazz.invoke('fs:readFile', { path: `${folder}/手机审批包.json` }));
  }, seeded);

  const dragged = await page.evaluate(async ({ artifactPath }) => {
    const { createArtifactLiveReference, FACTORY_LIVE_REF_MIME } = await import('./modules/factory/bridge-runtime.js');
    const ref = createArtifactLiveReference({ artifactPath, eventId: 'factory-bridge-artifact' });
    window.MazzShell.openTab('markdown', { title: '引用接收.md', content: '# 引用接收\n\n' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const editor = document.querySelector('.module-view:not([style*="display: none"]) .ProseMirror') || document.querySelector('.ProseMirror');
    const rect = editor.getBoundingClientRect();
    const dataTransfer = new DataTransfer(); dataTransfer.setData(FACTORY_LIVE_REF_MIME, ref.syntax);
    editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + 30, clientY: rect.top + 30 }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { text: editor.textContent, syntax: ref.syntax };
  }, seeded);

  const dashboard = await page.evaluate(async ({ taskId, folder }) => {
    await window.MazzCommands.execute('factory.openDesk', { taskId, folder, title: 'Factory 桥接看板' });
    await new Promise(resolve => setTimeout(resolve, 300));
    document.querySelector('.factory-desk [data-a=health]').click();
    const metrics = [...document.querySelectorAll('.factory-desk [data-drill-path]')];
    metrics[0]?.click();
    document.querySelector('.factory-desk [data-a=economics]').click();
    return { metrics: metrics.length, preview: document.querySelector('.factory-desk .fd-preview')?.textContent || '', economics: [...document.querySelectorAll('.modal-title,.mz-modal-title')].some(node => /成本对账/.test(node.textContent || '')) || document.body.textContent.includes('Factory 成本对账') };
  }, seeded);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const mainFatalLogs = mainLogs.filter(row => /uncaught|unhandled|typeerror|referenceerror|fatal error/i.test(row.text));

  const result = {
    schema: 'mazz.factory-bridge-runtime-evidence/v0', ok: true, feed, revision, conflict,
    mobile: { schema: mobile.schema, kind: mobile.kind, clientGate: mobile.clientGate, fieldClientAvailable: mobile.fieldClientAvailable, executionAuthorized: mobile.executionAuthorized },
    dragged: { inserted: dragged.text.includes(dragged.syntax), syntax: dragged.syntax }, dashboard, pageErrors: errors,
    mainProcess: { stdoutChunks: mainLogs.filter(row => row.stream === 'stdout').length, stderrChunks: mainLogs.filter(row => row.stream === 'stderr').length, fatalLogs: mainFatalLogs.map(row => row.text.trim()).filter(Boolean) },
    screenshot: path.relative(root, screenshotPath).replace(/\\/g, '/'),
  };
  if (!feed.found || feed.automaticStart !== false || feed.executionAuthorized !== false) throw new Error(`随处投喂越权或未接线: ${JSON.stringify(feed)}`);
  if (!revision.saved || revision.records !== 1 || revision.reviewStatus !== 'RE_REVIEW_REQUIRED' || !revision.flowHasDiff) throw new Error(`工件双态/重审未落盘: ${JSON.stringify(revision)}`);
  if (!conflict.conflictCard || !conflict.humanPreserved || conflict.aiWritten) throw new Error(`设定集冲突裁决失败: ${JSON.stringify(conflict)}`);
  if (mobile.clientGate !== 'CONDITIONAL_MOBILE_CLIENT' || mobile.fieldClientAvailable !== false || mobile.executionAuthorized !== false) throw new Error('手机审批条件门不诚实');
  if (!result.dragged.inserted) throw new Error(`活引用拖拽未插入: ${JSON.stringify(result.dragged)}`);
  if (dashboard.metrics < 9 || !dashboard.preview || !dashboard.economics) throw new Error(`看板钻取/对账入口未接线: ${JSON.stringify(dashboard)}`);
  if (errors.length) throw new Error(`renderer pageerror: ${errors.join('\n')}`);
  if (mainFatalLogs.length) throw new Error(`main process fatal log: ${mainFatalLogs.map(row => row.text).join('\n')}`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, feed: true, revision: true, conflict: true, mobileGate: mobile.clientGate, liveReference: true, dashboardMetrics: dashboard.metrics, pageErrors: errors.length }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
