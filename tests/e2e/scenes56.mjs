// tests/e2e/scenes56.mjs —— W58 实证批
export async function scenes56({ app, win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  const termText = async () => evaluate(() => {
    const ctl = window.__activeCodeCtl;
    const rec = ctl?.terminal?.terms?.get(ctl.terminal.activeId);
    const buf = rec?.xterm?.buffer?.active;
    if (!buf) return '';
    const lines = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) || ''); // 全行读（TERM_OK 常在 buffer 前部——末 14 行窗口曾整段漏掉实锤）
    return lines.join('\n');
  });

  try {
    await scenario('运行·js 直跑终端出字', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newCode'));
      await wait(1600);
      await evaluate(() => {
        const ctl = window.__activeCodeCtl;
        if (ctl?.editor) ctl.editor.setValue('console.log("MAZZ_RUN_OK_"+(40+2))');
      });
      await evaluate(async (ws) => {
        const p = ws + '/验收-run.js';
        await window.mazz.invoke('fs:writeFile', { path: p, content: 'console.log("MAZZ_RUN_OK_"+(40+2))' });
        await window.MazzShell?.openFile?.(p);
      }, WS);
      await wait(1400);
      const st = await evaluate(() => ({ lang: window.__activeCodeCtl?.language, fp: window.__activeCodeCtl?.filePath }));
      await human.assert(st.lang === 'javascript' && st.fp?.endsWith('.js'), `打开 .js 必须 javascript+路径在（实拿 ${JSON.stringify(st)}）`);
      await evaluate(() => window.MazzCommands?.execute('code.runFile'));
      await wait(3400);
      const out = await termText();
      await human.assert(out.includes('MAZZ_RUN_OK') || out.includes('42'), `终端必须出字（末段：${out.slice(-160)}）`);
    });

    await scenario('语言链·打开同步与人话提示', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newCode'));
      await wait(1400);
      await evaluate(async (ws) => {
        const ctl = window.__activeCodeCtl;
        if (ctl?.editor) ctl.editor.setValue('print("PY_OK")');
        const p = ws + '/验收-run.py';
        await window.mazz.invoke('fs:writeFile', { path: p, content: 'print("PY_OK")' });
        await window.MazzShell?.openFile?.(p);
      }, WS);
      await wait(1400);
      const st = await evaluate(() => ({ lang: window.__activeCodeCtl?.language, fp: window.__activeCodeCtl?.filePath }));
      await human.assert(st.lang === 'python', `打开 .py 必须同步 python（实拿 ${JSON.stringify(st)}——语言链根治）`);
      await evaluate(() => window.MazzCommands?.execute('file.newCode'));
      await wait(1200);
      await evaluate(() => {
        const ctl = window.__activeCodeCtl;
        if (ctl) ctl.language = 'plaintext';
        window.MazzCommands?.execute('code.runFile');
      });
      await wait(900);
      const toastOk = await evaluate(() => document.querySelector('.mazz-toast')?.textContent || '');
      await human.assert(toastOk.includes('不可运行') || toastOk.includes('选择语言') || toastOk.includes('扩展名'), `plaintext 必须人话提示（实拿 ${toastOk.slice(0, 50)}）`);
    });

    await scenario('缺链·工具链探测明示', async () => {
      const d1 = await evaluate(() => window.mazz.invoke('toolchain:detect', { exe: 'node' }).catch(() => null));
      await human.assert(d1?.exe === 'node', `node 探测必须命中（实拿 ${JSON.stringify(d1)}）`);
      const d2 = await evaluate(() => window.mazz.invoke('toolchain:detect', { exe: 'definitely-not-exists-w58' }).catch(() => null));
      await human.assert(d2?.exe === null, `不存在 exe 探测必须为空（实拿 ${JSON.stringify(d2)}）`);
      const d3 = await evaluate(() => window.mazz.invoke('toolchain:detect', { exe: ['definitely-not-exists-w58', 'node'] }).catch(() => null));
      await human.assert(d3?.exe === 'node', `候选数组必须取首中（实拿 ${JSON.stringify(d3)}）`);
    });

    await scenario('B12·语言按钮开 ctxmenu 选择格', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newCode'));
      await wait(1600);
      const btnOk = await evaluate(() => {
        const b = document.getElementById('code-lang-btn');
        return { has: !!b, text: document.getElementById('code-lang-text')?.textContent };
      });
      await human.assert(btnOk.has, `语言按钮必须在（实拿 ${JSON.stringify(btnOk)}——select 已退役）`);
      await evaluate(() => document.getElementById('code-lang-btn')?.click());
      let pw = null;
      for (let i = 0; i < 16; i++) {
        await wait(300);
        pw = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
        if (pw) break;
      }
      await human.assert(!!pw, '选择格必须开 ctxmenu（select 弹出层被压时代结束）');
      if (pw) {
        const st = await pw.evaluate(() => ({
          items: document.querySelectorAll('.mi').length,
          texts: [...document.querySelectorAll('.mi .t')].map(x => x.textContent).slice(0, 4).join('|'),
        }));
        await human.assert(st.items >= 11, `11 种语言必须全列（实拿 ${st.items}：${st.texts}…）`);
        await pw.evaluate(() => {
          for (const el of document.querySelectorAll('.mi .t')) { if (el.textContent === 'Python') { el.closest('.mi').click(); return; } }
        });
        await wait(700);
        const lang = await evaluate(() => ({ lang: window.__activeCodeCtl?.language, text: document.getElementById('code-lang-text')?.textContent }));
        await human.assert(lang.lang === 'python' && lang.text === 'Python', `选后必须切换+文本同步（实拿 ${JSON.stringify(lang)}）`);
      }
    });

    await scenario('预览·html 运行开浏览器页签', async () => {
      await evaluate(() => window.MazzCommands?.execute('file.newCode'));
      await wait(1400);
      await evaluate(async (ws) => {
        const ctl = window.__activeCodeCtl;
        if (ctl?.editor) ctl.editor.setValue('<html><body><h1 id="w58mark">W58预览</h1></body></html>');
        const p = ws + '/验收-page.html';
        await window.mazz.invoke('fs:writeFile', { path: p, content: '<html><body><h1 id="w58mark">W58预览</h1></body></html>' });
        await window.MazzShell?.openFile?.(p);
      }, WS);
      await wait(1400);
      await evaluate(() => window.MazzCommands?.execute('code.runFile'));
      await wait(1800);
      const ok = await evaluate(async () => {
        const bctl = window.__activeBrowserCtl;
        const t = bctl?.tabs?.find(x => x.id === bctl.activeId) || bctl?.tabs?.[0];
        if (!t) return false;
        return await window.mazz.invoke('bv:js', { tabId: t.viewId, code: "!!document.getElementById('w58mark')" }).catch(() => false);
      });
      await human.assert(ok === true, 'html 运行必须开预览（W58预览标记在）');
    });
  } finally {}
}
