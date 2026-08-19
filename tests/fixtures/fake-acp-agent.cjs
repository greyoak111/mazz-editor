'use strict';
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let pendingPrompt = null;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
rl.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  if (request.method === 'initialize') send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, authMethods: [] } });
  else if (request.method === 'session/new') send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fake-kimi-session', configOptions: [{ id: 'model', currentValue: 'default' }] } });
  else if (request.method === 'session/load') send({ jsonrpc: '2.0', id: request.id, result: { sessionId: request.params.sessionId } });
  else if (request.method === 'session/set_config_option' && request.params.value === 'reject-model') {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'fixture model rejected' } });
  }
  else if (request.method === 'session/set_config_option') send({ jsonrpc: '2.0', id: request.id, result: { configOptions: [{ id: 'model', currentValue: request.params.value }] } });
  else if (request.method === 'session/prompt') {
    const text = request.params.prompt?.[0]?.text || '';
    if (text.includes('WAIT_FOR_CANCEL')) {
      pendingPrompt = request;
      return;
    }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: request.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `received:${text.length}` } } } });
    send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } });
  }
  else if (request.method === 'session/cancel' && pendingPrompt) {
    send({ jsonrpc: '2.0', id: pendingPrompt.id, result: { stopReason: 'cancelled' } });
    pendingPrompt = null;
  }
});
