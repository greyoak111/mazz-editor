// Mikan catalog cover policy: pure allow-list helpers shared by the protocol
// handler and contract tests.  Keep this module free of Electron side effects.
'use strict';

const CATALOG_IMAGE_HOSTS = new Set([
  'mikanime.tv', 'www.mikanime.tv',
  'mikanani.me', 'www.mikanani.me',
]);
const CATALOG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function allowedCatalogImageUrl(value) {
  try {
    const target = new URL(String(value || ''));
    if (target.protocol !== 'https:' || target.username || target.password) return null;
    if (target.port && target.port !== '443') return null;
    return CATALOG_IMAGE_HOSTS.has(target.hostname.toLowerCase()) ? target : null;
  } catch { return null; }
}

function canonicalCatalogImageUrl(value) {
  const target = allowedCatalogImageUrl(value);
  if (!target) return null;
  // The legacy catalogue host redirects these covers to a lower-cased path
  // that does not exist on the case-sensitive canonical host.  Canonicalize
  // before Electron net.fetch: its `redirect: manual` rejects a redirect
  // instead of exposing the 302 response to the protocol handler.
  if (/(^|\.)mikanime\.tv$/i.test(target.hostname)
    && target.pathname.startsWith('/images/Bangumi/')) {
    target.hostname = 'mikanani.me';
  }
  return target;
}

function resolvedCatalogImageRedirect(currentValue, locationValue) {
  const current = allowedCatalogImageUrl(currentValue);
  if (!current) return null;
  if (!locationValue) return null;
  let redirected;
  try {
    redirected = allowedCatalogImageUrl(new URL(String(locationValue || ''), current).href);
  } catch { return null; }
  if (!redirected) return null;

  // mikanime.tv currently migrates cover requests to mikanani.me while
  // lower-casing the case-sensitive /images/Bangumi/ path.  The redirected
  // resource then 404s even though the same destination with the original
  // path casing is valid.  Only repair a path that is otherwise byte-for-byte
  // equivalent ignoring case; never carry an unrelated redirect path across.
  const fromLegacyHost = /(^|\.)mikanime\.tv$/i.test(current.hostname);
  const toCanonicalHost = /(^|\.)mikanani\.me$/i.test(redirected.hostname);
  if (fromLegacyHost && toCanonicalHost
    && redirected.pathname !== current.pathname
    && redirected.pathname.toLowerCase() === current.pathname.toLowerCase()) {
    redirected.pathname = current.pathname;
    redirected.search = current.search;
  }
  return redirected;
}

module.exports = {
  CATALOG_IMAGE_HOSTS,
  CATALOG_IMAGE_MAX_BYTES,
  allowedCatalogImageUrl,
  canonicalCatalogImageUrl,
  resolvedCatalogImageRedirect,
};
