// renderer/ai/contributes.js —— AI 命令贡献点：右键/命令面板可挂 AI 动作（Provider 默认空 → 禁用态）
import { aiProviders } from './provider.js';

class AIContributes {
  constructor() {
    this.actions = []; // {id, title, scope, run, source}
  }
  addAction(action) {
    if (!action?.id) return;
    this.actions.push(action);
  }
  /** 菜单展示：Provider 为空时全部禁用并标注 */
  listForMenu() {
    const configured = aiProviders.isConfigured();
    if (!this.actions.length && !configured) {
      return [{ id: 'ai.placeholder', title: 'AI ▸（未配置）', enabled: false }];
    }
    return this.actions.map(a => ({
      id: a.id, title: a.title, enabled: configured,
    }));
  }
}

export const aiContributes = new AIContributes();
