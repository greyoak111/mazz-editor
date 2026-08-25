'use strict';

const crypto = require('node:crypto');
const { SaxesParser } = require('saxes');
const contract = require('./library-resource-contract');
const source = require('./library-source-registry');

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const DC_NS = 'http://purl.org/dc/terms/';
const OPDS_ACQUISITION = 'http://opds-spec.org/acquisition';
const OPDS_OPEN_ACCESS = 'http://opds-spec.org/acquisition/open-access';
const OPDS1_ACCEPT = 'application/atom+xml;profile=opds-catalog, application/atom+xml;q=0.9';
const OPDS2_ACCEPT = 'application/opds+json';
const GUTENBERG_ROOT = 'https://www.gutenberg.org/ebooks/search.opds/';
const GUTENBERG_SEARCH = 'https://www.gutenberg.org/ebooks/search.opds/?query={query}';
const GUTENBERG_TERMS = 'https://www.gutenberg.org/policy/terms_of_use.html';
const GUTENBERG_ROBOT = 'https://www.gutenberg.org/policy/robot_access.html';

const MIME_FORMATS = Object.freeze({
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.mobi8-ebook': 'azw3',
  'application/vnd.comicbook+zip': 'cbz',
  'application/x-cbz': 'cbz',
});

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecord(value, label, fields, options) {
  if (!isPlainRecord(value)) throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', label + ' 必须是普通对象');
  const unknown = Object.keys(value).filter(function (key) { return !fields.includes(key); });
  if (unknown.length) throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', label + ' 含未知字段');
  if (!options || options.scanSecrets !== false) contract.assertNoSecrets(value, label);
  return value;
}

function exactString(value, label, optional) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value)
    || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', label + ' 必须是原生精确字符串');
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label, false);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', label + ' 必须是 opaque identity');
  }
  return text;
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now === undefined ? new Date() : now);
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_SOURCE_PACK_CLOCK_INVALID', 'source pack clock 非法');
  return new Date(timestamp).toISOString();
}

function hashId(prefix, material) {
  return prefix + '-' + crypto.createHash('sha256').update(contract.stableJson(material)).digest('hex');
}

function contentType(headers) {
  const raw = headers && (headers['content-type'] || headers['Content-Type']);
  return String(raw || '').split(';')[0].trim().toLowerCase();
}

function attr(node, name) {
  const value = node && node.attributes && node.attributes[name];
  if (value && typeof value === 'object') return String(value.value || '');
  return value === undefined ? '' : String(value);
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeResolvedUrl(baseUrl, href, label) {
  if (typeof href !== 'string' || !href || href !== href.trim()) {
    throw codedError('LIBRARY_OPDS_URL_INVALID', label + ' 非法');
  }
  let resolved;
  try { resolved = baseUrl ? new URL(href, baseUrl) : new URL(href); }
  catch { throw codedError('LIBRARY_OPDS_URL_INVALID', label + ' 非法'); }
  resolved.hash = '';
  try { return contract.assertHttpsPublicUrl(resolved.href, label); }
  catch { throw codedError('LIBRARY_OPDS_URL_INVALID', label + ' 未通过公共 HTTPS/secret 边界'); }
}

function parseOpds1(xmlInput, feedUrl) {
  if (!Buffer.isBuffer(xmlInput) && typeof xmlInput !== 'string') {
    throw codedError('LIBRARY_OPDS_XML_INVALID', 'OPDS1 XML 必须是 Buffer 或原生字符串');
  }
  const xml = Buffer.isBuffer(xmlInput) ? xmlInput.toString('utf8') : xmlInput;
  if (!xml || /\u0000/.test(xml)) throw codedError('LIBRARY_OPDS_XML_INVALID', 'OPDS1 XML 非法');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw codedError('LIBRARY_OPDS_XML_UNSAFE', 'OPDS1 禁止 DTD/ENTITY');
  }
  const feed = { title: '', selfUrl: '', nextUrl: '', entries: [] };
  let currentEntry = null;
  let currentAuthor = null;
  const stack = [];
  let parserError = null;
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on('doctype', function () {
    throw codedError('LIBRARY_OPDS_XML_UNSAFE', 'OPDS1 禁止 DTD');
  });
  parser.on('processinginstruction', function () {
    throw codedError('LIBRARY_OPDS_XML_UNSAFE', 'OPDS1 禁止 processing instruction');
  });
  parser.on('error', function (error) {
    parserError = codedError('LIBRARY_OPDS_XML_INVALID', 'OPDS1 XML 非法', { cause: error });
  });
  parser.on('opentag', function (node) {
    const frame = { uri: node.uri || '', local: node.local || node.name, text: '' };
    stack.push(frame);
    if (frame.uri === ATOM_NS && frame.local === 'entry') {
      currentEntry = {
        id: '', title: '', updated: '', authors: [], languages: [], identifiers: [],
        rights: '', summary: '', links: [],
      };
    } else if (currentEntry && frame.uri === ATOM_NS && frame.local === 'author') {
      currentAuthor = '';
    } else if (frame.uri === ATOM_NS && frame.local === 'link') {
      const link = {
        rel: attr(node, 'rel'),
        href: attr(node, 'href'),
        type: attr(node, 'type'),
        length: attr(node, 'length'),
      };
      if (currentEntry) currentEntry.links.push(link);
      else if (link.rel === 'next') feed.nextUrl = safeResolvedUrl(feedUrl, link.href, 'OPDS1 next');
      else if (link.rel === 'self') feed.selfUrl = safeResolvedUrl(feedUrl, link.href, 'OPDS1 self');
    }
  });
  parser.on('text', function (text) {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on('cdata', function (text) {
    if (stack.length) stack[stack.length - 1].text += text;
  });
  parser.on('closetag', function () {
    const frame = stack.pop();
    if (!frame) return;
    const text = normalizedText(frame.text);
    if (!currentEntry) {
      if (frame.uri === ATOM_NS && frame.local === 'title' && !feed.title) feed.title = text;
      return;
    }
    if (frame.uri === ATOM_NS && frame.local === 'id') currentEntry.id = text;
    else if (frame.uri === ATOM_NS && frame.local === 'title') currentEntry.title = text;
    else if (frame.uri === ATOM_NS && frame.local === 'updated') currentEntry.updated = text;
    else if (frame.uri === ATOM_NS && frame.local === 'rights') currentEntry.rights = text;
    else if (frame.uri === ATOM_NS && (frame.local === 'summary' || frame.local === 'content')) {
      if (!currentEntry.summary) currentEntry.summary = text;
    } else if (frame.uri === DC_NS && frame.local === 'identifier') currentEntry.identifiers.push(text);
    else if (frame.uri === DC_NS && frame.local === 'language') currentEntry.languages.push(text);
    else if (frame.uri === ATOM_NS && frame.local === 'name' && currentAuthor !== null) currentAuthor = text;
    else if (frame.uri === ATOM_NS && frame.local === 'author') {
      if (currentAuthor) currentEntry.authors.push(currentAuthor);
      currentAuthor = null;
    } else if (frame.uri === ATOM_NS && frame.local === 'entry') {
      if (!currentEntry.id || !currentEntry.title || !currentEntry.updated) {
        throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS1 entry 缺少 id/title/updated');
      }
      feed.entries.push(currentEntry);
      currentEntry = null;
      currentAuthor = null;
    }
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    throw error && error.code ? error : codedError('LIBRARY_OPDS_XML_INVALID', 'OPDS1 XML 非法', { cause: error });
  }
  if (parserError) throw parserError;
  if (!feed.title) throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS1 feed 缺少 title');
  return feed;
}

function linkRels(link) {
  if (!link || typeof link !== 'object') return [];
  if (Array.isArray(link.rel)) return link.rel.filter(function (item) { return typeof item === 'string'; });
  return typeof link.rel === 'string' ? [link.rel] : [];
}

function parseOpds2(input, feedUrl) {
  let document;
  try {
    document = Buffer.isBuffer(input) ? JSON.parse(input.toString('utf8'))
      : (typeof input === 'string' ? JSON.parse(input) : input);
  } catch (error) {
    throw codedError('LIBRARY_OPDS_JSON_INVALID', 'OPDS2 JSON 非法', { cause: error });
  }
  if (!isPlainRecord(document) || !isPlainRecord(document.metadata)
    || typeof document.metadata.title !== 'string' || !document.metadata.title.trim()) {
    throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS2 feed 缺少 metadata.title');
  }
  const links = Array.isArray(document.links) ? document.links : [];
  const self = links.find(function (link) { return linkRels(link).includes('self'); });
  if (!self || typeof self.href !== 'string') throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS2 feed 缺少 self link');
  const selfUrl = safeResolvedUrl(feedUrl, self.href, 'OPDS2 self');
  const next = links.find(function (link) { return linkRels(link).includes('next'); });
  const publications = [];
  if (Array.isArray(document.publications)) publications.push.apply(publications, document.publications);
  if (Array.isArray(document.groups)) {
    for (const group of document.groups) {
      if (isPlainRecord(group) && Array.isArray(group.publications)) {
        publications.push.apply(publications, group.publications);
      }
    }
  }
  if (!Array.isArray(document.navigation) && !Array.isArray(document.publications)
    && !Array.isArray(document.groups)) {
    throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS2 feed 缺少 navigation/publications/groups');
  }
  return {
    title: normalizedText(document.metadata.title),
    selfUrl: selfUrl,
    nextUrl: next && typeof next.href === 'string'
      ? safeResolvedUrl(feedUrl, next.href, 'OPDS2 next') : '',
    entries: publications.map(function (publication) {
      if (!isPlainRecord(publication) || !isPlainRecord(publication.metadata)) {
        throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS2 publication 非法');
      }
      const metadata = publication.metadata;
      const authors = [];
      const authorList = Array.isArray(metadata.author) ? metadata.author
        : (metadata.author === undefined ? [] : [metadata.author]);
      for (const author of authorList) {
        if (typeof author === 'string') authors.push(normalizedText(author));
        else if (isPlainRecord(author) && typeof author.name === 'string') authors.push(normalizedText(author.name));
      }
      const languages = Array.isArray(metadata.language) ? metadata.language
        : (typeof metadata.language === 'string' ? [metadata.language] : []);
      const identifiers = Array.isArray(metadata.identifier) ? metadata.identifier
        : (typeof metadata.identifier === 'string' ? [metadata.identifier] : []);
      const publicationLinks = Array.isArray(publication.links) ? publication.links : [];
      const selfLink = publicationLinks.find(function (link) { return linkRels(link).includes('self'); });
      const title = normalizedText(metadata.title);
      const publicationId = typeof metadata.identifier === 'string'
        ? metadata.identifier : (selfLink && typeof selfLink.href === 'string' ? selfLink.href : '');
      if (!title || !publicationId) {
        throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS2 publication 缺少 title/identifier');
      }
      return {
        id: publicationId,
        title: title,
        updated: typeof metadata.modified === 'string' ? metadata.modified : '',
        authors: authors.filter(Boolean),
        languages: languages.map(normalizedText).filter(Boolean),
        identifiers: identifiers.map(normalizedText).filter(Boolean),
        rights: typeof metadata.rights === 'string' ? normalizedText(metadata.rights) : '',
        summary: typeof metadata.description === 'string' ? normalizedText(metadata.description) : '',
        links: publicationLinks.map(function (link) {
          return {
            rel: linkRels(link),
            href: link && link.href,
            type: link && link.type,
            length: link && link.properties && link.properties.length,
          };
        }),
      };
    }),
  };
}

function parseIdentifierClaims(values, entryId) {
  const result = { isbn: [], olid: [], ia: [], gutenberg: [], doi: [] };
  const claims = Array.isArray(values) ? values.slice() : [];
  if (entryId) claims.push(entryId);
  for (const raw of claims) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    const isbn = /^(?:urn:isbn:|isbn:)?([0-9Xx -]{10,17})$/.exec(text);
    const olid = /\b(OL[0-9]+[WM])\b/i.exec(text);
    const gutenberg = /(?:gutenberg(?::|\/ebooks\/)|\/ebooks\/)([0-9]+)\b/i.exec(text);
    const doi = /(?:doi:|doi\.org\/)(10\.[0-9]{4,9}\/\S+)/i.exec(text);
    const pairs = [];
    if (isbn) pairs.push(['isbn', isbn[1]]);
    if (olid) pairs.push(['olid', olid[1]]);
    if (gutenberg) pairs.push(['gutenberg', gutenberg[1]]);
    if (doi) pairs.push(['doi', doi[1]]);
    for (const pair of pairs) {
      const probe = { isbn: [], olid: [], ia: [], gutenberg: [], doi: [] };
      probe[pair[0]] = [pair[1]];
      try {
        const normalized = contract.normalizeIdentifiers(probe, 'identifiers', {
          entityKind: pair[0] === 'olid' && String(pair[1]).toUpperCase().endsWith('M') ? 'edition' : 'work',
        });
        const value = normalized[pair[0]][0];
        if (value && !result[pair[0]].includes(value)) result[pair[0]].push(value);
      } catch {}
    }
  }
  for (const valuesForKind of Object.values(result)) valuesForKind.sort();
  return result;
}

function identifiersForEntity(claims, entity) {
  const result = { isbn: claims.isbn.slice(), olid: [], ia: claims.ia.slice(), gutenberg: claims.gutenberg.slice(), doi: claims.doi.slice() };
  result.olid = claims.olid.filter(function (value) {
    return entity === 'work' ? value.endsWith('W') : value.endsWith('M');
  });
  return result;
}

function relationValues(rel) {
  return Array.isArray(rel) ? rel : [rel];
}

function openAcquisition(link, version) {
  const rels = relationValues(link.rel).filter(function (item) { return typeof item === 'string'; });
  return rels.some(function (rel) {
    if (version === '1.2') return rel === OPDS_ACQUISITION || rel === OPDS_OPEN_ACCESS;
    return rel === 'download' || rel === 'acquisition'
      || rel === OPDS_ACQUISITION || rel === OPDS_OPEN_ACCESS;
  });
}

function formatForLink(link) {
  if (!link || typeof link.type !== 'string') return '';
  return MIME_FORMATS[link.type.split(';')[0].trim().toLowerCase()] || '';
}

function gutenbergRightsConflict(value) {
  const text = normalizedText(value);
  if (!text || /public\s+domain/i.test(text)) return false;
  return /copyright|all\s+rights\s+reserved|restricted|permission|license/i.test(text);
}

function candidateFromEntry(entry, context) {
  if (!entry || typeof entry !== 'object' || !entry.id || !entry.title) return null;
  const resourceId = hashId('resource', {
    providerId: context.descriptor.providerId,
    sourceId: entry.id,
  });
  const claims = parseIdentifierClaims(entry.identifiers, entry.id);
  const workIdentifiers = identifiersForEntity(claims, 'work');
  const editionIdentifiers = identifiersForEntity(claims, 'edition');
  const identityFallback = { providerId: context.descriptor.providerId, resourceId: resourceId };
  const workId = contract.deriveWorkId(Object.values(workIdentifiers).some(function (items) { return items.length; })
    ? { identifiers: workIdentifiers } : Object.assign({ identifiers: workIdentifiers }, identityFallback));
  const editionId = contract.deriveEditionId(Object.values(editionIdentifiers).some(function (items) { return items.length; })
    ? { identifiers: editionIdentifiers } : Object.assign({ identifiers: editionIdentifiers }, identityFallback));
  const offers = [];
  for (const link of entry.links || []) {
    if (!openAcquisition(link, context.version)) continue;
    const format = formatForLink(link);
    if (!format || typeof link.href !== 'string') continue;
    const sourceUrl = safeResolvedUrl(context.feedUrl, link.href, 'OPDS acquisition URL');
    let size = null;
    if (link.length !== undefined && link.length !== null && link.length !== '') {
      const number = Number(link.length);
      if (!Number.isSafeInteger(number) || number < 0) {
        throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS acquisition length 非法');
      }
      size = number;
    }
    const material = {
      providerId: context.descriptor.providerId,
      resourceId: resourceId,
      editionId: editionId,
      format: format,
      transport: 'https',
      size: size,
      checksum: '',
      infoHash: '',
      sourceUrl: sourceUrl,
      acquisitionRef: '',
      selectableFiles: [],
    };
    material.offerId = contract.deriveOfferId(material);
    offers.push(material);
  }
  if (!offers.length) return null;
  offers.sort(function (left, right) { return left.offerId.localeCompare(right.offerId, 'en'); });
  const observedAt = context.observedAt;
  let rights;
  if (context.rightsMode === 'gutenberg-us' && !gutenbergRightsConflict(entry.rights)) {
    rights = {
      status: 'public-domain',
      licenseId: '',
      rightsStatement: 'Project Gutenberg source claim; United States only',
      jurisdiction: 'US',
      evidenceUrl: GUTENBERG_TERMS,
      assertedBy: 'project-gutenberg',
      checkedAt: context.descriptor.policy.checkedAt,
      confidence: 1,
    };
  } else {
    rights = {
      status: 'unknown',
      licenseId: '',
      rightsStatement: entry.rights || '',
      jurisdiction: '',
      evidenceUrl: '',
      assertedBy: context.descriptor.providerId,
      checkedAt: observedAt,
      confidence: null,
    };
  }
  let pageUrl = '';
  const gutenbergId = claims.gutenberg[0];
  if (context.rightsMode === 'gutenberg-us' && gutenbergId) {
    pageUrl = 'https://www.gutenberg.org/ebooks/' + gutenbergId;
  }
  const candidate = {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: hashId('candidate', { providerId: context.descriptor.providerId, resourceId: resourceId }),
    work: {
      workId: workId,
      title: entry.title,
      authors: Array.from(new Set(entry.authors || [])).sort(),
      languages: Array.from(new Set(entry.languages || [])).sort(),
      subjects: [],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId: editionId,
      title: entry.title,
      language: (entry.languages && entry.languages[0]) || '',
      publisher: '',
      publishedAt: '',
      identifiers: editionIdentifiers,
      description: entry.summary || '',
    }],
    offers: offers,
    rights: rights,
    provenance: [{
      providerId: context.descriptor.providerId,
      resourceId: resourceId,
      pageUrl: pageUrl,
      observedAt: observedAt,
      adapterVersion: context.descriptor.adapterVersion,
    }],
  };
  return contract.normalizeCandidate(candidate);
}

function validateSearchTemplate(value) {
  const template = exactString(value, 'searchTemplate', false);
  const placeholders = template.match(/\{\??query\}/g) || [];
  if (placeholders.length !== 1 || /\{(?!\??query\})/.test(template)) {
    throw codedError('LIBRARY_OPDS_SEARCH_TEMPLATE_INVALID', 'searchTemplate 必须精确包含一个 {query} 或 {?query}');
  }
  const probe = template.includes('{?query}')
    ? template.replace('{?query}', '?query=probe')
    : template.replace('{query}', 'probe');
  safeResolvedUrl('', probe, 'searchTemplate');
  return template;
}

function searchUrl(template, query) {
  const encoded = encodeURIComponent(query);
  return template.includes('{?query}')
    ? template.replace('{?query}', '?query=' + encoded)
    : template.replace('{query}', encoded);
}

class OpdsLibrarySourceAdapter {
  constructor(options) {
    const input = options || {};
    plainRecord(input, 'OpdsLibrarySourceAdapter options', [
      'descriptor', 'client', 'rootUrl', 'searchTemplate', 'version', 'paginationMode',
      'minIntervalMs', 'rightsMode', 'now',
    ], { scanSecrets: false });
    this._descriptor = source.normalizeDescriptor(input.descriptor, { now: input.now });
    if (!input.client || typeof input.client.get !== 'function') {
      throw codedError('LIBRARY_OPDS_CLIENT_REQUIRED', 'OPDS adapter 必须有显式 catalog client');
    }
    this.client = input.client;
    this.rootUrl = safeResolvedUrl('', input.rootUrl, 'OPDS root URL');
    this.searchTemplate = input.searchTemplate ? validateSearchTemplate(input.searchTemplate) : '';
    this.version = exactString(input.version, 'OPDS version', false);
    if (!['1.2', '2.0'].includes(this.version)) {
      throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'OPDS version 仅支持 1.2/2.0');
    }
    this.paginationMode = input.paginationMode === undefined ? 'user-driven'
      : exactString(input.paginationMode, 'paginationMode', false);
    if (!['user-driven', 'automatic'].includes(this.paginationMode)) {
      throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'paginationMode 非法');
    }
    this.minIntervalMs = input.minIntervalMs === undefined ? 0 : input.minIntervalMs;
    if (!Number.isSafeInteger(this.minIntervalMs) || this.minIntervalMs < 0) {
      throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'minIntervalMs 非法');
    }
    this.rightsMode = input.rightsMode === undefined ? 'unknown'
      : exactString(input.rightsMode, 'rightsMode', false);
    if (!['unknown', 'gutenberg-us'].includes(this.rightsMode)) {
      throw codedError('LIBRARY_OPDS_SCHEMA_INVALID', 'rightsMode 非法');
    }
    this.now = input.now;
    this.cursorUrls = new Map();
    this.candidateByResource = new Map();
    this.responseCache = new Map();
    this.calls = { search: 0, discover: 0, resolve: 0, health: 0 };
  }

  descriptor() { return this._descriptor; }

  _cursor(url) {
    if (!url) return null;
    const token = hashId('cursor', { providerId: this._descriptor.providerId, url: url });
    this.cursorUrls.set(token, url);
    return token;
  }

  _urlForCursor(cursor) {
    if (cursor === null) return '';
    const token = opaqueId(cursor, 'cursor');
    const url = this.cursorUrls.get(token);
    if (!url) throw codedError('LIBRARY_OPDS_CURSOR_UNKNOWN', 'OPDS cursor 未在当前 main owner 注册');
    return url;
  }

  cursorRecord(cursor) {
    const token = opaqueId(cursor, 'cursor');
    const url = this.cursorUrls.get(token);
    if (!url) throw codedError('LIBRARY_OPDS_CURSOR_UNKNOWN', 'OPDS cursor 未知');
    return Object.freeze({ cursorToken: token, nextUrl: url });
  }

  restoreCursor(record) {
    plainRecord(record, 'cursor record', ['cursorToken', 'nextUrl']);
    const token = opaqueId(record.cursorToken, 'cursorToken');
    const url = safeResolvedUrl('', record.nextUrl, 'cursor nextUrl');
    const expected = hashId('cursor', { providerId: this._descriptor.providerId, url: url });
    if (token !== expected) throw codedError('LIBRARY_OPDS_CURSOR_MISMATCH', 'cursor token 与 URL 不一致');
    this.cursorUrls.set(token, url);
    return token;
  }

  async _fetch(url, signal) {
    const cached = this.responseCache.get(url);
    const response = await this.client.get({
      providerId: this._descriptor.providerId,
      url: url,
      accept: this.version === '1.2' ? OPDS1_ACCEPT : OPDS2_ACCEPT,
      etag: cached && cached.etag,
      lastModified: cached && cached.lastModified,
      minIntervalMs: this.minIntervalMs,
      signal: signal,
    });
    if (response.notModified) {
      if (!cached) throw codedError('LIBRARY_OPDS_CACHE_MISS', '304 没有对应 catalog cache');
      return cached;
    }
    const mime = contentType(response.headers);
    const expected = this.version === '1.2' ? 'application/atom+xml' : 'application/opds+json';
    if (mime !== expected) throw codedError('LIBRARY_OPDS_MIME_INVALID', 'OPDS 响应 MIME 非法');
    const record = {
      url: response.url,
      body: response.body,
      etag: response.headers.etag || '',
      lastModified: response.headers['last-modified'] || '',
    };
    this.responseCache.set(url, record);
    return record;
  }

  async _page(url, signal) {
    const response = await this._fetch(url, signal);
    const parsed = this.version === '1.2'
      ? parseOpds1(response.body, response.url)
      : parseOpds2(response.body, response.url);
    const observedAt = nowIso(this.now);
    const candidates = [];
    for (const entry of parsed.entries) {
      const candidate = candidateFromEntry(entry, {
        descriptor: this._descriptor,
        feedUrl: response.url,
        observedAt: observedAt,
        rightsMode: this.rightsMode,
        version: this.version,
      });
      if (candidate) {
        candidates.push(candidate);
        const resourceId = candidate.provenance[0].resourceId;
        this.candidateByResource.set(resourceId, candidate);
      }
    }
    return {
      schema: source.PAGE_SCHEMA,
      providerId: this._descriptor.providerId,
      adapterVersion: this._descriptor.adapterVersion,
      policyVersion: this._descriptor.policy.policyVersion,
      candidates: candidates,
      nextCursor: this._cursor(parsed.nextUrl),
    };
  }

  async search(request, context) {
    this.calls.search += 1;
    const cursorUrl = request.cursor === null ? '' : this._urlForCursor(request.cursor);
    if (!cursorUrl && !this.searchTemplate) {
      throw codedError('LIBRARY_SOURCE_CAPABILITY_UNAVAILABLE', 'OPDS 来源未配置 searchTemplate');
    }
    const url = cursorUrl || searchUrl(this.searchTemplate, request.query);
    return this._page(url, context && context.signal);
  }

  async discover(request, context) {
    this.calls.discover += 1;
    const url = request.cursor === null ? this.rootUrl : this._urlForCursor(request.cursor);
    return this._page(url, context && context.signal);
  }

  async resolve(request) {
    this.calls.resolve += 1;
    const candidate = this.candidateByResource.get(request.resourceId);
    return {
      schema: source.PAGE_SCHEMA,
      providerId: this._descriptor.providerId,
      adapterVersion: this._descriptor.adapterVersion,
      policyVersion: this._descriptor.policy.policyVersion,
      candidates: candidate ? [candidate] : [],
      nextCursor: null,
    };
  }

  async health(_request, context) {
    this.calls.health += 1;
    await this._fetch(this.rootUrl, context && context.signal);
    return {
      schema: source.HEALTH_SCHEMA,
      providerId: this._descriptor.providerId,
      adapterVersion: this._descriptor.adapterVersion,
      policyVersion: this._descriptor.policy.policyVersion,
      status: 'ready',
      checkedAt: nowIso(this.now),
      code: '',
    };
  }

  snapshot() {
    return Object.freeze({
      search: this.calls.search,
      discover: this.calls.discover,
      resolve: this.calls.resolve,
      health: this.calls.health,
      cursors: this.cursorUrls.size,
      cachedResponses: this.responseCache.size,
      candidates: this.candidateByResource.size,
      paginationMode: this.paginationMode,
    });
  }
}

class GutenbergLibrarySourceAdapter extends OpdsLibrarySourceAdapter {
  constructor(options) {
    const input = options || {};
    plainRecord(input, 'GutenbergLibrarySourceAdapter options', ['client', 'now', 'policyCheckedAt'], { scanSecrets: false });
    const checkedAt = nowIso(input.policyCheckedAt || input.now);
    super({
      descriptor: {
        schema: source.DESCRIPTOR_SCHEMA,
        providerId: 'project-gutenberg',
        displayName: 'Project Gutenberg',
        adapterVersion: 'gutenberg-opds1-v1',
        capabilities: ['discover', 'health', 'resolve', 'search'],
        policy: {
          policyVersion: 'gutenberg-policy-2026-08-25',
          checkedAt: checkedAt,
          jurisdictions: ['US'],
          rightsModes: ['public-domain', 'unknown'],
          termsUrl: GUTENBERG_ROBOT,
          rightsUrl: GUTENBERG_TERMS,
        },
      },
      client: input.client,
      rootUrl: GUTENBERG_ROOT,
      searchTemplate: GUTENBERG_SEARCH,
      version: '1.2',
      paginationMode: 'user-driven',
      minIntervalMs: 2000,
      rightsMode: 'gutenberg-us',
      now: input.now,
    });
  }
}

function createManualHttpsCandidate(options) {
  const input = options || {};
  plainRecord(input, 'manual HTTPS Candidate', [
    'url', 'format', 'title', 'authors', 'language', 'workIdentifiers',
    'editionIdentifiers', 'observedAt',
  ]);
  const url = contract.assertHttpsPublicUrl(input.url, 'manual URL');
  const format = exactString(input.format, 'manual format', false);
  if (!contract.FORMATS.includes(format)) throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', 'manual format 非法');
  const title = exactString(input.title, 'manual title', false);
  const authors = input.authors === undefined ? [] : input.authors;
  if (!Array.isArray(authors)) {
    throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', 'manual authors 必须是字符串数组');
  }
  const normalizedAuthors = authors.map(function (item, index) {
    return exactString(item, 'manual authors[' + index + ']', false);
  });
  const language = input.language === undefined ? '' : exactString(input.language, 'manual language', true);
  if (input.workIdentifiers !== undefined && !isPlainRecord(input.workIdentifiers)) {
    throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', 'manual workIdentifiers 必须是普通对象');
  }
  if (input.editionIdentifiers !== undefined && !isPlainRecord(input.editionIdentifiers)) {
    throw codedError('LIBRARY_SOURCE_PACK_SCHEMA_INVALID', 'manual editionIdentifiers 必须是普通对象');
  }
  const workIdentifiers = contract.normalizeIdentifiers(input.workIdentifiers ?? {}, 'work.identifiers', { entityKind: 'work' });
  const editionIdentifiers = contract.normalizeIdentifiers(input.editionIdentifiers ?? {}, 'edition.identifiers', { entityKind: 'edition' });
  const resourceId = hashId('resource', { providerId: 'manual-https', url: url });
  const fallback = { providerId: 'manual-https', resourceId: resourceId };
  const workId = contract.deriveWorkId(Object.values(workIdentifiers).some(function (items) { return items.length; })
    ? { identifiers: workIdentifiers } : Object.assign({ identifiers: workIdentifiers }, fallback));
  const editionId = contract.deriveEditionId(Object.values(editionIdentifiers).some(function (items) { return items.length; })
    ? { identifiers: editionIdentifiers } : Object.assign({ identifiers: editionIdentifiers }, fallback));
  const offer = {
    providerId: 'manual-https',
    resourceId: resourceId,
    editionId: editionId,
    format: format,
    transport: 'https',
    size: null,
    checksum: '',
    infoHash: '',
    sourceUrl: url,
    acquisitionRef: '',
    selectableFiles: [],
  };
  offer.offerId = contract.deriveOfferId(offer);
  return contract.normalizeCandidate({
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: hashId('candidate', { providerId: 'manual-https', resourceId: resourceId }),
    work: {
      workId: workId,
      title: title,
      authors: normalizedAuthors,
      languages: language ? [language] : [],
      subjects: [],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId: editionId,
      title: title,
      language: language,
      publisher: '',
      publishedAt: '',
      identifiers: editionIdentifiers,
      description: '',
    }],
    offers: [offer],
    rights: {
      status: 'unknown',
      licenseId: '',
      rightsStatement: '',
      jurisdiction: '',
      evidenceUrl: '',
      assertedBy: 'manual-user-input',
      checkedAt: nowIso(input.observedAt),
      confidence: null,
    },
    provenance: [{
      providerId: 'manual-https',
      resourceId: resourceId,
      pageUrl: '',
      observedAt: nowIso(input.observedAt),
      adapterVersion: 'manual-https-v1',
    }],
  });
}

module.exports = {
  OPDS1_ACCEPT,
  OPDS2_ACCEPT,
  GUTENBERG_ROOT,
  GUTENBERG_SEARCH,
  GUTENBERG_TERMS,
  GUTENBERG_ROBOT,
  MIME_FORMATS,
  parseOpds1,
  parseOpds2,
  candidateFromEntry,
  OpdsLibrarySourceAdapter,
  GutenbergLibrarySourceAdapter,
  createManualHttpsCandidate,
  _forTests: {
    parseIdentifierClaims,
    safeResolvedUrl,
    validateSearchTemplate,
    searchUrl,
    openAcquisition,
    formatForLink,
    gutenbergRightsConflict,
  },
};
