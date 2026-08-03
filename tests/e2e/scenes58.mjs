// tests/e2e/scenes58.mjs —— W58d 实证批：看图零连带 / 超大 md·docx 降级 / 小文件防误伤
import fs from 'fs';
import JSZip from 'jszip';

export async function scenes58({ app, win, human, WS, WS2, scenario }) {
  const wait = (ms) => win.waitForTimeout(ms);
  const evaluate = (fn, arg) => win.evaluate(fn, arg);

  // 造档：真 PNG + 最小 PDF
  fs.writeFileSync(WS + '/验收图.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4GBgQEACvsC/wvfs+8AAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(WS + '/验收文档.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 30 100 Td (W58D PDF) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'));

  const viewerState = () => evaluate(() => {
    const ctl = window.__activeViewerCtl;
    return ctl ? { kind: ctl.kind, players: ctl.body.querySelectorAll('.mz-player-root').length, imgs: ctl.body.querySelectorAll('img').length, embeds: ctl.body.querySelectorAll('embed').length } : null;
  });

  // ==================== 1：看图零连带 ====================
  await scenario('看图·零连带播放器', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/验收图.png');
    await wait(2800);
    const st = await viewerState();
    human.log('看图状态:', JSON.stringify(st));
    await human.assert(st?.kind === 'image' && st.imgs === 1, `图片必须真渲染（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.players === 0, `裸播放器必须零连带（实拿 players=${st.players}——竞态闸重验+收尸）`);
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(400);
  });

  // ==================== 2：PDF 零连带 ====================
  await scenario('PDF·零连带且真嵌档', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/验收文档.pdf');
    await wait(2800);
    const st = await viewerState();
    human.log('PDF 状态:', JSON.stringify(st));
    await human.assert(st?.kind === 'pdf' && st.embeds === 1, `PDF 必须 embed 真嵌（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.players === 0, `裸播放器必须零连带（实拿 players=${st.players}）`);
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(400);
  });

  // ==================== 3：书库 epub 真打开 ====================
  await scenario('书库·epub 打开真渲染', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/电子书/潮声集.epub');
    await wait(5000);
    const st = await evaluate(() => ({
      toc: document.querySelectorAll('.lib-toc *').length,
      reader: !!document.querySelector('.lib-reader, .lib-book, [class*=lib-read]'),
      bodyHas: document.body.innerText.includes('潮声集'),
      players: document.querySelectorAll('.mz-player-root').length,
    }));
    human.log('书库状态:', JSON.stringify(st));
    await human.assert(st.bodyHas && st.toc >= 1, `epub 必须真开（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.players === 0, '书库不得沾播放器');
  });

  // ==================== 4：超大 md 降级不卡死 ====================
  await scenario('超大md·Monaco 降级不崩', async () => {
    const big = WS + '/超大.md';
    fs.writeFileSync(big, Buffer.from(Array.from({ length: 100000 }, (_, i) => `## 第${i + 1}节\n\n正文 ${i + 1}\n`).join('\n')));
    const t0 = Date.now();
    await evaluate((p) => window.MazzShell?.openFile?.(p), big);
    await wait(7000);
    const st = await evaluate(() => {
      const ctl = window.__activeCodeCtl;
      return {
        lang: ctl?.language,
        lines: ctl?.editor?.getModel()?.getLineCount() ?? -1,
        viewLines: document.querySelectorAll('.view-lines > div').length,
        pm: !!document.querySelector('.ProseMirror'),
      };
    });
    human.log(`超大md@${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(st));
    await human.assert(st.lines === 400000, `40 万行必须全载（实拿 ${st.lines}）`);
    await human.assert(st.lang === 'markdown', `语言必须 markdown（实拿 ${st.lang}）`);
    await human.assert(st.viewLines > 0 && st.viewLines < 100, `Monaco 虚拟化必须生效（可视行 ${st.viewLines}）`);
    await human.assert(st.pm === false, '不得走 ProseMirror（整树必卡死）');
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(500);
  });

  // ==================== 5：超大 docx 降级纯文本 ====================
  await scenario('超大docx·轻提取降级', async () => {
    // 夹带 3.5MB 无关部件把 zip 顶过阈值（document.xml 不变——提取内容应照旧）
    const src = fs.readFileSync(WS + '/立项报告.docx');
    const zip = await JSZip.loadAsync(src);
    zip.file('word/media/pad.bin', Buffer.alloc(3_600_000, 7));
    const padded = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const big = WS + '/超大报告.docx';
    fs.writeFileSync(big, padded);
    human.log('夹带后 docx 字节:', padded.length);
    const openErr = await evaluate((p) => window.MazzShell?.openFile?.(p).then(() => null).catch(e => String(e?.message || e)), big);
    human.log('openFile 回执:', JSON.stringify(openErr));
    // 轮询等编辑器落地（Monaco 异步创建+_pendingText 桥——9s 盲等会读空实锤）
    let st = null;
    for (let i = 0; i < 30; i++) {
      await wait(1000);
      st = await evaluate(() => {
        const ctl = window.__activeCodeCtl;
        return {
          lang: ctl?.language, val: (ctl?.editor?.getValue() || '').length,
          fp: ctl?.filePath ?? null, pending: (ctl?._pendingText || '').length,
          pm: !!document.querySelector('.ProseMirror'), mod: window.MazzShell?.paneTree?.tabs?.active?.moduleId,
        };
      });
      if (st.val > 0 || i >= 29) break;
    }
    human.log('超大docx:', JSON.stringify(st));
    await human.assert(st.mod === 'code' && st.pm === false, `必须降级 code 模块（实拿 ${JSON.stringify(st)}）`);
    await human.assert(st.lang === 'plaintext' && st.val > 100, `必须纯文本轻提取（实拿 lang=${st.lang} val=${st.val}）`);
    await evaluate(() => window.MazzCommands?.execute('file.closeTab')).catch(() => {});
    await wait(400);
  });

  // ==================== 6：小 md 防误伤（富文本照常） ====================
  await scenario('小md·富文本不遭池鱼', async () => {
    await evaluate((p) => window.MazzShell?.openFile?.(p), WS + '/测试文档.md');
    await wait(2500);
    const st = await evaluate(() => ({
      pm: !!document.querySelector('.ProseMirror'),
      text: (document.querySelector('.ProseMirror')?.textContent || '').includes('W58c 实证') || (document.querySelector('.ProseMirror')?.textContent || '').length > 0,
      mod: window.MazzShell?.paneTree?.tabs?.active?.moduleId,
    }));
    human.log('小md:', JSON.stringify(st));
    await human.assert(st.mod === 'markdown' && st.pm === true, `小 md 必须仍走富文本（实拿 ${JSON.stringify(st)}）`);
  });
}
