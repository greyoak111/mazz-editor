// tests/unit/factory-sse.test.mjs —— Factory SSE 分片、完成标记与截断诚实性
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { FactorySseDecoder } = require('../../main/factory-sse.js');
const encoder = new TextEncoder();

describe('Factory SSE 解码器', () => {
  test('跨字节与跨行分片仍能完整恢复中文 delta 和 DONE', () => {
    const deltas = [];
    const decoder = new FactorySseDecoder({ onDelta: delta => deltas.push(delta) });
    const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"半稿中文"}}]}\n\ndata: [DONE]\n\n');
    for (let index = 0; index < bytes.length; index += 3) decoder.push(bytes.slice(index, index + 3));
    const result = decoder.finish();
    assert.deepEqual(deltas, ['半稿中文']);
    assert.equal(result.completed, true);
    assert.equal(result.completionKind, 'done-marker');
    assert.equal(result.deltaCount, 1);
  });

  test('没有 DONE 但存在 finish_reason 的兼容响应可诚实完成', () => {
    const deltas = [];
    const decoder = new FactorySseDecoder({ onDelta: delta => deltas.push(delta) });
    decoder.push('data: {"choices":[{"delta":{"content":[{"text":"完成"}]},"finish_reason":"stop"}]}\r\n');
    const result = decoder.finish();
    assert.deepEqual(deltas, ['完成']);
    assert.equal(result.completionKind, 'finish-reason');
  });

  test('Provider 在 SSE 回供 usage 时原样分离为实收证据', () => {
    const usages = [];
    const decoder = new FactorySseDecoder({ onUsage: usage => usages.push(usage) });
    decoder.push('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n');
    const result = decoder.finish();
    assert.deepEqual(usages, [{ inputTokens: 12, outputTokens: 8, totalTokens: 20 }]);
    assert.deepEqual(result.usage, usages[0]);
  });

  test('完整行里的损坏 JSON 不再被静默吞掉', () => {
    const decoder = new FactorySseDecoder();
    assert.throws(() => decoder.push('data: {not-json}\n\n'), /损坏的 SSE JSON/);
  });

  test('已收到部分正文但 EOF 无完成标记时拒绝冒充成功', () => {
    const deltas = [];
    const decoder = new FactorySseDecoder({ onDelta: delta => deltas.push(delta) });
    decoder.push('data: {"choices":[{"delta":{"content":"只到这里"}}]}\n\n');
    assert.throws(() => decoder.finish(), /未收到完成标记/);
    assert.deepEqual(deltas, ['只到这里']);
  });

  test('EOF 留下半截 JSON 时报告损坏而不是正常结束', () => {
    const decoder = new FactorySseDecoder();
    decoder.push('data: {"choices":[{"delta":');
    assert.throws(() => decoder.finish(), /损坏的 SSE JSON/);
  });

  test('服务端 error 事件只暴露有限错误信息', () => {
    const decoder = new FactorySseDecoder();
    assert.throws(
      () => decoder.push(`data: ${JSON.stringify({ error: { message: 'provider refused' } })}\n\n`),
      /AI 流式响应报错：provider refused/,
    );
  });
});
