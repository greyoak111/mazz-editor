// tests/e2e/scenes77.mjs —— W62a-0 中央登记、路由选单与工厂就地指派实证
export async function scenes77({ app, win, human, scenario, shotDir }) {
  let config;
  const panel = re => app.windows().find(w => re.test(w.url()));
  const waitPanel = async re => {
    for (let i = 0; i < 120; i++) {
      const w = panel(re);
      if (w) return w;
      await win.waitForTimeout(50);
    }
    throw new Error('子窗未打开：' + re);
  };
  const closePicklist = async () => {
    const p = panel(/picklist\.html/);
    if (p) await p.evaluate(() => window.mazz.invoke('window:close')).catch(() => {});
  };
  const pick = async (route, value) => {
    await closePicklist();
    await config.locator(`[data-ai-route="${route}"]`).click();
    const p = await waitPanel(/picklist\.html/);
    await p.waitForFunction(v => !!document.querySelector(`.it[data-v="${v}"]`), value, { timeout: 5000 });
    await p.locator(`.it[data-v="${value}"]`).click();
    for (let i = 0; i < 80 && panel(/picklist\.html/); i++) await win.waitForTimeout(40);
  };

  await scenario('旧双名 Key 自动迁入分仓·配置窗只显状态点', async () => {
    await human.evaluate(async () => {
      await window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: 'mock://deepseek-w62', model: 'deepseek-v4-pro', providerId: 'deepseek' } });
      await window.mazz.invoke('secret:set', { key: 'factory.providerKey', value: 'legacy-panel-key-w62' });
      await window.mazz.invoke('panel:open', { kind: 'factorycfg' });
    });
    config = await waitPanel(/factorycfg\.html/);
    await config.waitForSelector('.provider-layout', { timeout: 8000 });
    await config.waitForFunction(() => document.querySelector('#pv-status .key-dot')?.classList.contains('on'), null, { timeout: 8000 });
    const safe = await config.evaluate(() => ({ keyValue: document.querySelector('#pv-key')?.value, text: document.body.innerText }));
    await human.assert(safe.keyValue === '' && !safe.text.includes('legacy-panel-key-w62'), '配置窗不得回显或泄露旧 Key');
    const migrated = await human.evaluate(async () => ({
      keys: await window.mazz.invoke('secret:get', { key: 'factory.keys' }),
      routing: await window.mazz.invoke('settings:get', { key: 'factory.routing' }),
    }));
    await human.assert(JSON.parse(migrated.keys).deepseek === 'legacy-panel-key-w62', '旧 Key 必须迁入 deepseek 分仓');
    await human.assert(migrated.routing.default.providerId === 'deepseek', '旧默认连接必须迁入全局路由');
    await config.screenshot({ path: shotDir + '/w62a0-central-registry.png' });
  });

  await scenario('中央登记第二厂·picklist 只列已接入模型', async () => {
    await config.locator('#pv-preset').selectOption('kimi');
    await config.locator('#pv-base').fill('mock://kimi-w62');
    await config.locator('#pv-model').fill('kimi-k3');
    await config.locator('#pv-key').fill('kimi-key-w62');
    await config.locator('#pv-save').click();
    await config.waitForFunction(() => [...document.querySelectorAll('.provider-chip')].some(x => /Kimi/.test(x.textContent) && x.querySelector('.key-dot.on')), null, { timeout: 8000 });
    await config.locator('[data-ai-route="chapter"]').click();
    const p = await waitPanel(/picklist\.html/);
    await p.waitForSelector('.it', { timeout: 5000 });
    const items = await p.evaluate(() => [...document.querySelectorAll('.it')].map(x => ({ value: x.dataset.v, label: x.textContent.trim() })));
    await human.assert(items[0]?.label === '跟随全局', '岗位选单首项必须是跟随全局');
    await human.assert(items.some(x => x.value === 'deepseek::deepseek-v4-pro') && items.some(x => x.value === 'kimi::kimi-k3'), '两家已接入模型必须可选');
    await human.assert(!items.some(x => x.value?.startsWith('openai::')), '无 Key 的 OpenAI 不得混入选单');
    await p.screenshot({ path: shotDir + '/w62a0-connected-only-picklist.png' });
    await p.locator('.it[data-v="kimi::kimi-k3"]').click();
    for (let i = 0; i < 80 && panel(/picklist\.html/); i++) await win.waitForTimeout(40);
  });

  await scenario('三级路由·岗位改派、全局兜底与实际 chat 穿针', async () => {
    await pick('default', 'deepseek::deepseek-v4-pro');
    await config.waitForFunction(() => document.querySelector('[data-ai-route="default"]')?.textContent.includes('DeepSeek'), null, { timeout: 5000 });
    const routed = await human.evaluate(async () => {
      const P = await import('./modules/factory/provider.js');
      const chapter = await P.getProviderConfig('chapter');
      const blueprint = await P.getProviderConfig('blueprint');
      const reply = await P.chat({ role: 'chapter', user: 'W62 路由实证', maxTokens: 32 });
      return { chapter: chapter.providerId, blueprint: blueprint.providerId, reply };
    });
    await human.assert(routed.chapter === 'kimi' && routed.blueprint === 'deepseek', '章节应走改派，蓝图应走全局兜底');
    await human.assert(!!routed.reply, '带 role 的 chat 必须打通执行代理');
    await config.screenshot({ path: shotDir + '/w62a0-role-routing.png' });
  });

  await scenario('工厂工具条三个就地指派钮复用同一选择格', async () => {
    await human.evaluate(async () => {
      window.MazzShell.sideDock.show();
      window.MazzShell.sideDock.showTab('factory');
      await window.MazzShell.sideDock.factoryPanel.reload();
    });
    await human.until(() => document.querySelectorAll('.fc-role-pickers .ai-role-picker').length === 3, { timeout: 8000, msg: '工厂三岗位按钮' });
    const roles = await human.evaluate(() => [...document.querySelectorAll('.fc-role-pickers .ai-role-picker')].map(x => x.dataset.aiRole));
    await human.assert(roles.join(',') === 'blueprint,chapter,snapshot', '工厂工具条必须就地暴露蓝图/章节/快照三岗');
    await human.click('.fc-role-pickers [data-ai-role="chapter"]');
    const p = await waitPanel(/picklist\.html/);
    await p.waitForFunction(() => document.querySelector('#cap')?.textContent.includes('工厂·章节'), null, { timeout: 5000 });
    await human.assert((await p.locator('.it').first().textContent()).trim() === '跟随全局', '就地指派也必须复用同一 picklist 数据结构');
    await win.screenshot({ path: shotDir + '/w62a0-factory-inline-roles.png' });
    await closePicklist();
  });
}
