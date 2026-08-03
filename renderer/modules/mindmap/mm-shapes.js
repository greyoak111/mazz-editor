// renderer/modules/mindmap/mm-shapes.js —— 图形库 deals：流程图六符 + 箭头多形态
// node.shape：rect(默认过程) / diamond(判断) / ellipse(起止) / para(数据) / cylinder(数据库) / round(圆角过程)
// 箭头：arrow(实心三角,现状) / open(空心) / diamond(菱形) / circle(圆点) / none——全局 linkStyle.arrow 或线级覆盖
import { mmRegister } from './mm-modules.js';

export const SHAPES = [
  { id: 'rect', name: '矩形（过程）' },
  { id: 'round', name: '圆角（过程）' },
  { id: 'diamond', name: '菱形（判断）' },
  { id: 'ellipse', name: '椭圆（起止）' },
  { id: 'para', name: '平行四边形（数据）' },
  { id: 'cylinder', name: '圆柱（数据库）' },
];
export const ARROW_HEADS = [
  { id: 'arrow', name: '实心三角' },
  { id: 'open', name: '空心三角' },
  { id: 'diamond', name: '菱形' },
  { id: 'circle', name: '圆点' },
  { id: 'none', name: '无箭头' },
];

/** 形状内边距系数（文字不贴边：菱形/椭圆最吃宽度） */
export function shapePad(shape) {
  return { diamond: 1.45, ellipse: 1.3, cylinder: 1.15, para: 1.2, rect: 1, round: 1 }[shape] || 1;
}

/** 产形状元素（统一入口：fill/stroke 由调用方给） */
export function shapeEl(svgEl, shape, pos, attrs) {
  const { w, h } = pos;
  switch (shape) {
    case 'diamond':
      return svgEl('polygon', { points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`, ...attrs });
    case 'ellipse':
      return svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, ...attrs });
    case 'para': {
      const s = Math.min(w * 0.18, 22);
      return svgEl('polygon', { points: `${s},0 ${w},0 ${w - s},${h} 0,${h}`, ...attrs });
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 10);
      const d = `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} L${w},${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z`;
      return svgEl('path', { d, ...attrs });
    }
    case 'round':
      return svgEl('rect', { width: w, height: h, rx: Math.min(18, h / 2), ...attrs });
    default:
      return svgEl('rect', { width: w, height: h, ...attrs });
  }
}

/** 箭头头部 path（cx,cy 顶点 + 角度；kind 形态；ah 尺寸；color 填充） */
export function arrowHeadD(kind, cx, cy, ang, ah = 8) {
  const p = (a, r) => [cx + r * Math.cos(ang + a), cy + r * Math.sin(ang + a)];
  const [x1, y1] = p(-0.42, -ah), [x2, y2] = p(0.42, -ah);
  const [xb, yb] = p(0, -ah * 0.6);
  switch (kind) {
    case 'open': return `M${x1},${y1} L${cx},${cy} L${x2},${y2}`;
    case 'diamond': return `M${cx},${cy} L${x1},${y1} L${xb},${yb} L${x2},${y2} Z`;
    case 'circle': return null; // 圆点用 circle 元素（调用方处理）
    case 'none': return null;
    default: return `M${cx},${cy} l${x1 - cx},${y1 - cy} l${xb - x1},${yb - y1} l${x2 - xb},${y2 - yb} Z`;
  }
}

mmRegister('shapes', {
  defaultOptions: { arrow: 'arrow' },
  commands: {
    setNodeShape: class {
      queryState(ctl) { return ctl.selected ? 0 : -1; }
      execute(ctl, shape) {
        const n = ctl.selectedNode?.();
        if (!n) return false;
        n.shape = shape === 'rect' ? undefined : shape; // rect 为默认不占档
        ctl.mutate(() => {});
        return true;
      }
    },
    setArrowHead: class {
      execute(ctl, kind) {
        ctl.doc.linkStyle = { ...(ctl.doc.linkStyle || {}), arrow: kind };
        ctl.mutate(() => {});
        return true;
      }
    }
  }
});
