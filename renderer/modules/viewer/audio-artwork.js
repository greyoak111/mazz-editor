// Audio artwork owns exactly one <img> per source. A retired image is fully
// detached so a late load/error event can never paint over the next track.

const REMOTE_OR_CUSTOM_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;
const WINDOWS_UNC = /^\\\\[^\\/]+[\\/][^\\/]+/;
const NORMALIZED_UNC = /^\/\/[^/]+\/[^/]+/;

export function audioArtworkUrl(filePath) {
  const raw = typeof filePath === 'string' ? filePath.trim() : '';
  if (!raw) return null;

  // A drive letter is an absolute path, not a URI scheme. Everything else
  // with a scheme (http:, blob:, mazz-res:, data:, ...) stays renderer-only.
  const local = WINDOWS_ABSOLUTE.test(raw)
    || WINDOWS_UNC.test(raw)
    || NORMALIZED_UNC.test(raw)
    || (raw.startsWith('/') && !raw.startsWith('//'));
  if (!local || (!WINDOWS_ABSOLUTE.test(raw) && REMOTE_OR_CUSTOM_SCHEME.test(raw))) return null;

  const normalized = raw.replace(/\\/g, '/');
  return `mazz-res://audio-artwork/${encodeURIComponent(normalized)}`;
}

const FALLBACK_MARKUP = `
  <div class="mz-audio-art-fallback" aria-hidden="true">
    <svg viewBox="0 0 96 96" focusable="false" aria-hidden="true">
      <rect x="14" y="14" width="68" height="68" rx="16" fill="currentColor" opacity=".1"/>
      <path d="M35 62V39l29-6v23" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M35 44l29-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      <circle cx="29" cy="64" r="8" fill="currentColor"/>
      <circle cx="58" cy="58" r="8" fill="currentColor"/>
      <path d="M20 29h9M67 68h9M24 75h8M68 24h5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".38"/>
    </svg>
  </div>`;

export function mountAudioArtwork(host, { path = '', name = '' } = {}) {
  if (!host) return { setSource() {}, destroy() {} };

  host.innerHTML = FALLBACK_MARKUP;
  host.setAttribute('role', 'img');

  let destroyed = false;
  let generation = 0;
  let active = null;

  const setLabel = (hasArtwork, label) => {
    const title = String(label || '').trim();
    host.setAttribute('aria-label', hasArtwork
      ? (title ? `封面：${title}` : '音频封面')
      : (title ? `${title}（无内嵌封面）` : '音频（无内嵌封面）'));
  };

  const retire = () => {
    const owner = active;
    active = null;
    if (!owner) return;
    owner.image.removeEventListener('load', owner.onLoad);
    owner.image.removeEventListener('error', owner.onError);
    owner.image.removeAttribute('src');
    owner.image.remove();
  };

  const showFallback = (label) => {
    host.classList.remove('has-artwork', 'is-loading');
    host.setAttribute('aria-busy', 'false');
    setLabel(false, label);
  };

  const setSource = (filePath, label = '') => {
    if (destroyed) return;
    const ownerGeneration = ++generation;
    retire();
    showFallback(label);

    const source = audioArtworkUrl(filePath);
    if (!source) return;

    const image = document.createElement('img');
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.loading = 'eager';
    image.setAttribute('aria-hidden', 'true');

    const isCurrentOwner = () => !destroyed
      && generation === ownerGeneration
      && active?.image === image;

    const onLoad = () => {
      if (!isCurrentOwner()) return;
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        onError();
        return;
      }
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      host.classList.remove('is-loading');
      host.classList.add('has-artwork');
      host.setAttribute('aria-busy', 'false');
      setLabel(true, label);
    };

    const onError = () => {
      if (!isCurrentOwner()) return;
      retire();
      showFallback(label);
    };

    active = { image, onLoad, onError, generation: ownerGeneration };
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    host.classList.add('is-loading');
    host.setAttribute('aria-busy', 'true');
    host.appendChild(image);
    image.src = source;

    // Cached custom-protocol images may already be complete before the event
    // turn is observed. They still pass through the same decoded-size gate.
    if (image.complete) queueMicrotask(() => {
      if (!isCurrentOwner()) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) onLoad();
      else if (image.complete) onError();
    });
  };

  setSource(path, name);

  return {
    setSource,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      retire();
      host.classList.remove('has-artwork', 'is-loading');
      host.removeAttribute('aria-busy');
    },
  };
}
