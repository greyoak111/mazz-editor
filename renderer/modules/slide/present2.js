// renderer/modules/slide/present2.js —— mazzslide v2 放映引擎（W39：camTween 同款缓动镜头+四切换+reveal 逐点揭示+帧动作+演讲者视图）
// 镜头动画：tween()——camTween（mm-present.js w33）同款 rAF+easeInOutCubic 引擎（旧趟取消），参数对象化通吃 opacity/transform
// 状态机：ctl.slStatus（normal|present）——mmStatus 同款单字段+rollback（Esc 还原编辑器），present 态幂等闸
// reveal 引擎：帧内 reveal.order 整数序列（1..N，0/null=随帧即现）；→/空格先揭后翻；prev 回帧全显（FreeShow clickReveal 子集）
// 帧动作：nextAfter 到时自动推进（计时器驱动，导航即清）/clearMedia（到帧隐媒体图）/stopTimer（到帧冻计时）
import { DESIGN } from './doc.js';
import { renderPageCanvas } from './canvas.js';
import { themeById } from './themes.js';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function escHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>'); }

/** camTween 同款镜头动画器（rAF+easeInOutCubic；kEnd==kTarget 全等落点；旧趟取消） */
function tween({ duration = 420, step, done }) {
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const t0 = performance.now();
  let cancelled = false;
  const tick = (now) => {
    if (cancelled) return;
    const k = Math.min(1, (now - t0) / duration);
    step(ease(k), k);
    if (k < 1) requestAnimationFrame(tick);
    else done?.();
  };
  requestAnimationFrame(tick);
  return () => { cancelled = true; };
}

export class Presenter2 {
  constructor({ ctl, presenterView = false, startIndex = 0 }) {
    if (ctl.slStatus === 'present') return null; // 幂等闸（状态机单字段）
    this.ctl = ctl;
    this.doc = ctl.doc2;
    this.frames = this.doc.layouts.main.frames;
    this.fi = startIndex;
    this.presenterView = presenterView;
    this.startTime = Date.now();
    this.revealN = 0;       // 当前帧已揭到 order N
    this.cancelFx = null;   // 进行中的切换动画取消器
    this.autoTimer = 0;     // nextAfter 计时
    this.tickTimer = 0;     // 计时器 Item 走字
    ctl.slStatus = 'present';
    ctl._presenter = this; // 测试/遥控钩子（W40 手机遥控同口）
    this.build();
    this.go(startIndex, { fx: 'none', dir: 1 });
    return this;
  }

  // ---------- 序列（禁用帧跳过） ----------
  enabled() { return this.frames.map((f, i) => ({ f, i })).filter(x => !x.f.disabled); }
  nextIdx(d = 1) {
    let j = this.fi + d;
    while (j >= 0 && j < this.frames.length && this.frames[j].disabled) j += d;
    return (j < 0 || j >= this.frames.length) ? -1 : j;
  }

  // ---------- 骨架 ----------
  build() {
    this.el = document.createElement('div');
    this.el.className = 'sl-present';
    this.el.tabIndex = 0;
    this.el.innerHTML = `
      <div class="sl-pv2-wrap">
        <div class="sl-pv2-main"><div class="sl-pv2-stage"></div></div>
        <div class="sl-pv-side" style="display:none">
          <div class="sl-pv2-next"></div>
          <div class="sl-pv-notes"><div class="sl-pv-cap">演讲者备注</div><div class="sl-pv-notes-body"></div></div>
          <div class="sl-pv2-meta"><span class="sl-pv2-reveal"></span><span class="sl-clock">00:00</span></div>
        </div>
      </div>
      <div class="sl-pageno"></div>
      <div class="sl-pv-bar">
        <button class="sl-pv-btn" data-a="pv"></button>
        <button class="sl-pv-btn" data-a="exit">退出 (Esc)</button>
      </div>`;
    document.body.appendChild(this.el);
    this.stage = this.el.querySelector('.sl-pv2-stage');
    this.el.querySelector('[data-a=pv]').addEventListener('click', () => { this.presenterView = !this.presenterView; this.renderChrome(); this.renderPvSide(); });
    this.el.querySelector('[data-a=exit]').addEventListener('click', () => this.close());
    this.keyHandler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); this.step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'Escape') this.close();
      else if (e.key === 'Home') { e.preventDefault(); const en = this.enabled(); if (en.length) this.go(en[0].i, { dir: -1 }); }
      else if (e.key === 'End') { e.preventDefault(); const en = this.enabled(); if (en.length) this.go(en[en.length - 1].i, { dir: 1 }); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this.black(); } // 黑屏（FreeShow B 键同款；手机遥控同口）
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.sl-pv-bar,.sl-pv-side')) return;
      (e.clientX / window.innerWidth) > 0.5 ? this.step(1) : this.step(-1);
    });
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    this.clockTimer = setInterval(() => this.updateClock(), 1000);
    this.el.focus();
  }

  renderChrome() {
    const en = this.enabled();
    const pos = en.findIndex(x => x.i === this.fi);
    this.el.querySelector('.sl-pageno').textContent = `${pos + 1} / ${en.length}`;
    this.el.querySelector('[data-a=pv]').textContent = this.presenterView ? '退出演讲者视图' : '演讲者视图';
    this.el.querySelector('.sl-pv-side').style.display = this.presenterView ? '' : 'none';
    this.el.querySelector('.sl-pv2-main').style.flex = this.presenterView ? '1.6' : '';
    this.stage.style.width = this.presenterView ? '92%' : 'min(96%, calc(96vh * 16 / 9))';
  }

  updateClock() {
    const el = this.el?.querySelector('.sl-clock');
    if (!el) return;
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- 帧渲染 ----------
  renderFrameSvg(fr) {
    const sl = this.doc.slides[fr.slideId];
    const th = themeById(this.ctl.themeId);
    const svg = svgEl('svg', { class: 'sl-v2-svg', viewBox: `0 0 ${DESIGN.w} ${DESIGN.h}`, preserveAspectRatio: 'xMidYMid meet' });
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    if (!sl?.bg) svg.style.background = th?.bg || '#1a1a1e';
    const viewport = svgEl('g', { class: 'sl-v2-viewport' });
    svg.appendChild(viewport);
    renderPageCanvas(svgEl, viewport, sl, th, { outW: DESIGN.w, outH: DESIGN.h });
    return { svg, sl };
  }

  /** 应用揭示态：order>revealN 的对象隐身（带 150ms 显现过渡） */
  applyReveal(svg, sl) {
    for (const it of (sl?.items || [])) {
      const o = it.reveal?.order | 0;
      const g = svg.querySelector(`[data-id="${it.id}"]`);
      if (!g) continue;
      g.style.transition = 'opacity .15s ease';
      g.style.opacity = o >= 1 && o > this.revealN ? '0' : '1';
    }
  }
  revealLeft(sl) { return (sl?.items || []).filter(it => (it.reveal?.order | 0) >= 1 && it.reveal.order > this.revealN).length; }

  /** 帧动作（到帧执行）：clearMedia 隐媒体图 / stopTimer 冻计时 / nextAfter 到时推进 */
  applyActions(svg, sl, fr) {
    clearInterval(this.tickTimer); this.tickTimer = 0;
    clearTimeout(this.autoTimer); this.autoTimer = 0;
    if (fr.actions?.clearMedia) {
      for (const it of (sl?.items || [])) {
        if (it.type === 'media' || (it.type === 'image' && it.src)) svg.querySelector(`[data-id="${it.id}"]`)?.style.setProperty('display', 'none');
      }
    }
    // 计时器走字（stopTimer 冻结不走）
    const timers = (sl?.items || []).filter(it => it.type === 'timer');
    if (timers.length && !fr.actions?.stopTimer) {
      const t0 = Date.now();
      this.tickTimer = setInterval(() => {
        const el = (Date.now() - t0) / 1000;
        for (const it of timers) {
          const t = svg.querySelector(`[data-id="${it.id}"] .sl-timer-text`);
          if (!t) continue;
          if (it.timer?.kind === 'clock') {
            const d = new Date();
            t.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          } else {
            const left = Math.max(0, (it.timer?.target || 300) - Math.floor(el));
            t.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
          }
        }
      }, 1000);
    }
    if (fr.nextAfter > 0) this.autoTimer = setTimeout(() => this.step(1), fr.nextAfter * 1000);
  }

  // ---------- 推进（先揭后翻） ----------
  step(d = 1) {
    const fr = this.frames[this.fi];
    const sl = fr && this.doc.slides[fr.slideId];
    if (d > 0 && sl && this.revealLeft(sl) > 0) {
      // 揭下一序
      const next = Math.min(...sl.items.filter(it => (it.reveal?.order | 0) >= 1 && it.reveal.order > this.revealN).map(it => it.reveal.order));
      this.revealN = next;
      const layer = this.stage.lastElementChild;
      const svg = layer?.querySelector('svg');
      if (svg) this.applyReveal(svg, sl);
      this.renderPvSide();
      this.pushState();
      return;
    }
    const j = this.nextIdx(d);
    if (j < 0) { if (d > 0) this.close(); return; } // 末帧后再 → = 收映（FreeShow 同款）
    this.go(j, { dir: d });
  }

  /** 切帧（四切换：fade 叠化/slide 平移/zoom 缩放推进/none 直切） */
  go(idx, { fx = null, dir = 1 } = {}) {
    const fr = this.frames[idx];
    if (!fr) return;
    this.fi = idx;
    this.revealN = 0; // 新帧揭示归零（prev 也归零重揭——FreeShow 同款纪律）
    const { svg, sl } = this.renderFrameSvg(fr);
    this.applyReveal(svg, sl);
    const layer = document.createElement('div');
    layer.className = 'sl-pv2-layer';
    layer.appendChild(svg);
    const old = this.stage.lastElementChild;
    this.stage.appendChild(layer);
    const kind = fx || fr.transition || 'fade';
    this.cancelFx?.(); this.cancelFx = null;
    while (this.stage.children.length > 2) this.stage.firstElementChild.remove(); // 连按翻帧：上趟 tween 被毙其 done 清场不跑——防旧层泄漏（至多 老+新 两层）
    const cleanup = () => { old?.remove(); layer.style.transform = ''; layer.style.opacity = ''; this.cancelFx = null; };
    if (!old || kind === 'none') { old?.remove(); }
    else if (kind === 'fade') {
      layer.style.opacity = '0';
      this.cancelFx = tween({ duration: 380, step: (e) => { layer.style.opacity = String(e); }, done: cleanup });
    } else if (kind === 'slide') {
      layer.style.transform = `translateX(${dir > 0 ? '' : '-'}100%)`;
      this.cancelFx = tween({ duration: 420, step: (e) => { layer.style.transform = `translateX(${(1 - e) * 100 * (dir > 0 ? 1 : -1)}%)`; }, done: cleanup });
    } else if (kind === 'zoom') {
      const s0 = dir > 0 ? 1.25 : 0.75;
      layer.style.opacity = '0';
      this.cancelFx = tween({ duration: 460, step: (e) => { const s = s0 + (1 - s0) * e; layer.style.transform = `scale(${s})`; layer.style.opacity = String(e); }, done: cleanup });
    }
    this.applyActions(svg, sl, fr);
    this.renderChrome();
    this.renderPvSide();
    this.pushState();
  }

  /** 演讲者侧栏（当前/下一帧/备注/揭示进度/计时） */
  renderPvSide() {
    if (!this.presenterView) return;
    const fr = this.frames[this.fi];
    const sl = fr && this.doc.slides[fr.slideId];
    const ni = this.nextIdx(1);
    const nFr = ni >= 0 ? this.frames[ni] : null;
    const nextBox = this.el.querySelector('.sl-pv2-next');
    nextBox.innerHTML = '<div class="sl-pv-cap">下一帧</div>';
    if (nFr) {
      const { svg } = this.renderFrameSvg(nFr);
      const box = document.createElement('div');
      box.className = 'sl-pv2-stage mini';
      box.appendChild(svg);
      nextBox.appendChild(box);
    } else nextBox.innerHTML += '<div class="sl-pv-cap">（最后一帧）</div>';
    this.el.querySelector('.sl-pv-notes-body').innerHTML = escHtml(sl?.notes || '（无备注）');
    const rl = sl ? this.revealLeft(sl) : 0;
    const total = (sl?.items || []).filter(it => (it.reveal?.order | 0) >= 1).length;
    this.el.querySelector('.sl-pv2-reveal').textContent = total ? `揭示 ${total - rl}/${total}` : '';
  }

  /** 黑屏开关（手机遥控 black 指令/B 键同口） */
  black() {
    this.blackOn = !this.blackOn;
    let ov = this.el.querySelector('.sl-pv2-black');
    if (this.blackOn && !ov) {
      ov = document.createElement('div');
      ov.className = 'sl-pv2-black';
      ov.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999';
      this.el.appendChild(ov);
    } else if (!this.blackOn) ov?.remove();
    this.pushState();
    return this.blackOn;
  }

  /** 遥控状态推送（W40：帧变/揭示变/黑屏变/收映 离散推送；手机端计时本地走字不刷流） */
  pushState() {
    const fr = this.frames[this.fi];
    const sl = fr && this.doc.slides[fr.slideId];
    const en = this.enabled();
    const pos = en.findIndex(x => x.i === this.fi);
    const t = sl?.items.find(i => i.type === 'text');
    window.mazz?.invoke('slideRemote:state', {
      presenting: this.ctl.slStatus === 'present',
      title: (t?.lines?.[0]?.text || t?.list?.items?.[0]?.text || '').trim().slice(0, 24) || '帧',
      pos: pos + 1, total: en.length,
      clockSec: Math.floor((Date.now() - this.startTime) / 1000),
      black: !!this.blackOn,
    }).catch(() => {});
  }

  close() {
    if (this.ctl.slStatus !== 'present') return false;
    this.ctl.slStatus = 'normal'; // rollback（mmStatus 同款）
    this.cancelFx?.();
    clearTimeout(this.autoTimer);
    clearInterval(this.tickTimer);
    clearInterval(this.clockTimer);
    window.removeEventListener('keydown', this.keyHandler, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.el.remove();
    this.ctl._presenter = null;
    this.pushState(); // 收映态（presenting:false——手机端落「未在放映」）
    return true;
  }
}
