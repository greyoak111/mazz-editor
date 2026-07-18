// renderer/ai/index.js —— AI 扩展层总入口（只预留，不实现）
import { aiProviders } from './provider.js';
import { getContext } from './context.js';
import { aiPipeline } from './pipeline.js';
import { aiContributes } from './contributes.js';

window.MazzAI = {
  providers: aiProviders,
  getContext,
  pipeline: aiPipeline,
  contributes: aiContributes,
  // Provider 默认 = null：相关菜单项显示「未配置 AI」禁用态
  isConfigured: () => aiProviders.isConfigured(),
};
export { aiProviders, getContext, aiPipeline, aiContributes };
