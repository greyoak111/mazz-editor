// 示例插件：字数统计（契约 v1 模块）
const instances = new Map();
let current = null;

function createWordcount(container) {
  const root = document.createElement('div');
  root.style.cssText = 'padding:24px;overflow:auto;height:100%;box-sizing:border-box';
  container.appendChild(root);
  const ctl = { root, container };

  function collectText() {
    // 统计所有打开的 Markdown 文档（取最近一个）
    let text = '';
    for (const [, inst] of (window.MazzModules?.instances || new Map())) {
      if (inst.name === 'markdown') {
        try { text = inst.def.getContent(inst.state) || ''; } catch {}
      }
    }
    return text;
  }

  ctl.refresh = function refresh() {
    const text = collectText();
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    const words = (text.replace(/[一-鿿]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
    const chars = text.replace(/\s/g, '').length;
    const lines = text ? text.split('\n').length : 0;
    const readMin = Math.max(text ? 1 : 0, Math.round(cjk / 400 + words / 200));
    root.innerHTML = `
      <h2 style="margin:0 0 14px">📊 字数统计</h2>
      <table style="border-collapse:collapse;font-size:14px;line-height:2">
        <tr><td style="padding-right:18px;color:#83817a">汉字</td><td><b>${cjk}</b></td></tr>
        <tr><td style="padding-right:18px;color:#83817a">英文单词</td><td><b>${words}</b></td></tr>
        <tr><td style="padding-right:18px;color:#83817a">总字符（不含空白）</td><td><b>${chars}</b></td></tr>
        <tr><td style="padding-right:18px;color:#83817a">行数</td><td><b>${lines}</b></td></tr>
        <tr><td style="padding-right:18px;color:#83817a">预计阅读时长</td><td><b>${readMin} 分钟</b></td></tr>
      </table>
      <button id="wc-refresh" style="margin-top:16px;padding:6px 16px;border:1px solid #d8d6cf;border-radius:6px;background:#fff;cursor:pointer">↻ 刷新</button>
      <div style="margin-top:12px;font-size:12px;color:#83817a">统计对象：当前打开的 Markdown 文档</div>`;
    root.querySelector('#wc-refresh').addEventListener('click', refresh);
  };

  setTimeout(refresh, 50);
  return ctl;
}

export default {
  displayName: '字数统计',
  icon: '📊',
  create(container) {
    const ctl = createWordcount(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    current = instances.get(container);
    current?.refresh();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent() { return ''; },
  setContent() {},
  newDocument() { current?.refresh(); },
  getCharCount() { return 0; },
  getCursorPos() { return '统计'; },
  contributes: {
    commands: [
      { id: 'wordcount.refresh', title: '刷新字数统计', group: '插件', run: () => current?.refresh() },
    ],
    keybindings: [],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
