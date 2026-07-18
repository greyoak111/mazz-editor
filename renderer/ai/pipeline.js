// renderer/ai/pipeline.js —— 流式渲染管道：ghost text / 差异视图 挂点（预留，不实现）
// 未来 AI 引擎的流式输出经此管道渲染到编辑器
export class StreamPipeline {
  constructor() {
    this.sinks = new Map(); // targetId -> {write(chunk), flush(), abort()}
  }
  /** 挂载渲染目标（ghost text / diff view 由编辑器模块实现后注入） */
  attachSink(targetId, sink) { this.sinks.set(targetId, sink); }
  detachSink(targetId) { this.sinks.delete(targetId); }
  /** 流式写入：AI Provider 的 stream 回调 → 各 sink */
  async pipe(stream, targetId) {
    const sink = this.sinks.get(targetId);
    if (!sink) throw new Error(`[ai] 渲染目标未挂载: ${targetId}`);
    try {
      for await (const chunk of stream) sink.write(chunk);
      sink.flush();
    } catch (e) {
      sink.abort?.(e);
      throw e;
    }
  }
}

export const aiPipeline = new StreamPipeline();
