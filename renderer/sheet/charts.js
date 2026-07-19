// renderer/modules/sheet/charts.js —— ECharts 浮动图表（柱/线/饼/散/面积/雷达）
let chartInst = null;
let chartEl = null;

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
      <button class="rb-btn" data-a="close" title="关闭">✕</button>
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
  chartEl.querySelector('[data-a=close]').addEventListener('click', closeChart);
  rebuild();

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

  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: 'var(--fg)' },
    tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
    animation: false,
  };

  if (type === 'pie') {
    return {
      ...base,
      series: [{
        type: 'pie', radius: ['30%', '65%'],
        data: data.map((row, i) => ({ name: cats[i], value: Number(row[1]) || 0 })),
        label: { color: 'var(--fg)' },
      }],
    };
  }
  if (type === 'radar') {
    const indicators = cats.map(name => ({ name, max: Math.max(...data.map(r => Number(r[1]) || 0)) * 1.2 || 10 }));
    return {
      ...base,
      radar: { indicator: indicators },
      series: Array.from({ length: seriesCount }, (_, si) => ({
        type: 'radar', name: String(header[si + 1] ?? `系列${si + 1}`),
        data: [{ value: data.map(row => Number(row[si + 1]) || 0), name: String(header[si + 1] ?? `系列${si + 1}`) }],
      })),
    };
  }
  if (type === 'scatter') {
    return {
      ...base,
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: Array.from({ length: seriesCount }, (_, si) => ({
        type: 'scatter', name: String(header[si + 1] ?? `系列${si + 1}`),
        data: data.map((row, i) => [Number(row[0]) || i, Number(row[si + 1]) || 0]),
      })),
    };
  }
  // bar / line / area
  return {
    ...base,
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    legend: seriesCount > 1 ? { textStyle: { color: 'var(--fg-dim)' } } : undefined,
    series: Array.from({ length: seriesCount }, (_, si) => ({
      type: type === 'area' ? 'line' : type,
      name: String(header[si + 1] ?? `系列${si + 1}`),
      areaStyle: type === 'area' ? { opacity: 0.25 } : undefined,
      data: data.map(row => Number(row[si + 1]) || 0),
    })),
  };
}

export function closeChart() {
  chartInst?.dispose();
  chartEl?.remove();
  chartInst = null; chartEl = null;
}

export function getChartImage() {
  if (!chartInst) return null;
  return {
    dataUrl: chartInst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' }),
    width: 480, height: 300,
  };
}
