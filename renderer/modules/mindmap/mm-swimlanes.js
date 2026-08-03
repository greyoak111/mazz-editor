// renderer/modules/mindmap/mm-swimlanes.js —— 泳道简版 deals：背景分区 + 归属着色
// doc.swimlanes = [{id, title, x, y, w, h, color}]（绝对坐标背景层）；节点中心点落入即归属（边框着色）
import { mmRegister } from './mm-modules.js';
import { toast } from '../../shell/shell.js';

const LANE_COLORS = ['#e0f2fe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5'];
let laneSeq = 1;

export function laneOf(lanes, cx, cy) {
  return (lanes || []).find(l => cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h) || null;
}

mmRegister('swimlanes', {
  commands: {
    addSwimlane: class {
      execute(ctl, opts = {}) {
        const doc = ctl.doc;
        doc.swimlanes = doc.swimlanes || [];
        const color = opts.color || LANE_COLORS[doc.swimlanes.length % LANE_COLORS.length];
        const lane = {
          id: 'lane' + (laneSeq++) + '-' + Date.now().toString(36),
          title: opts.title || '泳道 ' + (doc.swimlanes.length + 1),
          x: opts.x ?? 40, y: opts.y ?? 40, w: opts.w ?? 360, h: opts.h ?? 240, color,
        };
        doc.swimlanes.push(lane);
        ctl.mutate(() => {});
        toast('泳道已加（标题条拖动移位，右下手柄调尺寸）');
        return lane;
      }
    },
    removeSwimlane: class {
      execute(ctl, id) {
        const doc = ctl.doc;
        if (!doc.swimlanes?.length) return false;
        doc.swimlanes = doc.swimlanes.filter(l => l.id !== id);
        ctl.mutate(() => {});
        return true;
      }
    },
    renameSwimlane: class {
      execute(ctl, { id, title }) {
        const lane = ctl.doc.swimlanes?.find(l => l.id === id);
        if (!lane) return false;
        lane.title = title;
        ctl.mutate(() => {});
        return true;
      }
    }
  }
});

/** 渲染泳道背景层（节点下层；返回是否渲染了任一泳道） */
export function renderSwimlanes(svgEl, viewport, ctl) {
  const lanes = ctl.doc.swimlanes || [];
  for (const lane of lanes) {
    const g = svgEl('g', { class: 'mm-lane', 'data-id': lane.id });
    g.appendChild(svgEl('rect', {
      x: lane.x, y: lane.y, width: lane.w, height: lane.h, rx: 10,
      fill: lane.color, 'fill-opacity': 0.42, stroke: lane.color, 'stroke-width': 1.5,
    }));
    const bar = svgEl('rect', { x: lane.x, y: lane.y, width: lane.w, height: 26, rx: 10, fill: lane.color, 'fill-opacity': 0.85, class: 'mm-lane-bar' });
    bar.style.cursor = 'grab';
    g.appendChild(bar);
    const t = svgEl('text', { x: lane.x + 12, y: lane.y + 17.5, 'font-size': 12.5, 'font-weight': 600, fill: 'var(--fg,#3a3936)' });
    t.textContent = lane.title;
    g.appendChild(t);
    // 标题条拖拽移位
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      ctl._laneDrag = { id: lane.id, sx: e.clientX, sy: e.clientY, ox: lane.x, oy: lane.y, mode: 'move' };
    });
    // 右下调尺寸手柄
    const rz = svgEl('rect', { x: lane.x + lane.w - 12, y: lane.y + lane.h - 12, width: 11, height: 11, rx: 2, fill: lane.color, stroke: 'var(--bd,#d8d6cf)', class: 'mm-lane-rz' });
    rz.style.cursor = 'nwse-resize';
    rz.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      ctl._laneDrag = { id: lane.id, sx: e.clientX, sy: e.clientY, ow: lane.w, oh: lane.h, mode: 'resize' };
    });
    g.appendChild(rz);
    viewport.appendChild(g);
  }
  return lanes.length > 0;
}

/** 泳道拖拽统一处理（pointermove/pointerup；主循环调） */
export function laneDragMove(ctl, e) {
  const d = ctl._laneDrag;
  if (!d) return false;
  const lane = ctl.doc.swimlanes?.find(l => l.id === d.id);
  if (!lane) { ctl._laneDrag = null; return false; }
  const k = ctl.cam.k;
  if (d.mode === 'move') {
    lane.x = d.ox + (e.clientX - d.sx) / k;
    lane.y = d.oy + (e.clientY - d.sy) / k;
  } else {
    lane.w = Math.max(120, d.ow + (e.clientX - d.sx) / k);
    lane.h = Math.max(80, d.oh + (e.clientY - d.sy) / k);
  }
  return true;
}
export function laneDragEnd(ctl) { const had = !!ctl._laneDrag; ctl._laneDrag = null; return had; }
