'use strict';

// W94G local Publication signing identity. The private Ed25519 key is never
// exposed through IPC and is persisted only through an injected OS-protection
// boundary (Electron safeStorage in production). The public proof remains
// portable and can be verified without granting publication authority.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertKnownKeys, deepFreeze, isPlainObject, requiredString } = require('./foundation/plain-value');

const IDENTITY_SCHEMA = 'mazz.publication-signing-identity/v1';
const SIGNATURE_SCHEMA = 'mazz.publication-signature/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function codedError(code, message) { return Object.assign(new Error(message), { code }); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function digestBytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function digest(value) { return digestBytes(Buffer.from(JSON.stringify(canonical(value)), 'utf8')); }
function safeId(value, label, prefix = '') {
  const text = requiredString(value, label);
  if (!ID.test(text) || (prefix && !text.startsWith(prefix))) throw codedError('PUBLICATION_SIGNATURE_INVALID', `${label} 非法`);
  return text;
}
function nowIso(value) {
  const date = new Date(typeof value === 'function' ? value() : value || Date.now());
  if (!Number.isFinite(date.getTime())) throw codedError('PUBLICATION_SIGNATURE_INVALID', '签名时间非法');
  return date.toISOString();
}
function unsignedEnvelope(envelope) {
  if (!isPlainObject(envelope)) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication envelope 必须是对象');
  return { ...envelope, signatureRef: '' };
}
function signaturePayload(envelope, grant) {
  if (!isPlainObject(grant)) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication grant 必须是对象');
  return { envelope: unsignedEnvelope(envelope), grant };
}

function normalizeIdentity(input) {
  if (!isPlainObject(input)) throw codedError('PUBLICATION_IDENTITY_CORRUPT', 'Publication signing identity 必须是对象');
  assertKnownKeys(input, ['schema', 'keyId', 'algorithm', 'publicKeySpki', 'protectedPrivateKey', 'createdAt'], 'Publication signing identity');
  if (input.schema !== IDENTITY_SCHEMA || input.algorithm !== 'Ed25519') throw codedError('PUBLICATION_IDENTITY_CORRUPT', 'Publication signing identity schema/algorithm 不支持');
  const keyId = safeId(input.keyId, 'keyId', 'signer:');
  const publicKeySpki = requiredString(input.publicKeySpki, 'publicKeySpki');
  const protectedPrivateKey = requiredString(input.protectedPrivateKey, 'protectedPrivateKey');
  const publicBytes = Buffer.from(publicKeySpki, 'base64');
  const protectedBytes = Buffer.from(protectedPrivateKey, 'base64');
  if (!publicBytes.length || !protectedBytes.length || Buffer.from(publicBytes.toString('base64'), 'base64').compare(publicBytes) !== 0) {
    throw codedError('PUBLICATION_IDENTITY_CORRUPT', 'Publication signing identity 编码非法');
  }
  const expectedKeyId = `signer:ed25519:${digestBytes(publicBytes)}`;
  if (keyId !== expectedKeyId) throw codedError('PUBLICATION_IDENTITY_CORRUPT', 'Publication signing key identity 不匹配');
  try { crypto.createPublicKey({ key: publicBytes, format: 'der', type: 'spki' }); }
  catch { throw codedError('PUBLICATION_IDENTITY_CORRUPT', 'Publication signing public key 损坏'); }
  const createdAt = nowIso(input.createdAt);
  return deepFreeze({ schema: IDENTITY_SCHEMA, keyId, algorithm: 'Ed25519', publicKeySpki, protectedPrivateKey, createdAt });
}

function normalizeSignature(input) {
  if (!isPlainObject(input)) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signature proof 必须是对象');
  assertKnownKeys(input, ['schema', 'keyId', 'algorithm', 'payloadDigest', 'signatureRef', 'signature', 'publicKeySpki', 'createdAt'], 'Publication signature proof');
  if (input.schema !== SIGNATURE_SCHEMA || input.algorithm !== 'Ed25519') throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signature schema/algorithm 不支持');
  const proof = {
    schema: SIGNATURE_SCHEMA,
    keyId: safeId(input.keyId, 'signature.keyId', 'signer:'),
    algorithm: 'Ed25519',
    payloadDigest: requiredString(input.payloadDigest, 'signature.payloadDigest'),
    signatureRef: safeId(input.signatureRef, 'signature.signatureRef', 'signature:'),
    signature: requiredString(input.signature, 'signature.signature'),
    publicKeySpki: requiredString(input.publicKeySpki, 'signature.publicKeySpki'),
    createdAt: nowIso(input.createdAt),
  };
  if (!/^[0-9a-f]{64}$/.test(proof.payloadDigest)) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signature payloadDigest 非法');
  const signatureBytes = Buffer.from(proof.signature, 'base64');
  const publicBytes = Buffer.from(proof.publicKeySpki, 'base64');
  if (!signatureBytes.length || !publicBytes.length) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signature 编码非法');
  if (proof.signatureRef !== `signature:ed25519:${digestBytes(signatureBytes)}`) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signatureRef 不匹配');
  if (proof.keyId !== `signer:ed25519:${digestBytes(publicBytes)}`) throw codedError('PUBLICATION_SIGNATURE_INVALID', 'Publication signature keyId 不匹配');
  return deepFreeze(proof);
}

function atomicWrite(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fsImpl.openSync(temporary, 'wx');
    fsImpl.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd); fd = undefined;
    fsImpl.renameSync(temporary, filePath);
    let dirFd;
    try {
      dirFd = fsImpl.openSync(path.dirname(filePath), 'r');
      try { fsImpl.fsyncSync(dirFd); }
      catch (error) {
        // Windows does not expose directory fsync even though the file itself
        // has already been flushed and atomically renamed.
        if (process.platform !== 'win32' || !['EPERM', 'EINVAL'].includes(error?.code)) throw error;
      }
    }
    finally { if (dirFd !== undefined) fsImpl.closeSync(dirFd); }
  } catch (error) {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch {} }
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch {}
    throw error;
  }
}

class PublicationSigningService {
  constructor({ rootProvider, protect, unprotect, fsImpl = fs, now = () => Date.now() } = {}) {
    if (typeof rootProvider !== 'function' || typeof protect !== 'function' || typeof unprotect !== 'function') {
      throw new TypeError('PublicationSigningService 需要 rootProvider/protect/unprotect');
    }
    this.rootProvider = rootProvider;
    this.protect = protect;
    this.unprotect = unprotect;
    this.fs = fsImpl;
    this.now = now;
  }

  root() { return path.resolve(requiredString(this.rootProvider(), 'workspacePath')); }
  folder() { return path.join(this.root(), '.mazz', 'identity'); }
  file() { return path.join(this.folder(), 'publication-signing.json'); }

  readIdentity() {
    if (!this.fs.existsSync(this.file())) return null;
    try { return normalizeIdentity(JSON.parse(this.fs.readFileSync(this.file(), 'utf8'))); }
    catch (error) { throw codedError(error.code || 'PUBLICATION_IDENTITY_CORRUPT', `Publication signing identity 损坏；原文件保留: ${error.message}`); }
  }

  ensureIdentity() {
    const existing = this.readIdentity();
    if (existing) return deepFreeze({ schema: existing.schema, keyId: existing.keyId, algorithm: existing.algorithm, publicKeySpki: existing.publicKeySpki, createdAt: existing.createdAt, protectedAtRest: true, privateKeyExposed: false });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicBytes = publicKey.export({ format: 'der', type: 'spki' });
    const privateBytes = privateKey.export({ format: 'der', type: 'pkcs8' });
    let protectedBytes;
    try { protectedBytes = Buffer.from(this.protect(privateBytes)); }
    finally { privateBytes.fill(0); }
    if (!protectedBytes.length) throw codedError('PUBLICATION_KEY_PROTECTION_FAILED', 'Publication private key 保护失败');
    const identity = normalizeIdentity({
      schema: IDENTITY_SCHEMA,
      keyId: `signer:ed25519:${digestBytes(publicBytes)}`,
      algorithm: 'Ed25519',
      publicKeySpki: publicBytes.toString('base64'),
      protectedPrivateKey: protectedBytes.toString('base64'),
      createdAt: nowIso(this.now),
    });
    atomicWrite(this.file(), identity, this.fs);
    return this.ensureIdentity();
  }

  signPublication({ envelope, grant } = {}) {
    const publicIdentity = this.ensureIdentity();
    const identity = this.readIdentity();
    let privateBytes;
    try {
      privateBytes = Buffer.from(this.unprotect(Buffer.from(identity.protectedPrivateKey, 'base64')));
      const privateKey = crypto.createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' });
      const payloadDigest = digest(signaturePayload(envelope, grant));
      const signatureBytes = crypto.sign(null, Buffer.from(payloadDigest, 'utf8'), privateKey);
      const signatureRef = `signature:ed25519:${digestBytes(signatureBytes)}`;
      const proof = normalizeSignature({
        schema: SIGNATURE_SCHEMA, keyId: publicIdentity.keyId, algorithm: 'Ed25519', payloadDigest,
        signatureRef, signature: signatureBytes.toString('base64'), publicKeySpki: publicIdentity.publicKeySpki,
        createdAt: nowIso(this.now),
      });
      return deepFreeze({ envelope: { ...envelope, signatureRef }, signature: proof, identity: publicIdentity, authorityGranted: false, privateKeyExposed: false });
    } catch (error) {
      throw codedError(error.code || 'PUBLICATION_SIGNING_FAILED', `Publication 签名失败: ${error.message}`);
    } finally { if (privateBytes) privateBytes.fill(0); }
  }

  verifyPublication({ envelope, grant, signature } = {}) {
    try {
      const proof = normalizeSignature(signature);
      const trusted = this.readIdentity();
      if (!trusted || trusted.keyId !== proof.keyId || trusted.publicKeySpki !== proof.publicKeySpki) return { valid: false, reason: 'UNTRUSTED_SIGNING_KEY' };
      const payloadDigest = digest(signaturePayload(envelope, grant));
      if (payloadDigest !== proof.payloadDigest || envelope.signatureRef !== proof.signatureRef) return { valid: false, reason: 'SIGNED_PAYLOAD_TAMPERED' };
      const publicKey = crypto.createPublicKey({ key: Buffer.from(proof.publicKeySpki, 'base64'), format: 'der', type: 'spki' });
      const valid = crypto.verify(null, Buffer.from(payloadDigest, 'utf8'), publicKey, Buffer.from(proof.signature, 'base64'));
      return { valid, reason: valid ? 'VALID' : 'SIGNATURE_INVALID', keyId: proof.keyId, signatureRef: proof.signatureRef };
    } catch (error) { return { valid: false, reason: error.code || 'SIGNATURE_INVALID' }; }
  }
}

module.exports = {
  PublicationSigningService, IDENTITY_SCHEMA, SIGNATURE_SCHEMA,
  _forTests: { canonical, digest, digestBytes, signaturePayload, normalizeIdentity, normalizeSignature },
};
