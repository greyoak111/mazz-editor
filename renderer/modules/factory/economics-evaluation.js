// W73f Economics / Metric / Formula / Local Evaluation v0
// 同一 Production Run 的 append-only 账本；估算、供应商实报、结算实付与未知值永不混算。

export const ECONOMICS_LEDGER_RECORD_SCHEMA = 'mazz.economics-evaluation-record/v0';
export const COST_RECORD_SCHEMA = 'mazz.cost-record/v0';
export const PRICE_TABLE_SCHEMA = 'mazz.price-table/v0';
export const METRIC_DEFINITION_SCHEMA = 'mazz.metric-definition/v0';
export const METRIC_FORMULA_SCHEMA = 'mazz.metric-formula/v0';
export const LOCAL_EVALUATION_SCHEMA = 'mazz.local-evaluation/v0';

export const COST_KINDS = Object.freeze(['estimate', 'provider-reported', 'settled-actual', 'unknown']);
export const METRIC_AXES = Object.freeze([
  'raw-ability', 'governance-uplift', 'final-quality', 'governance-dependency',
  'reliability', 'cost', 'latency', 'revision-cost', 'canon-compliance',
]);
export const SCORECARDS = Object.freeze(['production', 'author', 'audience', 'system-health']);
export const EVALUATION_STATUSES = Object.freeze(['measured', 'unknown', 'not-applicable', 'insufficient-sample']);
export const ECONOMICS_RECORD_TYPES = Object.freeze([
  'price-table-defined', 'cost-recorded', 'metric-defined', 'formula-defined',
  'evaluation-recorded', 'recovery-acknowledged',
]);

const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie',
]);
const ENVELOPE_KEYS = new Set([
  'schema', 'recordId', 'type', 'sequence', 'occurredAt', 'runId', 'authorityRef', 'evidenceRefs',
  'priceTable', 'cost', 'metric', 'formula', 'evaluation', 'reasonCode', 'message',
]);
const PRICE_KEYS = new Set([
  'schema', 'priceTableId', 'version', 'providerRef', 'modelRef', 'currency', 'effectiveFrom',
  'effectiveTo', 'inputPerMillion', 'outputPerMillion', 'sourceRef',
]);
const COST_KEYS = new Set([
  'schema', 'costId', 'runId', 'taskRef', 'kind', 'category', 'providerRef', 'modelRef', 'seatRef',
  'usage', 'amount', 'priceRef', 'observedAt', 'reason', 'evidenceRefs',
]);
const USAGE_KEYS = new Set(['status', 'inputTokens', 'outputTokens', 'totalTokens', 'unit', 'version', 'sourceRef']);
const AMOUNT_KEYS = new Set(['status', 'currency', 'value']);
const PRICE_REF_KEYS = new Set(['priceTableId', 'version', 'currency', 'effectiveAt']);
const METRIC_KEYS = new Set([
  'schema', 'metricId', 'version', 'label', 'axis', 'direction', 'unit', 'scorecard',
  'applicableContexts', 'sampleWindow', 'effectiveFrom', 'systemHealthOnly', 'description',
]);
const SAMPLE_WINDOW_KEYS = new Set(['kind', 'minSamples', 'durationDays', 'matchedBy']);
const FORMULA_KEYS = new Set([
  'schema', 'formulaId', 'version', 'metricRef', 'operation', 'missingPolicy', 'precision',
  'effectiveFrom', 'description',
]);
const REF_VERSION_KEYS = new Set(['id', 'version']);
const EVALUATION_KEYS = new Set([
  'schema', 'evaluationId', 'runId', 'taskRef', 'metricRef', 'formulaRef', 'scorecard', 'context',
  'evidenceWindow', 'samples', 'result', 'createdAt', 'supersedesEvaluationId',
]);
const CONTEXT_KEYS = new Set([
  'domain', 'workflow', 'workflowVersion', 'governanceProfile', 'artifactType',
  'seatRef', 'executorRef', 'providerRef', 'modelRef', 'defectClass',
]);
const EVIDENCE_WINDOW_KEYS = new Set(['from', 'to']);
const SAMPLE_KEYS = new Set([
  'sampleId', 'runId', 'taskRef', 'artifactRefs', 'findingRefs', 'gateRefs', 'humanDecisionRefs',
  'evidenceRefs', 'observedAt', 'status', 'value', 'reason',
]);
const RESULT_KEYS = new Set(['status', 'value', 'unit', 'sampleCount', 'measuredCount', 'reason']);

const asString = (value, max = 600) => String(value ?? '').trim().slice(0, max);
const asArray = value => Array.isArray(value) ? value : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isoNow = clock => new Date(clock()).toISOString();
const finiteOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;

function rejectUnknown(value, allowed, label) {
  if (!plainObject(value)) throw new Error(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} 含未冻结字段：${unknown.join(', ')}`);
}

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Economics 禁止 secret 字段：${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function strings(values, max = 800) {
  return [...new Set(asArray(values).map(value => asString(value, max)).filter(Boolean))];
}

function requireIso(value, label) {
  const text = asString(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`${label} 必须是 ISO 时间`);
  return text;
}

function normalizeVersionRef(value = {}, label = 'version ref') {
  rejectUnknown(value, REF_VERSION_KEYS, label);
  const ref = { id: asString(value.id, 320), version: asString(value.version, 120) };
  if (!ref.id || !ref.version) throw new Error(`${label} 缺 id/version`);
  return Object.freeze(ref);
}

function versionKey(ref) { return `${ref.id}@${ref.version}`; }

export function normalizePriceTable(value = {}) {
  rejectSecrets(value); rejectUnknown(value, PRICE_KEYS, 'Price table');
  if (value.schema != null && value.schema !== PRICE_TABLE_SCHEMA) throw new Error(`未知 Price table schema：${value.schema}`);
  const row = {
    schema: PRICE_TABLE_SCHEMA,
    priceTableId: asString(value.priceTableId, 320), version: asString(value.version, 120),
    providerRef: asString(value.providerRef, 240), modelRef: asString(value.modelRef, 300),
    currency: asString(value.currency, 20).toUpperCase(), effectiveFrom: requireIso(value.effectiveFrom, 'Price table effectiveFrom'),
    effectiveTo: asString(value.effectiveTo, 80), inputPerMillion: finiteOrNull(value.inputPerMillion),
    outputPerMillion: finiteOrNull(value.outputPerMillion), sourceRef: asString(value.sourceRef, 1000),
  };
  if (!row.priceTableId || !row.version || !row.providerRef || !row.currency || !row.sourceRef) throw new Error('Price table 缺 id/version/provider/currency/sourceRef');
  if (row.effectiveTo && (!Number.isFinite(Date.parse(row.effectiveTo)) || Date.parse(row.effectiveTo) <= Date.parse(row.effectiveFrom))) throw new Error('Price table effectiveTo 非法');
  if (row.inputPerMillion == null || row.inputPerMillion < 0 || row.outputPerMillion == null || row.outputPerMillion < 0) throw new Error('Price table 单价必须是非负有限数');
  return Object.freeze(row);
}

function normalizeUsage(value = {}) {
  rejectUnknown(value, USAGE_KEYS, 'Cost usage');
  const status = asString(value.status || 'unknown', 40);
  if (!['estimated', 'reported', 'unknown'].includes(status)) throw new Error(`非法 usage.status：${status}`);
  const row = {
    status, inputTokens: Math.max(0, Math.trunc(Number(value.inputTokens) || 0)),
    outputTokens: Math.max(0, Math.trunc(Number(value.outputTokens) || 0)),
    totalTokens: Math.max(0, Math.trunc(Number(value.totalTokens) || 0)),
    unit: asString(value.unit || 'token', 40), version: asString(value.version, 160),
    sourceRef: asString(value.sourceRef, 1000),
  };
  if (status !== 'unknown' && (!row.totalTokens || !row.version || !row.sourceRef)) throw new Error('已知 usage 缺 totalTokens/version/sourceRef');
  if (row.inputTokens + row.outputTokens > row.totalTokens) throw new Error('usage 分项超过 totalTokens');
  return Object.freeze(row);
}

function normalizeAmount(value = {}) {
  rejectUnknown(value, AMOUNT_KEYS, 'Cost amount');
  const status = asString(value.status || 'unknown', 40);
  if (!['estimated', 'reported', 'settled', 'unknown'].includes(status)) throw new Error(`非法 amount.status：${status}`);
  const row = { status, currency: asString(value.currency, 20).toUpperCase(), value: finiteOrNull(value.value) };
  if (status === 'unknown') return Object.freeze({ status, currency: '', value: null });
  if (!row.currency || row.value == null || row.value < 0) throw new Error('已知 amount 缺 currency/value');
  return Object.freeze(row);
}

function normalizePriceRef(value = {}) {
  rejectUnknown(value, PRICE_REF_KEYS, 'Cost priceRef');
  const row = {
    priceTableId: asString(value.priceTableId, 320), version: asString(value.version, 120),
    currency: asString(value.currency, 20).toUpperCase(), effectiveAt: asString(value.effectiveAt, 80),
  };
  if (!row.priceTableId && !row.version && !row.currency && !row.effectiveAt) return Object.freeze(row);
  if (!row.priceTableId || !row.version || !row.currency || !Number.isFinite(Date.parse(row.effectiveAt))) throw new Error('非空 priceRef 必须完整给出 id/version/currency/effectiveAt');
  return Object.freeze(row);
}

export function normalizeCostRecord(value = {}) {
  rejectSecrets(value); rejectUnknown(value, COST_KEYS, 'Cost record');
  if (value.schema != null && value.schema !== COST_RECORD_SCHEMA) throw new Error(`未知 Cost schema：${value.schema}`);
  const row = {
    schema: COST_RECORD_SCHEMA, costId: asString(value.costId, 360), runId: asString(value.runId, 240),
    taskRef: asString(value.taskRef, 360), kind: asString(value.kind, 60), category: asString(value.category || 'model-usage', 120),
    providerRef: asString(value.providerRef, 240), modelRef: asString(value.modelRef, 300), seatRef: asString(value.seatRef, 240),
    usage: normalizeUsage(value.usage || {}), amount: normalizeAmount(value.amount || {}),
    priceRef: normalizePriceRef(value.priceRef || {}), observedAt: requireIso(value.observedAt, 'Cost observedAt'),
    reason: asString(value.reason, 1000), evidenceRefs: strings(value.evidenceRefs, 1000),
  };
  if (!row.costId || !row.runId || !row.taskRef || !COST_KINDS.includes(row.kind)) throw new Error('Cost record 缺身份或 kind 非法');
  if (row.kind === 'estimate' && row.usage.status !== 'estimated' && row.amount.status !== 'estimated') throw new Error('estimate 必须含估算 usage 或 amount');
  if (row.kind === 'provider-reported' && (row.usage.status !== 'reported' || !row.providerRef || !row.evidenceRefs.length)) throw new Error('provider-reported 必须含 provider、reported usage 与 evidence');
  if (row.kind === 'settled-actual' && (row.amount.status !== 'settled' || !row.evidenceRefs.length)) throw new Error('settled-actual 必须含 settled amount 与 evidence');
  if (row.kind === 'unknown' && (row.usage.status !== 'unknown' || row.amount.status !== 'unknown' || !row.reason)) throw new Error('unknown 必须保持 usage/amount 未知并说明原因');
  if (row.amount.status !== 'unknown' && !row.priceRef.priceTableId && row.kind !== 'settled-actual') throw new Error('非结算金额必须引用版本化 price table');
  return Object.freeze(row);
}

export function normalizeMetricDefinition(value = {}) {
  rejectSecrets(value); rejectUnknown(value, METRIC_KEYS, 'Metric definition');
  if (value.schema != null && value.schema !== METRIC_DEFINITION_SCHEMA) throw new Error(`未知 Metric schema：${value.schema}`);
  rejectUnknown(value.sampleWindow || {}, SAMPLE_WINDOW_KEYS, 'Metric sampleWindow');
  const scorecard = asString(value.scorecard, 60);
  const row = {
    schema: METRIC_DEFINITION_SCHEMA, metricId: asString(value.metricId, 320), version: asString(value.version, 120),
    label: asString(value.label, 300), axis: asString(value.axis, 80), direction: asString(value.direction || 'none', 20),
    unit: asString(value.unit || 'count', 80), scorecard,
    applicableContexts: strings(value.applicableContexts, 240),
    sampleWindow: {
      kind: asString(value.sampleWindow?.kind || 'run', 80),
      minSamples: Math.max(1, Math.trunc(Number(value.sampleWindow?.minSamples) || 1)),
      durationDays: Math.max(0, Math.trunc(Number(value.sampleWindow?.durationDays) || 0)),
      matchedBy: strings(value.sampleWindow?.matchedBy, 160),
    },
    effectiveFrom: requireIso(value.effectiveFrom, 'Metric effectiveFrom'),
    systemHealthOnly: value.systemHealthOnly === true, description: asString(value.description, 1000),
  };
  if (!row.metricId || !row.version || !row.label || !METRIC_AXES.includes(row.axis)) throw new Error('Metric definition 缺身份或 axis 非法');
  if (!['up', 'down', 'none'].includes(row.direction) || !SCORECARDS.includes(scorecard)) throw new Error('Metric direction/scorecard 非法');
  if (scorecard === 'system-health' && !row.systemHealthOnly) throw new Error('system-health KPI 必须声明 systemHealthOnly');
  if (scorecard !== 'system-health' && row.systemHealthOnly) throw new Error('业务 scorecard 不得伪装 systemHealthOnly');
  return Object.freeze(row);
}

export function normalizeMetricFormula(value = {}) {
  rejectSecrets(value); rejectUnknown(value, FORMULA_KEYS, 'Metric formula');
  if (value.schema != null && value.schema !== METRIC_FORMULA_SCHEMA) throw new Error(`未知 Formula schema：${value.schema}`);
  const row = {
    schema: METRIC_FORMULA_SCHEMA, formulaId: asString(value.formulaId, 320), version: asString(value.version, 120),
    metricRef: normalizeVersionRef(value.metricRef, 'Formula metricRef'), operation: asString(value.operation, 60),
    missingPolicy: asString(value.missingPolicy || 'fail-closed', 60),
    precision: Math.max(0, Math.min(8, Math.trunc(Number(value.precision) || 0))),
    effectiveFrom: requireIso(value.effectiveFrom, 'Formula effectiveFrom'), description: asString(value.description, 1000),
  };
  if (!row.formulaId || !row.version || !['mean', 'sum', 'passthrough'].includes(row.operation)) throw new Error('Formula 缺身份或 operation 非法');
  if (!['fail-closed', 'exclude-unknown'].includes(row.missingPolicy)) throw new Error('Formula missingPolicy 非法');
  return Object.freeze(row);
}

function normalizeSample(value = {}) {
  rejectUnknown(value, SAMPLE_KEYS, 'Evaluation sample');
  const status = asString(value.status, 60);
  if (!['measured', 'unknown', 'not-applicable'].includes(status)) throw new Error(`非法 sample.status：${status}`);
  const row = {
    sampleId: asString(value.sampleId, 360), runId: asString(value.runId, 240), taskRef: asString(value.taskRef, 360),
    artifactRefs: strings(value.artifactRefs, 1000), findingRefs: strings(value.findingRefs, 1000),
    gateRefs: strings(value.gateRefs, 1000), humanDecisionRefs: strings(value.humanDecisionRefs, 1000),
    evidenceRefs: strings(value.evidenceRefs, 1000), observedAt: requireIso(value.observedAt, 'Sample observedAt'),
    status, value: finiteOrNull(value.value), reason: asString(value.reason, 1000),
  };
  if (!row.sampleId || !row.runId || !row.taskRef) throw new Error('Evaluation sample 缺 sampleId/runId/taskRef');
  if (status === 'measured' && row.value == null) throw new Error('measured sample 缺有限 value');
  if (status !== 'measured' && !row.reason) throw new Error(`${status} sample 必须说明原因`);
  return Object.freeze(row);
}

function computeResult(metric, formula, samples) {
  const measured = samples.filter(row => row.status === 'measured');
  const unknown = samples.filter(row => row.status === 'unknown');
  const applicable = samples.filter(row => row.status !== 'not-applicable');
  if (!applicable.length) return { status: 'not-applicable', value: null, unit: metric.unit, sampleCount: samples.length, measuredCount: 0, reason: '该上下文无适用样本' };
  if (formula.missingPolicy === 'fail-closed' && unknown.length) return { status: 'unknown', value: null, unit: metric.unit, sampleCount: samples.length, measuredCount: measured.length, reason: `${unknown.length} 个样本未知，按 fail-closed 不计算` };
  if (measured.length < metric.sampleWindow.minSamples) return { status: 'insufficient-sample', value: null, unit: metric.unit, sampleCount: samples.length, measuredCount: measured.length, reason: `至少需要 ${metric.sampleWindow.minSamples} 个实测样本` };
  const values = measured.map(row => row.value);
  let value = formula.operation === 'sum' ? values.reduce((sum, item) => sum + item, 0) : values.reduce((sum, item) => sum + item, 0) / values.length;
  if (formula.operation === 'passthrough' && values.length !== 1) throw new Error('passthrough 公式必须恰有一个实测样本');
  value = Number(value.toFixed(formula.precision));
  return { status: 'measured', value, unit: metric.unit, sampleCount: samples.length, measuredCount: measured.length, reason: '' };
}

export function createLocalEvaluation({ metric, formula, evaluationId, runId, taskRef, scorecard, context = {}, evidenceWindow = {}, samples = [], createdAt, supersedesEvaluationId = '' } = {}) {
  const normalizedMetric = normalizeMetricDefinition(metric);
  const normalizedFormula = normalizeMetricFormula(formula);
  if (versionKey(normalizedFormula.metricRef) !== versionKey({ id: normalizedMetric.metricId, version: normalizedMetric.version })) throw new Error('Formula 与 Metric 版本不匹配');
  rejectUnknown(context, CONTEXT_KEYS, 'Evaluation context');
  rejectUnknown(evidenceWindow, EVIDENCE_WINDOW_KEYS, 'Evaluation evidenceWindow');
  const normalizedSamples = asArray(samples).map(normalizeSample);
  const row = {
    schema: LOCAL_EVALUATION_SCHEMA, evaluationId: asString(evaluationId, 360), runId: asString(runId, 240),
    taskRef: asString(taskRef, 360),
    metricRef: Object.freeze({ id: normalizedMetric.metricId, version: normalizedMetric.version }),
    formulaRef: Object.freeze({ id: normalizedFormula.formulaId, version: normalizedFormula.version }),
    scorecard: asString(scorecard || normalizedMetric.scorecard, 60),
    context: {
      domain: asString(context.domain, 160), workflow: asString(context.workflow, 160),
      workflowVersion: asString(context.workflowVersion, 120), governanceProfile: asString(context.governanceProfile, 160),
      artifactType: asString(context.artifactType, 160), seatRef: asString(context.seatRef, 240),
      executorRef: asString(context.executorRef, 240), providerRef: asString(context.providerRef, 240),
      modelRef: asString(context.modelRef, 300), defectClass: asString(context.defectClass, 160),
    },
    evidenceWindow: { from: requireIso(evidenceWindow.from, 'Evaluation window.from'), to: requireIso(evidenceWindow.to, 'Evaluation window.to') },
    samples: normalizedSamples, result: computeResult(normalizedMetric, normalizedFormula, normalizedSamples),
    createdAt: requireIso(createdAt, 'Evaluation createdAt'), supersedesEvaluationId: asString(supersedesEvaluationId, 360),
  };
  if (!row.evaluationId || !row.runId || !row.taskRef || !SCORECARDS.includes(row.scorecard)) throw new Error('Evaluation 缺身份或 scorecard 非法');
  if (row.scorecard !== normalizedMetric.scorecard) throw new Error('Evaluation scorecard 与 Metric 不匹配');
  if (Date.parse(row.evidenceWindow.to) < Date.parse(row.evidenceWindow.from)) throw new Error('Evaluation evidenceWindow 非法');
  if (normalizedSamples.some(sample => sample.runId !== row.runId || sample.taskRef !== row.taskRef)) throw new Error('Evaluation sample 不属于同一 Run/Task');
  return Object.freeze(row);
}

export function normalizeLocalEvaluation(value = {}, { metrics = new Map(), formulas = new Map() } = {}) {
  rejectSecrets(value); rejectUnknown(value, EVALUATION_KEYS, 'Local evaluation');
  if (value.schema !== LOCAL_EVALUATION_SCHEMA) throw new Error(`未知 Evaluation schema：${value.schema || '空'}`);
  rejectUnknown(value.context || {}, CONTEXT_KEYS, 'Evaluation context');
  rejectUnknown(value.evidenceWindow || {}, EVIDENCE_WINDOW_KEYS, 'Evaluation evidenceWindow');
  rejectUnknown(value.result || {}, RESULT_KEYS, 'Evaluation result');
  const metricRef = normalizeVersionRef(value.metricRef, 'Evaluation metricRef');
  const formulaRef = normalizeVersionRef(value.formulaRef, 'Evaluation formulaRef');
  const metric = metrics.get(versionKey(metricRef)); const formula = formulas.get(versionKey(formulaRef));
  if (!metric || !formula) throw new Error('Evaluation 引用未知 Metric/Formula 版本');
  const recomputed = createLocalEvaluation({
    metric, formula, evaluationId: value.evaluationId, runId: value.runId, taskRef: value.taskRef,
    scorecard: value.scorecard, context: value.context, evidenceWindow: value.evidenceWindow,
    samples: value.samples, createdAt: value.createdAt, supersedesEvaluationId: value.supersedesEvaluationId,
  });
  if (JSON.stringify(recomputed.result) !== JSON.stringify(value.result)) throw new Error('Evaluation result 与版本化公式重算不一致');
  return recomputed;
}

export function normalizeEconomicsLedgerRecord(value = {}, context = {}) {
  rejectSecrets(value); rejectUnknown(value, ENVELOPE_KEYS, 'Economics ledger record');
  const type = asString(value.type, 120);
  if (!ECONOMICS_RECORD_TYPES.includes(type)) throw new Error(`非法 Economics record type：${type || '空'}`);
  const record = {
    schema: ECONOMICS_LEDGER_RECORD_SCHEMA, recordId: asString(value.recordId || context.recordId, 420), type,
    sequence: Math.max(1, Number(value.sequence || context.sequence) || 0),
    occurredAt: asString(value.occurredAt || context.occurredAt, 80), runId: asString(value.runId || context.runId, 240),
    authorityRef: asString(value.authorityRef, 240), evidenceRefs: strings(value.evidenceRefs, 1000),
    priceTable: null, cost: null, metric: null, formula: null, evaluation: null,
    reasonCode: asString(value.reasonCode, 160), message: asString(value.message, 1000),
  };
  if (!record.recordId || !record.runId || !Number.isFinite(Date.parse(record.occurredAt))) throw new Error('Economics record 缺 recordId/runId/occurredAt');
  if (type === 'price-table-defined') record.priceTable = normalizePriceTable(value.priceTable);
  if (type === 'cost-recorded') {
    record.cost = normalizeCostRecord(value.cost);
    if (record.cost.runId !== record.runId) throw new Error('Cost record runId 不一致');
  }
  if (type === 'metric-defined') record.metric = normalizeMetricDefinition(value.metric);
  if (type === 'formula-defined') record.formula = normalizeMetricFormula(value.formula);
  if (type === 'evaluation-recorded') {
    if (!context.metrics || !context.formulas) throw new Error('Evaluation replay 缺 Metric/Formula 上下文');
    record.evaluation = normalizeLocalEvaluation(value.evaluation, context);
    if (record.evaluation.runId !== record.runId) throw new Error('Evaluation runId 不一致');
  }
  if (type === 'recovery-acknowledged' && (!record.authorityRef.startsWith('human:') || !record.evidenceRefs.length)) throw new Error('Economics 恢复确认必须有 human Authority 与 evidence');
  return Object.freeze(record);
}

export function replayEconomicsRecords(values = []) {
  const state = { sequence: 0, recordIds: new Set(), priceTables: new Map(), costs: new Map(), metrics: new Map(), formulas: new Map(), evaluations: new Map() };
  for (const value of values) {
    const record = normalizeEconomicsLedgerRecord(value, { metrics: state.metrics, formulas: state.formulas });
    if (record.sequence !== state.sequence + 1) throw new Error(`Economics sequence 不连续：${state.sequence}→${record.sequence}`);
    if (state.recordIds.has(record.recordId)) throw new Error(`Economics recordId 重复：${record.recordId}`);
    state.recordIds.add(record.recordId); state.sequence = record.sequence;
    if (record.priceTable) {
      const key = versionKey({ id: record.priceTable.priceTableId, version: record.priceTable.version });
      if (state.priceTables.has(key)) throw new Error(`Price table 版本重复：${key}`);
      state.priceTables.set(key, record.priceTable);
    }
    if (record.cost) {
      if (state.costs.has(record.cost.costId)) throw new Error(`Cost id 重复：${record.cost.costId}`);
      if (record.cost.priceRef.priceTableId && !state.priceTables.has(versionKey({ id: record.cost.priceRef.priceTableId, version: record.cost.priceRef.version }))) throw new Error('Cost 引用未知 Price table 版本');
      state.costs.set(record.cost.costId, record.cost);
    }
    if (record.metric) {
      const key = versionKey({ id: record.metric.metricId, version: record.metric.version });
      if (state.metrics.has(key)) throw new Error(`Metric 版本重复：${key}`);
      state.metrics.set(key, record.metric);
    }
    if (record.formula) {
      const key = versionKey({ id: record.formula.formulaId, version: record.formula.version });
      if (!state.metrics.has(versionKey(record.formula.metricRef))) throw new Error('Formula 引用未知 Metric 版本');
      if (state.formulas.has(key)) throw new Error(`Formula 版本重复：${key}`);
      state.formulas.set(key, record.formula);
    }
    if (record.evaluation) {
      if (state.evaluations.has(record.evaluation.evaluationId)) throw new Error(`Evaluation id 重复：${record.evaluation.evaluationId}`);
      state.evaluations.set(record.evaluation.evaluationId, record.evaluation);
    }
  }
  return state;
}

export function parseEconomicsLog(text, { runId = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/); const records = []; let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim(); if (!line) continue;
    try {
      const raw = JSON.parse(line);
      const state = replayEconomicsRecords([...records, raw]);
      const record = normalizeEconomicsLedgerRecord(raw, { metrics: state.metrics, formulas: state.formulas });
      if (runId && record.runId !== runId) throw new Error('runId 不匹配');
      records.push(record);
    } catch (error) {
      if (lines.slice(index + 1).some(item => item.trim())) throw new Error(`Economics 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line; break;
    }
  }
  return { records, corruptTail };
}

function semanticRecord(record) {
  const { sequence, occurredAt, ...rest } = record;
  return JSON.stringify(rest);
}

export class EconomicsEvaluationLedger {
  static async open({ io, path, runId, clock = Date.now, idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` } = {}) {
    for (const name of ['exists', 'read', 'write']) if (typeof io?.[name] !== 'function') throw new Error(`Economics Ledger IO 缺 ${name}`);
    if (!asString(path, 1600) || !asString(runId, 240)) throw new Error('Economics Ledger 缺 path/runId');
    if (!(await io.exists(path))) await io.write(path, '');
    const parsed = parseEconomicsLog(await io.read(path), { runId });
    if (parsed.corruptTail) {
      await io.write(`${path}.corrupt-tail.txt`, parsed.corruptTail);
      await io.write(path, parsed.records.map(row => JSON.stringify(row)).join('\n') + (parsed.records.length ? '\n' : ''));
    }
    const ledger = new EconomicsEvaluationLedger({ io, path, runId, clock, idFactory, records: parsed.records });
    ledger.corruptTail = parsed.corruptTail; ledger.recoveryRequired = !!parsed.corruptTail;
    return ledger;
  }

  constructor({ io, path, runId, clock, idFactory, records }) {
    this.io = io; this.path = path; this.runId = runId; this.clock = clock; this.idFactory = idFactory;
    this.records = records; this.state = replayEconomicsRecords(records); this.queue = Promise.resolve();
    this.activeWrites = 0; this.disposed = false; this.recoveryRequired = false; this.corruptTail = '';
  }

  _text(records = this.records) { return records.map(row => JSON.stringify(row)).join('\n') + (records.length ? '\n' : ''); }

  async _appendBatch(values, { allowRecovery = false } = {}) {
    if (this.disposed) throw new Error('Economics Ledger 已释放');
    if (this.recoveryRequired && !allowRecovery) throw new Error('Economics Ledger 处于恢复阻断态');
    const operation = this.queue.then(async () => {
      this.activeWrites++;
      try {
        let nextRecords = [...this.records]; let nextState = this.state;
        for (const input of values) {
          const existing = nextRecords.find(row => row.recordId === input.recordId);
          const candidate = normalizeEconomicsLedgerRecord(input, {
            sequence: existing?.sequence || nextRecords.length + 1,
            occurredAt: existing?.occurredAt || isoNow(this.clock), runId: this.runId,
            metrics: nextState.metrics, formulas: nextState.formulas,
          });
          if (existing) {
            if (semanticRecord(existing) !== semanticRecord(candidate)) throw new Error(`W73f 幂等键冲突：${input.recordId}`);
            continue;
          }
          nextRecords.push(candidate); nextState = replayEconomicsRecords(nextRecords);
        }
        await this.io.write(this.path, this._text(nextRecords));
        this.records = nextRecords; this.state = nextState;
        return this.healthSnapshot();
      } finally { this.activeWrites--; }
    });
    this.queue = operation.catch(() => {}); return operation;
  }

  appendBatch(values = []) { return this._appendBatch(values); }

  async resolveRecovery({ authorityRef, evidenceRefs = [], reason = 'economics-recovery-reviewed' } = {}) {
    if (!asString(authorityRef, 240).startsWith('human:')) throw new Error('Economics 恢复必须由 human Authority 确认');
    if (!strings(evidenceRefs, 1000).length) throw new Error('Economics 恢复必须有 evidence');
    await this._appendBatch([{
      recordId: `recovery:${this.runId}:${this.idFactory()}`, type: 'recovery-acknowledged', authorityRef,
      evidenceRefs, reasonCode: 'W73F_RECOVERY_ACKNOWLEDGED', message: reason,
    }], { allowRecovery: true });
    this.corruptTail = ''; this.recoveryRequired = false; return this.healthSnapshot();
  }

  healthSnapshot() {
    const byKind = Object.fromEntries(COST_KINDS.map(kind => [kind, 0]));
    for (const cost of this.state.costs.values()) byKind[cost.kind]++;
    return Object.freeze({
      runId: this.runId, records: this.records.length, costs: this.state.costs.size, costKinds: byKind,
      priceTables: this.state.priceTables.size, metrics: this.state.metrics.size, formulas: this.state.formulas.size,
      evaluations: this.state.evaluations.size, recoveryRequired: this.recoveryRequired,
      activeWrites: this.activeWrites, disposed: this.disposed,
    });
  }

  async dispose() { if (!this.disposed) { await this.queue; this.disposed = true; } return this.healthSnapshot(); }
}

export const openEconomicsEvaluationLedger = options => EconomicsEvaluationLedger.open(options);

export function aggregateCosts(values = []) {
  const rows = values.map(normalizeCostRecord);
  const buckets = Object.fromEntries(COST_KINDS.map(kind => [kind, { count: 0, tokens: 0, amountsByCurrency: {} }]));
  for (const row of rows) {
    const bucket = buckets[row.kind]; bucket.count++;
    if (row.usage.status !== 'unknown') bucket.tokens += row.usage.totalTokens;
    if (row.amount.status !== 'unknown') bucket.amountsByCurrency[row.amount.currency] = (bucket.amountsByCurrency[row.amount.currency] || 0) + row.amount.value;
  }
  return Object.freeze({ schema: 'mazz.cost-summary/v0', buckets, combinedTotal: null, note: '不同 cost kind 不合并；estimate 不冒充 actual，unknown 不补零。' });
}

export function computeParetoFrontier(profiles = [], dimensions = []) {
  const dims = asArray(dimensions).map(value => ({ metricId: asString(value.metricId, 320), direction: asString(value.direction, 20) }));
  if (!dims.length || dims.some(row => !row.metricId || !['up', 'down'].includes(row.direction))) throw new Error('Pareto dimensions 必须给出 metricId 与 up/down');
  const ready = []; const excluded = [];
  for (const profile of asArray(profiles)) {
    const profileId = asString(profile?.profileId, 320); const metrics = plainObject(profile?.metrics) ? profile.metrics : {};
    const missing = dims.filter(dim => {
      const value = metrics[dim.metricId];
      return !(Number.isFinite(Number(value)) || (plainObject(value) && value.status === 'measured' && Number.isFinite(Number(value.value))));
    }).map(dim => dim.metricId);
    if (!profileId || missing.length) excluded.push({ profileId, reason: 'MISSING_MEASURED_DIMENSIONS', metricIds: missing });
    else ready.push({ profileId, metrics: Object.fromEntries(dims.map(dim => [dim.metricId, Number(plainObject(metrics[dim.metricId]) ? metrics[dim.metricId].value : metrics[dim.metricId])])), evidenceRefs: strings(profile.evidenceRefs, 1000) });
  }
  const dominates = (left, right) => {
    const noWorse = dims.every(dim => dim.direction === 'up' ? left.metrics[dim.metricId] >= right.metrics[dim.metricId] : left.metrics[dim.metricId] <= right.metrics[dim.metricId]);
    const better = dims.some(dim => dim.direction === 'up' ? left.metrics[dim.metricId] > right.metrics[dim.metricId] : left.metrics[dim.metricId] < right.metrics[dim.metricId]);
    return noWorse && better;
  };
  const dominated = []; const frontier = [];
  for (const row of ready) {
    const by = ready.filter(other => other !== row && dominates(other, row)).map(other => other.profileId).sort();
    if (by.length) dominated.push({ profileId: row.profileId, dominatedBy: by }); else frontier.push(row);
  }
  return Object.freeze({ schema: 'mazz.pareto-frontier/v0', dimensions: dims, frontier: frontier.sort((a, b) => a.profileId.localeCompare(b.profileId)), dominated: dominated.sort((a, b) => a.profileId.localeCompare(b.profileId)), excluded, overallScore: null });
}

const STANDARD_METRICS = Object.freeze([
  ['production.raw-ability.baseline-quality', '原始能力', 'raw-ability', 'up', 'percent', 'production', 'matched-pair', 2],
  ['production.governance-uplift.matched-delta', '治理增益', 'governance-uplift', 'up', 'percentage-point', 'production', 'matched-pair', 2],
  ['production.final-quality.seal-rate', '终稿质量', 'final-quality', 'up', 'percent', 'production', 'run', 1],
  ['production.governance-dependency.matched-gap', '治理依赖度', 'governance-dependency', 'down', 'percentage-point', 'production', 'matched-pair', 2],
  ['production.reliability.completion-rate', '生产可靠性', 'reliability', 'up', 'percent', 'production', 'rolling-run', 5],
  ['production.cost.estimated-tokens', 'Provider 实报 Token（兼容指标）', 'cost', 'down', 'token', 'production', 'run', 1],
  ['production.latency.elapsed-ms', '生产延迟', 'latency', 'down', 'ms', 'production', 'run', 1],
  ['production.revision-cost.rework-count', '返工成本', 'revision-cost', 'down', 'count', 'production', 'run', 1],
  ['production.canon-compliance.gate-pass-rate', 'Canon 合规', 'canon-compliance', 'up', 'percent', 'production', 'run', 1],
  ['author.revision-acceptance', '作者修订接受度', 'final-quality', 'up', 'percent', 'author', 'rolling-run', 5],
  ['audience.acceptance', '受众接受度', 'final-quality', 'up', 'percent', 'audience', 'rolling-run', 5],
  ['system.machine-return-rate', '机检打回率', 'reliability', 'down', 'percent', 'system-health', 'rolling-time', 5],
  ['system.review-return-rate', '审理打回率', 'reliability', 'down', 'percent', 'system-health', 'rolling-time', 5],
  ['system.hearing-rate', '开庭率', 'governance-dependency', 'down', 'percent', 'system-health', 'rolling-time', 5],
  ['system.revision-first-pass-rate', '修订一次通过率', 'revision-cost', 'up', 'percent', 'system-health', 'rolling-time', 5],
  ['system.query-effectiveness-rate', '质询有效率', 'governance-uplift', 'up', 'percent', 'system-health', 'rolling-time', 5],
  ['system.evidence-withdrawal-rate', '撤回引据率', 'canon-compliance', 'up', 'percent', 'system-health', 'rolling-time', 5],
  ['system.human-intervention-count', '人类介入频次', 'governance-dependency', 'down', 'count', 'system-health', 'rolling-time', 5],
]);

export function standardEconomicsMetricRecords(runId, { at = new Date().toISOString() } = {}) {
  return STANDARD_METRICS.flatMap(([metricId, label, axis, direction, unit, scorecard, kind, minSamples]) => {
    const metric = normalizeMetricDefinition({
      metricId, version: '1.0.0', label, axis, direction, unit, scorecard,
      applicableContexts: scorecard === 'system-health' ? ['factory-system-health'] : ['factory.single.w68'],
      sampleWindow: { kind, minSamples, durationDays: kind === 'rolling-time' ? 7 : 0, matchedBy: kind === 'matched-pair' ? ['taskRef', 'artifactType'] : [] },
      effectiveFrom: at, systemHealthOnly: scorecard === 'system-health',
      description: scorecard === 'system-health' ? '仅作系统健康观察；不得自动处罚 Seat、改 Gate 或改方法。' : '本地透明评估；不得聚合为 One Overall Score。',
    });
    const formula = normalizeMetricFormula({
      formulaId: `${metricId}.mean`, version: '1.0.0', metricRef: { id: metricId, version: '1.0.0' },
      operation: minSamples === 1 ? 'passthrough' : 'mean', missingPolicy: 'fail-closed', precision: 2,
      effectiveFrom: at, description: '对版本化样本做透明聚合；未知值 fail-closed。',
    });
    return [
      { recordId: `metric:${metricId}@1.0.0`, type: 'metric-defined', metric },
      { recordId: `formula:${formula.formulaId}@1.0.0`, type: 'formula-defined', formula },
    ];
  });
}

export function buildW68EconomicsEvaluationBatch({
  runId, taskId, result = {}, artifactDir = '', costLedgerPath = '', findingRefs: suppliedFindingRefs = [],
  reworkRefs = [], providerRef = '', modelRef = '', unitNo = 1, at = new Date().toISOString(), metricState,
} = {}) {
  const taskRef = `factory-task:${asString(taskId, 240)}`; const prefix = `${runId}:unit:${unitNo}`;
  if (!runId || !taskId || !metricState?.metrics || !metricState?.formulas) throw new Error('W68 economics batch 缺 Run/Task/Metric state');
  const gates = Object.entries(result.gates || {}); const gateRefs = gates.map(([gate, pass]) => `w68:${gate}:${pass ? 'pass' : 'block'}`);
  const findingRefs = strings(suppliedFindingRefs, 1000).length
    ? strings(suppliedFindingRefs, 1000)
    : asArray(result.objections).map(row => asString(row?.id, 240)).filter(Boolean).map(id => `finding:${runId}:unresolved-adapter-ref:${id}`);
  const artifactRefs = artifactDir ? [`${artifactDir}/工件清单.json`, `${artifactDir}/裁决书.md`] : [];
  const evidenceRefs = [...new Set([...artifactRefs, ...strings(reworkRefs, 1000), ...(costLedgerPath ? [costLedgerPath] : [])])];
  const common = { runId, taskRef, artifactRefs, findingRefs, gateRefs, humanDecisionRefs: [], evidenceRefs, observedAt: at };
  const sample = (suffix, status, value, reason = '') => ({ sampleId: `sample:${prefix}:${suffix}`, ...common, status, value, reason });
  const providerEntries = asArray(result.budget?.entries).filter(row => row?.source === 'provider-reported');
  const providerUsage = providerEntries.reduce((usage, row) => ({
    inputTokens: usage.inputTokens + Math.max(0, Number(row.inputTokens) || 0),
    outputTokens: usage.outputTokens + Math.max(0, Number(row.outputTokens) || 0),
    totalTokens: usage.totalTokens + Math.max(0, Number(row.tokens) || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const hasProviderUsage = providerUsage.totalTokens > 0;
  const metrics = new Map([
    ['production.raw-ability.baseline-quality', sample('raw-ability', 'unknown', null, '缺少同任务无治理对照样本')],
    ['production.governance-uplift.matched-delta', sample('governance-uplift', 'unknown', null, '缺少同任务轻/标准/完整治理匹配样本')],
    ['production.final-quality.seal-rate', sample('final-quality', 'measured', result.sealed ? 100 : 0)],
    ['production.governance-dependency.matched-gap', sample('governance-dependency', 'unknown', null, '缺少同任务无治理对照样本')],
    ['production.reliability.completion-rate', sample('reliability', 'measured', result.sealed ? 100 : 0)],
    ['production.cost.estimated-tokens', hasProviderUsage
      ? sample('cost', 'measured', providerUsage.totalTokens, 'Provider 实报 usage；沿用旧 metric id 仅作兼容')
      : sample('cost', 'unknown', null, 'Provider 未返回 usage；系统不再按字符数推算 Token')],
    ['production.latency.elapsed-ms', sample('latency', 'unknown', null, '现有 W68 未记录可信起止时间')],
    ['production.revision-cost.rework-count', sample('revision-cost', 'measured', asArray(result.repairs).length)],
    ['production.canon-compliance.gate-pass-rate', gates.length ? sample('canon', 'measured', gates.filter(([, pass]) => pass).length * 100 / gates.length) : sample('canon', 'not-applicable', null, '本次没有可适用 Gate')],
    ['author.revision-acceptance', sample('author', 'unknown', null, '尚无作者显式接受/驳回决定')],
    ['audience.acceptance', sample('audience', 'unknown', null, '尚无受众反馈样本')],
  ]);
  const records = [{
    recordId: `cost:${prefix}:provider-usage`, type: 'cost-recorded',
    cost: {
      costId: `cost:${prefix}:provider-usage`, runId, taskRef, kind: hasProviderUsage ? 'provider-reported' : 'unknown', category: 'provider-usage',
      providerRef, modelRef, seatRef: 'seat:factory-review',
      usage: hasProviderUsage
        ? { status: 'reported', ...providerUsage, unit: 'token', version: 'provider.response.usage/v1', sourceRef: costLedgerPath || `${artifactDir}/成本台账.json` }
        : { status: 'unknown', inputTokens: 0, outputTokens: 0, totalTokens: 0, unit: 'token', version: '', sourceRef: '' },
      amount: { status: 'unknown' }, priceRef: {}, observedAt: at,
      reason: hasProviderUsage ? '只记录 Provider 返回的 usage；不参与流程门禁。' : 'Provider 未返回 usage；不补零、不按字符数估算，也不参与流程门禁。', evidenceRefs: artifactRefs,
    },
  }];
  for (const [metricId, oneSample] of metrics) {
    const metric = metricState.metrics.get(`${metricId}@1.0.0`); const formula = metricState.formulas.get(`${metricId}.mean@1.0.0`);
    if (!metric || !formula) throw new Error(`缺标准 Metric/Formula：${metricId}`);
    const evaluation = createLocalEvaluation({
      metric, formula, evaluationId: `evaluation:${prefix}:${metricId}`, runId, taskRef,
      context: {
        domain: 'content-production', workflow: 'W68', workflowVersion: 'W68a',
        governanceProfile: asString(result.ritual?.effective || result.ritual?.requested || 'unknown', 160), artifactType: 'reviewed-text',
        seatRef: 'seat:factory-review', executorRef: '', providerRef, modelRef,
        defectClass: findingRefs.length ? 'review-finding' : '',
      },
      evidenceWindow: { from: at, to: at }, samples: [oneSample], createdAt: at,
    });
    records.push({ recordId: `evaluation:${prefix}:${metricId}`, type: 'evaluation-recorded', evaluation });
  }
  return records;
}
