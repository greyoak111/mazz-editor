// renderer/modules/code/monaco-setup.js —— Monaco 环境（懒加载 + 模块 Worker 接线）
// JS/TS 智能走 Monaco 内置 TS worker：补全/跳转/诊断零外部依赖
import monacoCss from 'monaco-editor/min/vs/editor/editor.main.css';

let monacoPromise = null;

function injectMonacoCss() {
  if (document.getElementById('monaco-css')) return;
  const style = document.createElement('style');
  style.id = 'monaco-css';
  // codicon 字体路径重写为 dist/codicon.ttf
  style.textContent = monacoCss.replace(/url\([^)]*codicon\.ttf[^)]*\)/g, 'url(./codicon.ttf)');
  document.head.appendChild(style);
}

export async function getMonaco() {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      injectMonacoCss();
      const monaco = await import('monaco-editor');

      const workerUrl = (name) => new URL(`./${name}`, import.meta.url).href;
      self.MonacoEnvironment = {
        getWorker(_workerId, label) {
          if (label === 'typescript' || label === 'javascript') {
            return new Worker(workerUrl('ts.worker.js'), { type: 'module' });
          }
          return new Worker(workerUrl('editor.worker.js'), { type: 'module' });
        },
      };

      // 暗色/亮色主题对齐外壳
      monaco.editor.defineTheme('mazz-dark', {
        base: 'vs-dark', inherit: true,
        rules: [],
        colors: { 'editor.background': '#16181d', 'editor.lineHighlightBackground': '#1e2128' },
      });
      monaco.editor.defineTheme('mazz-light', {
        base: 'vs', inherit: true,
        rules: [],
        colors: { 'editor.background': '#ffffff' },
      });
      return monaco;
    })();
  }
  return monacoPromise;
}

export const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescriptreact', jsx: 'javascriptreact',
  json: 'json', css: 'css', html: 'html', md: 'markdown',
  py: 'python', sh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', txt: 'plaintext',
};
