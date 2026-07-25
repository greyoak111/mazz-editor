// renderer/modules/webbridge/queue.js —— 投稿队列：一份稿子逐站投（前台式批量，待校对统一过堂）
// 状态机：pending 待投 → injecting 注入中 → review 待校对 → failed 失败（可重试）
import { toast } from '../../shell/shell.js';

export class PostQueue {
  constructor() {
    this.items = []; // {adapter, status, note, tabId}
    this.onChange = null;
    this.running = false;
  }

  enqueue(adapters) {
    for (const a of adapters) {
      if (!this.items.find(x => x.adapter.id === a.id)) {
        this.items.push({ adapter: a, status: 'pending', note: '', tabId: null });
      }
    }
    this.emit();
  }

  emit() { this.onChange?.(this.items); }

  async start(doc, launchFn) {
    if (this.running) { toast('队列正在执行中'); return; }
    this.running = true;
    for (const item of this.items) {
      if (item.status !== 'pending' && item.status !== 'failed') continue;
      item.status = 'injecting';
      item.note = '拉起投稿页…';
      this.emit();
      try {
        const r = await launchFn(item.adapter, doc);
        if (r?.ok) {
          item.status = 'review';
          item.note = `已填入（${r.via || 'ok'}${r.images ? '，图 ' + r.images : ''}）——请校对后自行发布`;
        } else {
          item.status = 'failed';
          item.note = r?.reason || '注入失败';
        }
      } catch (e) {
        item.status = 'failed';
        item.note = e.message?.slice(0, 60) || '异常';
      }
      this.emit();
    }
    this.running = false;
    const ok = this.items.filter(x => x.status === 'review').length;
    toast(`队列执行完：${ok}/${this.items.length} 站已填入待校对`);
  }

  retry(item) {
    item.status = 'pending';
    item.note = '';
    this.emit();
  }

  clear() {
    this.items = this.items.filter(x => x.status === 'review');
    this.emit();
  }
}

export const queue = new PostQueue();
