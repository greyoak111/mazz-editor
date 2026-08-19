'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('fixture 1.0.0\n'); process.exit(0); }
if (argv.includes('status')) { process.stdout.write('authenticated\n'); process.exit(0); }
const input = fs.readFileSync(0, 'utf8');
const claude = argv.includes('claude-fixture');
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
if (claude) {
  emit({ type: 'system', subtype: 'init', session_id: 'claude-session', model: 'fixture' });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: `claude:${input.length}` }, { type: 'tool_use', id: 't1', name: 'Read' }] } });
  emit({ type: 'result', subtype: 'success', session_id: 'claude-session', usage: { input_tokens: 3, output_tokens: 4 } });
} else {
  emit({ type: 'thread.started', thread_id: 'codex-thread' });
  emit({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: `codex:${input.length}` } });
  emit({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 6 } });
}
