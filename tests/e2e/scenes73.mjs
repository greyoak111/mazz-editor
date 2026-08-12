// W59c 新建文件全族、六格式骨件与四档语言菜单真界面实证
export async function scenes73({ app, win, human, WS, scenario, shotDir }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const formats = [
    { ext: 'rs', lang: 'rust', mark: 'fn main()' },
    { ext: 'go', lang: 'go', mark: 'func main()' },
    { ext: 'rb', lang: 'ruby', mark: 'def main' },
    { ext: 'py', lang: 'python', mark: '#!/usr/bin/env python3' },
    { ext: 'java', lang: 'java', mark: 'public class Main' },
    { ext: 'f90', lang: 'fortran', mark: 'program main' },
  ];

  const openPicker = async () => {
    await human.evaluate(() => window.MazzCommands?.execute('fileTree.newFile'));
    for (let i = 0; i < 40; i++) {
      const panel = app.windows().find(w => w.url().includes('/panels/newfile.html'));
      if (panel) { await panel.waitForSelector('.nft', { timeout: 5000 }); return panel; }
      await wait(100);
    }
    throw new Error('新建文件子窗未出现');
  };

  await scenario('W59c·54类型八组全族卡面', async () => {
    const panel = await openPicker();
    const actual = await panel.evaluate(() => ({
      cards: document.querySelectorAll('.nft').length,
      groups: [...document.querySelectorAll('.grp')].map(x => x.textContent.trim()),
      codeTiers: [...document.querySelectorAll('.grp.code-tier')].map(x => x.textContent.trim()),
      exts: [...document.querySelectorAll('.nft')].map(x => x.dataset.ext),
    }));
    await human.assert(actual.cards === 54, `新建文件必须是 54 类型（实得 ${actual.cards}）`);
    await human.assert(actual.groups.length === 8 && actual.codeTiers.length === 4, `必须是办公创作四组 + 代码四档（实得 ${actual.groups.join('｜')}）`);
    for (const label of ['代码 · A 直跑（29）', '代码 · B 编译（8）', '代码 · C 预览（1）', '代码 · D 标记 / 数据（7）']) {
      await human.assert(actual.codeTiers.includes(label), `缺少档位 ${label}`);
    }
    for (const { ext } of formats) await human.assert(actual.exts.includes(ext), `全族卡面缺 .${ext}`);
    await panel.evaluate(() => {
      document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
      document.querySelector('.pwin').style.height = 'auto'; document.querySelector('.body').style.overflow = 'visible';
    });
    await panel.screenshot({ path: shotDir + '/w59c-newfile-catalog.png', fullPage: true });
    await panel.close();
  });

  await scenario('W59c·六格式真创建+模板+语言识别', async () => {
    for (const row of formats) {
      // 卡面入口已在上一场逐项核过；本场直接走其唯一落点 startInlineCreate，避免原生子窗反复销毁的焦点时序污染六格式链。
      await human.evaluate(ext => window.MazzShell.fileTree.startInlineCreate(null, 'file', ext), row.ext);
      await wait(250);
      await win.keyboard.press('Escape');
      await wait(180);
      const filePath = WS.replace(/\\/g, '/') + '/新建文件.' + row.ext;
      const content = await human.evaluate(p => window.mazz.invoke('fs:readFile', { path: p }), filePath);
      await human.assert(String(content).toLowerCase().includes(row.mark.toLowerCase()), `.${row.ext} 创建即带 ${row.mark} 骨件`);
      await human.evaluate(p => window.MazzShell.openFile(p), filePath);
      await win.waitForFunction(({ lang, suffix }) => window.__activeCodeCtl?.language === lang && String(window.__activeCodeCtl?.filePath || '').endsWith(suffix), { lang: row.lang, suffix: '.' + row.ext }, { timeout: 12000 });
      await human.assert(true, `.${row.ext} 已识别为 ${row.lang}`);
      if (row !== formats.at(-1)) {
        await human.evaluate(() => window.MazzCommands?.execute('file.closeTab'));
        await wait(220);
      }
    }
  });

  await scenario('W59c·语言菜单 A29/B8/C1/D7 四档', async () => {
    await human.evaluate(() => {
      const btn = [...document.querySelectorAll('#code-lang-btn')].find(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      btn?.click();
    });
    let menu = null;
    for (let i = 0; i < 40; i++) {
      menu = app.windows().find(w => w.url().includes('/panels/ctxmenu.html'));
      if (menu) { await menu.waitForSelector('.heading', { timeout: 5000 }); break; }
      await wait(100);
    }
    await human.assert(!!menu, '语言选择格子窗必须出现');
    const actual = await menu.evaluate(() => ({
      headings: [...document.querySelectorAll('.heading')].map(x => x.textContent.trim()),
      languages: [...document.querySelectorAll('.mi:not(.dis) .t')].map(x => x.textContent.trim()),
    }));
    for (const label of ['A · 直跑（29）', 'B · 编译（8）', 'C · 预览（1）', 'D · 标记 / 数据（7）']) {
      await human.assert(actual.headings.includes(label), `语言菜单缺档位 ${label}`);
    }
    await human.assert(actual.languages.length === 45, `语言菜单必须列全 45 种（实得 ${actual.languages.length}）`);
    for (const label of ['Rust', 'Go', 'Ruby', 'Fortran', 'Pascal', 'Objective-C']) await human.assert(actual.languages.includes(label), `语言菜单缺 ${label}`);
    await menu.evaluate(() => {
      document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
      document.querySelector('.pwin').style.maxHeight = 'none'; document.querySelector('main').style.overflow = 'visible';
    });
    await menu.screenshot({ path: shotDir + '/w59c-language-tiers.png', fullPage: true });
    await menu.close();
  });
}
