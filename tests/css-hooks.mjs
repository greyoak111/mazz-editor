// tests/css-hooks.mjs —— Node ESM loader hook：.css 以空文本模块处理（对齐 esbuild text loader 语义的最小集）
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default "";', shortCircuit: true };
  }
  return nextLoad(url, context);
}
