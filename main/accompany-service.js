'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCHIVE_SCHEMA = 'mazz.accompany-session/v0';
const sha256 = value => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

function safeName(value) {
  const name = String(value || '未命名媒体').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  return name || '未命名媒体';
}

function normalizeArchive(input, workspace) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('观剧档请求必须是对象');
  const allowed = new Set(['schema', 'mediaPath', 'mediaName', 'sessionId', 'startedAt', 'endedAt', 'mode', 'personas', 'beats', 'messages', 'stats']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`观剧档包含未冻结字段：${key}`);
  if (input.schema !== ARCHIVE_SCHEMA) throw new Error(`不支持的观剧档 schema：${input.schema}`);
  const mediaName = String(input.mediaName || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  if (!mediaName || !/^accompany:[a-z0-9-]{8,80}$/i.test(sessionId)) throw new Error('mediaName/sessionId 非法');
  const messages = Array.isArray(input.messages) ? input.messages.map((message, index) => {
    if (!message || typeof message !== 'object') throw new Error(`messages[${index}] 非法`);
    const role = String(message.role || '');
    if (!['user', 'assistant', 'system'].includes(role)) throw new Error(`messages[${index}].role 非法`);
    const text = String(message.text || '');
    const mediaTimeMs = Math.max(0, Math.floor(Number(message.mediaTimeMs) || 0));
    return { role, speaker: String(message.speaker || ''), text, mediaTimeMs, createdAt: String(message.createdAt || '') };
  }) : [];
  const beats = Array.isArray(input.beats) ? input.beats.map(beat => ({
    type: String(beat?.type || 'calm').slice(0, 30), mediaTimeMs: Math.max(0, Math.floor(Number(beat?.mediaTimeMs) || 0)),
  })) : [];
  return {
    schema: ARCHIVE_SCHEMA, mediaPath: String(input.mediaPath || ''), mediaName, sessionId,
    startedAt: new Date(input.startedAt).toISOString(), endedAt: new Date(input.endedAt).toISOString(),
    mode: String(input.mode || 'beat').slice(0, 30), personas: (input.personas || []).map(String).slice(0, 8), beats, messages,
    stats: input.stats && typeof input.stats === 'object' ? input.stats : {}, workspace: path.resolve(workspace),
  };
}

function renderSession(value) {
  const lines = [
    `\n## 场次 ${value.startedAt}`,
    '',
    `- sessionId: \`${value.sessionId}\``,
    `- 媒体：${value.mediaName}`,
    `- 时间：${value.startedAt} → ${value.endedAt}`,
    `- 模式：${value.mode}`,
    `- 人格：${value.personas.join(' / ') || '无'}`,
    `- 拍点：${value.beats.length}；对话：${value.messages.length}`,
    '',
    '### 拍点轴',
    '',
    ...value.beats.map(beat => `- ${Math.floor(beat.mediaTimeMs / 1000)}s · ${beat.type}`),
    '',
    '### 对话全录',
    '',
    ...value.messages.flatMap(message => [
      `#### ${Math.floor(message.mediaTimeMs / 1000)}s · ${message.speaker || message.role}`,
      '',
      message.text || '（空）',
      '',
    ]),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

class AccompanyService {
  constructor({ rootProvider }) { this.rootProvider = rootProvider; }

  archive(input) {
    const workspace = path.resolve(this.rootProvider());
    const value = normalizeArchive(input, workspace);
    const directory = path.join(workspace, 'accompany');
    const filePath = path.join(directory, `${safeName(value.mediaName)}-${sha256(value.mediaPath || value.mediaName).slice(0, 8)}.md`);
    fs.mkdirSync(directory, { recursive: true });
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : `# ${value.mediaName} · 观剧档\n\n`;
    const next = `${existing.trimEnd()}\n${renderSession(value)}`;
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, next, 'utf8');
    fs.renameSync(temporary, filePath);
    return { ok: true, path: filePath.replace(/\\/g, '/'), sessionId: value.sessionId, messageCount: value.messages.length, beatCount: value.beats.length };
  }

  memory({ mediaName, mediaPath = '' } = {}) {
    const workspace = path.resolve(this.rootProvider());
    const filePath = path.join(workspace, 'accompany', `${safeName(mediaName)}-${sha256(mediaPath || mediaName).slice(0, 8)}.md`);
    if (!fs.existsSync(filePath)) return { exists: false, path: filePath.replace(/\\/g, '/'), text: '', tail: '' };
    const text = fs.readFileSync(filePath, 'utf8');
    // `tail` is kept as a bridge-compatible alias, but it now carries the whole
    // archive so callers never mistake a locally clipped memory for full history.
    return { exists: true, path: filePath.replace(/\\/g, '/'), text, tail: text };
  }
}

module.exports = { ARCHIVE_SCHEMA, AccompanyService, normalizeArchive, renderSession, safeName };
