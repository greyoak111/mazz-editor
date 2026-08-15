// renderer/modules/code/monaco-setup.js —— Monaco 环境（懒加载 + 模块 Worker 接线）
// JS/TS 智能走 Monaco 内置 TS worker：补全/跳转/诊断零外部依赖
import monacoCss from 'monaco-editor/min/vs/editor/editor.main.css';

let monacoPromise = null;
const workerDiagnostics = {
  created: 0,
  active: 0,
  terminated: 0,
  errors: 0,
  byLabel: {},
};

export function getMonacoWorkerDiagnostics() {
  return {
    ...workerDiagnostics,
    byLabel: { ...workerDiagnostics.byLabel },
  };
}

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
          const name = label === 'typescript' || label === 'javascript' ? 'ts.worker.js' : 'editor.worker.js';
          const worker = new Worker(workerUrl(name), { type: 'module', name: `mazz-monaco-${label || 'editor'}` });
          workerDiagnostics.created += 1;
          workerDiagnostics.active += 1;
          workerDiagnostics.byLabel[label || 'editor'] = (workerDiagnostics.byLabel[label || 'editor'] || 0) + 1;
          worker.addEventListener('error', () => { workerDiagnostics.errors += 1; });
          worker.addEventListener('messageerror', () => { workerDiagnostics.errors += 1; });
          const terminate = worker.terminate.bind(worker);
          let terminated = false;
          worker.terminate = () => {
            if (terminated) return;
            terminated = true;
            workerDiagnostics.active = Math.max(0, workerDiagnostics.active - 1);
            workerDiagnostics.terminated += 1;
            terminate();
          };
          return worker;
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
