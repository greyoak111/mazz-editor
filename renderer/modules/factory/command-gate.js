// renderer/modules/factory/command-gate.js —— W68c 指令闸、终审卡与健康看板纯内核
// 不碰 DOM/文件系统；Factory Desk 与契约测试共用同一套确定性规则。

export const FACTORY_COMMAND_FAMILIES = Object.freeze(['production', 'legislation', 'quality', 'chat']);
export const FACTORY_COMMAND_LABELS = Object.freeze({
  production: '生产', legislation: '立法', quality: '质检', chat: '闲聊', ambiguous: '待澄清',
});

const FAMILY_PATTERNS = Object.freeze({
  production: [/(?:写|续写|重写|改写|扩写|生成|开工|重来|返工|继续|补写|出稿|做完|落稿)/g, /第\s*[一二三四五六七八九十百千万\d]+\s*(?:章|节|幕|单元).*(?:写|来|做|重)/g],
  legislation: [/(?:以后|今后|从此|一律|统一|规定|立规|设定|圣经|锁定|命名|口径|不得|不许|必须|永远)/g, /(?:改成|定为|改作|记为).*(?:规则|设定|口径|名称|编制|体系)/g],
  quality: [/(?:质检|检查|审一审|审理|复核|核对|评价|评估|挑错|找错|咋样|怎么样|有问题|合格|校验|勘误|审稿)/g, /(?:这段|这章|这稿|正文|骨架).*(?:好不好|行不行|如何|怎样|问题)/g],
  chat: [/(?:^|[，。！？!?\s])(?:你好|您好|在吗|辛苦了|谢谢|多谢|早上好|下午好|晚上好|晚安|哈哈+|聊聊|陪我|别忙|休息)(?:$|[，。！？!?\s])/g, /^(?:hi|hello|thanks|thank you|ok|好的|收到|行|嗯+|哦+)\s*[!！。.]?$/i],
});

const countMatches = (text, rules) => rules.reduce((sum, rule) => {
  const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
  return sum + [...text.matchAll(new RegExp(rule.source, flags))].length;
}, 0);
const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const percent = (n, d) => d ? Math.round((n / d) * 100) : 0;
const unitKey = event => Number(event?.unitNo) || String(event?.id || 'public');

export function classifyFactoryInstruction(input, { forcedFamily = '' } = {}) {
  const text = clean(input);
  if (FACTORY_COMMAND_FAMILIES.includes(forcedFamily)) {
    return { family: forcedFamily, ambiguous: false, options: [], scores: {}, reason: '人工澄清已指定', text };
  }
  if (!text) return { family: 'ambiguous', ambiguous: true, options: ['production', 'quality'], scores: {}, reason: '空指令不能猜', text };
  const scores = Object.fromEntries(FACTORY_COMMAND_FAMILIES.map(family => [family, countMatches(text, FAMILY_PATTERNS[family])]));
  const ranked = FACTORY_COMMAND_FAMILIES.map(family => ({ family, score: scores[family] })).sort((a, b) => b.score - a.score || FACTORY_COMMAND_FAMILIES.indexOf(a.family) - FACTORY_COMMAND_FAMILIES.indexOf(b.family));
  const top = ranked[0];
  const tied = ranked.filter(row => row.score === top.score && row.score > 0);
  if (tied.length === 1) return { family: top.family, ambiguous: false, options: [], scores, reason: `${FACTORY_COMMAND_LABELS[top.family]}特征命中 ${top.score}`, text };
  if (tied.length > 1) return { family: 'ambiguous', ambiguous: true, options: tied.slice(0, 2).map(row => row.family), scores, reason: '多族信号冲突，必须由人二选一', text };
  // 只有明确社交短句才自动归闲聊；其余无动词短句不擅自开工。
  if (/^[\p{L}\p{N}\s，。！？!?、,.]{1,12}$/u.test(text) && /[吗呢吧呀啊哦哈谢好]/.test(text)) {
    return { family: 'chat', ambiguous: false, options: [], scores, reason: '短社交句', text };
  }
  const hasUnit = /第\s*[一二三四五六七八九十百千万\d]+\s*(?:章|节|幕|单元)|(?:这段|这章|这稿)/.test(text);
  return { family: 'ambiguous', ambiguous: true, options: hasUnit ? ['production', 'quality'] : ['production', 'chat'], scores, reason: '缺少可执行动词，必须反问', text };
}

export function buildLockedBibleProposal(before = '', instruction = '', { at = new Date().toISOString() } = {}) {
  const oldText = clean(before) || '# 圣经';
  const rule = clean(instruction).replace(/[。；;]+$/, '');
  const heading = '## 指令闸确认变更';
  const row = `- ${rule}｜确认时间：${at}`;
  const after = oldText.includes(heading) ? `${oldText}\n${row}\n` : `${oldText}\n\n${heading}\n\n${row}\n`;
  return { before: `${oldText}\n`, after, instruction: rule, heading };
}

export function buildLineDiff(before = '', after = '', { filename = '圣经.md' } = {}) {
  const left = String(before).replace(/\r/g, '').split('\n');
  const right = String(after).replace(/\r/g, '').split('\n');
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let li = left.length - 1, ri = right.length - 1;
  while (li >= start && ri >= start && left[li] === right[ri]) { li--; ri--; }
  const removed = left.slice(start, li + 1).map(line => `- ${line}`);
  const added = right.slice(start, ri + 1).map(line => `+ ${line}`);
  return [`--- a/${filename}`, `+++ b/${filename}`, `@@ 第 ${start + 1} 行 @@`, ...removed, ...added].join('\n');
}

export function makeClarificationCard(input, options = ['production', 'quality']) {
  const safe = [...new Set(options)].filter(x => FACTORY_COMMAND_FAMILIES.includes(x)).slice(0, 2);
  while (safe.length < 2) safe.push(safe.includes('production') ? 'chat' : 'production');
  return { kind: 'clarify', original: clean(input), options: safe.map(id => ({ id, label: FACTORY_COMMAND_LABELS[id] })) };
}

export function makeDiffConfirmationCard({ targetPath = '', before = '', after = '', instruction = '' } = {}) {
  return { kind: 'diff-confirm', targetPath, before: String(before), after: String(after), instruction: clean(instruction), diff: buildLineDiff(before, after, { filename: targetPath.split(/[\\/]/).pop() || '圣经.md' }) };
}

export function makeFinalReviewCard({ unitNo = 0, unitName = '单元', targetPath = '', targetPrefix = '', draftPath = '', reviewPath = '', machinePath = '', artifactDir = '', eventDay = false } = {}) {
  return { kind: 'final-review', unitNo: Number(unitNo) || 0, unitName: String(unitName || '单元'), targetPath, targetPrefix, draftPath, reviewPath, machinePath, artifactDir, eventDay: !!eventDay, actions: ['seal', 'return', 'hold'] };
}

export function evaluateBudgetCap({ capTokens = 0, usedTokens = 0, requestedRitual = 'light' } = {}) {
  const cap = Math.max(0, Number(capTokens) || 0);
  const used = Math.max(0, Number(usedTokens) || 0);
  const remaining = Math.max(0, cap - used);
  return {
    status: 'ok', label: '厂商计量', capTokens: cap, usedTokens: used, remainingTokens: remaining,
    actions: [], reason: '', requestedRitual: requestedRitual === 'full' ? 'full' : 'light',
    enforcement: 'provider-native',
  };
}

export function makeBudgetCard(budget = {}) {
  const state = evaluateBudgetCap(budget);
  return { kind: 'budget', ...state, requestedRitual: budget.requestedRitual === 'full' ? 'full' : 'light' };
}

export const HUMAN_HELP_MOMENTS = Object.freeze({
  nonconvergent: '三轮不收敛', hearingConflict: '开庭互矛盾', redBlindspot: '红队系统性盲区',
});

export function detectHumanHelpMoments(result = {}) {
  const moments = [];
  const machineRounds = Array.isArray(result.machineHistory) ? result.machineHistory.length : 0;
  const repairs = Array.isArray(result.repairs) ? result.repairs.length : 0;
  if ((machineRounds >= 3 || repairs >= 3) && !result.machine?.pass) moments.push({ id: 'nonconvergent', label: HUMAN_HELP_MOMENTS.nonconvergent, reason: `机检 ${machineRounds} 轮、修订 ${repairs} 轮仍未闭合` });
  const hearings = (result.objections || []).filter(x => x?.hearing);
  if (hearings.length) moments.push({ id: 'hearingConflict', label: HUMAN_HELP_MOMENTS.hearingConflict, reason: `${hearings.length} 条质询经两轮答辩仍需开庭，请人工关注裁决升级` });
  const quietReviews = (result.reviews || []).length > 0 && (result.objections || []).length === 0;
  if (quietReviews && (!result.gates?.machine || !result.gates?.point)) moments.push({ id: 'redBlindspot', label: HUMAN_HELP_MOMENTS.redBlindspot, reason: '红队零质询，但机检或对点仍发现阻断项' });
  return moments;
}

export const FACTORY_HEALTH_METRICS = Object.freeze([
  { id: 'machineReturnRate', label: '机检打回率', target: '逐周下降但不归零', better: 'down' },
  { id: 'reviewReturnRate', label: '审理打回率', target: '低于机检且不归零', better: 'down' },
  { id: 'hearingRate', label: '开庭率', target: '<5%', better: 'down' },
  { id: 'revisionFirstPassRate', label: '修订一次通过率', target: '逐周上升', better: 'up' },
  { id: 'queryEffectivenessRate', label: '质询有效率', target: '防乱质询', better: 'up' },
  { id: 'evidenceWithdrawalRate', label: '撤回引据率', target: '防客套死', better: 'up' },
  { id: 'humanInterventionCount', label: '人类介入频次', target: '仅终审与升级', better: 'down', unit: '次' },
]);

function healthSnapshot(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const reviewed = new Set(rows.filter(e => ['review', 'verdict'].includes(e.type)).map(unitKey));
  const machine = new Set(rows.filter(e => e.stage === 'machine').map(unitKey));
  const machineReturns = new Set(rows.filter(e => e.stage === 'machine' && /(?:未通过|打回|阻断|critical|fail)/i.test(e.content || '')).map(unitKey));
  const reviewReturns = new Set(rows.filter(e => e.stage === 'repair' || e.tone === 'disagreement').map(unitKey));
  const hearings = new Set(rows.filter(e => e.stage === 'hearing').map(unitKey));
  const objections = rows.filter(e => e.stage === 'objection' || e.tone === 'disagreement');
  const effective = objections.filter(e => !/(?:无效|驳回质询|overrule)/i.test(e.content || ''));
  const answers = rows.filter(e => e.stage === 'answer' || e.tone === 'evidence');
  const withdrawals = answers.filter(e => /(?:撤回|withdraw)/i.test(e.content || '') && /(?:证据|引据|来源|artifact|evidence)/i.test(e.content || ''));
  const revised = new Set(rows.filter(e => e.stage === 'repair').map(unitKey));
  const repairCounts = rows.filter(e => e.stage === 'repair').reduce((map, e) => map.set(unitKey(e), (map.get(unitKey(e)) || 0) + 1), new Map());
  const repeatedRepair = [...repairCounts.values()].filter(count => count > 1).length;
  const human = rows.filter(e => ['final-human', 'help-decision', 'upgrade-human'].includes(e.stage)).length;
  return {
    machineReturnRate: percent(machineReturns.size, machine.size || reviewed.size),
    reviewReturnRate: percent(reviewReturns.size, reviewed.size),
    hearingRate: percent(hearings.size, reviewed.size),
    revisionFirstPassRate: revised.size ? Math.max(0, 100 - percent(repeatedRepair, revised.size)) : (reviewed.size ? 100 : 0),
    queryEffectivenessRate: percent(effective.length, objections.length),
    evidenceWithdrawalRate: percent(withdrawals.length, answers.length),
    humanInterventionCount: human,
  };
}

export function computeFactoryHealth(events = [], { now = Date.now() } = {}) {
  const currentStart = now - 7 * 86400000;
  const previousStart = now - 14 * 86400000;
  const time = row => Number.isFinite(Date.parse(row?.createdAt)) ? Date.parse(row.createdAt) : now;
  const currentRows = (events || []).filter(row => time(row) >= currentStart);
  const previousRows = (events || []).filter(row => time(row) >= previousStart && time(row) < currentStart);
  const current = healthSnapshot(currentRows);
  const previous = healthSnapshot(previousRows);
  return FACTORY_HEALTH_METRICS.map(metric => {
    const value = current[metric.id] || 0;
    const old = previous[metric.id] || 0;
    const delta = value - old;
    const trend = !previousRows.length || delta === 0 ? 'flat' : ((metric.better === 'up' ? delta > 0 : delta < 0) ? 'good' : 'bad');
    return { ...metric, value, previous: old, delta, trend, display: metric.unit === '次' ? `${value} 次` : `${value}%` };
  });
}
