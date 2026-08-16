'use strict';

const fs = require('node:fs');
const { TextDecoder } = require('node:util');

const DEFAULT_SAMPLE_BYTES = 64 * 1024;

function classifyFileSample(buffer) {
  if (!buffer?.length) return { kind: 'text', encoding: 'utf8', reason: 'empty' };
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { kind: 'text', encoding: 'utf8', reason: 'utf8-bom' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { kind: 'text', encoding: 'utf16le', reason: 'utf16le-bom' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { kind: 'unsupported-encoding', encoding: 'utf16be', reason: 'utf16be-bom' };
  }

  let nul = 0;
  let controls = 0;
  for (const byte of buffer) {
    if (byte === 0) nul++;
    else if (byte < 9 || (byte > 13 && byte < 32)) controls++;
  }
  if (nul > 0 || controls / buffer.length > 0.02) {
    return { kind: 'binary', encoding: null, reason: nul ? 'nul-byte' : 'control-bytes' };
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { kind: 'text', encoding: 'utf8', reason: 'valid-utf8' };
  } catch {
    return { kind: 'unsupported-encoding', encoding: null, reason: 'invalid-utf8' };
  }
}

function probeFileSync(filePath, sampleBytes = DEFAULT_SAMPLE_BYTES) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { exists: true, isFile: false, size: stat.size, kind: 'not-file', encoding: null };
  const length = Math.min(stat.size, Math.max(1, Number(sampleBytes) || DEFAULT_SAMPLE_BYTES));
  const sample = Buffer.alloc(length);
  let bytesRead = 0;
  if (length) {
    const fd = fs.openSync(filePath, 'r');
    try { bytesRead = fs.readSync(fd, sample, 0, length, 0); }
    finally { fs.closeSync(fd); }
  }
  return {
    exists: true,
    isFile: true,
    size: stat.size,
    sampleBytes: bytesRead,
    ...classifyFileSample(sample.subarray(0, bytesRead)),
  };
}

module.exports = { DEFAULT_SAMPLE_BYTES, classifyFileSample, probeFileSync };
