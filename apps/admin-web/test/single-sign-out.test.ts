import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGN_IN_COOKIES, singleSignOutNext, startSingleSignOut } from '../src/lib/single-sign-out';

const ISSUER = 'https://auth.qa.alummahnow.net';
const APP = 'https://admin.qa.alummahnow.net';

describe('admin single sign-out (#295)', () => {
  it('log out starts at the auth server and comes back to admin', () => {
    const url = new URL(startSingleSignOut(ISSUER, `${APP}/`));
    assert.equal(url.origin + url.pathname, `${ISSUER}/logout`);
    assert.equal(url.searchParams.get('return'), `${APP}/`);
  });

  it('the front-channel step follows next back to the auth server', () => {
    const next = `${ISSUER}/logout?step=4&return=${encodeURIComponent('https://videos.qa.alummahnow.net/en')}`;
    assert.equal(singleSignOutNext(ISSUER, new URLSearchParams({ next }), APP), next);
  });

  it('never follows next anywhere else (no open redirect)', () => {
    for (const next of ['https://evil.example/logout', `${ISSUER}/authorize`, '//evil.example', 'not a url']) {
      const url = new URL(singleSignOutNext(ISSUER, new URLSearchParams({ next }), APP));
      assert.equal(url.origin + url.pathname, `${ISSUER}/logout`);
      assert.equal(url.searchParams.get('return'), `${APP}/`);
    }
  });

  it('restores a next whose query was split by a decoded %26 (OpenNext)', () => {
    const query = new URLSearchParams();
    query.set('next', `${ISSUER}/logout?step=4`);
    query.set('return', `${APP}/`);
    const url = new URL(singleSignOutNext(ISSUER, query, APP));
    assert.equal(url.searchParams.get('step'), '4');
    assert.equal(url.searchParams.get('return'), `${APP}/`);
  });

  it('clears every cookie that carries admin credentials', () => {
    assert.deepEqual([...SIGN_IN_COOKIES].sort(), ['access_token', 'admin_session', 'refresh_token']);
  });
});
