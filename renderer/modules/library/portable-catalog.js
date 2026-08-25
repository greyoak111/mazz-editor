const clone = value => JSON.parse(JSON.stringify(value));

export async function portableSnapshot(repository) {
  const [books, categories, progress, bookmarks] = await Promise.all([
    repository.listBooks(),
    repository.getValue('categories'),
    repository.getValue('progress'),
    repository.getValue('bookmarks'),
  ]);
  return Object.freeze({
    books: clone(books),
    categories: clone(categories || []),
    progress: clone(progress || {}),
    bookmarks: clone(bookmarks || {}),
  });
}

export async function savePortableCatalog({ invoke, repository }) {
  if (typeof invoke !== 'function' || !repository?.identity?.canonical) throw new TypeError('portable catalog binding invalid');
  return invoke('library:portableCatalogSave', {
    workspacePath: repository.identity.canonical,
    snapshot: await portableSnapshot(repository),
  });
}

export async function restorePortableCatalog({ invoke, repository }) {
  if (typeof invoke !== 'function' || !repository?.identity?.canonical) throw new TypeError('portable catalog binding invalid');
  const current = await repository.listBooks();
  if (current.length) return Object.freeze({ restored: false, existing: true, books: current });
  const rebuilt = await invoke('library:portableCatalogRebuild', {
    workspacePath: repository.identity.canonical,
  });
  if (!Array.isArray(rebuilt?.books) || !rebuilt.books.length) {
    return Object.freeze({ restored: false, existing: false, books: [] });
  }
  const receipt = await repository.restorePortableSnapshot(rebuilt);
  return Object.freeze({ ...receipt, rebuilt });
}

export async function repairPortableCatalog({ invoke, repository }) {
  if (typeof invoke !== 'function' || !repository?.identity?.canonical) throw new TypeError('portable catalog binding invalid');
  const rebuilt = await invoke('library:portableCatalogRebuild', {
    workspacePath: repository.identity.canonical,
  });
  if (!Array.isArray(rebuilt?.books)) return Object.freeze({ repaired: 0, missing: 0, ambiguous: 0 });
  const byId = new Map(rebuilt.books.map(book => [book.id, book]));
  let repaired = 0;
  const receipt = await repository.mutateBooks(books => books.map(book => {
    const next = byId.get(book.id);
    if (!next) return book;
    const changed = book.path !== next.path || book.sourceHash !== next.sourceHash
      || book.missing !== next.missing || book.repairConflict !== next.repairConflict;
    if (changed) repaired++;
    return { ...book, path: next.path, sourcePath: next.sourcePath,
      sourceHash: next.sourceHash, missing: next.missing,
      ...(next.repairConflict ? { repairConflict: true } : { repairConflict: undefined }) };
  }));
  return Object.freeze({ repaired, missing: rebuilt.missing || 0, ambiguous: rebuilt.ambiguous || 0,
    books: receipt.value, rebuilt });
}

export function createPortableCatalogCheckpoint({ invoke, repository, canUse = () => true, track = value => value }) {
  let requested = false;
  let running = null;
  const drain = async () => {
    do {
      requested = false;
      if (!canUse()) return null;
      await savePortableCatalog({ invoke, repository });
    } while (requested && canUse());
    return true;
  };
  return Object.freeze({
    request() {
      requested = true;
      if (!running) {
        running = Promise.resolve().then(drain).finally(() => { running = null; });
        track(running);
      }
      return running;
    },
    flush() { return running || (requested ? this.request() : Promise.resolve(true)); },
    snapshot() { return Object.freeze({ requested, running: !!running, timerCount: 0 }); },
  });
}
