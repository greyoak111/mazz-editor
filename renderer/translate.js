// renderer/translate.js —— 全局翻译：选区/全文翻译 + 引擎配置（主进程代理，页面拿不到通道细节）
import { modal, toast } from './shell/shell.js';

const LANGS = [
  ['zh-CN', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'],
  ['fr', '法语'], ['de', '德语'], ['es', '西班牙语'], ['ru', '俄语'],
];

/** 取当前选区文本（contenteditable/DOM 通用） */
function getSelectionText() {
  return (window.getSelection()?.toString() || '').trim();
}

/** 向光标处插入文本（ProseMirror 经 beforeinput 正常接管） */
function insertAtCursor(text) {
  document.execCommand('insertText', false, text);
}

export function showTranslateModal(initialText = '') {
  // W52f：浏览器前台 DOM modal 必被 WebContentsView 压（真机实锤）——收编 lean 弹窗子窗；
  // lean 子窗内（dataset.windowMode）直开本机 modal 防递归
  if (window.mazz?.isElectron) {
    // W53：全原生独立子窗格（应用壳 lean 路线退役）——初始文本经主窗暂存透传
    if (initialText) window.mazz.invoke('panel:action', { type: 'translateStashInit', text: initialText }).catch(() => {});
    window.mazz.invoke('panel:open', { kind: 'translate' }).catch(() => {});
    return;
  }
  const m = modal('翻译');
  m.body.innerHTML = `
    <div class="tr-grid">
      <div class="tr-col">
        <div class="tr-label">原文</div>
        <textarea class="tr-src rb-input" rows="7" spellcheck="false">${initialText.replace(/</g, '&lt;')}</textarea>
      </div>
      <div class="tr-col">
        <div class="tr-label">译文
          <select class="rb-select tr-target" style="margin-left:8px">${LANGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
          <select class="rb-select tr-source"><option value="auto">自动检测</option>${LANGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        </div>
        <textarea class="tr-out rb-input" rows="7" readonly spellcheck="false" placeholder="点击「翻译」…"></textarea>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="rb-btn tr-go" style="flex-direction:row">翻译</button>
      <button class="rb-btn tr-copy" style="flex-direction:row" disabled>复制译文</button>
      <button class="rb-btn tr-replace" style="flex-direction:row" disabled>替换选区</button>
      <button class="rb-btn tr-insert" style="flex-direction:row" disabled>插入到光标</button>
      ${document.documentElement.dataset.windowMode === 'lean' ? '<span style="font-size:11px;color:var(--fg-dim);align-self:center">弹窗版：替换/插入请在主窗使用</span>' : ''}
    </div>`;
  const src = m.body.querySelector('.tr-src');
  const out = m.body.querySelector('.tr-out');
  const target = m.body.querySelector('.tr-target');
  const source = m.body.querySelector('.tr-source');
  const btns = ['.tr-copy', '.tr-replace', '.tr-insert'].map(s => m.body.querySelector(s));
  // 有选区时默认目标：中文原文→英语，其他→中文
  if (initialText && /[一-鿿]/.test(initialText)) target.value = 'en';

  m.body.querySelector('.tr-go').addEventListener('click', async () => {
    const text = src.value.trim();
    if (!text) { toast('请输入原文'); return; }
    out.value = '翻译中…';
    btns.forEach(b => b.disabled = true);
    // AI 优先（智能创作 Provider 就绪时，独立提示词工程）；否则免费引擎
    try {
      const { aiTranslate } = await import('./lib/ai-translate.js');
      const ai = await aiTranslate({ text, from: source.value, to: target.value });
      if (ai) {
        out.value = ai.text || '（无结果）';
        btns.forEach(b => b.disabled = !ai.text);
        toast('AI 翻译完成');
        return;
      }
    } catch (e) {
      out.value = 'AI 翻译失败：' + (e.message || e) + '\n\n可检查智能创作 ⚙ 的 AI 服务配置，或改用免费引擎';
      return;
    }
    try {
      const r = await window.mazz.invoke('tr:translate', { text, from: source.value, to: target.value });
      out.value = r.text || '（无结果）';
      btns.forEach(b => b.disabled = !r.text);
      toast('免费引擎翻译完成（配 AI 后可享受更高质量）');
    } catch (e) {
      out.value = '翻译失败：' + (e.message || e) + '\n\n（未配置 AI；免费引擎有日限额，也可在设置中改配 LibreTranslate 自部署实例）';
    }
  });
  m.body.querySelector('.tr-copy').addEventListener('click', async () => {
    await window.mazz.invoke('clipboard:write', { text: out.value }).catch(() => {});
    toast('译文已复制');
  });
  m.body.querySelector('.tr-replace').addEventListener('click', () => {
    m.close();
    insertAtCursor(out.value);
  });
  m.body.querySelector('.tr-insert').addEventListener('click', () => {
    m.close();
    insertAtCursor('\n' + out.value + '\n');
  });
}

export function registerTranslateCommands(commands) {
  commands.register('translate.selection', {
    title: '翻译选中文本', icon: '🌐', group: '工具',
    when: "module=='markdown' || module=='text' || module=='notes'",
    run: () => {
      const text = getSelectionText();
      if (!text) { toast('先选中一段文字'); return; }
      showTranslateModal(text);
    },
  });
  commands.register('translate.panel', {
    title: '打开翻译面板', icon: '🌐', group: '工具',
    run: () => showTranslateModal(getSelectionText()),
  });
  commands.register('translate.config', {
    title: '翻译引擎设置', icon: '⚙', group: '工具',
    run: async () => {
      // W53：引擎设置并入翻译子窗格抽屉（⚙ 引擎设置钮）
      if (window.mazz?.isElectron) {
        window.mazz.invoke('panel:open', { kind: 'translate' }).catch(() => {});
        return;
      }
      const cfg = await window.mazz.invoke('tr:getConfig').catch(() => ({}));
      const m = modal('翻译引擎设置');
      m.body.innerHTML = `
        <div class="set-row"><label>引擎</label>
          <select id="trc-engine" class="rb-select">
            <option value="mymemory" ${cfg.engine !== 'libretranslate' ? 'selected' : ''}>MyMemory（免 key，日限额）</option>
            <option value="libretranslate" ${cfg.engine === 'libretranslate' ? 'selected' : ''}>LibreTranslate（自部署）</option>
          </select></div>
        <div class="set-row"><label>实例地址</label><input id="trc-url" class="rb-input" style="width:64%" placeholder="https://your-libretranslate.host" value="${cfg.ltUrl || ''}"></div>
        <div class="set-row"><label>API Key</label><input id="trc-key" class="rb-input" style="width:64%" type="password" placeholder="${cfg.ltKeySet ? '（已设置，留空保持不变）' : '（可选）'}"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="trc-save" class="rb-btn" style="flex-direction:row">保存</button></div>`;
      // AI 翻译提示词（自定义覆盖内置提示词工程）
      const curPrompt = await window.mazz.invoke('settings:get', { key: 'mazz.translate.sysPrompt' }).catch(() => '');
      const promptRow = document.createElement('div');
      promptRow.innerHTML = `<div class="set-row" style="align-items:flex-start"><label>AI 提示词</label>
        <textarea id="trc-sys" class="rb-input" rows="4" style="width:64%" placeholder="留空使用内置翻译提示词工程（铁律：只出译文/保留格式/信达雅/术语统一）">${(curPrompt || '').replace(/</g, '&lt;')}</textarea></div>
        <div style="font-size:11px;color:var(--fg-dim);margin:2px 0 0 64px">智能创作 ⚙ 配好 AI 后，翻译自动走 AI（优先级高于免费引擎）</div>`;
      m.body.querySelector('#trc-save').parentElement.before(promptRow);
      m.body.querySelector('#trc-save').addEventListener('click', async () => {
        const engine = m.body.querySelector('#trc-engine').value;
        const ltUrl = m.body.querySelector('#trc-url').value.trim();
        const ltKey = m.body.querySelector('#trc-key').value;
        await window.mazz.invoke('tr:setConfig', { engine, ltUrl, ...(ltKey ? { ltKey } : {}) });
        await window.mazz.invoke('settings:set', { key: 'mazz.translate.sysPrompt', value: m.body.querySelector('#trc-sys')?.value.trim() || '' }).catch(() => {});
        toast('翻译引擎设置已保存');
        m.close();
      });
    },
  });
}
