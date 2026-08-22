import assert from 'node:assert/strict';
import { buildMangaBook } from '../../renderer/modules/library/manga.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error?.stack || error}`);
  }
}

console.log('\nLibrary Manga Folder · fail-closed directory ownership');

await test('a failed root read remains a read failure, not an empty book', async () => {
  const expected = Object.assign(new Error('access denied'), { code: 'EACCES' });
  globalThis.window = {
    mazz: { invoke: async () => { throw expected; } },
  };
  await assert.rejects(() => buildMangaBook('D:/manga'), error => error === expected);
});

await test('a failed child chapter read rejects the whole candidate instead of committing a partial book', async () => {
  const calls = [];
  const expected = Object.assign(new Error('bridge temporarily unavailable'), { code: 'EIO' });
  globalThis.window = {
    mazz: {
      invoke: async (_channel, { path }) => {
        calls.push(`${_channel}:${path}`);
        if (_channel === 'fs:stat') return { exists: true, isDir: true, mtime: 1 };
        if (path === 'D:/manga') return [
          { name: '001.jpg', path: 'D:/manga/001.jpg', isDir: false },
          { name: 'chapter-02', path: 'D:/manga/chapter-02', isDir: true },
        ];
        if (path === 'D:/manga/chapter-02') throw expected;
        return [];
      },
    },
  };
  await assert.rejects(() => buildMangaBook('D:/manga'), error => error === expected);
  assert.deepEqual(calls, [
    'fs:stat:D:/manga',
    'fs:listDir:D:/manga',
    'fs:stat:D:/manga',
    'fs:listDir:D:/manga',
    'fs:stat:D:/manga',
    'fs:stat:D:/manga/chapter-02',
    'fs:listDir:D:/manga/chapter-02',
  ]);
});

await test('a child removed between enumeration and read cannot shorten the committed book', async () => {
  let childStatReads = 0;
  globalThis.window = {
    mazz: {
      invoke: async (channel, { path }) => {
        if (channel === 'fs:stat') {
          if (path === 'D:/manga/chapter-02') {
            childStatReads++;
            return childStatReads === 1
              ? { exists: true, isDir: true, mtime: 1 }
              : { exists: false, isDir: false, code: 'ENOENT' };
          }
          return { exists: true, isDir: true, mtime: 1 };
        }
        if (path === 'D:/manga') return [
          { name: '001.jpg', path: 'D:/manga/001.jpg', isDir: false },
          { name: 'chapter-02', path: 'D:/manga/chapter-02', isDir: true },
        ];
        return [];
      },
    },
  };
  await assert.rejects(
    () => buildMangaBook('D:/manga'),
    error => error?.code === 'LIBRARY_SOURCE_CHANGED' && error?.sourceCode === 'ENOENT',
  );
});

await test('a successful empty listing is still classified as an empty book', async () => {
  globalThis.window = {
    mazz: {
      invoke: async channel => channel === 'fs:stat'
        ? { exists: true, isDir: true, mtime: 1 }
        : [],
    },
  };
  await assert.rejects(() => buildMangaBook('D:/empty'), /文件夹为空或不可读/);
});

console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed) process.exit(1);
