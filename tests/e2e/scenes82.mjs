// R1+R2：位置接力恢复 + 通知抽屉真人子窗。
import path from 'node:path';

export async function scenes82({ app, win, human, scenario, shotDir, relayPath, bookPath, mediaPath }) {
  await scenario('R1 编辑器光标写入位置账并在重开时自动接力', async () => {
    await human.evaluate(p => window.MazzCommands.execute('file.openPath', { path: p }), relayPath);
    await human.until(() => !!window.__activeTextCtl, { timeout: 8000, msg: '纯文本编辑器打开' });
    const saved = await human.evaluate(async () => {
      const ta = document.querySelector('.txt-editor');
      ta.setSelectionRange(47, 47); ta.scrollTop = 18;
      const tab = window.MazzShell.tabs.active;
      window.MazzShell.captureProgressFor(tab.id, { immediate: true });
      await window.MazzProgress.flush();
      return window.mazz.invoke('sync:positionGet', { kind: 'editor', path: tab.filePath });
    });
    await human.assert(saved?.value?.start === 47, `位置账应写入光标 47（实际 ${saved?.value?.start}）`);
    await human.evaluate(async () => {
      const tab = window.MazzShell.tabs.active;
      tab.forceClose = true;
      await window.MazzShell.closeTabFlow(tab.id);
    });
    await human.evaluate(p => window.MazzCommands.execute('file.openPath', { path: p }), relayPath);
    await human.until(() => document.querySelector('.txt-editor')?.selectionStart === 47, { timeout: 8000, msg: '重开自动跳到光标 47' });
  });

  await scenario('R1 书库屏位以路径入账并覆盖旧单机进度', async () => {
    await human.evaluate(async ({ path: p }) => {
      const books = (await window.mazz.invoke('settings:get', { key: 'library.books' }).catch(() => [])) || [];
      if (!books.some(book => book.id === 'r1-relay-book')) books.push({ id: 'r1-relay-book', title: '跨设备阅读接力', author: 'R1 实证', path: p, format: 'txt', category: '未分类', addedAt: Date.now() });
      await window.mazz.invoke('settings:set', { key: 'library.books', value: books });
      await window.mazz.invoke('settings:set', { key: 'library.progress', value: {} });
      await window.MazzCommands.execute('file.newLibrary');
    }, { path: bookPath });
    await human.until(() => [...document.querySelectorAll('.lib-card')].some(card => card.textContent.includes('跨设备阅读接力')), { timeout: 8000, msg: '接力书籍上架' });
    await human.evaluate(() => [...document.querySelectorAll('.lib-card')].find(card => card.textContent.includes('跨设备阅读接力'))?.click());
    await human.until(() => {
      const ctl = window.__activeLibraryCtl;
      const flow = ctl?._flowWrap?.querySelector('.lib-flow');
      return flow && flow.scrollWidth > ctl._flowWrap.clientWidth;
    }, { timeout: 10000, msg: '书库分栏排版完成' });
    const saved = await human.evaluate(async () => {
      const ctl = window.__activeLibraryCtl;
      const flow = ctl._flowWrap.querySelector('.lib-flow');
      ctl._applyOffset((flow.scrollWidth - ctl._flowWrap.clientWidth) * 0.58);
      const tab = window.MazzShell.tabs.active;
      window.MazzShell.captureProgressFor(tab.id, { immediate: true });
      await window.MazzProgress.flush();
      return window.mazz.invoke('sync:positionGet', { kind: 'library', path: ctl.book.meta.path });
    });
    await human.assert(Math.abs((saved?.value?.ratio ?? 0) - 0.58) < 0.08, `书库位置账应记录约 58%（实际 ${saved?.value?.ratio}）`);
    await human.evaluate(() => [...document.querySelectorAll('[data-a=back]')].find(node => node.getBoundingClientRect().width > 0)?.click());
    await human.until(() => [...document.querySelectorAll('.lib-card')].some(card => card.textContent.includes('跨设备阅读接力')), { timeout: 6000, msg: '返回书架' });
    await human.evaluate(async () => window.mazz.invoke('settings:set', { key: 'library.progress', value: { 'r1-relay-book': { page: 0, ratio: 0.05 } } }));
    await human.evaluate(() => [...document.querySelectorAll('.lib-card')].find(card => card.textContent.includes('跨设备阅读接力'))?.click());
    await human.until(() => Math.abs((window.__activeLibraryCtl?._flowRatio ?? 0) - 0.58) < 0.1, { timeout: 10000, msg: '同步账覆盖旧单机 5% 屏位' });
  });

  await scenario('R1 播放秒位写入位置账并在重开时自动续播', async () => {
    await human.evaluate(p => window.MazzCommands.execute('file.openPath', { path: p }), mediaPath);
    await human.until(() => {
      const media = window.__activeViewerCtl?.body?.querySelector('audio.mz-media,video.mz-media');
      return media && media.readyState >= 1 && media.duration > 10;
    }, { timeout: 10000, msg: '12 秒音频元数据就绪' });
    const saved = await human.evaluate(async () => {
      const media = window.__activeViewerCtl.body.querySelector('audio.mz-media,video.mz-media');
      media.currentTime = 6;
      const tab = window.MazzShell.tabs.active;
      window.MazzShell.captureProgressFor(tab.id, { immediate: true });
      await window.MazzProgress.flush();
      return window.mazz.invoke('sync:positionGet', { kind: 'player', path: tab.filePath });
    });
    await human.assert(saved?.value?.seconds === 6, `播放位置账应写入 6 秒（实际 ${saved?.value?.seconds}）`);
    await human.evaluate(async () => {
      const tab = window.MazzShell.tabs.active;
      tab.forceClose = true;
      await window.MazzShell.closeTabFlow(tab.id);
    });
    await human.evaluate(p => window.MazzCommands.execute('file.openPath', { path: p }), mediaPath);
    await human.until(() => {
      const media = window.__activeViewerCtl?.body?.querySelector('audio.mz-media,video.mz-media');
      return media?.currentTime >= 5.5 && media.currentTime < 7.5;
    }, { timeout: 10000, msg: '重开自动跳回约 6 秒' });
  });

  await scenario('R2 五类结果静默汇入、未读角标与通知子窗', async () => {
    const count = await human.evaluate(p => {
      for (const [source, title] of [['transcode', '媒体转码完成'], ['factory', 'AI 写作完成'], ['sync', '局域网同步完成'], ['download', '下载已入书库'], ['archive', '解压完成']]) {
        window.MazzActivity.publish({ id: `e2e-${source}`, source, title, detail: `${title} · 实证`, target: { kind: 'file', path: p } });
      }
      return window.MazzActivity.snapshot().unread;
    }, relayPath);
    await human.assert(count === 5, `五类结果应形成 5 条未读（实际 ${count}）`);
    await human.assertText('#st-notif', '通知 5', '状态栏未读数应出现');
    await human.click('#st-notif');
    let panel;
    for (let i = 0; i < 40 && !panel; i++) {
      panel = app.windows().find(w => /panels\/notif\.html/.test(w.url()));
      if (!panel) await win.waitForTimeout(200);
    }
    await human.assert(!!panel, '通知中心原生子窗应打开');
    await panel.waitForSelector('.item', { timeout: 6000 });
    const state = await panel.evaluate(() => ({ items: document.querySelectorAll('.item').length, unread: document.querySelectorAll('.item.unread').length, text: document.body.textContent }));
    await human.assert(state.items === 5 && state.unread === 5, `抽屉应见 5/5（实际 ${state.items}/${state.unread}）`);
    for (const title of ['媒体转码完成', 'AI 写作完成', '局域网同步完成', '下载已入书库', '解压完成']) await human.assert(state.text.includes(title), `抽屉应包含「${title}」`);
    await panel.screenshot({ path: path.join(shotDir, 'r1r2-notification-drawer.png') });
  });

  await scenario('R2 点击通知回跳文件、已读清理且事件账已持久化', async () => {
    const panel = app.windows().find(w => /panels\/notif\.html/.test(w.url()));
    await panel.locator('.item').first().click();
    await human.until(() => window.MazzActivity.snapshot().unread === 4, { timeout: 5000, msg: '点击后单条已读' });
    await panel.locator('#read').click();
    await human.until(() => window.MazzActivity.snapshot().unread === 0, { timeout: 5000, msg: '全部已读' });
    await panel.locator('#clear').click();
    await human.until(() => window.MazzActivity.snapshot().items.length === 0, { timeout: 5000, msg: '清理已读' });
    await human.evaluate(() => window.MazzActivity.publish({ id: 'e2e-persist', source: 'system', title: '重启后可回看', detail: '持久事件账' }));
    await win.waitForTimeout(250);
    const saved = await human.evaluate(() => window.mazz.invoke('settings:get', { key: 'activity.center.v1' }));
    await human.assert(saved?.items?.some(x => x.id === 'e2e-persist'), '通知事件账必须已经落持久层');
    await panel.locator('#close').click();
  });
}
