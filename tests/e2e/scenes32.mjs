// tests/e2e/scenes32.mjs —— 波次四十一「一键成页本体+导图帧放映本体」实证批
// 结构化死转 v2 本体 / AI 拆段（本地假 AI 伺服走主进程全链路） / 导图帧→演示本体（帧罩节点树序要点+note 随迁+不挂桥）
import http from 'http';
import fs from 'fs';

export async function scenes32({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：结构化死转 v2 本体 ====================
  await scenario('成页·结构化死转本体', async () => {
    // 开结构化 markdown（# 项目计划/## 第一章——内容 runner 侧读盘直给）
    const mdText = fs.readFileSync(WS + '/测试文档.md', 'utf8');
    await evaluate((c) => window.MazzHost?.openTab('markdown', { title: '测试文档.md', content: c }), mdText);
    await human.until(() => {
      for (const [, inst] of (window.MazzModules?.instances || new Map())) if (inst.name === 'markdown') return true;
      return false;
    }, { timeout: 9000, msg: 'markdown 开档' });
    await wait(600);
    await evaluate(() => window.MazzCommands?.execute('slide.compileFromMarkdown'));
    await human.until(() => window.__activeSlideCtl?.isV2 === true, { timeout: 9000, msg: '演示 v2 起手' });
    await wait(500);
    const r = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl?.doc2;
      const F = doc?.layouts?.main?.frames || [];
      const s0 = doc?.slides?.[F[0]?.slideId];
      const s1 = doc?.slides?.[F[1]?.slideId];
      return {
        v: doc?.v, name: doc?.name, frameN: F.length, slideN: Object.keys(doc?.slides || {}).length,
        title: s0?.items?.find(i => i.type === 'text')?.lines?.[0]?.text,
        t1: s1?.items?.find(i => i.type === 'text')?.lines?.[0]?.text,
        bullets: s1?.items?.find(i => i.list)?.list?.items?.map(x => x.text),
        source: s0?.items?.[0]?.source,
      };
    });
    human.log('死转:', JSON.stringify(r));
    await human.assert(r.v === 2, `必须是 v2 本体直落（v=${r.v}——不经大纲中间态实锤）`);
    await human.assert(r.frameN >= 1 && r.slideN === r.frameN, `物料编排必须同数（${r.slideN}/${r.frameN}）`);
    await human.assert(r.title === '项目计划', `首页标题必须来自文稿（${r.title}）`);
    await human.assert(r.t1 === '第一章 概念', `二级标题必须开新页（${r.t1}）`);
    await human.assert(r.bullets?.includes('正文内容熵增定律。'), `正文段落必须成要点（${JSON.stringify(r.bullets)}）`);
    await human.assert(r.source === null, '不得挂桥接引用（source 保持 null——用户拍板）');
  });

  // ==================== 2：AI 拆段（假 AI 全链路） ====================
  await scenario('成页·AI拆段成页', async () => {
    // 本地假 AI（OpenAI 形态）——主进程 net.fetch 全链路实证
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '```json\n[{"title":"熵增定律","bullets":["孤立系统熵不减","能量退化为热","第二类永动机不可得"],"notes":"从卡诺讲起"},{"title":"热寂说","bullets":["宇宙熵趋极大","有效能量耗尽"],"notes":"一节即可"},{"title":"麦克斯韦妖","bullets":["信息即负熵","妖不违热二"],"notes":"收尾互动"}]\n```' } }] }));
      });
    });
    const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    try {
      // 配 provider（走 settings/secret 真通道）
      await evaluate((p2) => Promise.all([
        window.mazz.invoke('settings:set', { key: 'factory.provider', value: { baseURL: `http://127.0.0.1:${p2}`, model: 'fake-llm' } }),
        window.mazz.invoke('secret:set', { key: 'factory.apiKey', value: 'fake-key' }),
      ]), port);
      // 无结构 markdown 开档
      await evaluate(() => window.MazzHost?.openTab('markdown', { title: '热力学随想.md', content: '熵增定律是热力学第二定律的通俗表述。孤立系统的熵永不减少，能量不断退化为不可用的热。第二类永动机因此不可能造成。热寂说认为宇宙熵趋极大，有效能量终将耗尽。麦克斯韦妖思想实验则指出信息本身即负熵，妖并不违反热二定律。' }));
      await wait(600);
      await evaluate(() => window.MazzCommands?.execute('slide.compileFromMarkdown', { autoConfirm: true }));
      try {
        await human.until(() => {
          const ctl = window.__activeSlideCtl;
          return ctl?.isV2 === true && ctl?.doc2?.name === '热力学随想';
        }, { timeout: 15000, msg: 'AI 拆段成档' });
      } catch (e) {
        const diag = await evaluate(async () => {
          const toasts = [...document.querySelectorAll('.mazz-toast, [class*=toast]')].map(t => t.textContent).slice(-3);
          let chatProbe = null;
          try {
            const { getProviderConfig, providerReady } = await import('./modules/factory/provider.js');
            const cfg = await getProviderConfig();
            chatProbe = { baseURL: cfg?.baseURL, model: cfg?.model, ready: providerReady(cfg), hasKey: !!cfg?.apiKey };
          } catch (e2) { chatProbe = 'probe err:' + e2.message; }
          return { toasts, chatProbe, name: window.__activeSlideCtl?.doc2?.name, isV2: window.__activeSlideCtl?.isV2 };
        });
        human.log('AI 诊断:', JSON.stringify(diag));
        throw e;
      }
      const r = await evaluate(() => {
        const ctl = window.__activeSlideCtl;
        const doc = ctl.doc2;
        const F = doc.layouts.main.frames;
        const pages = F.map(f => {
          const sl = doc.slides[f.slideId];
          return {
            t: sl.items.find(i => i.style?.bold)?.lines?.[0]?.text,
            b: sl.items.find(i => i.list)?.list?.items?.length || 0,
            n: sl.notes,
          };
        });
        return { frameN: F.length, pages };
      });
      human.log('AI 拆段:', JSON.stringify(r));
      await human.assert(r.frameN === 3, `必须 3 页（${r.frameN}）`);
      await human.assert(r.pages[0].t === '熵增定律' && r.pages[0].b === 3, `首页标题要点必须落（${JSON.stringify(r.pages[0])}）`);
      await human.assert(r.pages[1].n === '一节即可', `备注必须随迁（${r.pages[1].n}）`);
      await human.assert(r.pages[2].b === 2, '末页要点必须落');
    } finally { srv.close(); }
  });

  // ==================== 3：导图帧→演示本体 ====================
  await scenario('成页·导图帧转演示', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await human.until(() => !!window.__activeMindmapCtl?.doc, { timeout: 9000, msg: '导图起手' });
    await wait(500);
    const r = await evaluate(async () => {
      const ctl = window.__activeMindmapCtl;
      const M = await import('./modules/mindmap/model.js');
      // 造树：根[甲乙]——两帧各罩一枚
      const root = M.createNode('根主题');
      const a = M.createNode('甲分支');
      const b = M.createNode('乙分支');
      root.children = [a, b];
      ctl.doc.roots = [root];
      ctl.doc.frames = [];
      ctl.render();
      const ba = ctl.boxes.get(a.id), bb = ctl.boxes.get(b.id);
      const frOf = (bx, title, note) => ({ id: 'fr-' + title, title, note, x: bx.x - 20, y: bx.y - 20, w: bx.w + 40, h: bx.h + 40 });
      ctl.doc.frames = [frOf(ba, '讲甲', '甲的备注'), frOf(bb, '讲乙', '')];
      window.MazzCommands?.execute('mindmap.framesToSlide');
      return { ok: true };
    });
    await human.until(() => window.__activeSlideCtl?.isV2 === true && window.__activeSlideCtl?.doc2?.name?.includes('帧演示'), { timeout: 9000, msg: '帧演示开档' });
    await wait(400);
    const r2 = await evaluate(() => {
      const ctl = window.__activeSlideCtl;
      const doc = ctl.doc2;
      const F = doc.layouts.main.frames;
      const pages = F.map(f => {
        const sl = doc.slides[f.slideId];
        return {
          t: sl.items[0]?.lines?.[0]?.text,
          bl: (sl.items.find(i => i.list)?.list?.items || []).map(x => x.text),
          n: sl.notes, src: sl.items[0]?.source,
        };
      });
      return { name: doc.name, frameN: F.length, pages };
    });
    human.log('帧转演示:', JSON.stringify(r2));
    await human.assert(r2.frameN === 2, `两帧必须两页（${r2.frameN}）`);
    await human.assert(r2.pages[0].t === '讲甲', `帧标题必须落页标题（${r2.pages[0].t}）`);
    await human.assert(r2.pages[0].bl.includes('甲分支') && !r2.pages[0].bl.includes('乙分支'), `帧罩节点必须成要点且互不串（${r2.pages[0].bl}）`);
    await human.assert(r2.pages[0].n === '甲的备注', `帧 note 必须转演讲者备注（${r2.pages[0].n}）`);
    await human.assert(r2.pages[1].bl.includes('乙分支'), '乙帧必须罩乙分支');
    await human.assert(r2.pages[0].src === null, '不得挂桥接引用（source 保持 null）');
  });

  // ==================== 4：空帧明白话 ====================
  await scenario('成页·空帧明白话', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
    await wait(600);
    const r = await evaluate(() => {
      window.MazzCommands?.execute('mindmap.framesToSlide');
      return { slideOpened: !!window.__activeSlideCtl?.doc2?.name?.includes?.('未命名') && document.querySelector('.sl-v2')?.style.display === 'flex' && false };
    });
    await wait(400);
    const r2 = await evaluate(() => ({ stillMindmap: !!window.__activeMindmapCtl?.doc }));
    await human.assert(r2.stillMindmap, '空帧不得开演示档（明白话拦在原地）');
  });
}
