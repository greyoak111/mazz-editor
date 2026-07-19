// renderer/modules/slide/present.js —— 放映模式：全屏放映 + 演讲者视图（当前/下一页/备注/计时）
import { renderSlideHTML } from './render.js';

export class Presenter {
  constructor({ slides, theme, startIndex = 0 }) {
    this.slides = slides;
    this.theme = theme;
    this.index = startIndex;
    this.presenterView = false;
    this.startTime = Date.now();
    this.build();
  }

  build() {
    this.el = document.createElement('div');
    this.el.className = 'sl-present';
    this.el.tabIndex = 0;
    document.body.appendChild(this.el);
    this.render();
    this.el.focus();
    this.keyHandler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); this.next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.prev(); }
      else if (e.key === 'Escape') this.close();
      else if (e.key === 'Home') { this.index = 0; this.render(); }
      else if (e.key === 'End') { this.index = this.slides.length - 1; this.render(); }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.el.addEventListener('click', (e) => {
      const x = e.clientX / window.innerWidth;
      if (e.target.closest('.sl-pv-notes,.sl-pv-btn')) return;
      x > 0.5 ? this.next() : this.prev();
    });
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    this.timer = setInterval(() => this.updateClock(), 1000);
  }

  updateClock() {
    const el = this.el?.querySelector('.sl-clock');
    if (!el) return;
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  next() { if (this.index < this.slides.length - 1) { this.index++; this.render(); } }
  prev() { if (this.index > 0) { this.index--; this.render(); } }

  render() {
    const s = this.slides[this.index];
    const main = renderSlideHTML(s, this.theme, { scale: this.presenterView ? 0.62 : 1 });
    if (!this.presenterView) {
      this.el.innerHTML = `
        <div class="sl-stage">${main}</div>
        <div class="sl-pageno">${this.index + 1} / ${this.slides.length}</div>
        <div class="sl-pv-bar">
          <button class="sl-pv-btn" data-a="pv">演讲者视图</button>
          <button class="sl-pv-btn" data-a="exit">退出 (Esc)</button>
        </div>`;
    } else {
      const next = this.slides[this.index + 1];
      this.el.innerHTML = `
        <div class="sl-pv">
          <div class="sl-pv-main">${main}</div>
          <div class="sl-pv-side">
            <div class="sl-pv-next">${next ? '<div class="sl-pv-cap">下一页</div>' + renderSlideHTML(next, this.theme, { scale: 0.34 }) : '<div class="sl-pv-cap">（最后一页）</div>'}</div>
            <div class="sl-pv-notes"><div class="sl-pv-cap">演讲者备注</div><div class="sl-pv-notes-body">${escapeHtml(s.notes || '（无备注）')}</div></div>
            <div class="sl-clock">00:00</div>
          </div>
        </div>
        <div class="sl-pageno">${this.index + 1} / ${this.slides.length}</div>
        <div class="sl-pv-bar">
          <button class="sl-pv-btn" data-a="pv">退出演讲者视图</button>
          <button class="sl-pv-btn" data-a="exit">退出 (Esc)</button>
        </div>`;
    }
    this.el.querySelector('[data-a=pv]').addEventListener('click', () => { this.presenterView = !this.presenterView; this.render(); });
    this.el.querySelector('[data-a=exit]').addEventListener('click', () => this.close());
  }

  close() {
    window.removeEventListener('keydown', this.keyHandler, true);
    clearInterval(this.timer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.el.remove();
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>'); }
