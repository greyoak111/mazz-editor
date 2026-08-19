// OCR 作业运行时：单作业、可取消、有界超时、worker 必释放。

export const OCR_LIMITS = Object.freeze({
  maxImageBytes: 32 * 1024 * 1024,
  timeoutMs: 180_000,
});

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function estimateDataUrlBytes(dataUrl) {
  const encoded = String(dataUrl || '').split(',', 2)[1] || '';
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0));
}

export function createOcrRuntime({
  loadEngine = () => import('tesseract.js'),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = OCR_LIMITS.timeoutMs,
} = {}) {
  let active = null;

  const cancel = async (reason = 'user-cancel') => {
    if (!active || active.settled) return false;
    active.cancelled = true;
    active.reason = reason;
    try { await active.worker?.terminate?.(); } catch {}
    active.rejectCancel?.(failure('OCR_CANCELLED', 'OCR 已取消'));
    return true;
  };

  const recognize = async ({ imageDataUrl, lang = 'chi_sim+eng', onProgress = () => {} } = {}) => {
    if (active && !active.settled) throw failure('OCR_BUSY', '已有 OCR 作业正在运行');
    const bytes = estimateDataUrlBytes(imageDataUrl);
    if (!bytes) throw failure('OCR_EMPTY_IMAGE', '图片数据为空');
    if (bytes > OCR_LIMITS.maxImageBytes) throw failure('OCR_IMAGE_TOO_LARGE', '图片超过 32 MiB OCR 上限');

    const job = { worker: null, cancelled: false, reason: '', settled: false, timer: null, rejectCancel: null };
    active = job;
    const timeout = new Promise((_, reject) => {
      job.timer = setTimer(async () => {
        job.cancelled = true;
        job.reason = 'timeout';
        try { await job.worker?.terminate?.(); } catch {}
        reject(failure('OCR_TIMEOUT', `OCR 超过 ${Math.round(timeoutMs / 1000)} 秒，已停止`));
      }, timeoutMs);
    });
    const cancelled = new Promise((_, reject) => { job.rejectCancel = reject; });
    const work = (async () => {
      const module = await loadEngine();
      if (job.cancelled) throw failure(job.reason === 'timeout' ? 'OCR_TIMEOUT' : 'OCR_CANCELLED', 'OCR 已取消');
      const api = module.default || module;
      if (typeof api.createWorker !== 'function') throw failure('OCR_ENGINE_UNAVAILABLE', '本地 OCR 引擎不可用');
      job.worker = await api.createWorker(lang, undefined, {
        logger: info => {
          if (!job.cancelled) onProgress(Object.freeze({ status: String(info?.status || ''), progress: Math.max(0, Math.min(1, Number(info?.progress) || 0)) }));
        },
        errorHandler: error => { if (!job.cancelled) onProgress(Object.freeze({ status: 'error', message: String(error?.message || error) })); },
      });
      if (job.cancelled) throw failure(job.reason === 'timeout' ? 'OCR_TIMEOUT' : 'OCR_CANCELLED', 'OCR 已取消');
      const result = await job.worker.recognize(imageDataUrl);
      if (job.cancelled) throw failure(job.reason === 'timeout' ? 'OCR_TIMEOUT' : 'OCR_CANCELLED', 'OCR 已取消');
      return Object.freeze({
        text: String(result?.data?.text || '').trim(),
        confidence: Math.max(0, Math.min(100, Number(result?.data?.confidence) || 0)),
        lang,
      });
    })();

    try {
      return await Promise.race([work, timeout, cancelled]);
    } catch (error) {
      if (job.cancelled && error?.code !== 'OCR_TIMEOUT') throw failure(job.reason === 'timeout' ? 'OCR_TIMEOUT' : 'OCR_CANCELLED', job.reason === 'timeout' ? `OCR 超过 ${Math.round(timeoutMs / 1000)} 秒，已停止` : 'OCR 已取消');
      throw error;
    } finally {
      job.settled = true;
      clearTimer(job.timer);
      try { await job.worker?.terminate?.(); } catch {}
      if (active === job) active = null;
    }
  };

  return Object.freeze({
    recognize,
    cancel,
    get active() { return !!active && !active.settled; },
  });
}
