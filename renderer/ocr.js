// renderer/ocr.js —— OCR 图片文字识别（Tesseract.js 懒加载，中英双语）
import { modal, toast } from './shell/shell.js';

let tesseractPromise = null;
function loadTesseract() {
  if (!tesseractPromise) tesseractPromise = import('tesseract.js');
  return tesseractPromise;
}

export function registerOcrCommands(commands) {
  commands.register('ocr.image', {
    title: '图片文字识别（OCR）', icon: '🔤', group: '工具',
    run: async () => {
      if (!window.mazz?.isElectron) { toast('OCR 需要桌面版'); return; }
      const p = await window.mazz.invoke('dialog:openFile', {
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      });
      if (!p) return;
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
            </div>
            <div class="ocr-status" style="font-size:12px;color:#83817a">首次使用需下载识别模型（约 15MB，之后离线可用）</div>
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

      const engineEl = m.body.querySelector('.ocr-engine');
      m.body.querySelector('.ocr-go').addEventListener('click', async () => {
        if (engineEl.value === 'ai') {
          // AI 多模态识别（vision 通道）
          out.value = 'AI 识别中…';
          status.textContent = 'AI 多模态识别中（比本地模型更懂版式与手写）';
          try {
            const { getProviderConfig, providerReady, visionChat } = await import('./modules/factory/provider.js');
            const cfg = await getProviderConfig();
            if (!providerReady(cfg)) {
              out.value = '未配置 AI 服务——请先在智能创作 ⚙ 配置（或把引擎切回「本地 Tesseract」）';
              status.textContent = '';
              return;
            }
            const langName = { 'chi_sim+eng': '中文和英文', chi_sim: '中文', eng: '英文', jpn: '日文', kor: '韩文' }[m.body.querySelector('.ocr-lang').value] || '中文和英文';
            const text = await visionChat({
              cfg,
              prompt: `请精确识别这张图片中的全部文字（主要是${langName}）。要求：1. 按原图版式与阅读顺序逐行输出原文；2. 表格按行以「|」分列；3. 不翻译、不解释、不评价、不补充任何内容；4. 看不清的字用 □ 标出。`,
              imageDataUrl: dataUrl,
            });
            out.value = text;
            status.textContent = '✓ AI 识别完成';
            copyBtn.disabled = insertBtn.disabled = !text;
          } catch (e) {
            out.value = 'AI 识别失败：' + e.message;
            status.textContent = '可切回「本地 Tesseract」重试';
          }
          return;
        }
        const lang = m.body.querySelector('.ocr-lang').value;
        status.textContent = '正在加载识别引擎…';
        copyBtn.disabled = insertBtn.disabled = true;
        try {
          const Tesseract = await loadTesseract();
          const { data } = await Tesseract.recognize(dataUrl, lang, {
            logger: (info) => {
              if (info.status === 'recognizing text') {
                status.textContent = `识别中… ${Math.round((info.progress || 0) * 100)}%`;
              } else {
                status.textContent = info.status + '…';
              }
            },
          });
          const text = (data?.text || '').trim();
          out.value = text || '（未识别到文字）';
          status.textContent = `完成（置信度 ${Math.round(data?.confidence || 0)}%）`;
          copyBtn.disabled = insertBtn.disabled = !text;
        } catch (e) {
          status.textContent = '识别失败：' + (e.message || e) + '（模型下载需要网络）';
        }
      });
      copyBtn.addEventListener('click', async () => {
        await window.mazz.invoke('clipboard:write', { text: out.value }).catch(() => {});
        toast('已复制');
      });
      insertBtn.addEventListener('click', () => {
        m.close();
        document.execCommand('insertText', false, out.value);
      });
    },
  });
}
