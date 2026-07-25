import { iconHtml } from './svg-icons.js';
// renderer/lib/mobile-env.js —— 形态因子探测与移动端外壳增强
// 在 <html> 上挂类：m-touch / m-phone / m-tablet / m-wide / m-dualscreen / m-sidebar-open
// 断点对齐 Material 3 窗口尺寸类：手机 <600dp，平板 600–839dp，桌面 ≥840dp
(function () {
  const root = document.documentElement;

  function isCoarse() {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  function segments() {
    // Chromium 的 VisualViewport.segments（双屏设备，如 Surface Duo / 折叠屏展开）
    try { return window.visualViewport?.segments || null; } catch { return null; }
  }

  function classify() {
    const w = window.innerWidth;
    root.classList.toggle('m-touch', isCoarse());
    root.classList.toggle('m-phone', w < 600);
    root.classList.toggle('m-tablet', w >= 600 && w < 840);
    root.classList.toggle('m-wide', w >= 840);
    // 非 Electron（浏览器/WebView）：隐藏无意义的窗口控制按钮
    root.classList.toggle('m-web', !(window.mazz && window.mazz.isElectron));

    // 双屏：优先 segments API，退化为 media feature（horizontal-viewport-segments）
    let dual = false, leftW = 0;
    const seg = segments();
    if (seg && seg.length >= 2) {
      dual = true;
      leftW = seg[0].width;
      root.style.setProperty('--hinge-x', seg[0].right + 'px');
      root.style.setProperty('--seg-left-w', seg[0].width + 'px');
    } else if (matchMedia('(horizontal-viewport-segments: 2)').matches) {
      dual = true;
      leftW = Math.round(w / 2);
      root.style.setProperty('--seg-left-w', leftW + 'px');
    } else {
      root.style.removeProperty('--seg-left-w');
      root.style.removeProperty('--hinge-x');
    }
    root.classList.toggle('m-dualscreen', dual);
    if (w >= 600) root.classList.remove('m-sidebar-open'); // 大屏不保留抽屉态
  }

  // —— 手机侧栏抽屉：注入 ☰ 按钮与遮罩 ——
  function installDrawer() {
    const apply = () => {
      const titlebar = document.querySelector('.titlebar');
      if (!titlebar || document.getElementById('m-drawer-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'm-drawer-btn';
      btn.type = 'button';
      btn.innerHTML = iconHtml('☰');
      btn.setAttribute('aria-label', '打开侧栏');
      titlebar.insertBefore(btn, titlebar.firstChild);
      btn.addEventListener('click', () => root.classList.toggle('m-sidebar-open'));

      const scrim = document.createElement('div');
      scrim.id = 'm-drawer-scrim';
      document.body.appendChild(scrim);
      scrim.addEventListener('click', () => root.classList.remove('m-sidebar-open'));

      // 手机：点选侧栏里的文件后自动收起抽屉
      document.addEventListener('click', (e) => {
        if (root.classList.contains('m-phone') && root.classList.contains('m-sidebar-open')
          && e.target.closest('.sidebar') && !e.target.closest('.sidebar-head')) {
          root.classList.remove('m-sidebar-open');
        }
      }, true);
    };
    // titlebar 由外壳异步创建，轮询注入
    const t = setInterval(() => { apply(); if (document.getElementById('m-drawer-btn')) clearInterval(t); }, 300);
    setTimeout(() => clearInterval(t), 15000);
  }

  classify();
  // window.mazz 由浏览器桥/preload 异步注入，延迟复检一次平台类
  setTimeout(classify, 800);
  setTimeout(classify, 2500);
  addEventListener('resize', classify);
  addEventListener('orientationchange', () => setTimeout(classify, 60));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDrawer);
  else installDrawer();
})();
