import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('server/hub-origin.js'), 'utf8');

test('W94Gc origin is localhost-bound, body-capped, and publication-disabled by default', () => {
  assert.match(source, /server\.listen\(PORT, '127\.0\.0\.1'/);
  assert.match(source, /MAX_BODY_BYTES = 4 \* 1024 \* 1024/);
  assert.match(source, /MAZZ_HUB_PUBLIC_EFFECT === '1'/);
  assert.match(source, /HUB_PUBLIC_EFFECT_DISABLED/);
  assert.match(source, /publicationEffect: PUBLIC_EFFECT \? 'explicit-grant-only' : 'disabled-staging'/);
  assert.match(fs.readFileSync(path.resolve('deploy/mazz-hub/mazz-hub.service'), 'utf8'), /ProtectSystem=strict/);
  assert.match(fs.readFileSync(path.resolve('deploy/mazz-hub/mazz-hub.service'), 'utf8'), /ReadWritePaths=\/var\/lib\/mazz-hub/);
});
