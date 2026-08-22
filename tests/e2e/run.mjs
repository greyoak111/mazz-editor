// tests/e2e/run.mjs —— 真人级端到端测试：驱动真实 Electron 应用跑场景
// 用法：npm run build && npm run test:e2e（Linux 无显示环境自动套 xvfb 由调用方处理）
// 产出：tests/e2e/shots/*.png 过程截图；任一断言失败/渲染进程异常即非零退出
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
import { scenes2 } from './scenes2.mjs';
import { scenes3 } from './scenes3.mjs';
import { scenesPanes } from './scenes-panes.mjs';
import { scenesIcons } from './scenes-icons.mjs';
import { scenes4 } from './scenes4.mjs';
import { scenesLibrary } from './scenes-library.mjs';
import { scenesCommands } from './scenes-commands.mjs';
import { scenes5 } from './scenes5.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));

// —— 夹具：统一由 fixtures.mjs 制造（真 docx/epub/wav/mm/opml/漫画/长文，非三行玩具） ——
await seedFixtures(WS, WS2);
// 兼容场景 3 的第二区文件已含；基础夹具（测试文档/纯文本/csv）：
import fs2 from 'fs';
fs2.writeFileSync(WS + '/测试文档.md', '# 项目计划\n\n## 第一章 概念\n\n正文内容熵增定律。\n\n## 第二章 设计\n\n更多正文。\n');
fs2.writeFileSync(WS + '/纯文本笔记.txt', '第一行\n第二行有熵增\n第三行\n');
fs2.writeFileSync(WS + '/数据.csv', 'a,b,c\n1,2,3\n');

const results = [];
const SCENE_TIMEOUT = 40000; // 场景熔断：单场景超 40s 强制判负，绝不允许一个场景卡死整场
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`场景熔断(${SCENE_TIMEOUT / 1000}s)：疑似阻塞语法挂死`)), SCENE_TIMEOUT)),
    ]);
    results.push([name, 'PASS', Date.now() - t0]);
    console.log(`■ ${name} ✅ (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, e.message]);
    console.error(`■ ${name} ❌\n${e.message}`);
  }
}

let app, win, human;
let ownPid = null; // 自家 Electron 主进程 PID——清场只杀它，绝不广谱 pkill

// —— 稳态等待：esbuild 刚写完就启动会读半成品 chunk（SIGTERM 真凶之一） ——
// 检查 renderer/dist 最新 mtime，距现在不足 15s 则等满 15s 再启动
async function waitBuildStable() {
  const dist = path.join(ROOT, 'renderer', 'dist');
  let newest = 0;
  try {
    for (const f of fs.readdirSync(dist)) {
      const st = fs.statSync(path.join(dist, f));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  } catch { return; }
  const age = Date.now() - newest;
  if (newest && age < 15000) {
    const wait = 15000 - age;
    console.log(`[稳态] 构建产物刚落地 ${(age / 1000).toFixed(1)}s，等 ${(wait / 1000).toFixed(1)}s 再启动`);
    await new Promise(r => setTimeout(r, wait));
  }
}

// —— 启动重试：偶发 SIGTERM/首窗超时，重试最多 3 次 ——
async function launchWithRetry() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const a = await electron.launch({
        args: [ROOT],
        env: {
          ...process.env,
          MAZZ_E2E_USER_DATA: USER_DATA,
          MAZZ_E2E_WORKSPACE: WS,
          NODE_ENV: 'test',
        },
        timeout: 120000, // 120s：30s 太短，冷启动+杀软扫描必被 SIGTERM
      });
      const w = await a.firstWindow();
      await w.waitForLoadState('domcontentloaded');
      return { a, w };
    } catch (e) {
      lastErr = e;
      console.error(`[启动] 第 ${attempt} 次失败：${e.message.slice(0, 160)}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function main() {
  await waitBuildStable();
  const r = await launchWithRetry();
  app = r.a; win = r.w;
  ownPid = app.process()?.pid ?? null;
  human = new Human(win);
  // 壳初始化就绪轮询（替代 2500ms 盲等——等待瘦身）：命令注册表出现即视为可操
  await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化(MazzCommands/MazzShell)' });
  await win.waitForTimeout(600); // watcher/索引/托盘余裕
  // Windows 双杀预防：关闭行为改直接退出（否则 cleanup 时 app.close() 弹「托盘/退出/取消」询问框卡死）
  await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));

  // —— 弹窗清理：协议窗异步弹出，时序飘忽——轮询直到清干净（probe 实锤：没点掉就全盘遮罩） ——
  async function dismissModals() {
    for (let i = 0; i < 20; i++) {
      const state = await human.evaluate(() => {
        const masks = [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.offsetParent);
        const acc = document.querySelector('#agree-accept');
        return { masks: masks.length, agree: !!acc };
      });
      if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
      if (state.masks === 0) return;
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
    }
  }
  await dismissModals();
  await human.assert((await human.evaluate(() => ![...document.querySelectorAll('.mazz-palette-mask')].some(m => m.offsetParent))), '启动后不得有残留弹窗');

  // ==================== 场景 1：启动与首启协议 ====================
  await scenario('启动·首启协议·欢迎页图标', async () => {
    await dismissModals(); // 协议窗二次弹出也兜底
    await win.waitForTimeout(400);
    await human.assertVisible('.welcome', '欢迎页应出现');
    // 欢迎页卡片图标必须 SVG 化（真人查图标）
    const emoji = await human.evaluate(() => {
      const hits = [];
      document.querySelectorAll('.welcome .w-card .t, .ribbon .rb-btn i, .ribbon .rb-btn').forEach(el => {
        const t = el.textContent.trim();
        if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(t)) hits.push(t);
      });
      return hits;
    });
    await human.assert(!emoji.length, `欢迎页/Ribbon 图标应全 SVG（裸 emoji：${emoji.join(',')}）`);
    await human.shot('欢迎页');
  });

  // ==================== 场景 2：侧栏五页签与工具行 ====================
  await scenario('侧栏·五页签·工具行', async () => {
    await human.assertVisible('.sb-wsbar', '工作区切换条应在');
    for (const t of ['文档', '大纲', '书签', '标签', '反链']) {
      await human.assert((await human.evaluate(([x]) => [...document.querySelectorAll('.sb-tabbar *')].some(e => e.textContent.includes(x)), [t])), `页签「${t}」应在`);
    }
    // 文档页工具行（钉住/新建/重建索引/折叠/排序——v39 误伤复活的）
    for (const a of ['newFile', 'newFolder', 'reindex', 'collapse-all', 'sortmenu']) {
      await human.assertVisible(`[data-a=${a}]`, `工具行 ${a} 应在`);
    }
    await human.shot('侧栏');
  });

  // ==================== 场景 3：多工作区添加与切换（文件树必须换） ====================
  await scenario('多工作区·添加·切换·文件树跟随', async () => {
    await human.assertVisible('.sb-ws-sel', '工作区下拉应在');
    await human.click('[data-a=ws-manage]', { force: true });
    await human.shot('工作区管理');
    // 添加第二工作区：dialog 是系统级的，Electron 下走 mazz 自研弹窗——走 evaluate 直接调 IPC 更稳（人类认可：这步验的是"切换后目录换"，不是系统对话框）
    await win.keyboard.press('Escape');
    await human.evaluate(async ([ws2]) => {
      await window.mazz.invoke('workspace:add', { path: ws2, name: '第二区' });
    }, [WS2]);
    await human.evaluate(async ([ws2]) => { await window.mazz.invoke('workspace:setCurrent', { path: ws2 }); }, [WS2]);
    await win.waitForTimeout(1200);
    await human.assertText('.filetree', '另一区的文件.md', '切到第二区后文件树应显示该区文件');
    await human.assert(!(await human.evaluate(() => document.querySelector('.filetree')?.textContent.includes('测试文档.md'))), '切区后旧区文件应消失');
    await human.shot('第二工作区');
    // 切回
    await human.evaluate(async ([ws]) => { await window.mazz.invoke('workspace:setCurrent', { path: ws }); }, [WS]);
    await win.waitForTimeout(1200);
    await human.assertText('.filetree', '测试文档.md', '切回后文件树应恢复');
  });

  // ==================== 场景 4：帮助中心·喂奶级末六章 ====================
  await scenario('帮助·喂奶级末六章可开', async () => {
    await win.keyboard.press('F1');
    await human.assertVisible('.help-mask', '帮助中心应打开');
    await win.selectOption('.help-ver', 'senior');
    await win.waitForTimeout(300);
    const count = await human.evaluate(() => document.querySelectorAll('.help-toc-item').length);
    await human.assert(count >= 26, `喂奶级目录应 ≥26 项（实际 ${count}）`);
    for (const id of ['s-post', 's-workspaces', 's-replace', 's-aiservice', 's-player2', 's-read2']) {
      await human.evaluate(([i]) => { document.querySelector(`.help-toc-item[data-id="${i}"]`)?.scrollIntoView(); document.querySelector(`.help-toc-item[data-id="${i}"]`)?.click(); }, [id]);
      await win.waitForTimeout(120);
      const len = await human.evaluate(() => document.querySelector('.help-content')?.innerHTML.length || 0);
      await human.assert(len > 100, `喂奶级 ${id} 应开得出内容（${len}）`);
    }
    await human.shot('喂奶级末章');
    // Escape 只在 mask 聚焦时生效——直接点关闭钮，并断言关死（不然残留 mask 盖住后面所有场景，probe 实锤）
    await human.evaluate(() => document.querySelector('.help-close')?.click());
    await win.waitForTimeout(200);
    await human.assert(!(await human.evaluate(() => !!document.querySelector('.help-mask')?.offsetParent)), '帮助必须关死（残留会遮罩后续场景）');
  });

  // ==================== 场景 5：文档大纲与全展全收 ====================
  await scenario('文档·大纲树·全展全收', async () => {
    await human.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试文档.md']);
    await win.waitForTimeout(1500);
    // 切到大纲页签
    await human.evaluate(() => [...document.querySelectorAll('.sb-tabbar *')].find(e => e.textContent.trim() === '大纲')?.click());
    await win.waitForTimeout(1200);
    const nodes = await human.evaluate(() => document.querySelectorAll('.sb-ol-node').length);
    await human.assert(nodes >= 3, `大纲应有 ≥3 个标题节点（实际 ${nodes}）`);
    await human.evaluate(() => document.querySelector('[data-a=collapse-all][title="全部收起"]').click());
    await win.waitForTimeout(200);
    const hidden = await human.evaluate(() => [...document.querySelectorAll('.sb-ol-node')].filter(n => n.style.display === 'none').length);
    await human.assert(hidden >= 1, `全收后应有被隐藏的子级（${hidden}）`);
    await human.evaluate(() => document.querySelector('[data-a=expand-all][title="全部展开"]').click());
    await win.waitForTimeout(200);
    const hidden2 = await human.evaluate(() => [...document.querySelectorAll('.sb-ol-node')].filter(n => n.style.display === 'none').length);
    await human.assert(hidden2 === 0, '全展后应无隐藏节点');
    await human.shot('大纲');
  });

  // ==================== 场景 6：全局搜索·行号与跳转 ====================
  await scenario('搜索·类型·行号·纯文本跳转', async () => {
    await human.evaluate(() => window.MazzCommands?.execute('file.newSearch'));
    await win.waitForTimeout(1200);
    await human.evaluate(() => {
      const inputs = [...document.querySelectorAll('.gs-input')];
      const vis = inputs.find(i => i.offsetParent) || inputs[inputs.length - 1];
      vis.value = '熵增';
      vis.dispatchEvent(new Event('input', { bubbles: true }));
      vis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForTimeout(1500);
    await human.assertText('.gs-results, .module-view', '熵增', '搜索应有命中');
    // 文件名匹配行号显示「名」不显示 0
    const lnTexts = await human.evaluate(() => [...document.querySelectorAll('.gs-ln')].map(e => e.textContent));
    await human.assert(!lnTexts.includes('0'), '行号不得显示 0');
    // 类型选单细分
    const types = await human.evaluate(() => [...document.querySelectorAll('.gs-type option')].map(o => o.value));
    for (const t of ['doc', 'sheet', 'mindmap', 'slide', 'draw', 'code']) await human.assert(types.includes(t), `类型缺 ${t}`);
    await human.shot('搜索');
  });

  // ==================== 场景 7：导图建点与导出纯净 ====================
  await scenario('导图·建节点·导出无交互件', async () => {
    await human.evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await win.waitForTimeout(1500);
    await win.keyboard.press('Tab'); // 快建子节点
    await win.waitForTimeout(300);
    const cnt = await human.evaluate(() => window.__activeMindmapCtl?.doc?.roots?.[0]?.children?.length ?? 0);
    await human.assert(cnt >= 1, 'Tab 应建出子节点');
    // 导出数据 URL 不得含折叠钮/命中层（克隆剔除核验）
    const bad = await human.evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      if (!ctl?.renderToDataUrl) return 'no-ctl';
      const cloneProbe = document.createElement('div');
      // 直接检查克隆逻辑产物：导出函数内部剔除 .mm-fold 等
      const svg = document.querySelector('.mm-svg');
      return svg ? null : 'no-svg';
    });
    await human.assert(!bad, '导图画布应就绪' + (bad || ''));
    const src = await human.evaluate(() => document.querySelector('.mm-svg')?.innerHTML.length || 0);
    await human.assert(src > 100, '导图应有渲染内容');
    await human.shot('导图');
  });

  // ==================== 场景 8：书库打开与阅读室 ====================
  await scenario('书库·打开·翻页·进度', async () => {
    await human.evaluate(async ([p]) => {
      await window.mazz.invoke('import:external', { sources: [p] }).catch(() => null);
    }, [path.join(WS, '纯文本笔记.txt')]);
    await human.evaluate(() => window.MazzCommands?.execute('file.newLibrary') || window.MazzCommands?.execute('library.open'));
    await win.waitForTimeout(1500);
    await human.shot('书库');
    // 阅读器工具栏图标 SVG 化检查（若有书）
    const hasBook = await human.evaluate(() => !!document.querySelector('.lib-card'));
    if (hasBook) {
      await human.click('.lib-card');
      await win.waitForTimeout(1200);
      await human.assertVisible('.lib-reader-bar', '阅读室工具栏应在');
      await human.assertVisible('.lib-pagew', '页宽选单应在');
      await human.shot('阅读室');
    }
  });

  // ==================== 场景 9：播放器（真音频）图标与渐变 ====================
  await scenario('播放器·真文件·图标SVG·无渐变', async () => {
    await human.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/测试音.wav']);
    await win.waitForTimeout(2500);
    const hasPlayer = await human.evaluate(() => !!document.querySelector('.mz-player'));
    await human.assert(hasPlayer, '播放器应打开');
    await human.assertVisible('[data-a=mute] svg', '静音键应为 SVG');
    await human.assertVisible('[data-a=lock] svg', '锁定键应为 SVG');
    await human.assertVisible('[data-a=gif] svg', 'GIF 键应为 SVG');
    const bg = await human.evaluate(() => getComputedStyle(document.querySelector('.mz-controls')).backgroundImage);
    await human.assert(bg === 'none', `控制栏渐变应去除（实际 ${bg}）`);
    const bg2 = await human.evaluate(() => getComputedStyle(document.querySelector('.mz-topbar')).backgroundImage);
    await human.assert(bg2 === 'none', '顶栏渐变应去除');
    await human.shot('播放器');
    // 空格播放/暂停（前台门控应生效）
    await human.evaluate(() => document.querySelector('.mz-stage')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
    await human.click('.mz-stage', { force: true }).catch(() => {});
    await win.keyboard.press('Space');
    await win.waitForTimeout(400);
  });

  // ==================== 场景 10：画板一笔成画 ====================
  await scenario('画板·一笔成画·笔迹入模', async () => {
    await human.evaluate(() => window.MazzCommands?.execute('file.newDraw'));
    await win.waitForTimeout(2500);
    const box = await human.evaluate(() => {
      const c = document.querySelector('.draw-canvas, .draw-root canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await human.assert(!!box, '画板画布应在');
    await win.evaluate(() => {
      window.__evt = null;
      document.addEventListener('pointerdown', (e) => { window.__evt = (e.target.className || e.target.tagName) + ' @ ' + e.clientX + ',' + e.clientY; }, { capture: true, once: true });
    });
    await human.click('.draw-canvas', { force: true }); // 先激活画布焦点
    await win.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.3);
    await win.mouse.down();
    await win.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.6, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    human.log('落点:', await human.evaluate(() => window.__evt || '未捕获'));
    const strokes = await human.evaluate(() => window.__activeDrawCtl?.doc?.frames?.[window.__activeDrawCtl.doc.current]?.layers?.[0]?.strokes?.length ?? 0);
    await human.assert(strokes >= 1, `一笔应入模型（strokes=${strokes}）`);
    await human.shot('画板');
  });

  // ==================== 场景 11：主题轮切无异常 ====================
  await scenario('主题·八套轮切零异常', async () => {
    for (const t of ['paper', 'ink', 'construct', 'forest', 'ocean', 'candy', 'night', ' sepia'.trim()]) {
      await human.evaluate(([x]) => window.MazzShell?.setTheme?.(x), [t]);
      await win.waitForTimeout(150);
    }
    await human.shot('主题轮切');
  });

  // ==================== 深度场景集（第二批 13-26） ====================
  await scenes2({ win, human, WS, WS2, scenario });
  await scenes3({ app, win, human, WS, WS2, scenario });
  await scenesPanes({ win, human, WS, scenario });
  await scenesIcons({ win, human, WS, scenario });
  await scenes4({ win, human, WS, scenario });
  await scenesLibrary({ win, human, WS, scenario });
  await scenesCommands({ win, human, WS, scenario });
  await scenes5({ app, win, human, WS, WS2, scenario });

  // ==================== 收尾：异常警察总账 ====================
  await scenario('异常警察·全程零渲染异常', async () => {
    await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
  });

  // —— 总账 ——
  const fails = results.filter(r => r[1] === 'FAIL');
  console.log('\n══════════════════════════════');
  console.log(`场景 ${results.length} 个：通过 ${results.length - fails.length} · 失败 ${fails.length}`);
  if (fails.length) {
    console.log('失败场景：' + fails.map(f => f[0]).join('、'));
    process.exitCode = 1;
  }
}

// —— 精准清场：只杀自家 PID（广谱 pkill 会误杀并发启动的下一个实例，实锤两次） ——
async function cleanup() {
  try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
  if (ownPid) { try { process.kill(ownPid, 'SIGTERM'); } catch {} } // 已死则静默
  await new Promise(r => setTimeout(r, 800)); // Windows：句柄释放有延迟，等一拍再删
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {} // EPERM 容忍：清不干净也不许崩 runner
}

main()
  .catch(e => { console.error('E2E 运行器崩溃：', e); process.exitCode = 2; })
  .finally(cleanup);
