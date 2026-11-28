import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { duplicatePackage, packageToZip, validatePackage, zipToPackage, type ThemePackage } from '@al-ummah/theme-packages';
import { proxyThemeRequest } from '../src/lib/theme-proxy';

const target = 'https://admin-api.example.test/api/themes/import?newId=1';

test('the Worker proxy forwards a Fawanees duplicate with its real assets', async (t) => {
  const dir = fileURLToPath(new URL('../../../packages/theme-packages/themes/fawanees', import.meta.url));
  const source = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) as ThemePackage;
  const assets = Object.fromEntries(readdirSync(join(dir, 'assets'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(dir, path).replaceAll('\\', '/'), new Uint8Array(readFileSync(path))];
    }));
  const theme = duplicatePackage(source, 'fawanees', { en: 'Fawanees copy', ar: 'نسخة الفوانيس' }, 'admin');
  const archive = packageToZip({ theme, assets });
  assert.ok(Object.keys(assets).length > 0);

  const fetcher = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.redirect, 'manual'); // Workerd rejects redirect: 'error' before dispatch.
    assert.equal(url, target);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('content-type'), 'application/zip');
    const files = await zipToPackage(init.body as Uint8Array);
    assert.deepEqual(files.assets, assets);
    const validation = validatePackage(files.theme, { assets: files.assets });
    assert.deepEqual(validation.errors, []);
    return Response.json({ success: true }, { status: 201 });
  });

  const request = new Request('https://admin.example.test/api/themes/import?newId=1', {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(archive),
  });
  const response = await proxyThemeRequest(request, target, 'local-test-token');
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
});

test('the proxy returns an error for an upstream redirect', async (t) => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () =>
    Response.redirect('https://admin-api.example.test/moved', 307));
  const response = await proxyThemeRequest(new Request('https://admin.example.test/api/themes'), target, 'local-test-token');
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(fetcher.mock.calls[0]?.arguments[1]?.redirect, 'manual');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Location'), null);
  assert.deepEqual(await response.json(), { success: false, error: 'Admin API unreachable' });
});
