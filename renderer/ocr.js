// renderer/ocr.js —— OCR 图片文字识别（Tesseract.js 懒加载，中英双语）
import { modal, toast } from './shell/shell.js';
import { createOcrRuntime, OCR_LIMITS } from './lib/ocr-runtime.js';

const CACHE_KEY = 'ocr.languages.ready.v1';
const runtime = createOcrRuntime();

export function registerOcrCommands(commands) {
  commands.register('ocr.image', {
    title: '图片文字识别（OCR）', icon: '🔤', group: '工具',
    run: async () => {
      if (!window.mazz?.isElectron) { toast('OCR 需要桌面版'); return; }
      const p = await window.mazz.invoke('dialog:openFile', {
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      });
      if (!p) return;
      const stat = await window.mazz.invoke('fs:stat', { path: p }).catch(() => null);
      if (stat?.size > OCR_LIMITS.maxImageBytes) { toast('图片超过 32 MiB OCR 上限'); return; }
      const ext = p.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
      const dataUrl = `data:image/${ext};base64,${b64}`;

      const m = modal('图片文字识别（OCR）');
      m.body.innerHTML = `
        <div style="display:flex;gap:14px;max-width:72vw">
          <img src="${dataUrl}" style="max-width:300px;max-height:300px;border:1px solid var(--bd,#e0ded8);border-radius:8px;object-fit:contain" alt="">
          <div style="flex:1;min-width:320px;display:flex;flex-direction:column;gap:8px">
            <div class="tr-label">识别引擎
              <select class="rb-select ocr-engine">
                <option value="ai">AI 多模态（推荐，需配置 AI）</option>
                <option value="local">本地 Tesseract（离线）</option>
              </select>
            </div>
            <div class="tr-label">识别语言
              <select class="rb-select ocr-lang">
                <option value="chi_sim+eng">中文 + 英文</option>
                <option value="chi_sim">中文</option>
                <option value="eng">英文</option>
                <option value="jpn">日语</option>
                <option value="kor">韩语</option>
              </select>
              <button class="rb-btn ocr-go" style="flex-direction:row;margin-left:8px">开始识别</button>
              <button class="rb-btn ocr-cancel" style="display:none;flex-direction:row;margin-left:4px">取消</button>
            </div>
            <div class="ocr-status" style="font-size:12px;color:var(--fg-dim)">首次使用需下载识别模型（约 15MB，之后离线可用）</div>
            <textarea class="ocr-out rb-input" rows="10" readonly spellcheck="false" placeholder="识别结果…"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="rb-btn ocr-copy" style="flex-direction:row" disabled>复制</button>
              <button class="rb-btn ocr-insert" style="flex-direction:row" disabled>插入到光标</button>
            </div>
          </div>
        </div>`;
      const out = m.body.querySelector('.ocr-out');
      const status = m.body.querySelector('.ocr-status');
      const copyBtn = m.body.querySelector('.ocr-copy');
      const insertBtn = m.body.querySelector('.ocr-insert');
      const goBtn = m.body.querySelector('.ocr-go');
      const cancelBtn = m.body.querySelector('.ocr-cancel');
      let aiController = null;
      let running = false;
      const setRunning = value => {
        running = value;
        goBtn.disabled = value;
        cancelBtn.style.display = value ? 'inline-flex' : 'none';
      };
      const readyLangs = await window.mazz.invoke('settings:get', { key: CACHE_KEY }).catch(() => []);
      if (Array.isArray(readyLangs) && readyLangs.length) status.textContent = `本地模型缓存已就绪：${readyLangs.join('、')}`;

      const engineEl = m.body.querySelector('.ocr-engine');
      cancelBtn.addEventListener('click', async () => {
        aiController?.abort(new Error('用户取消'));
        await runtime.cancel('user-cancel');
        status.textContent = '已取消；没有保留后台 OCR 作业';
      });
      goBtn.addEventListener('click', async () => {
        if (running) return;
        setRunning(true);
        copyBtn.disabled = insertBtn.disabled = true;
        if (engineEl.value === 'ai') {
          // AI 多模态识别（vision 通道）
          out.value = 'AI 识别中…';
          status.textContent = 'AI 多模态识别中（比本地模型更懂版式与手写）';
          aiController = new AbortController();
          try {
            const { getProviderConfig, providerReady, visionChat } = await import('./modules/factory/provider.js');
            const cfg = await getProviderConfig('vision');
            if (!providerReady(cfg)) {
              out.value = '未配置 AI 服务——请先在智能创作 ⚙ 配置（或把引擎切回「本地 Tesseract」）';
              status.textContent = '';
              return;
            }
            const langName = { 'chi_sim+eng': '中文和英文', chi_sim: '中文', eng: '英文', jpn: '日文', kor: '韩文' }[m.body.querySelector('.ocr-lang').value] || '中文和英文';
            const text = await visionChat({
              cfg, role: 'vision',
              prompt: `请精确识别这张图片中的全部文字（主要是${langName}）。要求：1. 按原图版式与阅读顺序逐行输出原文；2. 表格按行以「|」分列；3. 不翻译、不解释、不评价、不补充任何内容；4. 看不清的字用 □ 标出。`,
              imageDataUrl: dataUrl,
              signal: aiController.signal,
            });
            if (aiController.signal.aborted) return;
            out.value = text;
            status.textContent = '✓ AI 识别完成';
            copyBtn.disabled = insertBtn.disabled = !text;
          } catch (e) {
            if (e?.name === 'AbortError') status.textContent = '已取消；远端请求已终止';
            else { out.value = 'AI 识别失败：' + e.message; status.textContent = '可切回「本地 Tesseract」重试'; }
          } finally {
            aiController = null;
            setRunning(false);
          }
          return;
        }
        const lang = m.body.querySelector('.ocr-lang').value;
        status.textContent = '正在加载识别引擎…';
        copyBtn.disabled = insertBtn.disabled = true;
        try {
          const result = await runtime.recognize({
            imageDataUrl: dataUrl,
            lang,
            onProgress: (info) => {
              if (info.status === 'recognizing text') {
                status.textContent = `识别中… ${Math.round(info.progress * 100)}%`;
              } else {
                status.textContent = info.status + '…';
              }
            },
          });
          const text = result.text;
          out.value = text || '（未识别到文字）';
          status.textContent = `完成（置信度 ${Math.round(result.confidence)}%）；该语言模型以后可离线复用`;
          copyBtn.disabled = insertBtn.disabled = !text;
          const current = await window.mazz.invoke('settings:get', { key: CACHE_KEY }).catch(() => []);
          await window.mazz.invoke('settings:set', { key: CACHE_KEY, value: [...new Set([...(Array.isArray(current) ? current : []), lang])] }).catch(() => {});
        } catch (e) {
          if (e?.code === 'OCR_CANCELLED') status.textContent = '已取消；本地 worker 已释放';
          else if (e?.code === 'OCR_TIMEOUT') status.textContent = e.message;
          else status.textContent = '识别失败：' + (e.message || e) + '（首次模型下载失败时请联网重试；已缓存语言可离线使用）';
        } finally { setRunning(false); }
      });
      copyBtn.addEventListener('click', async () => {
        await window.mazz.invoke('clipboard:write', { text: out.value }).catch(() => {});
        toast('已复制');
      });
      insertBtn.addEventListener('click', () => {
        m.close();
        document.execCommand('insertText', false, out.value);
      });
      const observer = new MutationObserver(() => {
        if (document.body.contains(m.el)) return;
        observer.disconnect();
        aiController?.abort(new Error('OCR 对话框已关闭'));
        runtime.cancel('dialog-closed').catch(() => {});
      });
      observer.observe(document.body, { childList: true });
    },
  });
}
