// tests/e2e/human.mjs —— 真人操作替身：点击/输入/按键/断言/截图/异常警察
// 设计哲学：每一步都像一个挑剔的人类测试工程师在操作——不是能跑就行，是要"看见"。
import fs from 'fs';
import path from 'path';

export const SHOTS = path.resolve('tests/e2e/shots');

export class Human {
  constructor(window, { tag = 'e2e' } = {}) {
    this.win = window;
    this.tag = tag;
    this.errors = [];
    this.step = 0;
    fs.mkdirSync(SHOTS, { recursive: true });
    // 异常警察：渲染进程任何 console.error / 未捕获异常 / 请求失败都记账
    window.on('pageerror', (e) => this.errors.push('[pageerror] ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 4).join(' ← ')));
    window.on('console', (m) => {
      if (m.type() === 'error') {
        const t = m.text();
        // 已知环境噪音白名单（jsdom 无关，真 Electron 里的良性报错）
        if (/Autofill|SharedArrayBuffer|deprecat/i.test(t)) return;
        // 带资源 URL（「Failed to load resource」不报 URL=盲猜实锤——location 补位）
        const loc = m.location()?.url;
        this.errors.push('[console.error] ' + t.slice(0, 300) + (loc ? ' @ ' + loc.slice(0, 140) : ''));
      }
    });
    window.on('requestfailed', (r) => {
      const u = r.url();
      if (/^(data|blob|file):/.test(u)) return;
      this.errors.push('[requestfailed] ' + u.slice(0, 120) + ' ' + (r.failure()?.errorText || ''));
    });
  }

  log(...a) { console.log(`  [人类]`, ...a); }

  async shot(name) {
    const n = `${String(++this.step).padStart(2, '0')}-${this.tag}-${name}.png`;
    await this.win.screenshot({ path: path.join(SHOTS, n) }).catch(() => {});
    this.log('截图', n);
  }

  async $(sel, { timeout = 5000 } = {}) {
    return await this.win.waitForSelector(sel, { timeout, state: 'attached' });
  }

  async visible(sel) { return !!(await this.win.$(sel)); }

  async click(sel, { force = false } = {}) {
    await this.win.click(sel, { timeout: 5000, force });
  }

  async clickText(text, sel = 'button, [role=button], .w-card, .help-toc-item, .sb-tbtn, .fc-mini, .rb-btn, option') {
    await this.win.click(`${sel} >> text=${text}`, { timeout: 5000 });
  }

  async type(sel, text) {
    await this.win.click(sel);
    await this.win.fill(sel, text);
  }

  async key(k) { await this.win.keyboard.press(k); }

  async evaluate(fn, arg) {
    // 10s 超时兜底：页面内 evaluate 一旦挂死（模态阻塞/死循环/客进程卡顿）不得拖垮整场
    return await Promise.race([
      this.win.evaluate(fn, arg),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时(10s)：' + String(fn).slice(0, 90))), 10000)),
    ]);
  }

  /** 轮询直到页面条件为真（替代盲等固定时长——等待瘦身） */
  async until(fn, { timeout = 8000, interval = 200, msg = '条件未达成' } = {}) {
    const t0 = Date.now();
    let lastErr = null;
    while (Date.now() - t0 < timeout) {
      const v = await this.evaluate(fn).catch(e => { lastErr = e; return null; });
      if (v) return v;
      await this.win.waitForTimeout(interval);
    }
    throw new Error('until 超时(' + timeout + 'ms)：' + msg + (lastErr ? '｜末次错误：' + lastErr.message : ''));
  }

  async assert(cond, msg) {
    if (!cond) {
      await this.shot('断言失败');
      throw new Error('断言失败：' + msg);
    }
    this.log('✓', msg);
  }

  async assertVisible(sel, msg) {
    await this.assert(await this.visible(sel), (msg || '应可见 ') + sel);
  }

  async assertHidden(sel, msg) {
    await this.assert(!(await this.visible(sel)), (msg || '应隐藏 ') + sel);
  }

  /** 文本内容断言（取元素 textContent 比对包含） */
  async assertText(sel, expect, msg) {
    const t = await this.win.textContent(sel).catch(() => null);
    await this.assert(t != null && t.includes(expect), (msg || sel + ' 应含「' + expect + '」') + `（实际：${String(t).slice(0, 60)}）`);
  }

  /** 图标配额断言：容器内不得出现 emoji 文本节点（SVG 化的反向守卫） */
  async assertNoEmoji(sel, msg) {
    const bad = await this.evaluate(([s]) => {
      const el = document.querySelector(s);
      if (!el) return '未找到元素 ' + s;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const hits = [];
      let n;
      while ((n = walker.nextNode())) {
        if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(n.textContent)) hits.push(n.textContent.trim().slice(0, 12));
      }
      return hits.length ? hits.join(',') : null;
    }, [sel]);
    await this.assert(!bad, (msg || sel + ' 不应有裸 emoji') + (bad ? `（发现：${bad}）` : ''));
  }

  /** 收尾：报告并抛出累计异常 */
  /** 军规⑩ 主进程日志警察：launch 后挂 stdout/stderr 收集（this.forward 连环炸盲区根治） */
  watchMain(app) {
    this.mainErrors = [];
    const p = app.process?.();
    if (!p) return;
    const grab = (buf) => {
      const text = String(buf || '');
      for (const line of text.split('\n')) {
        if (/uncaught|TypeError|ReferenceError|\[main\] .*Error|Error:/.test(line) && !/Debugger listening|inspector/.test(line)) {
          this.mainErrors.push(line.trim().slice(0, 300));
        }
      }
    };
    p.stdout?.on?.('data', grab);
    p.stderr?.on?.('data', grab);
  }

  async finish({ allow = [] } = {}) {
    const rest = this.errors.filter(e => !allow.some(a => e.includes(a)));
    if (rest.length) {
      await this.shot('异常记账');
      throw new Error('渲染进程异常 ' + rest.length + ' 条：\n' + rest.slice(0, 5).join('\n'));
    }
    // 主进程警察（军规⑩）：uncaught/TypeError/ReferenceError 出现即判负
    const mrest = (this.mainErrors || []).filter(e => !allow.some(a => e.includes(a)));
    if (mrest.length) {
      await this.shot('主进程异常记账');
      throw new Error('主进程异常 ' + mrest.length + ' 条：\n' + mrest.slice(0, 5).join('\n'));
    }
    this.log('无渲染进程异常' + (this.mainErrors ? '·主进程零异常' : ''));
  }
}
