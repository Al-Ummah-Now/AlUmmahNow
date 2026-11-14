import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rootLocaleRedirect } from '../src/lib/seo/root-locale';

describe('admin root-locale hop', () => {
  it('never redirects the admin root (no locale prefix in admin)', () => {
    const req = new Request('https://admin.alummahnow.net/', { headers: { 'accept-language': 'ar', cookie: 'preferred-language=ar' } });
    assert.equal(rootLocaleRedirect(req), null);
  });
});
