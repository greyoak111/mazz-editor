// renderer/shell/pane-zoom.js —— 内容缩放：Ctrl+滚轮（桌面）+ 双指捏合（触屏）
// 作用域：模块窗格的编辑区（.pane 的 .editor-area）；
// 排除：设置/帮助/命令面板（.mazz-palette-mask）、右键菜单、提示条、标题栏/Ribbon/状态栏/侧栏/标签栏
const MIN = 0.5, MAX = 2;
const zoomOf = new WeakMap(); // editor-area 元素 -> 当前倍率

const EXCLUDE_SEL = '.mazz-palette-mask, .mazz-menu, .mazz-toast, .titlebar, .ribbon, .statusbar, .sidebar, .tabbar, .lib-content';

/** 事件命中判定：落在模块窗格内 → 返回该窗格编辑区；落在固定 UI 上 → null（不处理） */
function targetArea(e) {
  if (e.target.closest?.(EXCLUDE_SEL)) return null;
  const pane = e.target.closest?.('.pane');
  return pane ? pane.querySelector('.editor-area') : null;
}

export function paneZoomOf(area) { return zoomOf.get(area) || 1; }

let onChange = null;
/** 缩放变化回调（状态栏百分比联动）：fn(area, z) */
export function setPaneZoomListener(fn) { onChange = fn; }

export function applyPaneZoom(area, z) {
  z = Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
  zoomOf.set(area, z);
  // webview（浏览器窗格）是独立渲染进程：CSS zoom 管不到它，走自己的 zoomFactor
  const wv = area.querySelector('webview');
  if (wv) {
    try { wv.setZoomFactor(z); } catch {}
    area.style.zoom = ''; // 容器不再 CSS 缩放（避免窗口边框放大内容不变）
  } else {
    area.style.zoom = z;
  }
  onChange?.(area, z);
  return z;
}

/** 重置全部窗格缩放（zoomReset 联动；含浏览器 webview 的 zoomFactor） */
export function resetAllPaneZooms(root = document) {
  root.querySelectorAll('.editor-area').forEach((a) => {
    a.style.zoom = '';
    zoomOf.delete(a);
    a.querySelectorAll('webview').forEach((wv) => { try { wv.setZoomFactor(1); } catch {} });
  });
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function installPaneZoom() {
  // ==================== Ctrl / ⌘ + 滚轮 ====================
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    // 全屏内容缩放自理（播放器画面缩放等）：fullscreen 时 pane-zoom 整体不抢——
    // 此前捕获相 stopPropagation 把事件拦死在 window，全屏播放器 wheel handler 永远收不到（全屏 ctrl 滚轮失效+错缩边栏的总根）
    if (document.fullscreenElement) return;
    const area = targetArea(e);
    if (!area) return; // 固定 UI：放行默认行为，不缩放
    e.preventDefault();
    e.stopPropagation();
    applyPaneZoom(area, paneZoomOf(area) + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { capture: true, passive: false });

  // ==================== 双指捏合（Pointer Events，触摸专属） ====================
  const pts = new Map(); // pointerId -> {x, y}
  let pinch = null;      // {area, startDist, startZoom}

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!targetArea(e)) { pts.clear(); pinch = null; return; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const area = targetArea(e);
      pinch = { area, startDist: dist(a, b) || 1, startZoom: paneZoomOf(area) };
    }
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      e.preventDefault();
      applyPaneZoom(pinch.area, pinch.startZoom * (dist(a, b) / pinch.startDist));
    }
  }, { capture: true, passive: false });

  const lift = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
  };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);
}
