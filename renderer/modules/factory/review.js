// W68a 双环引擎：确定性机检、主环对点、外围审理、质询闭环与四闸落盘。
// 本文件只保存可复验规则与流程；文件系统落盘由 factory/index.js 负责。

export const W68_PROTOCOL = 'W68a';
export const REVIEW_RULES = Object.freeze({
  machineBeforePoint: 'W68-R1',
  noSelfCertification: 'W68-R2',
  reviewerDoesNotRewrite: 'W68-R3',
  locksAreGlobal: 'W68-R4',
  noConfidenceEscalation: 'W68-R5',
  quietForcesRedTeam: 'W68-R6',
  maxThreeMainRounds: 'W68-R7',
  citedObjections: 'W68-R8',
  evidenceAnswers: 'W68-R9',
  fourGates: 'W68-R10',
  sealedReadOnly: 'W68-R11',
  budgetHardGate: 'W68-R12',
});

export const REVIEW_ARTIFACT_NAMES = Object.freeze({
  skeleton: '01-骨架与验收点.md',
  draft: '02-扩写稿.md',
  polish: '02b-润色记录.md',
  machine: '03-机检报告.md',
  point: '04-对点报告.md',
  repair: '05-修订单.md',
  consultation: '06-请示单.md',
  review: '07-审理表.md',
  objection: '08-质询单.md',
  answer: '09-答辩书.md',
  verdict: '10-裁决书.md',
  manifest: '工件清单.json',
});

export const TLC_RULES = Object.freeze([
  { id: 'E1', label: '年份先后', layer: 'time', since: '2026-08-13' },
  { id: 'E2', label: '届次有效性', layer: 'term', since: '2026-08-13' },
  { id: 'E3', label: '历法日期', layer: 'calendar', since: '2026-08-13' },
  { id: 'E4', label: '月份与季节', layer: 'season', since: '2026-08-13' },
  { id: 'E5', label: '时区范围', layer: 'timezone', since: '2026-08-13' },
  { id: 'E6', label: '人物在任区间', layer: 'office', since: '2026-08-13' },
  { id: 'E7', label: '技术代际年份', layer: 'technology', since: '2026-08-13' },
  { id: 'E8', label: '制度任期区间', layer: 'institution', since: '2026-08-13' },
  { id: 'E9', label: '地理海拔范围', layer: 'geography', since: '2026-08-13' },
  { id: 'E10', label: '文档结构闭合', layer: 'document', since: '2026-08-13' },
  { id: 'E11', label: '公历干支匹配', layer: 'sexagenary', since: '2026-08-13' },
  { id: 'E12', label: '机构编号格式', layer: 'identifier', since: '2026-08-13' },
]);

const asText = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];
const slug = value => asText(value).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'item';
const escRx = value => asText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const line = (label, value) => `- ${label}：${asText(value) || '无'}`;

function parseMarkerBody(body) {
  const parts = asText(body).split('::').map(x => x.trim()).filter(Boolean);
  const id = parts.length > 1 ? slug(parts.shift()) : '';
  const label = parts.shift() || asText(body);
  const patterns = parts.join('::').split(/[|｜]/).map(x => x.trim()).filter(Boolean);
  return { id, label, patterns: patterns.length ? patterns : [label] };
}

/**
 * 从蓝图读取四类显式验收标记：
 * - [必达] id::事件/观点::证据词|同义词
 * - [必埋] id::伏笔::种子词
 * - [锁定] id::事实名=事实值::来源A|来源B::口径
 * - [禁越] id::边界::禁词A|禁词B
 */
export function buildAcceptanceSchema({ blueprint = '', outline = '', lockedFacts = [], forbidden = [] } = {}) {
  const schema = {
    version: 1,
    protocol: W68_PROTOCOL,
    requiredBeats: [],
    plantedSeeds: [],
    lockedFacts: [],
    forbiddenBoundaries: [],
    source: 'derived',
  };
  const rows = asText(blueprint).split(/\r?\n/);
  for (const row of rows) {
    const hit = row.match(/^\s*[-*]?\s*\[(必达|必埋|锁定|禁越)\]\s*(.+)$/);
    if (!hit) continue;
    schema.source = 'explicit';
    const kind = hit[1];
    const parsed = parseMarkerBody(hit[2]);
    const base = { id: parsed.id || `${kind}-${schema.requiredBeats.length + schema.plantedSeeds.length + schema.lockedFacts.length + schema.forbiddenBoundaries.length + 1}`, label: parsed.label, patterns: parsed.patterns, required: true };
    if (kind === '必达') schema.requiredBeats.push(base);
    if (kind === '必埋') schema.plantedSeeds.push(base);
    if (kind === '禁越') schema.forbiddenBoundaries.push(base);
    if (kind === '锁定') {
      const pair = parsed.label.match(/^(.+?)\s*[=＝]\s*(.+)$/);
      const tail = hit[2].split('::').map(x => x.trim());
      schema.lockedFacts.push({
        ...base,
        label: pair?.[1]?.trim() || parsed.label,
        value: pair?.[2]?.trim() || parsed.patterns[0] || '',
        sources: (tail[2] || '').split(/[|｜、]/).map(x => x.trim()).filter(Boolean),
        basis: tail[3] || '',
      });
    }
  }
  for (const fact of list(lockedFacts)) {
    if (!fact?.label || schema.lockedFacts.some(x => x.label === fact.label)) continue;
    schema.lockedFacts.push({ id: fact.id || `lock-${schema.lockedFacts.length + 1}`, label: fact.label, value: asText(fact.value), sources: list(fact.sources), basis: asText(fact.basis), required: true, patterns: [asText(fact.value)].filter(Boolean) });
  }
  for (const item of list(forbidden)) {
    const text = asText(item);
    if (text) schema.forbiddenBoundaries.push({ id: `ban-${schema.forbiddenBoundaries.length + 1}`, label: text, patterns: [text], required: true });
  }
  // 没有显式标记时只生成“提示性”当前单元锚，不拿整本蓝图误伤每个单元。
  if (!schema.requiredBeats.length && asText(outline)) {
    const label = asText(outline).replace(/^第[^：:]+[：:]\s*/, '');
    const keywords = label.match(/[\p{L}\p{N}]{2,8}/gu)?.slice(0, 5) || [];
    schema.requiredBeats.push({ id: 'outline-anchor', label, patterns: keywords.length ? keywords : [label], required: false });
  }
  return schema;
}

export function acceptanceSchemaMarkdown(schema) {
  const section = (title, rows, render) => `## ${title}\n\n${rows.length ? rows.map(render).join('\n') : '- 无'}`;
  return [
    '# 骨架与验收点',
    '',
    line('协议', schema?.protocol || W68_PROTOCOL),
    line('来源', schema?.source || 'derived'),
    '',
    section('必达事件 / 观点', list(schema?.requiredBeats), x => `- [${x.required === false ? '建议' : '必达'}] ${x.id}｜${x.label}｜证据词：${list(x.patterns).join(' / ') || '无'}`),
    '',
    section('必埋种子', list(schema?.plantedSeeds), x => `- [必埋] ${x.id}｜${x.label}｜种子词：${list(x.patterns).join(' / ') || '无'}`),
    '',
    section('锁定事实', list(schema?.lockedFacts), x => `- [锁定] ${x.id}｜${x.label}＝${x.value}｜来源：${list(x.sources).join(' / ') || '未登记'}｜口径：${x.basis || '未登记'}`),
    '',
    section('禁止越界', list(schema?.forbiddenBoundaries), x => `- [禁越] ${x.id}｜${x.label}｜触发词：${list(x.patterns).join(' / ') || '无'}`),
  ].join('\n');
}

function sentenceLengths(text) {
  return asText(text).split(/[。！？!?\n]+/).map(x => x.replace(/\s/g, '').length).filter(Boolean);
}

function deviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
}

export function styleFingerprint(text) {
  const raw = asText(text);
  const chars = raw.replace(/\s/g, '').length || 1;
  const paragraphs = raw.split(/\n\s*\n/).map(x => x.replace(/\s/g, '').length).filter(Boolean);
  const lengths = sentenceLengths(raw);
  const psychology = raw.match(/(?:觉得|感到|意识到|心想|内心|不由得|他想|她想)/g) || [];
  return {
    chars,
    sentenceCount: lengths.length,
    meanSentenceLength: +(lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0).toFixed(2),
    sentenceStdDev: +deviation(lengths).toFixed(2),
    meanParagraphLength: +(paragraphs.length ? paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length : 0).toFixed(2),
    semicolonPer10k: +(((raw.match(/[；;]/g) || []).length * 10000) / chars).toFixed(2),
    exclamationPer10k: +(((raw.match(/[！!]/g) || []).length * 10000) / chars).toFixed(2),
    psychologyPer10k: +((psychology.length * 10000) / chars).toFixed(2),
  };
}

const finding = (id, severity, message, artifactRef, ruleRef, extra = {}) => ({ id, severity, message, artifactRef, ruleRef, ...extra });

export function runTlcInspection(text) {
  const raw = asText(text);
  const findings = [];
  for (const hit of raw.matchAll(/(\d{3,4})\s*年?\s*(?:至|到|—|-|~|～)\s*(\d{3,4})\s*年/g)) {
    if (+hit[1] > +hit[2]) findings.push(finding(`tlc-e1-${hit.index}`, 'critical', `年份区间倒置：${hit[0]}`, 'draft', 'TLC-E1'));
  }
  for (const hit of raw.matchAll(/第\s*(-?\d+)\s*届/g)) {
    if (+hit[1] < 1) findings.push(finding(`tlc-e2-${hit.index}`, 'critical', `届次必须为正整数：${hit[0]}`, 'draft', 'TLC-E2'));
  }
  for (const hit of raw.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    const y = +hit[1], m = +hit[2], d = +hit[3];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) findings.push(finding(`tlc-e3-${hit.index}`, 'critical', `无效公历日期：${hit[0]}`, 'draft', 'TLC-E3'));
  }
  const seasons = { 春: [3, 4, 5], 夏: [6, 7, 8], 秋: [9, 10, 11], 冬: [12, 1, 2] };
  for (const hit of raw.matchAll(/(\d{1,2})月[^。；;\n]{0,12}([春夏秋冬])季/g)) {
    if (!seasons[hit[2]].includes(+hit[1])) findings.push(finding(`tlc-e4-${hit.index}`, 'critical', `月份与季节冲突：${hit[0]}`, 'draft', 'TLC-E4'));
  }
  for (const hit of raw.matchAll(/(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/gi)) {
    const hour = +hit[2], minute = +(hit[3] || 0);
    if (hour > 14 || minute > 59 || (hour === 14 && minute > 0)) findings.push(finding(`tlc-e5-${hit.index}`, 'critical', `无效时区偏移：${hit[0]}`, 'draft', 'TLC-E5'));
  }
  for (const hit of raw.matchAll(/(?:任期|在任|服役期|代际|制度期)[：:]?\s*(\d{3,4})\s*(?:至|到|—|-|~|～)\s*(\d{3,4})/g)) {
    if (+hit[1] > +hit[2]) findings.push(finding(`tlc-range-${hit.index}`, 'critical', `有效期区间倒置：${hit[0]}`, 'draft', /代际/.test(hit[0]) ? 'TLC-E7' : /制度/.test(hit[0]) ? 'TLC-E8' : 'TLC-E6'));
  }
  for (const hit of raw.matchAll(/海拔\s*([+-]?\d+(?:\.\d+)?)\s*(?:米|m)/gi)) {
    if (+hit[1] < -500 || +hit[1] > 9000) findings.push(finding(`tlc-e9-${hit.index}`, 'warning', `海拔超出地球常见现实锚：${hit[0]}`, 'draft', 'TLC-E9'));
  }
  if ((raw.match(/```/g) || []).length % 2) findings.push(finding('tlc-e10-fence', 'critical', 'Markdown 代码围栏未闭合', 'draft', 'TLC-E10'));
  const stems = '甲乙丙丁戊己庚辛壬癸', branches = '子丑寅卯辰巳午未申酉戌亥';
  for (const hit of raw.matchAll(/(\d{4})年[^。；;\n]{0,10}([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])年?/g)) {
    const offset = ((+hit[1] - 1984) % 60 + 60) % 60;
    const expected = stems[offset % 10] + branches[offset % 12];
    if (hit[2] !== expected) findings.push(finding(`tlc-e11-${hit.index}`, 'critical', `公历 ${hit[1]} 年干支应为 ${expected}，正文写作 ${hit[2]}`, 'draft', 'TLC-E11'));
  }
  for (const hit of raw.matchAll(/机构编号[：:]\s*([^，。；;\s]+)/g)) {
    if (!/^[A-Z]{2,8}-\d{2,12}$/i.test(hit[1])) findings.push(finding(`tlc-e12-${hit.index}`, 'critical', `机构编号格式非法：${hit[1]}`, 'draft', 'TLC-E12'));
  }
  return { pass: !findings.some(x => x.severity === 'critical'), findings, rules: TLC_RULES };
}

function runArithmeticInspection(text) {
  const raw = asText(text);
  const findings = [];
  for (const hit of raw.matchAll(/([\d,.]+)\s*(?:÷|\/)\s*([\d,.]+)\s*=\s*([\d,.]+)/g)) {
    const a = +hit[1].replace(/,/g, ''), b = +hit[2].replace(/,/g, ''), stated = +hit[3].replace(/,/g, '');
    if (!b || !Number.isFinite(a / b) || !Number.isFinite(stated)) continue;
    const actual = a / b;
    const factor = Math.max(Math.abs(actual / stated), Math.abs(stated / actual));
    if (factor >= 9.5) findings.push(finding(`math-10x-${hit.index}`, 'critical', `10× 嗅探命中：${hit[0]}，机器复算=${+actual.toFixed(6)}`, 'draft', 'W68-Q3', { vertical: `${a}\n÷ ${b}\n= ${+actual.toFixed(6)}` }));
    else if (Math.abs(actual - stated) > Math.max(0.01, Math.abs(actual) * 0.01)) findings.push(finding(`math-${hit.index}`, 'critical', `算式不相等：${hit[0]}，机器复算=${+actual.toFixed(6)}`, 'draft', 'W68-Q4', { vertical: `${a}\n÷ ${b}\n= ${+actual.toFixed(6)}` }));
  }
  return findings;
}

export function runDeterministicInspection(text, schema = {}, { previousText = '', repairOrder = null } = {}) {
  const raw = asText(text);
  const findings = [];
  for (const beat of list(schema.requiredBeats)) {
    const present = list(beat.patterns).some(pattern => pattern && raw.includes(pattern));
    if (!present) findings.push(finding(`beat-${beat.id}`, beat.required === false ? 'warning' : 'critical', `未覆盖验收点：${beat.label}`, `skeleton:${beat.id}`, REVIEW_RULES.machineBeforePoint));
  }
  for (const seed of list(schema.plantedSeeds)) {
    const present = list(seed.patterns).some(pattern => pattern && raw.includes(pattern));
    if (!present) findings.push(finding(`seed-${seed.id}`, 'critical', `未埋入种子：${seed.label}`, `skeleton:${seed.id}`, REVIEW_RULES.machineBeforePoint));
  }
  for (const lock of list(schema.lockedFacts)) {
    const labelRx = new RegExp(`${escRx(lock.label)}\\s*[：:=＝]\\s*([^，。；;\\n]{1,40})`, 'g');
    for (const hit of raw.matchAll(labelRx)) {
      if (lock.value && !hit[1].includes(lock.value)) findings.push(finding(`lock-${lock.id}`, 'critical', `锁定事实冲突：${lock.label} 应为「${lock.value}」，正文写作「${hit[1].trim()}」`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
    }
    const hasQuantity = /\d/.test(lock.value || '');
    if (hasQuantity && list(lock.sources).length < 2) findings.push(finding(`source-${lock.id}`, 'critical', `定量锁定项「${lock.label}」不足两条独立记录`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
    if (hasQuantity && !lock.basis) findings.push(finding(`basis-${lock.id}`, 'critical', `定量锁定项「${lock.label}」未命名分母/统计口径`, `skeleton:${lock.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  for (const boundary of list(schema.forbiddenBoundaries)) {
    const bad = list(boundary.patterns).find(pattern => pattern && raw.includes(pattern));
    if (bad) findings.push(finding(`ban-${boundary.id}`, 'critical', `触碰禁止边界：${boundary.label}（${bad}）`, `skeleton:${boundary.id}`, REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  const freezePhrases = raw.match(/(?:作者授权|已入典|官方确认|经核实|经权威认定)/g) || [];
  for (const phrase of [...new Set(freezePhrases)]) {
    const supported = new RegExp(`${escRx(phrase)}[^\n]{0,80}(?:\[源[:：]|来源[:：]|证据[:：])`).test(raw);
    if (!supported) findings.push(finding(`freeze-${slug(phrase)}`, 'critical', `无证据授权性断言已冻结：${phrase}`, 'draft', REVIEW_RULES.locksAreGlobal, { frozen: true }));
  }
  if (/(?:已|全部)?(?:通过|满足)(?:所有|全部)?(?:校验|验收)|无任何问题/.test(raw)) {
    findings.push(finding('self-certification', 'critical', '正文含自我认证式通过声明', 'draft', REVIEW_RULES.noSelfCertification));
  }
  for (const hit of raw.matchAll(/\{\{[^}]+\}\}|\[(?:待填|待核实|TODO)\]|\b(?:TBD|TODO)\b|以系统核验为准/gi)) findings.push(finding(`placeholder-${hit.index}`, 'critical', `占位符未被真实结果替换：${hit[0]}`, 'draft', 'W68-D1'));
  for (const hit of raw.matchAll(/(?:本项|此处|该条)?(?:可不改|予以豁免|无需校验)/g)) findings.push(finding(`exemption-${hit.index}`, 'critical', `自我豁免归零：${hit[0]}`, 'draft', 'W68-D5'));
  const tlc = runTlcInspection(raw);
  findings.push(...tlc.findings);
  findings.push(...runArithmeticInspection(raw));
  const metrics = styleFingerprint(raw);
  if (metrics.sentenceCount >= 6 && metrics.sentenceStdDev < 6) findings.push(finding('style-flat', 'warning', `句长标准差仅 ${metrics.sentenceStdDev}，节奏可能机械`, 'draft', 'W68-S2'));
  if (metrics.psychologyPer10k > 45) findings.push(finding('style-psychology', 'warning', `心理动词密度 ${metrics.psychologyPer10k}/万字，建议改为动作或感官证据`, 'draft', 'W68-S3'));
  if (/(?:镜头|视角)(?:拉近|推进|切到|转向)/.test(raw)) findings.push(finding('style-camera', 'warning', '命中特写运镜化表述，需回到事实层', 'draft', 'W68-S4'));
  if (metrics.sentenceCount >= 8 && !/[—]/.test(raw)) findings.push(finding('style-rhythm', 'warning', '长段落未出现破折号且句长变化偏低，需抽审节奏匀死风险', 'draft', 'W68-S5'));
  if (previousText && repairOrder) {
    const stability = validateRepairRevision(previousText, raw, repairOrder);
    findings.push(...stability.findings);
  }
  const blocking = findings.filter(x => x.severity === 'critical');
  const pressureStages = [
    { id: 'density', label: '信息密度', pass: !findings.some(x => ['style-flat', 'style-psychology'].includes(x.id)) },
    { id: 'numeric-purity', label: '数字纯度', pass: !findings.some(x => /^(?:math|source|basis|tlc-)/.test(x.id)) },
    { id: 'consistency', label: '自洽与稳定', pass: !findings.some(x => /^(?:lock|protected|ban)-/.test(x.id)) },
    { id: 'final', label: '终审态', pass: blocking.length === 0 },
  ];
  return { pass: blocking.length === 0, findings, blocking, metrics, tlc, pressureStages, blindSpots: ['语义方向由 M2 对点席判断', '正典引用存在性由外围审理席开卷核对', '未登记现实锚不由机器臆测'], checkedAt: new Date().toISOString() };
}

export function buildRepairOrder(machineReport, { protectionList = [], source = 'machine' } = {}) {
  const items = list(machineReport?.findings).filter(x => x.severity === 'critical').map((x, index) => ({
    id: `R${index + 1}`,
    position: x.artifactRef || 'draft',
    error: x.message,
    change: x.frozen ? '删除或改成可由登记证据支持的表述；不得自行补造授权、来源或数值' : '只修复本项并重新对齐验收点',
    reason: x.ruleRef || REVIEW_RULES.machineBeforePoint,
  }));
  return { kind: 'repair-order', source, items, protectionList: list(protectionList).map(asText).filter(Boolean), createdAt: new Date().toISOString() };
}

export function repairOrderMarkdown(order) {
  const items = list(order?.items);
  return [
    '# 修订单', '',
    line('来源', order?.source),
    line('性质', '本单只授权列明的改动；不等同审理报告'),
    '',
    '| 编号 | 位置 | 错误 | 应改 | 理由/规则 |',
    '|---|---|---|---|---|',
    ...(items.length ? items.map(x => `| ${x.id} | ${x.position} | ${x.error} | ${x.change} | ${x.reason} |`) : ['| — | — | 无关键修订项 | — | — |']),
    '',
    '## 保护清单', '',
    ...(list(order?.protectionList).length ? list(order.protectionList).map(x => `- ${x}`) : ['- 未登记；仍禁止无关改写']),
  ].join('\n');
}

export function validateRepairRevision(previous, revised, order = {}) {
  const findings = [];
  for (const protectedText of list(order.protectionList)) {
    if (asText(protectedText) && asText(previous).includes(protectedText) && !asText(revised).includes(protectedText)) {
      findings.push(finding(`protected-${slug(protectedText)}`, 'critical', `修订误伤保护项：${protectedText}`, 'repair-order', REVIEW_RULES.reviewerDoesNotRewrite));
    }
  }
  return { pass: findings.length === 0, findings };
}

export function machineReportMarkdown(report) {
  const findings = list(report?.findings);
  return [
    '# 确定性机检报告', '',
    line('结论', report?.pass ? '通过' : '退回'),
    line('关键问题', findings.filter(x => x.severity === 'critical').length),
    line('警告', findings.filter(x => x.severity !== 'critical').length),
    '',
    '## 发现', '',
    ...(findings.length ? findings.map(x => `- [${x.severity}] ${x.id}｜${x.message}｜工件 ${x.artifactRef}｜规则 ${x.ruleRef}`) : ['- 未发现规则命中']),
    '',
    '## 文风指纹', '',
    '```json', JSON.stringify(report?.metrics || {}, null, 2), '```',
    '', '## 四轮加压', '',
    ...list(report?.pressureStages).map(x => `- [${x.pass ? '通过' : '待审'}] ${x.label}`),
    '', '## 盲区声明', '',
    ...list(report?.blindSpots).map(x => `- ${x}`),
  ].join('\n');
}

function stripFence(raw) {
  const text = asText(raw);
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function parseReviewPacket(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return { ...fallback, ...raw };
  try { return { ...fallback, ...JSON.parse(stripFence(raw)) }; }
  catch { return { ...fallback, raw: asText(raw), parseWarning: true }; }
}

export function normalizeObjection(value, index = 0) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    id: asText(obj.id) || `O${index + 1}`,
    severity: ['critical', 'major', 'minor'].includes(obj.severity) ? obj.severity : 'major',
    claim: asText(obj.claim || obj.message) || '审理输出未给出明确主张',
    artifactRef: asText(obj.artifactRef),
    ruleRef: asText(obj.ruleRef),
    status: 'open',
    reviewer: asText(obj.reviewer),
  };
}

export function validateObjection(objection) {
  const missing = [];
  if (!objection?.artifactRef) missing.push('artifactRef');
  if (!objection?.ruleRef) missing.push('ruleRef');
  return { valid: !missing.length, missing };
}

export class ReviewBudgetLedger {
  constructor(capTokens = 32000) {
    this.capTokens = Math.max(0, Number(capTokens) || 0);
    this.usedTokens = 0;
    this.entries = [];
  }
  canSpend(tokens) { return this.usedTokens + Math.max(0, tokens) <= this.capTokens; }
  charge({ seat, phase, input = '', output = '', estimatedTokens = 0 }) {
    const actual = Math.max(1, Math.ceil((asText(input).length + asText(output).length) / 4));
    const tokens = Math.max(actual, Math.min(Number(estimatedTokens) || 0, actual * 2));
    this.usedTokens += tokens;
    this.entries.push({ seat, phase, tokens, at: new Date().toISOString() });
    return tokens;
  }
  summary(units = 1) {
    const bySeat = {};
    for (const entry of this.entries) bySeat[entry.seat] = (bySeat[entry.seat] || 0) + entry.tokens;
    return { capTokens: this.capTokens, usedTokens: this.usedTokens, remainingTokens: Math.max(0, this.capTokens - this.usedTokens), bySeat, perUnit: Math.round(this.usedTokens / Math.max(1, units)), per10k: this.usedTokens ? Math.round(this.usedTokens * 10000 / Math.max(1, units * 10000)) : 0, entries: this.entries };
  }
}

export function planReviewRitual(requested = 'light', capTokens = 32000) {
  const ritual = requested === 'full' ? 'full' : 'light';
  const cap = Math.max(0, Number(capTokens) || 0);
  if (ritual === 'full' && cap < 18000) {
    if (cap >= 8000) return { requested: ritual, effective: 'light', downgraded: true, stopped: false, reason: '预算不足以覆盖全仪式，降为轻仪式并保留外部红队席' };
    return { requested: ritual, effective: 'stopped', downgraded: false, stopped: true, reason: '预算低于轻仪式硬底线' };
  }
  if (ritual === 'light' && cap < 8000) return { requested: ritual, effective: 'stopped', downgraded: false, stopped: true, reason: '预算低于轻仪式硬底线' };
  return { requested: ritual, effective: ritual, downgraded: false, stopped: false, reason: '' };
}

function pointReportMarkdown(packet, round) {
  return ['# 对点报告', '', line('主环轮次', round), line('决定', packet.decision), line('解析降级', packet.parseWarning ? '是' : '否'), '', '## 判断', '', ...(list(packet.findings).length ? list(packet.findings).map((x, i) => `- P${i + 1}｜${asText(x.message || x)}`) : ['- 未提出调整项'])].join('\n');
}

function polishRecordMarkdown(record) {
  if (!record) return '# 润色记录\n\n- 轻仪式或本轮未启用独立润色站。';
  return ['# 润色记录', '', line('结论', record.accepted ? '采用' : '回退原稿'), line('理由', record.reason), '', '## 润色前指纹', '', '```json', JSON.stringify(record.before || {}, null, 2), '```', '', '## 润色后指纹', '', '```json', JSON.stringify(record.after || {}, null, 2), '```'].join('\n');
}

function consultationMarkdown(packet) {
  return ['# 请示单', '', line('提案', packet?.proposal), line('理由', packet?.reason), line('M2 决定', packet?.approved ? '批准；先改骨架/圣经再动正文' : '不批准'), line('骨架变更', packet?.skeletonPatch), line('圣经变更', packet?.biblePatch)].join('\n');
}

function reviewMarkdown(reviews) {
  return ['# 背靠背审理表', '', line('规则', '审理席只提问题，不直接改稿'), '', ...reviews.flatMap(row => [`## ${row.seat}`, '', line('抽样/全审', row.sampled ? '抽样' : '全审'), line('解析降级', row.packet.parseWarning ? '是' : '否'), ...(list(row.packet.objections).length ? list(row.packet.objections).map((x, i) => `- ${asText(x.id) || `O${i + 1}`}｜${asText(x.claim || x.message)}｜${asText(x.artifactRef)}｜${asText(x.ruleRef)}`) : ['- 无质询'])])].join('\n');
}

function objectionMarkdown(objections) {
  return ['# 质询单', '', ...objections.flatMap(x => [`## ${x.id}`, '', line('审理席', x.reviewer), line('级别', x.severity), line('主张', x.claim), line('工件引用', x.artifactRef), line('规则引用', x.ruleRef), line('状态', x.status)])].join('\n');
}

function answerMarkdown(answers) {
  return ['# 答辩书', '', ...answers.flatMap(x => [`## ${x.objectionId}`, '', line('答辩', x.answer), line('证据引用', x.evidenceRef), line('审理结果', x.outcome), line('轮次', x.round)])].join('\n');
}

function verdictMarkdown(result) {
  return ['# 裁决书', '', line('最终裁决', result.verdict), line('封存', result.sealed ? '是；原件只读，后续更正另立补遗' : '否'), line('机检闸', result.gates.machine ? '开' : '关'), line('对点闸', result.gates.point ? '开' : '关'), line('审理闸', result.gates.review ? '开' : '关'), line('质询闸', result.gates.objection ? '开' : '关'), line('理由', result.reason), line('协议', W68_PROTOCOL)].join('\n');
}

function precedentMarkdown({ unitRef, objections, verdict }) {
  const reusable = objections.filter(x => x.status === 'closed' || x.status === 'overruled');
  return ['## 判例 ' + asText(unitRef), '', line('裁决', verdict), ...reusable.map(x => `- ${x.ruleRef}｜${x.claim}｜处置：${x.status}`)].join('\n');
}

/**
 * 执行 W68a。ask 入参为 { role, system, user, temperature, maxTokens }，返回文本。
 * 返回 sealed=false 时调用方不得写入正典正文，只可保存工件与任务状态。
 */
export async function runW68Review({
  draft = '', blueprint = '', outline = '', bible = '', unitRef = '第001单元',
  ritual = 'light', budgetCap = 32000, ask, previousText = '', protectionList = [],
  additionalMachineChecks = null, precedents = '',
} = {}) {
  if (typeof ask !== 'function') throw new Error('W68a 缺少审理调用器');
  const ritualPlan = planReviewRitual(ritual, budgetCap);
  const ledger = new ReviewBudgetLedger(budgetCap);
  const transitions = ['skeleton'];
  if (asText(precedents)) transitions.push('precedent:loaded');
  let schema = buildAcceptanceSchema({ blueprint, outline });
  let text = asText(draft);
  let machine = null;
  const machineHistory = [];
  let point = null;
  let consultation = null;
  let polishRecord = null;
  let polishAttempted = false;
  const repairs = [];
  const pointReports = [];
  const reviews = [];
  const objections = [];
  const answers = [];
  const inspectText = current => {
    const base = runDeterministicInspection(current, schema, { previousText, repairOrder: repairs.at(-1) });
    if (typeof additionalMachineChecks !== 'function') return base;
    const extras = list(additionalMachineChecks(current)).filter(x => x && x.pass === false).map((x, index) => finding(
      `template-${index + 1}`, 'critical', asText(x.label || x.detail || '模板质量规则未通过'), 'draft', 'W68-M-TEMPLATE',
    ));
    if (!extras.length) return base;
    base.findings.push(...extras);
    base.blocking.push(...extras);
    base.pass = false;
    return base;
  };
  if (ritualPlan.stopped) {
    const result = { protocol: W68_PROTOCOL, sealed: false, verdict: 'budget-stop', reason: ritualPlan.reason, ritual: ritualPlan, gates: { machine: false, point: false, review: false, objection: false }, text, schema, transitions: [...transitions, 'budget-stop'], budget: ledger.summary() };
    result.artifacts = { skeleton: acceptanceSchemaMarkdown(schema), draft: text, verdict: verdictMarkdown(result) };
    return result;
  }
  const invoke = async ({ seat, role, phase, system, user, expected = 1800, required = true, temperature = 0.2, maxTokens = 4096 }) => {
    const inputEstimate = Math.max(1, Math.ceil((asText(system).length + asText(user).length) / 4));
    const remaining = ledger.capTokens - ledger.usedTokens;
    const outputAllowance = remaining - inputEstimate;
    if (!ledger.canSpend(expected) || outputAllowance < 64) {
      if (!required) return null;
      const error = new Error(`W68a 预算硬闸：${phase} 前余额不足`);
      error.code = 'W68_BUDGET_STOP';
      throw error;
    }
    const output = await ask({ role, system, user, temperature, maxTokens: Math.max(64, Math.min(maxTokens, outputAllowance)) });
    ledger.charge({ seat, phase, input: `${system}\n${user}`, output, estimatedTokens: expected });
    return asText(output);
  };
  try {
    // 主环：确定性机检 → M2 对点 → 修订；最多三轮，仍不收敛则推定骨架问题。
    for (let round = 1; round <= 3; round++) {
      transitions.push(`machine:${round}`);
      machine = inspectText(text);
      machineHistory.push({ round, report: machine });
      if (!machine.pass) {
        const order = buildRepairOrder(machine, { protectionList, source: `machine:${round}` });
        repairs.push(order);
        transitions.push(`repair:${round}`);
        const revised = await invoke({
          seat: 'M3', role: 'factory_writer', phase: `main-repair-${round}`, expected: 2600,
          system: 'MAZZ_W68_REPAIR\n你是 M3 执笔席。修订单是唯一改稿授权；只修列明项目，保护其余内容。不得解释，不得宣称自己通过验收，只输出完整修订正文。',
          user: `【骨架与验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【初稿】\n${text}\n\n【修订单】\n${repairOrderMarkdown(order)}`,
          temperature: 0.35, maxTokens: 8192,
        });
        previousText = text;
        text = revised || text;
        continue;
      }
      if (ritualPlan.effective === 'full' && !polishAttempted) {
        polishAttempted = true;
        transitions.push(`polish:${round}`);
        const before = text;
        const polished = await invoke({
          seat: '润色席', role: 'factory_polish', phase: `polish-${round}`, expected: 2200,
          system: 'MAZZ_W68_POLISH\n你是独立润色席，不得改变事实、数值、事件顺序或验收点。依次处理：删直接心理报告、打散重复段首、替换粗俗比喻、补一个不抢戏的具体死物、让结尾留有余波；对话只改语气不改信息。只输出完整正文。',
          user: `【锁定验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${before}`,
          temperature: 0.3, maxTokens: 8192,
        });
        const polishedMachine = inspectText(polished);
        const lengthStable = polished.length >= Math.max(10, before.length * 0.7);
        const accepted = polishedMachine.pass && lengthStable;
        polishRecord = { accepted, before: styleFingerprint(before), after: styleFingerprint(polished), reason: accepted ? '润色后确定性机检仍通过' : (!lengthStable ? '润色删改超过 30%，自动回退' : '润色引入关键机检错误，自动回退'), text: accepted ? polished : before };
        if (accepted) {
          text = polished;
          machine = polishedMachine;
          machineHistory.push({ round: `polish-${round}`, report: machine });
        } else transitions.push(`polish-reverted:${round}`);
      }
      transitions.push(`point:${round}`);
      const pointRaw = await invoke({
        seat: 'M2', role: 'factory_point', phase: `point-${round}`, expected: 1600,
        system: 'MAZZ_W68_POINT\n你是 M2 对点席，与 M3 分离。只返回 JSON：{"decision":"pass|adjust|return_skeleton","findings":[{"message":"...","artifactRef":"...","ruleRef":"..."}],"repairItems":[],"consultation":{"proposal":"","reason":"","approved":false,"skeletonPatch":"","biblePatch":""}}。不得直接改稿。',
        user: `【验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${text}\n\n【机检】\n${machineReportMarkdown(machine)}\n\n【既有判例（同规则优先复用）】\n${precedents || '无'}`,
      });
      point = parseReviewPacket(pointRaw, { decision: 'pass', findings: [], repairItems: [], consultation: null });
      if (!['pass', 'adjust', 'return_skeleton'].includes(point.decision)) point.decision = 'adjust';
      pointReports.push({ round, ...point });
      if (point.consultation?.proposal) {
        consultation = { ...point.consultation };
        if (consultation.approved) {
          transitions.push(`consultation-approved:${round}`);
          const skeletonRaw = await invoke({
            seat: 'M1', role: 'factory_skeleton', phase: `consultation-${round}`, expected: 1200,
            system: 'MAZZ_W68_CONSULTATION\n你是骨架席。请把已批准请示先合并进骨架；只输出追加的显式 [必达]/[必埋]/[锁定]/[禁越] 行，不写正文。',
            user: `【原蓝图】\n${blueprint}\n\n【请示】\n${consultationMarkdown(consultation)}\n\n【圣经】\n${bible}`,
          });
          blueprint = `${blueprint}\n\n## W68a 已批准变更\n${skeletonRaw}`;
          bible = `${bible}\n\n## ${unitRef} 已批准请示\n${consultation.biblePatch || consultation.proposal}`;
          schema = buildAcceptanceSchema({ blueprint, outline });
          point.decision = 'adjust';
        }
      }
      if (point.decision === 'pass') break;
      if (point.decision === 'return_skeleton') {
        transitions.push('nonconvergence:skeleton');
        break;
      }
      const order = {
        kind: 'repair-order', source: `point:${round}`, protectionList: list(protectionList), createdAt: new Date().toISOString(),
        items: list(point.repairItems).map((x, i) => ({ id: x.id || `P${i + 1}`, position: x.position || x.artifactRef || 'draft', error: x.error || x.message || '对点偏差', change: x.change || '按对点意见作最小修订', reason: x.reason || x.ruleRef || REVIEW_RULES.machineBeforePoint })),
      };
      if (!order.items.length) order.items = list(point.findings).map((x, i) => ({ id: `P${i + 1}`, position: x.artifactRef || 'draft', error: x.message || asText(x), change: '作最小修订', reason: x.ruleRef || REVIEW_RULES.machineBeforePoint }));
      repairs.push(order);
      transitions.push(`repair:${round}`);
      previousText = text;
      text = await invoke({
        seat: 'M3', role: 'factory_writer', phase: `point-repair-${round}`, expected: 2600,
        system: 'MAZZ_W68_REPAIR\n你是 M3 执笔席。严格依修订单最小修订；不得扩写未授权内容，只输出完整正文。',
        user: `【正文】\n${text}\n\n【修订单】\n${repairOrderMarkdown(order)}\n\n【保护项】\n${list(protectionList).join('\n')}`,
        temperature: 0.35, maxTokens: 8192,
      }) || text;
    }
    machine = inspectText(text);
    machineHistory.push({ round: 'final', report: machine });
    const mainConverged = machine.pass && point?.decision === 'pass';
    if (!mainConverged) {
      transitions.push('nonconvergence:skeleton');
      const result = { protocol: W68_PROTOCOL, sealed: false, verdict: 'return-skeleton', reason: '主环三轮未收敛；依规则推定骨架/验收点需重开', ritual: ritualPlan, gates: { machine: machine.pass, point: false, review: false, objection: false }, text, schema, machine, machineHistory, polishRecord, point, transitions, budget: ledger.summary(), bible };
      result.artifacts = { skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n'), point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n---\n\n'), repair: repairs.map(repairOrderMarkdown).join('\n\n---\n\n'), consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无', verdict: verdictMarkdown(result) };
      return result;
    }

    // 外围环：全仪式 M4/M5 背靠背；轻仪式 M4 抽样。若安静，强制再开 M5 红队。
    transitions.push('peripheral-review');
    const reviewerSeats = ritualPlan.effective === 'full'
      ? [{ seat: 'M4', role: 'factory_review_a', sampled: false }, { seat: 'M5', role: 'factory_review_b', sampled: false }]
      : [{ seat: 'M4', role: 'factory_review_a', sampled: true }];
    const doReview = async reviewer => {
      const raw = await invoke({
        seat: reviewer.seat, role: reviewer.role, phase: `review-${reviewer.seat}`, expected: 1600,
        system: `MAZZ_W68_REVIEW\n你是 ${reviewer.seat} 外部审理席，与执笔席分离。不得改稿。只返回 JSON：{"objections":[{"id":"O1","severity":"critical|major|minor","claim":"...","artifactRef":"draft:段落/句子或skeleton:id","ruleRef":"规则编号"}]}。每项必须同时引用工件与规则。`,
        user: `【验收点】\n${acceptanceSchemaMarkdown(schema)}\n\n【正文】\n${text}\n\n【M2 对点】\n${pointReportMarkdown(point, pointReports.length)}\n\n【既有判例】\n${precedents || '无'}`,
      });
      const packet = parseReviewPacket(raw, { objections: [] });
      reviews.push({ ...reviewer, packet });
      for (const [index, rawObj] of list(packet.objections).entries()) {
        const obj = normalizeObjection({ ...rawObj, reviewer: reviewer.seat }, objections.length + index);
        const citation = validateObjection(obj);
        if (!citation.valid) {
          obj.severity = 'critical';
          obj.claim = `质询缺少 ${citation.missing.join('、')}，无法进入答辩闭环`;
          obj.artifactRef ||= `review:${reviewer.seat}`;
          obj.ruleRef ||= REVIEW_RULES.citedObjections;
        }
        objections.push(obj);
      }
    };
    for (const reviewer of reviewerSeats) await doReview(reviewer);
    if (!objections.length && !reviewerSeats.some(x => x.seat === 'M5')) {
      transitions.push('quiet:red-team');
      await doReview({ seat: 'M5', role: 'factory_review_b', sampled: false });
    }

    // 质询由 M2 据证答辩；未撤回的关键质询最多两轮，随后强制 M6 开庭。
    transitions.push('objection-loop');
    for (const objection of objections) {
      for (let round = 1; round <= 2 && objection.status === 'open'; round++) {
        const raw = await invoke({
          seat: 'M2', role: 'factory_point', phase: `answer-${objection.id}-${round}`, expected: 900,
          system: 'MAZZ_W68_ANSWER\n你是 M2 答辩席。只返回 JSON：{"answer":"...","evidenceRef":"工件:位置","outcome":"withdraw|hold"}。没有证据不得把置信语气当证据。',
          user: `【质询】\n${JSON.stringify(objection)}\n\n【正文】\n${text}\n\n【验收点】\n${acceptanceSchemaMarkdown(schema)}`,
        });
        const answer = parseReviewPacket(raw, { answer: '未形成有效答辩', evidenceRef: '' });
        let outcome = 'hold';
        if (answer.evidenceRef) {
          const reviewerRole = objection.reviewer === 'M5' ? 'factory_review_b' : 'factory_review_a';
          const reconsiderRaw = await invoke({
            seat: objection.reviewer || 'M4', role: reviewerRole, phase: `reconsider-${objection.id}-${round}`, expected: 700,
            system: 'MAZZ_W68_RECONSIDER\n你是原质询审理席。根据答辩证据只返回 JSON：{"outcome":"withdraw|hold","reason":"..."}。撤回权属于质询席，不属于答辩席。',
            user: `【原质询】\n${JSON.stringify(objection)}\n\n【答辩】\n${JSON.stringify(answer)}`,
          });
          const reconsider = parseReviewPacket(reconsiderRaw, { outcome: 'hold', reason: '复议输出不可解析' });
          outcome = reconsider.outcome === 'withdraw' ? 'withdraw' : 'hold';
        }
        answers.push({ objectionId: objection.id, answer: answer.answer, evidenceRef: answer.evidenceRef, outcome, round });
        if (outcome === 'withdraw') objection.status = 'closed';
      }
      if (objection.status === 'open') {
        transitions.push(`hearing:${objection.id}`);
        const raw = await invoke({
          seat: 'M6', role: 'factory_arbiter', phase: `hearing-${objection.id}`, expected: 1200,
          system: 'MAZZ_W68_HEARING\n你是 M6 庭审席。只返回 JSON：{"decision":"overrule|sustain","reason":"...","ruleRef":"..."}。证据优先，不得直接改稿。',
          user: `【质询】\n${JSON.stringify(objection)}\n\n【两轮答辩】\n${JSON.stringify(answers.filter(x => x.objectionId === objection.id))}`,
        });
        const hearing = parseReviewPacket(raw, { decision: objection.severity === 'critical' ? 'sustain' : 'overrule', reason: '庭审输出不可解析' });
        objection.status = hearing.decision === 'overrule' ? 'overruled' : 'sustained';
        objection.hearing = hearing;
      }
    }
    const openCritical = objections.filter(x => x.severity === 'critical' && !['closed', 'overruled'].includes(x.status));
    const gates = {
      machine: machine.pass,
      point: point.decision === 'pass',
      review: reviews.length >= 1 && reviews.some(x => x.seat !== 'M3'),
      objection: openCritical.length === 0 && objections.every(x => x.status !== 'open'),
    };
    transitions.push('final');
    const finalRaw = await invoke({
      seat: 'M6', role: 'factory_arbiter', phase: 'final', expected: 1200,
      system: 'MAZZ_W68_FINAL\n你是 M6 终审席。只返回 JSON：{"decision":"pass|block","reason":"..."}。四闸任一关闭必须 block；不得改稿。',
      user: `【四闸】\n${JSON.stringify(gates)}\n\n【未决关键质询】\n${JSON.stringify(openCritical)}\n\n【圣经审计】\n${bible || '未建圣经'}\n\n【预算】\n${JSON.stringify(ledger.summary())}`,
    });
    const final = parseReviewPacket(finalRaw, { decision: Object.values(gates).every(Boolean) ? 'pass' : 'block', reason: '按四闸确定性结果裁决' });
    const sealed = Object.values(gates).every(Boolean) && final.decision === 'pass';
    transitions.push(sealed ? 'sealed' : 'blocked');
    const result = {
      protocol: W68_PROTOCOL, sealed, verdict: sealed ? 'pass' : 'block', reason: final.reason || (sealed ? '四闸全开' : '四闸未全开'),
      ritual: ritualPlan, gates, text, schema, machine, machineHistory, polishRecord, point, consultation, repairs, reviews, objections, answers,
      transitions, budget: ledger.summary(), bible,
      precedent: precedentMarkdown({ unitRef, objections, verdict: sealed ? 'pass' : 'block' }),
    };
    result.artifacts = {
      skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n'),
      point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n---\n\n'),
      repair: repairs.length ? repairs.map(repairOrderMarkdown).join('\n\n---\n\n') : '# 修订单\n\n- 无',
      consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无',
      review: reviewMarkdown(reviews), objection: objectionMarkdown(objections), answer: answerMarkdown(answers), verdict: verdictMarkdown(result),
    };
    return result;
  } catch (error) {
    if (error?.code !== 'W68_BUDGET_STOP') throw error;
    const result = { protocol: W68_PROTOCOL, sealed: false, verdict: 'budget-stop', reason: error.message, ritual: ritualPlan, gates: { machine: !!machine?.pass, point: point?.decision === 'pass', review: false, objection: false }, text, schema, machine, machineHistory, polishRecord, point, transitions: [...transitions, 'budget-stop'], budget: ledger.summary(), bible };
    result.artifacts = { skeleton: acceptanceSchemaMarkdown(schema), draft: text, polish: polishRecordMarkdown(polishRecord), machine: machineHistory.length ? machineHistory.map(x => `## 机检轮次 ${x.round}\n\n${machineReportMarkdown(x.report)}`).join('\n\n---\n\n') : '# 机检报告\n\n- 未执行', point: pointReports.map(x => pointReportMarkdown(x, x.round)).join('\n\n') || '# 对点报告\n\n- 未执行', repair: repairs.map(repairOrderMarkdown).join('\n\n') || '# 修订单\n\n- 无', consultation: consultation ? consultationMarkdown(consultation) : '# 请示单\n\n- 无', review: reviewMarkdown(reviews), objection: objectionMarkdown(objections), answer: answerMarkdown(answers), verdict: verdictMarkdown(result) };
    return result;
  }
}

export function reviewArtifactManifest(result, { unitRef = '第001单元' } = {}) {
  return {
    protocol: W68_PROTOCOL,
    unitRef,
    sealed: !!result?.sealed,
    verdict: result?.verdict,
    ritual: result?.ritual,
    gates: result?.gates,
    transitions: list(result?.transitions),
    budget: result?.budget,
    files: REVIEW_ARTIFACT_NAMES,
    immutableAfterSeal: !!result?.sealed,
    addendumRequiredForChanges: !!result?.sealed,
    generatedAt: new Date().toISOString(),
  };
}
