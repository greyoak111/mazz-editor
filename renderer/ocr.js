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

      m.body.querySelector('.ocr-go').addEventListener('click', async () => {
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
