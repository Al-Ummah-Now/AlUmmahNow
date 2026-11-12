import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assetFile, assetsHandler } from '../assets.ts';

const dir = mkdtempSync(join(tmpdir(), 'stack-assets-'));
mkdirSync(join(dir, '_next/static/chunks'), { recursive: true });
writeFileSync(join(dir, '_next/static/chunks/a b.css'), 'body{}');
writeFileSync(join(dir, 'favicon.ico'), 'ico');

test('serves files under the directory with their type', async () => {
  const res = assetsHandler(dir)(new Request('https://assets.local/_next/static/chunks/a%20b.css'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(await res.text(), 'body{}');
});

test('404 for missing files and directories, 405 for writes', () => {
  const handler = assetsHandler(dir);
  assert.equal(handler(new Request('https://assets.local/_next/static/chunks/missing.js')).status, 404);
  assert.equal(handler(new Request('https://assets.local/_next/static')).status, 404);
  assert.equal(handler(new Request('https://assets.local/favicon.ico', { method: 'POST', body: 'x' })).status, 405);
});

test('never leaves the directory', () => {
  assert.equal(assetFile(dir, '/../../etc/passwd'), null);
  assert.equal(assetFile(dir, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(assetFile(dir, '/%E0%A4%A'), null);
});

test('HEAD has headers and no body', async () => {
  const res = assetsHandler(dir)(new Request('https://assets.local/favicon.ico', { method: 'HEAD' }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});
