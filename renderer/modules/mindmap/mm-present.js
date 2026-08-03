// renderer/modules/mindmap/mm-present.js —— 演示叙事模式 deals：圈帧→排序→F5 逐帧平滑缩放（Prezi 式）
// kityminder 弹药：①命令化（帧与放映全命令+三段闸）②状态机（mmStatus 单字段+rollback，present 态编辑自判禁用）
// 镜头动画器通用化（camTween：将来演示画布化共用同一引擎——导图帧叙事是它的首个消费者）
import { mmRegister } from './mm-modules.js';
import { toast } from '../../shell/shell.js';

let frameSeq = 1;
export function createFrame({ x, y, w, h, title = '', note = '' }) {
  return { id: 'fr' + (frameSeq++) + '-' + Date.now().toString(36), title: title || '帧', x, y, w, h, note };
}

/** 镜头动画器（通用）：cam 从 from 到 to 平滑过渡（easeInOutCubic；取消旧趟） */
export function camTween(ctl, to, { duration = 520, done } = {}) {
  if (ctl._tween?.raf) cancelAnimationFrame(ctl._tween.raf);
  const from = { x: ctl.cam.x, y: ctl.cam.y, k: ctl.cam.k };
  const t0 = performance.now();
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const apply = (m) => {
    ctl.cam.x = from.x + (to.x - from.x) * m;
    ctl.cam.y = from.y + (to.y - from.y) * m;
    ctl.cam.k = from.k + (to.k - from.k) * m;
    ctl.setCam?.();
  };
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    apply(ease(t));
    if (t < 1) ctl._tween.raf = requestAnimationFrame(step);
    else { ctl._tween = null; done?.(); }
  };
  ctl._tween = { raf: requestAnimationFrame(step) };
  return ctl._tween;
}

/** 帧 → 镜头目标（帧世界矩形适配视口：k=容纳比例+居中） */
export function camOfFrame(ctl, fr, wrap) {
  const vw = wrap.clientWidth || 800, vh = wrap.clientHeight || 600;
  const k = Math.min(vw / (fr.w + 80), vh / (fr.h + 80), 2.2);
  return { x: vw / 2 - (fr.x + fr.w / 2) * k, y: vh / 2 - (fr.y + fr.h / 2) * k, k };
}

/** 放映态：status 单字段+rollback（kityminder status.js 同款极简） */
export function enterPresent(ctl, idx = 0) {
  const frames = ctl.doc.frames || [];
  if (!frames.length) { toast('还没有帧——先「+帧」圈出要讲的画面'); return false; }
  ctl._prevCam = { ...ctl.cam }; // 还原快照
  ctl.mmStatus = 'present';
  ctl._presentIdx = Math.max(0, Math.min(idx, frames.length - 1));
  document.dispatchEvent(new CustomEvent('mm:present-change', { detail: { on: true, idx: ctl._presentIdx, total: frames.length } }));
  goFrame(ctl, ctl._presentIdx, { duration: 420 });
  return true;
}
export function goFrame(ctl, idx, { duration = 560 } = {}) {
  const frames = ctl.doc.frames || [];
  if (ctl.mmStatus !== 'present' || idx < 0 || idx >= frames.length) return false;
  ctl._presentIdx = idx;
  document.dispatchEvent(new CustomEvent('mm:present-change', { detail: { on: true, idx, total: frames.length, frame: frames[idx] } }));
  const wrap = ctl.root.querySelector('.mm-canvas-wrap');
  camTween(ctl, camOfFrame(ctl, frames[idx], wrap), { duration });
  return true;
}
export function exitPresent(ctl) {
  if (ctl.mmStatus !== 'present') return false;
  ctl.mmStatus = 'normal'; // rollback
  document.dispatchEvent(new CustomEvent('mm:present-change', { detail: { on: false } }));
  if (ctl._prevCam) camTween(ctl, ctl._prevCam, { duration: 380 });
  ctl._prevCam = null;
  return true;
}

mmRegister('present', {
  commands: {
    addFrame: class {
      queryState(ctl) { return ctl.mmStatus === 'present' ? -1 : 0; }
      execute(ctl, opts = {}) {
        const wrap = ctl.root.querySelector('.mm-canvas-wrap');
        const vw = (wrap.clientWidth || 800) / ctl.cam.k, vh = (wrap.clientHeight || 600) / ctl.cam.k;
        const fr = createFrame({
          x: opts.x ?? (-ctl.cam.x / ctl.cam.k + vw * 0.06),
          y: opts.y ?? (-ctl.cam.y / ctl.cam.k + vh * 0.06),
          w: opts.w ?? vw * 0.88, h: opts.h ?? vh * 0.88,
          title: opts.title || `帧 ${(ctl.doc.frames || []).length + 1}`,
        });
        ctl.doc.frames = ctl.doc.frames || [];
        ctl.doc.frames.push(fr);
        ctl.mutate(() => {});
        toast(`已圈「${fr.title}」（当前视口成帧）`);
        return fr;
      }
    },
    removeFrame: class {
      queryState(ctl) { return ctl.mmStatus === 'present' ? -1 : 0; }
      execute(ctl, id) {
        ctl.doc.frames = (ctl.doc.frames || []).filter(f => f.id !== id);
        ctl.mutate(() => {});
        return true;
      }
    },
    moveFrame: class {
      queryState(ctl) { return ctl.mmStatus === 'present' ? -1 : 0; }
      execute(ctl, { id, dir }) { // dir: -1 上移 / 1 下移
        const fs = ctl.doc.frames || [];
        const i = fs.findIndex(f => f.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= fs.length) return false;
        [fs[i], fs[j]] = [fs[j], fs[i]];
        ctl.mutate(() => {});
        return true;
      }
    },
    startPresent: class {
      queryState(ctl) { return ctl.mmStatus === 'present' ? -1 : ((ctl.doc.frames || []).length ? 0 : -1); }
      execute(ctl, idx = 0) { return enterPresent(ctl, idx); }
    },
    exitPresent: class {
      queryState(ctl) { return ctl.mmStatus === 'present' ? 0 : -1; }
      execute(ctl) { return exitPresent(ctl); }
    },
  },
  events: {
    // 放映键盘路由（present 态专属：→/空格/↓ 下一帧，←/↑ 上一帧，Esc 退出）
    // CustomEvent 的键盘载荷在 detail 里（裸 CustomEvent 无 .key——detail.key 才是键名，实锤）
    'mm:present-key': (ctl, e) => {
      if (ctl.mmStatus !== 'present') return;
      const key = (e.detail || e).key;
      e.preventDefault(); e.stopPropagation();
      const fs = ctl.doc.frames || [];
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(key)) goFrame(ctl, Math.min(ctl._presentIdx + 1, fs.length - 1));
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(key)) goFrame(ctl, Math.max(ctl._presentIdx - 1, 0));
      else if (key === 'Escape') exitPresent(ctl);
    },
  },
});
