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

module.exports = { CATALOG_IMAGE_HOSTS, CATALOG_IMAGE_MAX_BYTES, allowedCatalogImageUrl };
