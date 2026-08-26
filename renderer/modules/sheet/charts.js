// renderer/modules/sheet/charts.js —— ECharts 浮动图表（柱/线/饼/散/面积/雷达）
import { iconHtml } from '../../lib/svg-icons.js';
import { executeChartSpec } from '../../lib/capability-artifacts.js';

let chartInst = null;
let chartEl = null;
let chartThemeObserver = null;
let chartGeneration = 0;

const CHART_TYPES = [
  ['bar', '柱状图'], ['line', '折线图'], ['pie', '饼图'],
  ['scatter', '散点图'], ['area', '面积图'], ['radar', '雷达图'],
];

/** 从选区建图：首列做类目（或散点 X），其余列做系列；首行做系列名 */
export async function insertChart(container, sheet, sel, getValue) {
  closeChart();
  const echarts = await import('echarts');

  chartEl = document.createElement('div');
  chartEl.className = 'sg-chart';
  chartEl.innerHTML = `
    <div class="sg-chart-bar">
      <select class="rb-select">${CHART_TYPES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <button class="rb-btn" data-a="close" title="关闭" aria-label="关闭">${iconHtml('✕')}</button>
    </div>
    <div class="sg-chart-body" style="position:relative;overflow:hidden">
      <img class="sg-chart-artifact" alt="可追责图表资产" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2" hidden>
      <div class="sg-chart-legacy" style="position:absolute;inset:0"></div>
    </div>`;
  container.appendChild(chartEl);
  const body = chartEl.querySelector('.sg-chart-body');
  const artifactImage = body.querySelector('.sg-chart-artifact');
  const legacyBody = body.querySelector('.sg-chart-legacy');
  chartInst = echarts.init(legacyBody);

  const rebuild = async () => {
    const generation = ++chartGeneration;
    const type = chartEl.querySelector('select').value;
    const opt = buildOption(type, sheet, sel, getValue);
    chartInst.setOption(opt, true);
    if (!window.mazz?.isElectron) return;
    try {
      const result = await executeChartSpec(buildChartSpec(type, sheet, sel, getValue));
      if (generation !== chartGeneration || !chartEl?.isConnected) return;
      artifactImage.onload = () => {
        if (generation !== chartGeneration) return;
        artifactImage.hidden = false;
        legacyBody.style.visibility = 'hidden';
      };
      artifactImage.onerror = () => {
        artifactImage.hidden = true;
        legacyBody.style.visibility = 'visible';
      };
      artifactImage.src = result.grant.url;
    } catch {
      if (generation !== chartGeneration) return;
      artifactImage.hidden = true;
      legacyBody.style.visibility = 'visible';
    }
  };
  chartEl.querySelector('select').addEventListener('change', rebuild);
  // B12b 收编：图表类型子窗格化（select 隐藏保留，rebuild 读 value 照旧）
  import('../../lib/select-menu.js').then(({ selectProxy }) => selectProxy(chartEl.querySelector('select')));
  chartEl.querySelector('[data-a=close]').addEventListener('click', closeChart);
  await rebuild();
  chartThemeObserver = new MutationObserver(rebuild);
  chartThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // 拖拽移动
  const bar = chartEl.querySelector('.sg-chart-bar');
  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('select,button')) return;
    const sx = e.clientX - chartEl.offsetLeft, sy = e.clientY - chartEl.offsetTop;
    const move = (ev) => { chartEl.style.left = (ev.clientX - sx) + 'px'; chartEl.style.top = (ev.clientY - sy) + 'px'; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return chartInst;
}

function buildOption(type, sheet, sel, getValue) {
  const { r1, c1, r2, c2 } = sel;
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const line = [];
    for (let c = c1; c <= c2; c++) line.push(getValue(r, c));
    rows.push(line);
  }
  if (!rows.length) return {};
  const hasHeader = rows.length > 1;
  const header = hasHeader ? rows[0] : rows[0].map((_, i) => `系列${i + 1}`);
  const data = hasHeader ? rows.slice(1) : rows;
  const cats = data.map(row => String(row[0] ?? ''));
  const seriesCount = Math.max(1, (rows[0].length - 1));
  const theme = resolveThemeColors();
  const axis = {
    axisLabel: { color: theme.fgDim },
    axisLine: { lineStyle: { color: theme.border } },
    splitLine: { lineStyle: { color: theme.border } },
  };

  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: theme.fg },
    tooltip: {
      trigger: type === 'pie' ? 'item' : 'axis',
      backgroundColor: theme.bgElev,
      borderColor: theme.border,
      textStyle: { color: theme.fg },
    },
    animation: false,
  };

  if (type === 'pie') {
    return {
      ...base,
      series: [{
        type: 'pie', radius: ['30%', '65%'],
        data: data.map((row, i) => ({ name: cats[i], value: Number(row[1]) || 0 })),
        label: { color: theme.fg },
      }],
    };
  }
  if (type === 'radar') {
    const indicators = cats.map(name => ({ name, max: Math.max(...data.map(r => Number(r[1]) || 0)) * 1.2 || 10 }));
    return {
      ...base,
      radar: {
        indicator: indicators,
        axisName: { color: theme.fgDim },
        axisLine: { lineStyle: { color: theme.border } },
        splitLine: { lineStyle: { color: theme.border } },
      },
      series: Array.from({ length: seriesCount }, (_, si) => ({
        type: 'radar', name: String(header[si + 1] ?? `系列${si + 1}`),
        data: [{ value: data.map(row => Number(row[si + 1]) || 0), name: String(header[si + 1] ?? `系列${si + 1}`) }],
      })),
    };
  }
  if (type === 'scatter') {
    return {
      ...base,
      xAxis: { type: 'value', ...axis },
      yAxis: { type: 'value', ...axis },
      series: Array.from({ length: seriesCount }, (_, si) => ({
        type: 'scatter', name: String(header[si + 1] ?? `系列${si + 1}`),
        data: data.map((row, i) => [Number(row[0]) || i, Number(row[si + 1]) || 0]),
      })),
    };
  }
  // bar / line / area
  return {
    ...base,
    xAxis: { type: 'category', data: cats, ...axis },
    yAxis: { type: 'value', ...axis },
    legend: seriesCount > 1 ? { textStyle: { color: theme.fgDim } } : undefined,
    series: Array.from({ length: seriesCount }, (_, si) => ({
      type: type === 'area' ? 'line' : type,
      name: String(header[si + 1] ?? `系列${si + 1}`),
      areaStyle: type === 'area' ? { opacity: 0.25 } : undefined,
      data: data.map(row => Number(row[si + 1]) || 0),
    })),
  };
}

function selectedRows(sheet, sel, getValue) {
  const { r1, c1, r2, c2 } = sel;
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const line = [];
    for (let c = c1; c <= c2; c++) line.push(getValue(r, c));
    rows.push(line);
  }
  return rows;
}

function cssHex(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return '#' + [...text.slice(1)].map(char => char + char).join('');
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(text);
  if (rgb) return '#' + rgb.slice(1, 4).map(value => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, '0')).join('');
  return fallback;
}

export function buildChartSpec(type, sheet, sel, getValue) {
  let dataset = selectedRows(sheet, sel, getValue);
  if (!dataset.length) dataset = [['类别', '数值']];
  const width = dataset.reduce((max, row) => Math.max(max, row.length), 0);
  if (width < 2) dataset = [['类别', '数值'], ...dataset.map((row, index) => [String(index + 1), row[0] ?? null])];
  const columns = dataset.reduce((max, row) => Math.max(max, row.length), 0);
  const theme = resolveThemeColors();
  const locale = String(document.documentElement.lang || navigator.language || 'zh-CN').replace(/[^A-Za-z0-9._-]/g, '') || 'zh-CN';
  return {
    schema: 'mazz.chart-spec/v1',
    type,
    title: '',
    dataset,
    encoding: { categoryColumn: 0, seriesColumns: Array.from({ length: Math.max(1, columns - 1) }, (_, index) => index + 1), headerRow: dataset.length > 1 },
    width: 960,
    height: 540,
    dpi: 96,
    theme: {
      background: cssHex(theme.bgElev, '#ffffff'),
      foreground: cssHex(theme.fg, '#2c2c2a'),
      muted: cssHex(theme.fgDim, '#66645e'),
      border: cssHex(theme.border, '#e0ded8'),
      palette: [cssHex(theme.accent, '#4f46e5'), '#0f766e', '#b45309', '#be123c', '#7c3aed', '#0369a1'],
    },
    locale,
    font: { family: 'Mazz Sans', fallback: 'sans-serif' },
    seed: 0,
  };
}

/** Canvas 不解析 CSS var() 字符串；图表配置必须接收已经计算出的实色。 */
function resolveThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    bgElev: read('--bg-elev', '#ffffff'),
    fg: read('--fg', '#2c2c2a'),
    fgDim: read('--fg-dim', '#66645e'),
    border: read('--border', '#e0ded8'),
    accent: read('--accent', '#4f46e5'),
  };
}

export function closeChart() {
  chartGeneration += 1;
  chartThemeObserver?.disconnect();
  chartThemeObserver = null;
  chartInst?.dispose();
  chartEl?.remove();
  chartInst = null; chartEl = null;
}

export function getChartImage() {
  if (!chartInst) return null;
  return {
    dataUrl: chartInst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: resolveThemeColors().bgElev }),
    width: 480, height: 300,
  };
}
