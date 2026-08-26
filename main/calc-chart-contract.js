// W94B strict definitions for isolated calculation and deterministic charts.
'use strict';

const contract = require('./capability-execution-contract');

const CALC_DEFINITION_SCHEMA = 'mazz.calc-definition/v1';
const CALC_RESULT_SCHEMA = 'mazz.calc-result/v1';
const CHART_SPEC_SCHEMA = 'mazz.chart-spec/v1';
const CHART_SVG_SCHEMA = 'mazz.chart-svg/v1';

const CALC_LANGUAGES = Object.freeze(['python-expression']);
const CHART_TYPES = Object.freeze(['bar', 'line', 'area', 'scatter', 'pie', 'radar']);
const VALUE_TYPES = Object.freeze(['null', 'boolean', 'number', 'string', 'array', 'object']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COLOR = /^#[0-9a-f]{6}$/;

function integer(value, label, { min = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw contract.codedError('W94B_CONTRACT_INVALID', `${label} 必须是合法整数`);
  }
  return value;
}

function nullableSeed(value, label = 'seed') {
  if (value === null) return null;
  return integer(value, label);
}

function identifier(value, label) {
  const text = contract.exactText(value, label);
  if (!IDENTIFIER.test(text) || text.startsWith('__')) {
    throw contract.codedError('W94B_CONTRACT_INVALID', `${label} 必须是非保留标识符`);
  }
  return text;
}

function portable(value, label) {
  const cloned = contract.clonePortable(value, label);
  contract.assertNoSecrets(cloned, label);
  contract.assertNoPrivateLocators(cloned, label);
  return cloned;
}

function normalizeBindings(value) {
  const source = portable(value ?? {}, 'bindings');
  if (!contract.isPlainRecord(source)) throw contract.codedError('W94B_CONTRACT_INVALID', 'bindings 必须是普通对象');
  const output = {};
  for (const [key, item] of Object.entries(source)) output[identifier(key, `bindings.${key}`)] = item;
  return Object.freeze(output);
}

function normalizeCalcDefinition(input) {
  contract.exactKeys(input, ['schema', 'language', 'expression', 'bindings', 'resultSchema', 'seed'], 'Calc Definition');
  if (input.schema !== CALC_DEFINITION_SCHEMA) throw contract.codedError('W94B_CONTRACT_INVALID', 'Calc Definition schema 不支持');
  const language = contract.exactText(input.language, 'language');
  if (!CALC_LANGUAGES.includes(language)) throw contract.codedError('W94B_CONTRACT_INVALID', `Calc language 不支持: ${language}`);
  if (input.resultSchema !== CALC_RESULT_SCHEMA) throw contract.codedError('W94B_CONTRACT_INVALID', 'Calc resultSchema 不支持');
  const definition = {
    schema: CALC_DEFINITION_SCHEMA,
    language,
    expression: contract.exactText(input.expression, 'expression'),
    bindings: normalizeBindings(input.bindings),
    resultSchema: CALC_RESULT_SCHEMA,
    seed: nullableSeed(input.seed),
  };
  const digest = contract.sha256Hex(contract.canonicalJson(definition));
  return Object.freeze({ ...definition, definitionId: `calc-sha256-${digest}` });
}

function normalizeCalcResult(input) {
  contract.exactKeys(input, ['schema', 'definitionId', 'value', 'valueType'], 'Calc Result');
  if (input.schema !== CALC_RESULT_SCHEMA) throw contract.codedError('W94B_CONTRACT_INVALID', 'Calc Result schema 不支持');
  const value = portable(input.value, 'Calc Result.value');
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!VALUE_TYPES.includes(valueType) || input.valueType !== valueType) {
    throw contract.codedError('W94B_CONTRACT_INVALID', 'Calc Result valueType 与 value 不一致');
  }
  return Object.freeze({
    schema: CALC_RESULT_SCHEMA,
    definitionId: contract.safeId(input.definitionId, 'definitionId'),
    value,
    valueType,
  });
}

function normalizeColor(value, label) {
  const text = contract.exactText(value, label).toLowerCase();
  if (!COLOR.test(text)) throw contract.codedError('W94B_CONTRACT_INVALID', `${label} 必须是 #rrggbb`);
  return text;
}

function normalizeTheme(input) {
  contract.exactKeys(input, ['background', 'foreground', 'muted', 'border', 'palette'], 'Chart theme');
  if (!Array.isArray(input.palette) || !input.palette.length) {
    throw contract.codedError('W94B_CONTRACT_INVALID', 'Chart palette 必须是非空数组');
  }
  return Object.freeze({
    background: normalizeColor(input.background, 'theme.background'),
    foreground: normalizeColor(input.foreground, 'theme.foreground'),
    muted: normalizeColor(input.muted, 'theme.muted'),
    border: normalizeColor(input.border, 'theme.border'),
    palette: Object.freeze(input.palette.map((value, index) => normalizeColor(value, `theme.palette[${index}]`))),
  });
}

function normalizeFont(input) {
  contract.exactKeys(input, ['family', 'fallback'], 'Chart font');
  const family = contract.exactText(input.family, 'font.family');
  const fallback = contract.exactText(input.fallback, 'font.fallback');
  for (const [label, value] of [['font.family', family], ['font.fallback', fallback]]) {
    if (/[<>{};:"'\\/]/.test(value)) throw contract.codedError('W94B_CONTRACT_INVALID', `${label} 非法`);
  }
  return Object.freeze({ family, fallback });
}

function normalizeDataset(value) {
  if (!Array.isArray(value)) throw contract.codedError('W94B_CONTRACT_INVALID', 'dataset 必须是二维数组');
  const rows = value.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw contract.codedError('W94B_CONTRACT_INVALID', `dataset[${rowIndex}] 必须是数组`);
    return Object.freeze(row.map((cell, columnIndex) => {
      const normalized = portable(cell, `dataset[${rowIndex}][${columnIndex}]`);
      if (normalized !== null && !['string', 'number', 'boolean'].includes(typeof normalized)) {
        throw contract.codedError('W94B_CONTRACT_INVALID', 'Chart cell 只允许 scalar/null');
      }
      return normalized;
    }));
  });
  return Object.freeze(rows);
}

function normalizeEncoding(input, dataset) {
  contract.exactKeys(input, ['categoryColumn', 'seriesColumns', 'headerRow'], 'Chart encoding');
  const categoryColumn = integer(input.categoryColumn, 'encoding.categoryColumn', { min: 0 });
  if (!Array.isArray(input.seriesColumns) || !input.seriesColumns.length) {
    throw contract.codedError('W94B_CONTRACT_INVALID', 'encoding.seriesColumns 必须是非空数组');
  }
  const seriesColumns = input.seriesColumns.map((value, index) => integer(value, `encoding.seriesColumns[${index}]`, { min: 0 }));
  if (new Set(seriesColumns).size !== seriesColumns.length || seriesColumns.includes(categoryColumn)) {
    throw contract.codedError('W94B_CONTRACT_INVALID', 'Chart encoding 列不能重复或与 category 重叠');
  }
  if (typeof input.headerRow !== 'boolean') throw contract.codedError('W94B_CONTRACT_INVALID', 'encoding.headerRow 必须是 boolean');
  const widest = dataset.reduce((max, row) => Math.max(max, row.length), 0);
  if ([categoryColumn, ...seriesColumns].some(column => column >= widest)) {
    throw contract.codedError('W94B_CONTRACT_INVALID', 'Chart encoding 引用了不存在的列');
  }
  return Object.freeze({ categoryColumn, seriesColumns: Object.freeze(seriesColumns), headerRow: input.headerRow });
}

function normalizeChartSpec(input) {
  contract.exactKeys(input, [
    'schema', 'type', 'title', 'dataset', 'encoding', 'width', 'height', 'dpi',
    'theme', 'locale', 'font', 'seed',
  ], 'Chart Spec');
  if (input.schema !== CHART_SPEC_SCHEMA) throw contract.codedError('W94B_CONTRACT_INVALID', 'Chart Spec schema 不支持');
  const type = contract.exactText(input.type, 'type');
  if (!CHART_TYPES.includes(type)) throw contract.codedError('W94B_CONTRACT_INVALID', `Chart type 不支持: ${type}`);
  const dataset = normalizeDataset(input.dataset);
  const spec = {
    schema: CHART_SPEC_SCHEMA,
    type,
    title: input.title === '' ? '' : contract.exactText(input.title, 'title'),
    dataset,
    encoding: normalizeEncoding(input.encoding, dataset),
    width: integer(input.width, 'width', { min: 1 }),
    height: integer(input.height, 'height', { min: 1 }),
    dpi: integer(input.dpi, 'dpi', { min: 1 }),
    theme: normalizeTheme(input.theme),
    locale: contract.safeId(input.locale, 'locale'),
    font: normalizeFont(input.font),
    seed: nullableSeed(input.seed),
  };
  const digest = contract.sha256Hex(contract.canonicalJson(spec));
  return Object.freeze({ ...spec, chartSpecId: `chart-sha256-${digest}` });
}

function definitionHash(definition) {
  if (definition?.schema === CALC_DEFINITION_SCHEMA && typeof definition.definitionId === 'string') {
    const id = contract.safeId(definition.definitionId, 'definitionId');
    if (!/^calc-sha256-[0-9a-f]{64}$/.test(id)) throw contract.codedError('W94B_CONTRACT_INVALID', 'definitionId 非法');
    return `sha256-${id.slice('calc-sha256-'.length)}`;
  }
  if (definition?.schema === CHART_SPEC_SCHEMA && typeof definition.chartSpecId === 'string') {
    const id = contract.safeId(definition.chartSpecId, 'chartSpecId');
    if (!/^chart-sha256-[0-9a-f]{64}$/.test(id)) throw contract.codedError('W94B_CONTRACT_INVALID', 'chartSpecId 非法');
    return `sha256-${id.slice('chart-sha256-'.length)}`;
  }
  const normalized = definition.schema === CALC_DEFINITION_SCHEMA
    ? normalizeCalcDefinition(definition) : normalizeChartSpec(definition);
  const id = normalized.definitionId || normalized.chartSpecId;
  return `sha256-${id.slice(id.lastIndexOf('-') + 1)}`;
}

module.exports = {
  CALC_DEFINITION_SCHEMA,
  CALC_RESULT_SCHEMA,
  CHART_SPEC_SCHEMA,
  CHART_SVG_SCHEMA,
  CALC_LANGUAGES,
  CHART_TYPES,
  normalizeCalcDefinition,
  normalizeCalcResult,
  normalizeChartSpec,
  definitionHash,
};
