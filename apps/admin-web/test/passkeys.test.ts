/**
 * Staff passkeys in admin-web (wiki AUTH-PASSKEYS): the session token's rule,
 * admin-api's passkey_required / step_up_required answers, the sign-in with
 * max_age, and the "Passkey needed" page and grace banner in en and ar.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { PasskeyNeeded } from '../src/components/PasskeyNeeded';
import { PasskeyGraceBanner } from '../src/components/PasskeyGraceBanner';
import {
  adminSetupUrl,
  formatPasskeyDeadline,
  passkeyNeededPath,
  passkeyRedirectFor,
  passkeySignInPath,
  pathOfPageUrl,
  sessionPasskeyGate,
  stepUpLoginPath,
} from '../src/lib/passkeys';
import { loginDecision, loginPath, parseMaxAge, startPath, withLoginParams } from '../src/lib/login-flow';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

// Typed as plain function components (the linked @types/react differ between JSX and createElement)
const Needed = PasskeyNeeded as unknown as React.FC<Parameters<typeof PasskeyNeeded>[0]>;
const Banner = PasskeyGraceBanner as unknown as React.FC<Parameters<typeof PasskeyGraceBanner>[0]>;

const NOW = 1_800_000_000;

function token(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}
const staffToken = (extra: Record<string, unknown> = {}, properties: Record<string, unknown> = {}) =>
  token({ mode: 'access', type: 'user', auth_time: NOW - 60, ...extra, properties: { id: 'usr_1', email: 'a@b.c', roles: ['Admin'], ...properties } });

describe('sessionPasskeyGate', () => {
  it('is ok without a deadline (enforcement off) and for old tokens without amr', () => {
    assert.deepEqual(sessionPasskeyGate(staffToken(), NOW), { state: 'ok' });
  });
  it('is grace before the deadline and blocked from it, without a passkey', () => {
    assert.deepEqual(sessionPasskeyGate(staffToken({ amr: ['pwd'] }, { passkey_deadline: NOW + 10 }), NOW), { state: 'grace', deadline: NOW + 10 });
    assert.deepEqual(sessionPasskeyGate(staffToken({ amr: ['pwd'] }, { passkey_deadline: NOW }), NOW), { state: 'blocked', deadline: NOW });
    assert.deepEqual(sessionPasskeyGate(staffToken({}, { passkey_deadline: NOW - 10 }), NOW), { state: 'blocked', deadline: NOW - 10 });
  });
  it('is ok with a passkey sign-in, and for non-staff', () => {
    assert.deepEqual(sessionPasskeyGate(staffToken({ amr: ['passkey'] }, { passkey_deadline: NOW - 10 }), NOW), { state: 'ok' });
    assert.deepEqual(sessionPasskeyGate(staffToken({ amr: ['pwd'] }, { roles: ['Scholar'], passkey_deadline: NOW - 10 }), NOW), { state: 'ok' });
  });
  it('is ok for a token it cannot read', () => {
    assert.deepEqual(sessionPasskeyGate('garbage', NOW), { state: 'ok' });
  });
});

describe('admin-api answers', () => {
  it('passkey_required opens the page, coming back to the page the action ran on', () => {
    assert.equal(passkeyRedirectFor({ status: 403, code: 'passkey_required' }, '/users/u1'), '/passkey-needed?return=%2Fusers%2Fu1&reason=step_up');
  });
  it('step_up_required reopens sign-in with prompt=login&max_age=900', () => {
    assert.equal(passkeyRedirectFor({ status: 401, code: 'step_up_required' }, '/users/u1'), '/login?return=%2Fusers%2Fu1&prompt=login&max_age=900');
    assert.equal(stepUpLoginPath(null), '/login?return=%2Fdashboard&prompt=login&max_age=900');
  });
  it('anything else is an ordinary error', () => {
    assert.equal(passkeyRedirectFor({ status: 403, code: 'forbidden' }, '/x'), null);
    assert.equal(passkeyRedirectFor({ status: 401 }, '/x'), null);
    assert.equal(passkeyRedirectFor(null, '/x'), null);
  });
  it('takes the return path only from a same-origin page URL', () => {
    assert.equal(pathOfPageUrl('https://admin.qa.alummahnow.net/users/u1?tab=a', 'https://admin.qa.alummahnow.net'), '/users/u1?tab=a');
    assert.equal(pathOfPageUrl('https://evil.example/users', 'https://admin.qa.alummahnow.net'), null);
    assert.equal(pathOfPageUrl(null), null);
  });
  it('never loops the page into its own return path', () => {
    assert.equal(passkeyNeededPath('/passkey-needed?reason=step_up'), '/passkey-needed');
  });
});

describe('sign-in links', () => {
  it('"Sign in with a passkey" forces the form and comes back', () => {
    assert.equal(passkeySignInPath('/reports'), '/login?return=%2Freports&prompt=login');
  });
  it('"Add a passkey" goes to Auth and comes back to the sign-in', () => {
    const url = new URL(adminSetupUrl('https://auth.qa.alummahnow.net', 'https://admin.qa.alummahnow.net', '/reports'));
    assert.equal(url.origin + url.pathname, 'https://auth.qa.alummahnow.net/passkeys/setup');
    assert.equal(url.searchParams.get('return_to'), 'https://admin.qa.alummahnow.net/login?return=%2Freports&prompt=login');
  });
  it('max_age is carried from /login to /authorize', () => {
    assert.equal(parseMaxAge('900'), 900);
    assert.equal(parseMaxAge('-1'), undefined);
    assert.equal(parseMaxAge('9e9'), undefined);
    assert.equal(parseMaxAge('999999'), undefined);
    assert.equal(loginPath('/x', 'login', 900), '/login?return=%2Fx&prompt=login&max_age=900');
    // A signed-in admin asked for max_age still goes to the auth server
    assert.deepEqual(loginDecision({ authenticated: true, maxAge: 900, returnTo: '/x' }), { kind: 'authorize', prompt: undefined, returnTo: '/x', maxAge: 900 });
    assert.deepEqual(loginDecision({ authenticated: true, returnTo: '/x' }), { kind: 'continue', to: '/x' });
    assert.equal(startPath('login', '/x', 900), '/api/auth/start?return=%2Fx&prompt=login&max_age=900');
    const authorize = new URL(withLoginParams('https://auth.qa.alummahnow.net/authorize?client_id=c&max_age=5', 'login', '/x', 'n'.repeat(32), 900));
    assert.equal(authorize.searchParams.get('max_age'), '900');
    assert.equal(authorize.searchParams.get('prompt'), 'login');
    assert.equal(new URL(withLoginParams('https://auth.qa.alummahnow.net/authorize?max_age=5', undefined, '/x', 'n'.repeat(32))).searchParams.get('max_age'), null);
  });
});

function withI18n(locale: 'en' | 'ar', element: React.ReactElement): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string | null; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: null }, element));
}

describe('"Passkey needed" page and grace banner', () => {
  const props = {
    title: en.passkeys.neededTitle,
    body: 'b',
    why: en.passkeys.why,
    email: 'Signed in as a@b.c',
    setupUrl: 'https://auth.qa.alummahnow.net/passkeys/setup?return_to=x',
    signInPath: '/login?prompt=login',
    backPath: null,
    labels: { add: en.passkeys.add, signIn: en.passkeys.signIn, back: en.passkeys.back, logout: en.common.logout },
  };

  it('offers Add a passkey and Sign in with a passkey as links, and sign out as a form', () => {
    const html = renderToStaticMarkup(React.createElement(Needed, props));
    assert.match(html, /href="https:\/\/auth\.qa\.alummahnow\.net\/passkeys\/setup\?return_to=x"[^>]*data-testid="passkey-add">Add a passkey</);
    assert.match(html, /Sign in with a passkey/);
    assert.match(html, /href="\/login\?prompt=login"/);
    assert.match(html, /action="\/api\/logout"/);
    assert.doesNotMatch(html, /passkey-back/);
    assert.doesNotMatch(html, /confirm\(|alert\(|prompt\(/);
  });

  it('shows Back for a step-up and hides Add without an issuer', () => {
    const html = renderToStaticMarkup(React.createElement(Needed, { ...props, setupUrl: null, backPath: '/reports' }));
    assert.match(html, /data-testid="passkey-back"/);
    assert.doesNotMatch(html, /passkey-add/);
  });

  it('has every string in en and ar, with the date placeholder kept', () => {
    for (const key of Object.keys(en.passkeys) as (keyof typeof en.passkeys)[]) {
      assert.ok(ar.passkeys[key], key);
      assert.equal(en.passkeys[key].includes('{date}'), ar.passkeys[key].includes('{date}'), key);
    }
  });

  it('renders the banner in English and Arabic with the deadline', () => {
    const deadline = Date.UTC(2026, 10, 20, 12) / 1000;
    const html = withI18n('en', React.createElement(Banner, { deadline, setupUrl: 'https://auth/x' }));
    assert.match(html, /Add a passkey by .*2026/);
    assert.match(html, /role="status"/);
    assert.match(html, /Dismiss/);
    const arHtml = withI18n('ar', React.createElement(Banner, { deadline, setupUrl: null }));
    assert.match(arHtml, /أضف مفتاح مرور قبل/);
    assert.match(arHtml, /إخفاء/);
    assert.doesNotMatch(arHtml, /passkey-grace-add/);
    assert.notEqual(formatPasskeyDeadline(deadline, 'ar'), formatPasskeyDeadline(deadline, 'en'));
  });
});
