// main/agent-adapter-common.js —— W66 三家 Adapter 共用事件、句柄与安全投喂
'use strict';

const fs = require('fs');
const path = require('path');
const { createTypedHandle, assertTypedContinuation, normalizeResultEnvelope, createOutputReceipt } = require('./agent-execution-contracts');

function adapterError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.retryable = false;
  return error;
}

function requireRulePack(input = {}) {
  const injection = input.rulePackInjection;
  if (!injection?.rawSource || !injection?.compiledView) throw adapterError('RULE_PACK_REQUIRED', 'Adapter Session 缺少完整 Raw Source + Compiled Doctrine');
  return injection;
}

function composeInstruction(input = {}, prompt = '') {
  const injection = requireRulePack(input);
  const contextPackage = input.context?.contextPackage?.schema === 'mazz.context-package/v0' ? input.context.contextPackage : null;
  return [
    '以下 Project Rule Pack 是本次 Attempt 的强制约束，必须完整遵守。',
    '\n--- CANONICAL RAW SOURCE ---\n', String(injection.rawSource),
    '\n--- COMPILED DOCTRINE VIEW ---\n', typeof injection.compiledView === 'string' ? injection.compiledView : JSON.stringify(injection.compiledView),
    '\n--- AUDITABLE CONTEXT PACKAGE ---\n', contextPackage ? JSON.stringify(contextPackage) : 'NONE',
    '\n--- TASK INSTRUCTION ---\n', String(input.instruction || ''),
    '\n--- MAZZ HANDOFF SNAPSHOT REF ---\n', String(input.handoffRef || 'NONE'),
    '\n--- USER TURN ---\n', String(prompt || ''),
  ].join('');
}

function sessionHandle(id, adapterId, metadata = {}) {
  return createTypedHandle({ kind: 'AgentSessionHandle', id, ownerTool: adapterId, metadata });
}

function assertSession(handle, adapterId, action) {
  assertTypedContinuation(handle, { kind: 'AgentSessionHandle', ownerTool: adapterId, continuation: action });
}

function eventHub() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(type, payload = {}, raw = null) { for (const listener of listeners) { try { listener(type, payload, raw); } catch {} } },
    clear() { listeners.clear(); },
  };
}

function resultFromRun(run, structured = {}) {
  const result = normalizeResultEnvelope({
    outerStatus: run.result.outerStatus,
    exitCode: run.result.exitCode,
    stdout: run.result.stdout,
    stderr: run.result.stderr,
    error: run.result.error,
    complete: run.outputReceipt.complete,
    truncated: run.outputReceipt.truncated,
    structured,
  });
  return { result, outputReceipt: createOutputReceipt({ complete: result.complete, truncated: result.truncation.truncated, bytes: Buffer.from(`${result.stdout}\n${result.stderr}`) }) };
}

function redactedRawMetadata(value = {}) {
  return { type: String(value.type || value.method || ''), keys: Object.keys(value).filter(key => !/token|secret|key|content|text/i.test(key)).sort() };
}

function installedNativeExecutable(adapterId, env = process.env) {
  if (process.platform !== 'win32') return '';
  const appData = String(env.APPDATA || '');
  const userProfile = String(env.USERPROFILE || '');
  const arch = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const candidates = {
    'kimi-code': [path.join(userProfile, '.kimi-code', 'bin', 'kimi.exe')],
    'claude-code': [path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')],
    codex: [path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64', 'vendor', arch, 'bin', 'codex.exe')],
  }[adapterId] || [];
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || '';
}

module.exports = { adapterError, requireRulePack, composeInstruction, sessionHandle, assertSession, eventHub, resultFromRun, redactedRawMetadata, installedNativeExecutable };
