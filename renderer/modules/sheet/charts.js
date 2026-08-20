// renderer/modules/sheet/charts.js —— ECharts 浮动图表（柱/线/饼/散/面积/雷达）
import { iconHtml } from '../../lib/svg-icons.js';

let chartInst = null;
let chartEl = null;
let chartThemeObserver = null;

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
    <div class="sg-chart-body"></div>`;
  container.appendChild(chartEl);
  const body = chartEl.querySelector('.sg-chart-body');
  chartInst = echarts.init(body);

  const rebuild = () => {
    const type = chartEl.querySelector('select').value;
    const opt = buildOption(type, sheet, sel, getValue);
    chartInst.setOption(opt, true);
  };
  chartEl.querySelector('select').addEventListener('change', rebuild);
  // B12b 收编：图表类型子窗格化（select 隐藏保留，rebuild 读 value 照旧）
  import('../../lib/select-menu.js').then(({ selectProxy }) => selectProxy(chartEl.querySelector('select')));
  chartEl.querySelector('[data-a=close]').addEventListener('click', closeChart);
  rebuild();
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

/** Canvas 不解析 CSS var() 字符串；图表配置必须接收已经计算出的实色。 */
function resolveThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    bgElev: read('--bg-elev', '#ffffff'),
    fg: read('--fg', '#2c2c2a'),
    fgDim: read('--fg-dim', '#66645e'),
    border: read('--border', '#e0ded8'),
  };
}

export function closeChart() {
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
