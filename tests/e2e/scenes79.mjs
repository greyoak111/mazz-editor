// W68a 六席双环：真人立项控件、正式生产链、工件族、开庭、判例复用与预算降级。
import fs from 'fs';
import path from 'path';

const read = p => fs.readFileSync(p, 'utf8');
const filesDeep = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(root, entry.name);
  return entry.isDirectory() ? filesDeep(target) : [target];
});

export async function scenes79({ app, win, human, scenario, shotDir }) {
  let projectRoot = '';

  await scenario('W68a 立项控件·轻/全仪式、预算帽与六席路由可见', async () => {
    await human.evaluate(async () => {
      const provider = await import('./modules/factory/provider.js');
      await provider.saveProviderConfig({ providerId: 'deepseek', name: 'W68 mock', baseURL: 'mock://w68a', model: 'w68a-six-seat', apiKey: 'w68-local-key' });
      window.MazzShell.sideDock.show();
      window.MazzShell.sideDock.showTab('factory');
      await window.MazzShell.sideDock.factoryPanel.reload();
    });
    await human.until(() => !!document.querySelector('[data-a=project]'), { timeout: 8000, msg: '车间立项入口' });
    await human.click('[data-a=project]');
    let panel = null;
    for (let i = 0; i < 50 && !panel; i++) {
      panel = app.windows().find(page => /factorycfg\.html/.test(page.url()));
      if (!panel) await win.waitForTimeout(100);
    }
    await human.assert(!!panel, '立项独立窗必须打开');
    await panel.waitForSelector('details.advanced', { timeout: 8000 });
    await panel.click('details.advanced summary');
    await panel.waitForSelector('#pj-review-ritual');
    const options = await panel.locator('#pj-review-ritual option').allTextContents();
    await human.assert(options.join('|') === '轻仪式|全仪式', '仪式级别必须明确轻/全两档');
    await panel.selectOption('#pj-review-ritual', 'full');
    await panel.waitForTimeout(250);
    if (!(await panel.locator('details.advanced').evaluate(node => node.open))) await panel.click('details.advanced summary');
    await panel.fill('#pj-review-budget', '40000');
    await panel.dispatchEvent('#pj-review-budget', 'change');
    const routeState = await human.evaluate(async () => {
      const { AI_ROLES } = await import('./modules/factory/provider.js');
      return AI_ROLES.filter(x => x.id.startsWith('factory_')).map(x => x.id);
    });
    for (const id of ['factory_skeleton', 'factory_writer', 'factory_point', 'factory_review_a', 'factory_review_b', 'factory_arbiter']) await human.assert(routeState.includes(id), `缺六席路由 ${id}`);
    await panel.screenshot({ path: path.join(shotDir, 'w68a-project-ritual-budget.png') });
    await human.evaluate(() => window.mazz.invoke('panel:close', { kind: 'factorycfg' }));
  });

  await scenario('W68a 单次生产真链·机检退回、请示改骨架、质询撤回与两轮开庭', async () => {
    const outcome = await human.evaluate(async () => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      fp.genre = fp.genres.find(x => x.id === 'xiaoshuo');
      fp.values = {
        书名: 'W68双环实证', 作品类型: '科幻', premise: '归航员依据证据穿越雾带并抵达终点。',
        protagonist: '林澈，归航员，坚持留下可复验记录', tone: '冷峻', pov: '第三人称限制', length: '1500字片段',
      };
      fp.renderForm();
      fp.dumpEl.value = '必须走完整六席流程；允许执笔席提出把终点改为星港的请示。';
      fp.el.querySelector('.fc-review-ritual').value = 'full';
      fp.el.querySelector('.fc-review-budget').value = '40000';
      const task = fp.makeTask(false, 1);
      fp.tasks.push(task); fp.persistTasks();
      await fp.runTask(task);
      return { status: task.status, folder: task.folder, review: task.reviewState };
    });
    await human.assert(outcome.status === 'done', `任务应封存完成，实际 ${outcome.status}`);
    await human.assert(outcome.review?.sealed && Object.values(outcome.review.gates || {}).every(Boolean), '四闸必须全开并封存');
    projectRoot = outcome.folder.replace(/\//g, path.sep);
    const all = filesDeep(projectRoot);
    const names = all.map(x => path.basename(x));
    for (const name of ['圣经.md', '判例库.md', '成本台账.json', '01-骨架与验收点.md', '02-扩写稿.md', '03-机检报告.md', '04-对点报告.md', '05-修订单.md', '06-请示单.md', '07-审理表.md', '08-质询单.md', '09-答辩书.md', '10-裁决书.md', '工件清单.json']) await human.assert(names.includes(name), `缺 W68a 工件 ${name}`);
    const one = suffix => all.find(x => x.endsWith(suffix));
    const machine = read(one('03-机检报告.md'));
    const consultation = read(one('06-请示单.md'));
    const answer = read(one('09-答辩书.md'));
    const objection = read(one('08-质询单.md'));
    const verdict = read(one('10-裁决书.md'));
    const bodyPath = all.find(x => /第001章-[^\\/]+\.md$/.test(x) && !x.includes(`${path.sep}工件${path.sep}`));
    const body = read(bodyPath);
    await human.assert(machine.includes('自我认证') && machine.includes('结论：退回') && machine.includes('结论：通过'), '机检工件必须保存退回→通过全史');
    await human.assert(consultation.includes('批准；先改骨架/圣经再动正文') && consultation.includes('星港'), '请示必须先改骨架/圣经');
    await human.assert(answer.includes('outcome') === false && answer.includes('withdraw') && answer.match(/hold/g)?.length >= 2, '撤回与两轮保留必须入答辩书');
    await human.assert(objection.includes('overruled') && verdict.includes('最终裁决：pass') && verdict.includes('封存：是'), '开庭与终审必须闭环');
    await human.assert(!body.includes('已通过所有校验') && body.includes('星港'), '正式正文只能是过闸修订稿');
    const bible = read(path.join(projectRoot, '圣经.md'));
    const precedent = read(path.join(projectRoot, '判例库.md'));
    const costs = JSON.parse(read(path.join(projectRoot, '成本台账.json')));
    await human.assert(bible.includes('终点＝星港') && precedent.includes('W68-R4'), '圣经与判例必须入库');
    await human.assert(costs.units[0].ritual.effective === 'full' && costs.totalTokens > 0, '成本必须按席位/单元归因');
  });

  await scenario('W68a 判例复用、预算降级与封存只读语义', async () => {
    const state = await human.evaluate(async () => {
      const fp = window.MazzShell.sideDock.factoryPanel;
      const task = fp.tasks.find(x => x.label === 'W68双环实证');
      const tpl = fp.genres.find(x => x.id === task.genreId);
      const text = `林澈再次启航并抵达星港。${'他逐项核对航海日志、信标记录与舷侧刻度，确认每个判断都有独立记录支撑。'.repeat(16)}`;
      const reused = await fp.runW68UnitReview(task, tpl, { blueprint: '- [必达] port::抵达星港::星港', outline: '第2章：判例复用', text, unitNo: 2, unitName: '章' });
      const { planReviewRitual } = await import('./modules/factory/review.js');
      return { transitions: reused.transitions, downgrade: planReviewRitual('full', 12000), stopped: planReviewRitual('light', 7999) };
    });
    await human.assert(state.transitions.includes('precedent:loaded'), '第二单元必须把既有判例回供审理席');
    await human.assert(state.downgrade.effective === 'light' && state.downgrade.downgraded, '全仪式预算不足应降为轻仪式');
    await human.assert(state.stopped.stopped, '低于轻仪式底线必须硬停');
    const manifests = filesDeep(projectRoot).filter(x => x.endsWith('工件清单.json')).map(read).map(JSON.parse);
    await human.assert(manifests.every(x => x.immutableAfterSeal && x.addendumRequiredForChanges), '封存原件必须只读，后续只能补遗');
    await human.evaluate(() => {
      const log = document.querySelector('.fc-logwrap'); log?.scrollIntoView({ block: 'center' });
    });
    await win.screenshot({ path: path.join(shotDir, 'w68a-double-loop-log.png') });
  });
}
