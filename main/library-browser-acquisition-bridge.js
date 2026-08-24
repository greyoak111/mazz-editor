'use strict';

// A Browser Download remains Electron-owned.  This bridge changes only the
// save path of an exactly pre-registered, durable Library acquisition and asks
// the acquisition coordinator to verify/promote it after DownloadItem `done`.
// It never copies cookies/headers, trusts a filename, or emits an artifact path.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./library-resource-contract');

const WAKE_SCHEMA = 'mazz.library-browser-acquisition-wake/v1';

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function webContentsIdentity(value) {
  const id = isPlainRecord(value) || (value && typeof value === 'object') ? value.id : value;
  if (!Number.isSafeInteger(id) || id < 1) {
    throw codedError('LIBRARY_BROWSER_INVALID_WEB_CONTENTS', 'Browser acquisition requires a trusted WebContents identity');
  }
  return id;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative);
}

function safeWakeCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
    ? error.code
    : 'LIBRARY_BROWSER_ACQUISITION_FAILED';
}

function physicalRealpath(fsImpl, target) {
  if (typeof fsImpl.realpathSync?.native === 'function') return path.resolve(fsImpl.realpathSync.native(target));
  if (typeof fsImpl.realpathSync === 'function') return path.resolve(fsImpl.realpathSync(target));
  throw codedError('LIBRARY_BROWSER_REALPATH_REQUIRED', 'Browser acquisition staging requires physical realpath support');
}

class LibraryBrowserAcquisitionBridge {
  constructor({
    acquisitionService,
    session = null,
    onWake = null,
    randomId = () => crypto.randomUUID(),
    fsImpl = fs,
  } = {}) {
    if (!acquisitionService || typeof acquisitionService.listJobs !== 'function'
      || typeof acquisitionService.prepareBrowserDownload !== 'function'
      || typeof acquisitionService.completeBrowserDownload !== 'function') {
      throw codedError(
        'LIBRARY_BROWSER_ACQUISITION_SERVICE_REQUIRED',
        'Browser acquisition bridge requires durable list/prepare/complete coordinator capabilities',
      );
    }
    if (onWake !== null && typeof onWake !== 'function') {
      throw codedError('LIBRARY_BROWSER_INVALID_WAKE_HANDLER', 'Browser acquisition wake handler must be a function');
    }
    if (typeof randomId !== 'function') {
      throw codedError('LIBRARY_BROWSER_INVALID_RANDOM_ID', 'Browser acquisition requires an opaque handle generator');
    }
    this.acquisitionService = acquisitionService;
    this.onWake = onWake;
    this.randomId = randomId;
    this.fs = fsImpl;
    this.session = null;
    this.listener = this._onWillDownload.bind(this);
    this.registrations = new Map();
    this.registrationByMatch = new Map();
    this.claimedItems = new WeakSet();
    this.itemBindings = new Map();
    this.pending = new Set();
    this.disposed = false;
    this.disposePromise = null;
    if (session) this.attach(session);
  }

  attach(session) {
    if (this.disposed) throw codedError('LIBRARY_BROWSER_BRIDGE_DISPOSED', 'Browser acquisition bridge is disposed');
    if (!session || typeof session.on !== 'function') {
      throw codedError('LIBRARY_BROWSER_INVALID_SESSION', 'Browser acquisition bridge requires an Electron Session');
    }
    if (this.session === session) return this;
    this.detach();
    this.session = session;
    session.on('will-download', this.listener);
    return this;
  }

  detach() {
    if (!this.session) return false;
    if (typeof this.session.removeListener === 'function') {
      this.session.removeListener('will-download', this.listener);
    } else if (typeof this.session.off === 'function') {
      this.session.off('will-download', this.listener);
    }
    this.session = null;
    return true;
  }

  _readAuthorizedIntent(input) {
    if (!isPlainRecord(input)) {
      throw codedError('LIBRARY_BROWSER_INVALID_INTENT', 'Browser acquisition intent must be a plain object');
    }
    const allowed = new Set([
      'workspaceIdentity', 'jobId', 'intentId', 'candidate', 'expectedRevision', 'webContentsId',
    ]);
    if (Object.keys(input).some(key => !allowed.has(key))) {
      throw codedError(
        'LIBRARY_BROWSER_FORBIDDEN_CAPABILITY',
        'Browser acquisition intent cannot carry paths, filenames, cookies, headers, or URL overrides',
      );
    }
    if (typeof input.workspaceIdentity !== 'string' || !input.workspaceIdentity
      || typeof input.jobId !== 'string' || !input.jobId
      || typeof input.intentId !== 'string' || !input.intentId
      || !Number.isSafeInteger(input.expectedRevision)) {
      throw codedError('LIBRARY_BROWSER_INVALID_INTENT', 'Browser acquisition intent identities and revision are required');
    }
    const webContentsId = webContentsIdentity(input.webContentsId);
    let candidate;
    let candidateFingerprint;
    try {
      candidate = contract.normalizeCandidate(input.candidate);
      candidateFingerprint = contract.deriveCandidateFingerprint(candidate);
    } catch {
      throw codedError('LIBRARY_BROWSER_CANDIDATE_INVALID', 'Browser acquisition Candidate failed the frozen resource contract');
    }
    const jobs = this.acquisitionService.listJobs(input.workspaceIdentity);
    const job = Array.isArray(jobs) ? jobs.find(item => item?.jobId === input.jobId) : null;
    if (!job || job.intentId !== input.intentId || job.workspaceIdentity !== input.workspaceIdentity
      || job.revision !== input.expectedRevision || typeof job.workspacePath !== 'string'
      || contract.deriveWorkspaceIdentity(job.workspacePath) !== job.workspaceIdentity) {
      throw codedError('LIBRARY_BROWSER_DURABLE_INTENT_MISMATCH', 'Browser acquisition does not match a durable Workspace Job');
    }
    if (job.candidateId !== candidate.candidateId || job.candidateFingerprint !== candidateFingerprint) {
      throw codedError('LIBRARY_BROWSER_CANDIDATE_MISMATCH', 'Browser acquisition Candidate snapshot differs from the durable Job');
    }
    const offer = candidate.offers.find(item => item.offerId === job.offerId);
    if (!offer || offer.transport !== 'https' || !offer.sourceUrl
      || offer.providerId !== job.providerId || job.transport !== 'https'
      || contract.deriveTransportIdentity(offer) !== job.transportIdentity) {
      throw codedError('LIBRARY_BROWSER_OFFER_MISMATCH', 'Browser acquisition Offer differs from the durable HTTPS Job');
    }
    let rightsReceipt = null;
    try { rightsReceipt = contract.normalizeRightsReceipt(job.rightsReceipt, { rights: candidate.rights }); }
    catch {}
    if (!rightsReceipt || !contract.PASSING_RIGHTS_STATUSES.includes(job.rightsStatus)
      || rightsReceipt.decision !== job.rightsStatus || candidate.rights.status !== job.rightsStatus) {
      throw codedError('LIBRARY_BROWSER_RIGHTS_REQUIRED', 'Browser acquisition requires a durable passing Rights receipt');
    }
    const ready = job.state === 'queued'
      || (['paused', 'failed'].includes(job.state) && job.retryFrom === 'downloading');
    if (!ready) {
      throw codedError('LIBRARY_BROWSER_JOB_NOT_READY', 'Browser acquisition Job is not ready for a new short-lived DownloadItem');
    }
    return Object.freeze({
      workspaceIdentity: job.workspaceIdentity,
      workspacePath: job.workspacePath,
      jobId: job.jobId,
      intentId: job.intentId,
      expectedRevision: job.revision,
      candidate,
      candidateFingerprint,
      offerId: offer.offerId,
      sourceUrl: offer.sourceUrl,
      format: offer.format,
      webContentsId,
    });
  }

  _projection(registration) {
    return Object.freeze({
      registrationId: registration.registrationId,
      workspaceIdentity: registration.workspaceIdentity,
      jobId: registration.jobId,
      intentId: registration.intentId,
      expectedRevision: registration.expectedRevision,
      webContentsId: registration.webContentsId,
    });
  }

  registerIntent(input) {
    if (this.disposed) throw codedError('LIBRARY_BROWSER_BRIDGE_DISPOSED', 'Browser acquisition bridge is disposed');
    const authorized = this._readAuthorizedIntent(input);
    const matchKey = `${authorized.webContentsId}\0${authorized.sourceUrl}`;
    const existingId = this.registrationByMatch.get(matchKey);
    if (existingId) {
      const existing = this.registrations.get(existingId);
      if (existing && existing.jobId === authorized.jobId
        && existing.expectedRevision === authorized.expectedRevision
        && existing.candidateFingerprint === authorized.candidateFingerprint) {
        return this._projection(existing);
      }
      throw codedError('LIBRARY_BROWSER_INTENT_CONFLICT', 'this Browser URL already belongs to another pending acquisition intent');
    }
    const registrationId = `browser-acquisition-${sha256Text(this.randomId())}`;
    if (this.registrations.has(registrationId)) {
      throw codedError('LIBRARY_BROWSER_HANDLE_CONFLICT', 'opaque Browser acquisition handle was reused');
    }
    const registration = Object.freeze({ ...authorized, registrationId, matchKey });
    this.registrations.set(registrationId, registration);
    this.registrationByMatch.set(matchKey, registrationId);
    return this._projection(registration);
  }

  unregisterIntent(registrationId) {
    if (typeof registrationId !== 'string') return false;
    const registration = this.registrations.get(registrationId);
    if (!registration) return false;
    this.registrations.delete(registrationId);
    if (this.registrationByMatch.get(registration.matchKey) === registrationId) {
      this.registrationByMatch.delete(registration.matchKey);
    }
    return true;
  }

  clearRegistrations() {
    const count = this.registrations.size;
    this.registrations.clear();
    this.registrationByMatch.clear();
    return count;
  }

  _wake(registration, status, error = null) {
    if (!this.onWake) return;
    const event = Object.freeze({
      schema: WAKE_SCHEMA,
      type: 'library-acquisition-wake',
      workspaceIdentity: registration.workspaceIdentity,
      jobId: registration.jobId,
      status,
      ...(error ? { errorCode: safeWakeCode(error) } : {}),
    });
    try { this.onWake(event); } catch {}
  }

  _track(promise) {
    const tracked = Promise.resolve(promise);
    this.pending.add(tracked);
    // A rejected durability transition is still an owned, unresolved fact.
    // Keep it in the snapshot until the authoritative bridge owner is torn
    // down successfully (which cannot happen after that rejection).  The
    // rejection handler also prevents an ambient unhandled-rejection while
    // whenIdle()/dispose() retain responsibility for propagating the error.
    tracked.then(
      () => this.pending.delete(tracked),
      () => {},
    );
    return tracked;
  }

  _durableCompletionAfterError(binding, error) {
    if (typeof this.acquisitionService.getDurableCompletionReceipt !== 'function') return null;
    let receipt;
    try { receipt = this.acquisitionService.getDurableCompletionReceipt(error); }
    catch { return null; }
    if (!isPlainRecord(receipt)
      || receipt.workspaceIdentity !== binding.registration.workspaceIdentity
      || receipt.jobId !== binding.registration.jobId
      || receipt.intentId !== binding.registration.intentId
      || receipt.candidateId !== binding.registration.candidate.candidateId
      || receipt.candidateFingerprint !== binding.registration.candidateFingerprint
      || receipt.offerId !== binding.registration.offerId
      || !Number.isSafeInteger(receipt.revision)
      || receipt.revision <= binding.registration.expectedRevision) return null;
    const recoverable = (receipt.state === 'failed'
      && typeof receipt.retryFrom === 'string' && receipt.retryFrom)
      || (receipt.state === 'paused' && typeof receipt.retryFrom === 'string' && receipt.retryFrom)
      || receipt.state === 'cancelled'
      || receipt.state === 'awaiting-import'
      || receipt.state === 'imported';
    return recoverable ? receipt : null;
  }

  _completeBinding(binding, state) {
    if (binding.completionPromise) return binding.completionPromise;
    binding.doneObserved = true;
    if (typeof binding.item.removeListener === 'function') {
      binding.item.removeListener('done', binding.done);
    } else if (typeof binding.item.off === 'function') {
      binding.item.off('done', binding.done);
    }
    const electronState = ['completed', 'cancelled', 'interrupted'].includes(state)
      ? state
      : 'interrupted';
    // A shutdown-requested Electron cancellation is not a user decision to
    // discard the transfer.  `done` still supplies the real writer-close
    // boundary, but the coordinator must pause it as recoverable interrupted
    // work.  Ordinary in-app/user cancellation remains `cancelled`.
    const normalizedState = binding.shutdownRequested && electronState === 'cancelled'
      ? 'interrupted'
      : electronState;
    // Invoke synchronously in Electron's real `done` turn.  The coordinator
    // captures the writer-closed savePath identity before any later task can
    // replace it, while the returned verification/promotion work stays async.
    let completion;
    try {
      completion = Promise.resolve(this.acquisitionService.completeBrowserDownload(
        binding.handleId,
        { state: normalizedState },
      ));
    } catch (error) {
      completion = Promise.reject(error);
    }
    binding.completionPromise = this._track(completion.then(
      result => {
        binding.settled = true;
        this.itemBindings.delete(binding.item);
        this._wake(binding.registration, normalizedState === 'completed' ? 'ready' : 'paused');
        return result;
      },
      error => {
        this._wake(binding.registration, 'failed', error);
        const durable = this._durableCompletionAfterError(binding, error);
        if (durable) {
          // DownloadItem has emitted its real writer-close boundary and the
          // coordinator has already persisted an exact recoverable/terminal
          // Job fact.  The acquisition failed, but owner durability succeeded;
          // keep the failure in the Job/UI without deadlocking app shutdown.
          binding.settled = true;
          this.itemBindings.delete(binding.item);
          return durable;
        }
        throw error;
      },
    ));
    binding.completionPromise.then(binding.resolveSettlement, binding.rejectSettlement);
    return binding.completionPromise;
  }

  _validatePreparation(preparation, registration) {
    if (!isPlainRecord(preparation) || typeof preparation.handleId !== 'string'
      || !preparation.handleId || /[\u0000-\u001f\u007f\s]/.test(preparation.handleId)
      || typeof preparation.savePath !== 'string' || !path.isAbsolute(preparation.savePath)) {
      throw codedError('LIBRARY_BROWSER_INVALID_PREPARATION', 'acquisition coordinator returned an invalid Browser staging handle');
    }
    const savePath = path.resolve(preparation.savePath);
    const stagingRoot = path.resolve(registration.workspacePath, '书库', '.resources', 'staging');
    const expectedLeaf = `payload.${registration.format}.part`;
    if (!isInside(stagingRoot, savePath) || path.basename(savePath) !== expectedLeaf) {
      throw codedError('LIBRARY_BROWSER_UNSAFE_STAGING', 'Browser DownloadItem save path escaped its Job staging area');
    }
    let stat;
    try { stat = this.fs.lstatSync(savePath); }
    catch {
      throw codedError('LIBRARY_BROWSER_UNSAFE_STAGING', 'Browser DownloadItem staging file was not prepared');
    }
    if (!stat.isFile() || stat.isSymbolicLink()
      || (typeof stat.nlink === 'number' && stat.nlink !== 1)) {
      throw codedError('LIBRARY_BROWSER_UNSAFE_STAGING', 'Browser DownloadItem staging target is linked or not a regular file');
    }
    let physicalStagingRoot;
    let physicalSavePath;
    try {
      physicalStagingRoot = physicalRealpath(this.fs, stagingRoot);
      physicalSavePath = physicalRealpath(this.fs, savePath);
    } catch {
      throw codedError('LIBRARY_BROWSER_UNSAFE_STAGING', 'Browser DownloadItem staging path has no stable physical identity');
    }
    if (!isInside(physicalStagingRoot, physicalSavePath)) {
      throw codedError('LIBRARY_BROWSER_UNSAFE_STAGING', 'Browser DownloadItem staging path escaped through a linked component');
    }
    return Object.freeze({ handleId: preparation.handleId, savePath });
  }

  _abandonPreparation(preparation) {
    const handleId = isPlainRecord(preparation) && typeof preparation.handleId === 'string'
      && preparation.handleId && !/[\u0000-\u001f\u007f\s]/.test(preparation.handleId)
      ? preparation.handleId
      : '';
    if (!handleId) return null;
    // Validation/setup failure still owns a durable coordinator handle.  Its
    // interrupted transition is part of the same shutdown gate and therefore
    // cannot be converted into a best-effort/null result.
    return this._track(Promise.resolve().then(() => (
      this.acquisitionService.completeBrowserDownload(handleId, { state: 'interrupted' })
    )));
  }

  _onWillDownload(event, item, webContents) {
    if (this.disposed || !item || this.claimedItems.has(item)) return;
    let url;
    let webContentsId;
    try {
      if (typeof item.getURL !== 'function') return;
      url = item.getURL();
      webContentsId = webContentsIdentity(webContents);
    } catch {
      return;
    }
    if (typeof url !== 'string') return;
    const registrationId = this.registrationByMatch.get(`${webContentsId}\0${url}`);
    if (!registrationId) return;
    const registration = this.registrations.get(registrationId);
    if (!registration) return;
    if (typeof item.setSavePath !== 'function' || typeof item.once !== 'function') {
      this.unregisterIntent(registrationId);
      this._wake(registration, 'failed', codedError('LIBRARY_BROWSER_INVALID_ITEM', 'DownloadItem lacks required capabilities'));
      return;
    }

    // Durable facts are re-read at the event boundary.  A stale registration
    // is consumed but leaves Electron's default download completely untouched.
    try {
      this._readAuthorizedIntent({
        workspaceIdentity: registration.workspaceIdentity,
        jobId: registration.jobId,
        intentId: registration.intentId,
        candidate: registration.candidate,
        expectedRevision: registration.expectedRevision,
        webContentsId: registration.webContentsId,
      });
    } catch (error) {
      this.unregisterIntent(registrationId);
      this._wake(registration, 'stale', error);
      return;
    }

    this.unregisterIntent(registrationId);
    this.claimedItems.add(item);
    let preparation;
    try {
      preparation = this.acquisitionService.prepareBrowserDownload(
        registration.workspaceIdentity,
        registration.jobId,
        {
          candidate: registration.candidate,
          expectedRevision: registration.expectedRevision,
        },
      );
      if (preparation && typeof preparation.then === 'function') {
        this._track(Promise.resolve(preparation).then(
          latePreparation => this._abandonPreparation(latePreparation),
          () => null,
        ));
        throw codedError(
          'LIBRARY_BROWSER_ASYNC_PREPARATION_UNSUPPORTED',
          'Browser staging preparation must finish synchronously inside will-download',
        );
      }
      preparation = this._validatePreparation(preparation, registration);
    } catch (error) {
      this._abandonPreparation(preparation);
      this._wake(registration, 'failed', error);
      return;
    }

    const binding = {
      item,
      registration,
      handleId: preparation.handleId,
      settled: false,
      shutdownRequested: false,
      doneObserved: false,
      completionPromise: null,
      settlementPromise: null,
      resolveSettlement: null,
      rejectSettlement: null,
      done: null,
    };
    binding.settlementPromise = new Promise((resolve, reject) => {
      binding.resolveSettlement = resolve;
      binding.rejectSettlement = reject;
    });
    // The promise is intentionally not part of `pending` until a real `done`
    // event starts the persistent completion.  It is nevertheless the owner
    // that dispose() waits on after requesting Electron cancellation.
    binding.settlementPromise.catch(() => {});
    binding.done = (_doneEvent, state) => this._completeBinding(binding, state);
    item.once('done', binding.done);
    this.itemBindings.set(item, binding);
    try {
      // No preventDefault/cancel: Electron owns the transfer and may replace
      // the coordinator-created empty leaf at its normal writer-close boundary.
      item.setSavePath(preparation.savePath);
    } catch (error) {
      this._completeBinding(binding, 'interrupted');
      this._wake(registration, 'failed', error);
      return;
    }
    this._wake(registration, 'started');
  }

  snapshot() {
    return Object.freeze({
      attached: Boolean(this.session),
      disposed: this.disposed,
      pendingIntentCount: this.registrations.size,
      activeItemCount: this.itemBindings.size,
      pendingCompletionCount: this.pending.size,
    });
  }

  async whenIdle() {
    const seen = new Set();
    const failures = [];
    while (true) {
      const batch = [...this.pending].filter(promise => !seen.has(promise));
      if (!batch.length) break;
      for (const promise of batch) seen.add(promise);
      const results = await Promise.allSettled(batch);
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
    }
    this._throwDurabilityFailures(failures);
  }

  _throwDurabilityFailures(failures) {
    const unique = [...new Set(failures)];
    if (!unique.length) return;
    if (unique.length === 1) throw unique[0];
    const error = new AggregateError(unique, 'Browser acquisition durability transitions failed');
    error.code = 'LIBRARY_BROWSER_DURABILITY_FAILED';
    throw error;
  }

  async _finishDispose(settlements) {
    const seen = new Set();
    const failures = [];
    let batch = [...new Set([...settlements, ...this.pending])];
    while (batch.length) {
      for (const promise of batch) seen.add(promise);
      const results = await Promise.allSettled(batch);
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      batch = [...this.pending].filter(promise => !seen.has(promise));
    }
    this._throwDurabilityFailures(failures);
    if (this.itemBindings.size || this.pending.size) {
      throw codedError(
        'LIBRARY_BROWSER_DISPOSE_BOUNDARY_FAILED',
        'Browser acquisition owners did not reach the durable disposal boundary',
      );
    }
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.detach();
    this.clearRegistrations();
    const settlements = [];
    for (const binding of [...this.itemBindings.values()]) {
      if (!binding.doneObserved) {
        binding.shutdownRequested = true;
        try {
          if (typeof binding.item.cancel !== 'function') {
            throw codedError(
              'LIBRARY_BROWSER_CANCEL_UNAVAILABLE',
              'Browser DownloadItem cannot be cancelled at shutdown',
            );
          }
          binding.item.cancel();
        } catch (cause) {
          const error = codedError(
            'LIBRARY_BROWSER_CANCEL_FAILED',
            'Browser DownloadItem cancellation failed at the durable shutdown boundary',
          );
          error.cause = cause;
          const cancelFailure = this._track(Promise.reject(error));
          settlements.push(cancelFailure);
          continue;
        }
      }
      // Never synthesize `interrupted`: Electron's real `done` event is the
      // writer-close boundary.  A missing event deliberately holds shutdown.
      settlements.push(binding.settlementPromise);
    }
    this.disposePromise = this._finishDispose(settlements);
    // Preserve the exact authoritative promise for every repeated caller
    // while keeping it safe if a host temporarily has no awaiter attached.
    this.disposePromise.catch(() => {});
    return this.disposePromise;
  }

  cleanup() {
    return this.dispose();
  }
}

module.exports = LibraryBrowserAcquisitionBridge;
module.exports.LibraryBrowserAcquisitionBridge = LibraryBrowserAcquisitionBridge;
module.exports.WAKE_SCHEMA = WAKE_SCHEMA;
