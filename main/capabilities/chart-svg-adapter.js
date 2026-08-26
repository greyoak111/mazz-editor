// W94B deterministic, DOM-free SVG chart adapter.
'use strict';

const contract = require('../capability-execution-contract');
const chartContract = require('../calc-chart-contract');

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function chartRows(spec) {
  const rows = spec.encoding.headerRow ? spec.dataset.slice(1) : spec.dataset;
  const header = spec.encoding.headerRow ? spec.dataset[0] : [];
  return {
    rows,
    categories: rows.map((row, index) => String(row[spec.encoding.categoryColumn] ?? index + 1)),
    series: spec.encoding.seriesColumns.map((column, index) => ({
      name: String(header[column] ?? `系列${index + 1}`),
      values: rows.map(row => finiteNumber(row[column])),
    })),
  };
}

function points(values, xAt, yAt) {
  return values.map((value, index) => `${xAt(index).toFixed(3)},${yAt(value).toFixed(3)}`).join(' ');
}

function renderCartesian(spec, data, box) {
  const all = data.series.flatMap(series => series.values);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  const yAt = value => box.y + box.h - ((value - min) / (max - min)) * box.h;
  const step = box.w / Math.max(1, data.categories.length);
  const xAt = index => box.x + step * (index + 0.5);
  const svg = [];
  svg.push(`<line x1="${box.x}" y1="${box.y + box.h}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="${spec.theme.border}"/>`);
  svg.push(`<line x1="${box.x}" y1="${box.y}" x2="${box.x}" y2="${box.y + box.h}" stroke="${spec.theme.border}"/>`);
  data.categories.forEach((category, index) => svg.push(`<text x="${xAt(index).toFixed(3)}" y="${box.y + box.h + 24}" text-anchor="middle" fill="${spec.theme.muted}">${esc(category)}</text>`));
  if (spec.type === 'bar') {
    const groupWidth = step * 0.72;
    const width = groupWidth / Math.max(1, data.series.length);
    data.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
      const zero = yAt(0);
      const y = Math.min(zero, yAt(value));
      const height = Math.abs(yAt(value) - zero);
      const x = xAt(index) - groupWidth / 2 + seriesIndex * width;
      svg.push(`<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${Math.max(0, width - 2).toFixed(3)}" height="${height.toFixed(3)}" fill="${spec.theme.palette[seriesIndex % spec.theme.palette.length]}"/>`);
    }));
  } else {
    data.series.forEach((series, seriesIndex) => {
      const color = spec.theme.palette[seriesIndex % spec.theme.palette.length];
      const polyline = points(series.values, xAt, yAt);
      if (spec.type === 'area') {
        const zero = yAt(0).toFixed(3);
        svg.push(`<polygon points="${xAt(0).toFixed(3)},${zero} ${polyline} ${xAt(Math.max(0, series.values.length - 1)).toFixed(3)},${zero}" fill="${color}" fill-opacity="0.22"/>`);
      }
      if (spec.type === 'scatter') {
        series.values.forEach((value, index) => svg.push(`<circle cx="${xAt(index).toFixed(3)}" cy="${yAt(value).toFixed(3)}" r="4" fill="${color}"/>`));
      } else {
        svg.push(`<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2"/>`);
      }
    });
  }
  return svg.join('');
}

function renderPie(spec, data, box) {
  const values = data.series[0]?.values.map(value => Math.max(0, value)) || [];
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radius = Math.max(1, Math.min(box.w, box.h) * 0.38);
  let angle = -Math.PI / 2;
  return values.map((value, index) => {
    const next = angle + (value / total) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * radius;
    const y1 = cy + Math.sin(angle) * radius;
    const x2 = cx + Math.cos(next) * radius;
    const y2 = cy + Math.sin(next) * radius;
    const large = next - angle > Math.PI ? 1 : 0;
    const middle = angle + (next - angle) / 2;
    const labelX = cx + Math.cos(middle) * radius * 0.70;
    const labelY = cy + Math.sin(middle) * radius * 0.70;
    const path = `<path d="M ${cx.toFixed(3)} ${cy.toFixed(3)} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${spec.theme.palette[index % spec.theme.palette.length]}"/><text x="${labelX.toFixed(3)}" y="${labelY.toFixed(3)}" text-anchor="middle" fill="${spec.theme.foreground}">${esc(data.categories[index] ?? index + 1)}</text>`;
    angle = next;
    return path;
  }).join('');
}

function renderRadar(spec, data, box) {
  const count = Math.max(1, data.categories.length);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radius = Math.min(box.w, box.h) * 0.38;
  const max = Math.max(1, ...data.series.flatMap(series => series.values.map(value => Math.abs(value))));
  const axis = index => -Math.PI / 2 + index * Math.PI * 2 / count;
  const svg = [];
  for (let index = 0; index < count; index += 1) {
    const angle = axis(index);
    svg.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(angle) * radius).toFixed(3)}" y2="${(cy + Math.sin(angle) * radius).toFixed(3)}" stroke="${spec.theme.border}"/>`);
    svg.push(`<text x="${(cx + Math.cos(angle) * radius * 1.10).toFixed(3)}" y="${(cy + Math.sin(angle) * radius * 1.10).toFixed(3)}" text-anchor="middle" fill="${spec.theme.muted}">${esc(data.categories[index] ?? index + 1)}</text>`);
  }
  data.series.forEach((series, seriesIndex) => {
    const pts = series.values.map((value, index) => {
      const r = Math.abs(value) / max * radius;
      const angle = axis(index);
      return `${(cx + Math.cos(angle) * r).toFixed(3)},${(cy + Math.sin(angle) * r).toFixed(3)}`;
    }).join(' ');
    const color = spec.theme.palette[seriesIndex % spec.theme.palette.length];
    svg.push(`<polygon points="${pts}" fill="${color}" fill-opacity="0.20" stroke="${color}" stroke-width="2"/>`);
  });
  return svg.join('');
}

function renderChartSvg(input) {
  let spec;
  if (input && typeof input === 'object' && Object.hasOwn(input, 'chartSpecId')) {
    const { chartSpecId, ...definition } = input;
    spec = chartContract.normalizeChartSpec(definition);
    if (chartSpecId !== spec.chartSpecId) {
      throw contract.codedError('CAPABILITY_CHART_SPEC_ID_MISMATCH', 'Chart Spec identity 不匹配');
    }
  } else spec = chartContract.normalizeChartSpec(input);
  const data = chartRows(spec);
  const margin = { top: spec.title ? 58 : 30, right: 30, bottom: 56, left: 56 };
  const box = { x: margin.left, y: margin.top, w: Math.max(1, spec.width - margin.left - margin.right), h: Math.max(1, spec.height - margin.top - margin.bottom) };
  let body = '';
  if (spec.type === 'pie') body = renderPie(spec, data, box);
  else if (spec.type === 'radar') body = renderRadar(spec, data, box);
  else body = renderCartesian(spec, data, box);
  const family = `${esc(spec.font.family)},${esc(spec.font.fallback)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-label="${esc(spec.title || 'Chart')}" data-chart-spec="${spec.chartSpecId}"><rect width="100%" height="100%" fill="${spec.theme.background}"/><g font-family="${family}" font-size="12" fill="${spec.theme.foreground}">${spec.title ? `<text x="${spec.width / 2}" y="30" text-anchor="middle" font-size="18">${esc(spec.title)}</text>` : ''}${body}</g></svg>`;
}

function createChartSvgAdapter() {
  const descriptor = contract.normalizeCapabilityDescriptor({
    schema: contract.CAPABILITY_DESCRIPTOR_SCHEMA,
    capabilityId: 'mazz.chart.svg',
    version: '1.0.0',
    adapterId: 'mazz.chart.svg-deterministic',
    displayName: 'Mazz Deterministic SVG Chart',
    kind: 'chart',
    executionPlane: 'main',
    inputSchemas: [],
    outputSchemas: [chartContract.CHART_SPEC_SCHEMA, chartContract.CHART_SVG_SCHEMA],
    determinism: 'deterministic',
    safetyClass: 'local-safe',
    availability: { state: 'available', checkedAt: new Date().toISOString(), reason: 'BUILTIN_SVG_RENDERER', evidenceRef: 'runtime:mazz-chart-svg' },
    cancelMode: 'cooperative',
    resumeMode: 'restart',
    provenance: { adapter: 'built-in', renderer: 'deterministic-svg-v1', canvas: false, network: false },
  });
  return Object.freeze({
    protocol: contract.CAPABILITY_ADAPTER_PROTOCOL,
    descriptor,
    async execute({ proposal, signal, artifacts }) {
      contract.exactKeys(proposal.parameters, ['spec'], 'Chart proposal parameters');
      contract.exactKeys(proposal.constraints, [], 'Chart proposal constraints');
      const spec = chartContract.normalizeChartSpec(proposal.parameters.spec);
      if (signal.aborted) throw contract.codedError('CAPABILITY_CANCELLED', 'Chart cancelled');
      const specBytes = Buffer.from(contract.canonicalJson({
        schema: spec.schema, type: spec.type, title: spec.title, dataset: spec.dataset, encoding: spec.encoding,
        width: spec.width, height: spec.height, dpi: spec.dpi, theme: spec.theme, locale: spec.locale,
        font: spec.font, seed: spec.seed,
      }), 'utf8');
      const svgBytes = Buffer.from(renderChartSvg(spec), 'utf8');
      const [specPublication, svgPublication] = await Promise.all([
        artifacts.publishBytes(specBytes, { signal }),
        artifacts.publishBytes(svgBytes, { signal }),
      ]);
      const definitionHash = chartContract.definitionHash(spec);
      return Object.freeze({
        status: 'completed',
        outputs: Object.freeze([
          Object.freeze({
            schema: contract.ARTIFACT_SCHEMA, kind: 'chart-spec', mediaType: 'application/vnd.mazz.chart-spec+json; charset=utf-8',
            contentSchema: chartContract.CHART_SPEC_SCHEMA, contentHash: specPublication.contentHash, definitionHash,
            storageRef: specPublication.storageRef, sourceArtifacts: proposal.inputs.map(row => row.artifactId), rightsRef: '', mutableHead: false,
          }),
          Object.freeze({
            schema: contract.ARTIFACT_SCHEMA, kind: 'chart-svg', mediaType: 'image/svg+xml; charset=utf-8',
            contentSchema: chartContract.CHART_SVG_SCHEMA, contentHash: svgPublication.contentHash, definitionHash,
            storageRef: svgPublication.storageRef, sourceArtifacts: proposal.inputs.map(row => row.artifactId), rightsRef: '', mutableHead: false,
          }),
        ]),
        environment: { runtime: 'node', renderer: 'deterministic-svg-v1', canvas: false, dpi: spec.dpi, locale: spec.locale },
        diagnostics: { summaryRef: 'diagnostic:w94b-chart-complete' },
        resourceFinal: { activeOwners: 0, stagingCount: artifacts.snapshot().stagingCount },
        provenance: { adapter: descriptor.adapterId, chartSpecId: spec.chartSpecId },
        seed: spec.seed,
      });
    },
    async cancel() { return true; },
    async dispose() { return { status: 'disposed' }; },
  });
}

module.exports = { createChartSvgAdapter, renderChartSvg, esc };
