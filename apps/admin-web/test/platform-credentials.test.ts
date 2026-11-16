/**
 * Platform settings → Credentials (Super Admin): the editor's rules (state, token check, plain-words
 * copy for each missing Cloudflare permission, friendly errors) and the rendered section in en and
 * ar. Never a value: Replace opens an empty password field, and the page shows only the last four.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { CLOUDFLARE_MEDIA_CHECKS, type PlatformCredentialView } from '@al-ummah/shared-types';
import { CHECK_COPY, createErrorKey, credentialState, previousTokenNotice, saveErrorKey, testSummary, tokenError } from '../src/lib/platform-credentials';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { PlatformCredentialsSetting } from '../src/app/(protected)/platform-settings/PlatformCredentialsSetting';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789-_QZ';
const AT = '2026-11-16T10:00:00.000Z';
const view = (over: Partial<PlatformCredentialView> = {}): PlatformCredentialView => ({
  id: 'cloudflare-media',
  secretsStoreName: 'media-cdn-api-token',
  usedBy: [
    { worker: 'api-videos', binding: 'MEDIA_CDN_API_TOKEN' },
    { worker: 'api-videos', binding: 'MEDIA_ANALYTICS_TOKEN' },
    { worker: 'admin-api', binding: 'CF_ANALYTICS_TOKEN' },
  ],
  source: 'binding',
  present: true,
  last4: null,
  updatedAt: null,
  updatedBy: null,
  updatedByName: null,
  unreadable: false,
  test: null,
  mintable: true,
  canMint: false,
  minted: null,
  ...over,
});
const managerView = (over: Partial<PlatformCredentialView> = {}): PlatformCredentialView =>
  view({ id: 'cloudflare-token-manager', secretsStoreName: 'cloudflare-token-manager', usedBy: [{ worker: 'admin-api', binding: 'CF_TOKEN_MANAGER' }], mintable: false, source: null, present: false, ...over });
const allOk = { ok: true, code: 'ok', checks: CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: true })), at: AT, by: 'super-1' };
const missing = { ok: false, code: 'missing_permissions', checks: CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: name === 'token' || name === 'account_analytics' })), at: AT, by: 'super-1' };

const stub = async () => ({ ok: true as const, data: { view: view(), test: allOk, previousRevoked: false, previousKept: null } });

function render(views: PlatformCredentialView[], locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(PlatformCredentialsSetting as unknown as React.FC<{ views: PlatformCredentialView[]; replace: typeof stub; test: typeof stub; create: typeof stub }>, { views, replace: stub, test: stub, create: stub })) as never);
}

describe('credentials: editor rules', () => {
  it('says whether the token is missing, untested, working or needs attention', () => {
    assert.equal(credentialState(view({ present: false, source: null })), 'missing');
    assert.equal(credentialState(view()), 'untested');
    assert.equal(credentialState(view({ test: allOk })), 'ok');
    assert.equal(credentialState(view({ test: missing })), 'attention');
    assert.equal(credentialState(view({ unreadable: true, test: allOk })), 'attention');
  });

  it('checks the token before sending it', () => {
    assert.equal(tokenError(''), 'platformCredentials.errorEmpty');
    assert.equal(tokenError('not a token'), 'platformCredentials.errorToken');
    assert.equal(tokenError(TOKEN), null);
    assert.equal(saveErrorKey(403), 'platformCredentials.errorForbidden');
    assert.equal(saveErrorKey(503), 'platformCredentials.errorUnavailable');
    assert.equal(saveErrorKey(500, 'boom'), 'platformCredentials.errorFailed');
    assert.equal(testSummary('missing_permissions'), 'platformCredentials.testMissing');
    assert.equal(testSummary('weird'), 'platformCredentials.testUnreachable');
  });

  it('names each permission in Cloudflare\'s own words and says what stops working', () => {
    const t = createTranslator('en');
    assert.match(t(CHECK_COPY.cache_purge.permission), /Zone → Cache\sPurge → Purge for alummahnow\.net/);
    assert.match(t(CHECK_COPY.zone_analytics.permission), /Zone → Analytics → Read/);
    assert.match(t(CHECK_COPY.account_analytics.permission), /Account → Account\sAnalytics → Read/);
    assert.match(t(CHECK_COPY.cache_purge.impact), /private can stay cached/);
  });

  it('has every string in English and Arabic, with «مرئي» and Arabic digits', () => {
    const enKeys = Object.keys(en.platformCredentials).sort();
    assert.deepEqual(Object.keys(ar.platformCredentials).sort(), enKeys);
    for (const key of enKeys) assert.match((ar.platformCredentials as Record<string, string>)[key]!, /[؀-ۿ]/, key);
    // Product names (R2) keep their digit; every number in the copy is in Arabic digits
    assert.doesNotMatch(JSON.stringify(ar.platformCredentials).replace(/R2|\{#?[\w.]+\}/g, ''), /فيديو|[0-9]/);
  });
});

describe('credentials: the section', () => {
  it('shows the Secrets Store source with Replace and Test, and no value anywhere', () => {
    const html = render([view()]);
    assert.match(html, /data-testid="credential-cloudflare-media"[^>]*data-state="untested"/);
    assert.match(html, /From the Cloudflare Secrets\sStore entry/);
    assert.match(html, /media-cdn-api-token/);
    assert.match(html, /data-testid="credential-cloudflare-media-replace"/);
    assert.match(html, /data-testid="credential-cloudflare-media-run-test"/);
    assert.match(html, /Not tested yet/);
    assert.doesNotMatch(html, /type="password"/, 'the field only opens on Replace');
  });

  it('shows a token set here with its last four, and each missing permission in plain words', () => {
    const html = render([view({ source: 'admin', last4: 'Q_ZZ', updatedAt: AT, updatedBy: 'super-1', updatedByName: 'Mahmoud', test: missing })]);
    assert.match(html, /Set here on .* by .*Ends in …Q_ZZ\./);
    assert.doesNotMatch(html, /by super-1/, 'never the id as the name');
    assert.match(html, /data-state="attention"/);
    assert.match(html, /The token works, but some permissions are missing/);
    assert.match(html, /data-testid="credential-check-cache_purge" data-ok="false"/);
    assert.match(html, /Add Zone → Cache\sPurge → Purge for alummahnow\.net\./);
    assert.match(html, /data-testid="credential-check-account_analytics" data-ok="true"/);
    assert.doesNotMatch(html, /Add Account → Account\sAnalytics/, 'a passed check gives no advice');
  });

  it('a missing token offers Add and cannot be tested; an unreadable one asks to set it again', () => {
    const missingHtml = render([view({ present: false, source: null })]);
    assert.match(missingHtml, />Add token</);
    assert.match(missingHtml, /data-testid="credential-cloudflare-media-run-test"[^>]*disabled|disabled[^>]*data-testid="credential-cloudflare-media-run-test"/);
    assert.match(render([view({ unreadable: true })]), /can no longer be read/);
  });

  it('offers Rotate only with a token manager, and says where to add one otherwise', () => {
    const without = render([view(), managerView()]);
    assert.doesNotMatch(without, /data-testid="credential-cloudflare-media-create"/);
    assert.match(without, /Add the Cloudflare token manager below to create and rotate this token here\./);
    assert.match(without, /data-testid="credential-cloudflare-token-manager"/);
    assert.match(without, /API\sTokens: Edit and Secrets\sStore: Edit/);
    assert.doesNotMatch(without, /data-testid="credential-cloudflare-token-manager-create"/, 'the manager itself is never minted here');
    const withManager = render([view({ canMint: true }), managerView({ present: true, source: 'binding' })]);
    assert.match(withManager, /data-testid="credential-cloudflare-media-create"[^>]*>Rotate</);
    assert.match(withManager, /shared by QA, stage and production/);
    assert.match(render([view({ canMint: true, present: false, source: null })]), />Create token</);
    const minted = render([view({ canMint: true, minted: { tokenId: 't1', at: AT, by: 'super-1', byName: 'Mahmoud', previousTokenId: null, previousRevoked: false } })]);
    assert.match(minted, /Created here on .* by /);
  });

  it('says why Create failed and what happened to the previous token, in plain words', () => {
    const t = createTranslator('en');
    assert.match(t(createErrorKey(409, 'manager_cannot_mint')), /give it API\sTokens: Edit/);
    assert.match(t(createErrorKey(502, 'minted_token_failed')), /deleted and nothing was changed/);
    assert.match(t(createErrorKey(502, 'store_refused')), /Secrets\sStore: Edit/);
    assert.match(t(previousTokenNotice(false, 'not_minted_here')), /made by hand, so it was kept/);
    assert.match(t(previousTokenNotice(true, null)), /previous one was revoked/);
    assert.match(t(CHECK_COPY.mint_tokens.permission), /API\sTokens → Edit/);
  });

  it('renders right to left in Arabic', () => {
    const html = render([view({ test: allOk })], 'ar');
    assert.match(html, /رمز Cloudflare للوسائط/);
    assert.match(html, /كل الصلاحيات التي تحتاجها خدماتنا موجودة/);
  });
});
