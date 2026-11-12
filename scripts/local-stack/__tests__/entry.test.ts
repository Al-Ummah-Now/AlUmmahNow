import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { workerFirstPattern, assetsFirstEntry } from '../entry.ts';

describe('assets-first entry', () => {
  it('turns run_worker_first globs into anchored patterns', () => {
    const re = new RegExp(workerFirstPattern('/_next/static/*'));
    assert.ok(re.test('/_next/static/chunks/a.js'));
    assert.ok(!re.test('/brand/logo-64.webp'));
  });
  it('serves assets first except worker-first paths', () => {
    const src = assetsFirstEntry('./index.js', 'ASSETS', ['/_next/static/*', '!/_next/static/x']);
    assert.match(src, /env\["ASSETS"\]\.fetch\(request\)/);
    assert.match(src, /return worker\.fetch\(request, env, ctx\)/);
    assert.ok(!src.includes('!/_next'));
  });
});
