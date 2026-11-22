/**
 * Tier requests queue (wiki AUN-TIER-REQUESTS): the URL filter and links, the
 * email states, who a card names, decision failures in the admin's words,
 * every label in English and Arabic, and the rendered Approve / Decline.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { ADMIN_TIER_REQUEST_FILTERS, TIER_REQUEST_STATUSES } from '@al-ummah/shared-types';
import { decisionFailure, emailTone, parseTierRequestFilter, requesterName, tierRequestsHref } from '../src/lib/tier-requests';
import { NAV_ITEMS } from '../src/components/shell/nav-model';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { TierRequestActions } from '../src/components/tier-requests/TierRequestActions';
import { AllowRequestsSwitch } from '../src/components/tier-requests/AllowRequestsSwitch';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;
const ARABIC = /[؀-ۿ]/;
const noop = async () => ({ ok: true as const, data: null });
const EMAIL_STATUSES = ['queued', 'sent', 'sunk', 'disabled', 'no_address', 'failed'] as const;

describe('tier requests queue', () => {
  it('reads ?filter= (pending by default) and builds tab and next-page links', () => {
    assert.equal(parseTierRequestFilter(undefined), 'pending');
    assert.equal(parseTierRequestFilter('declined'), 'declined');
    assert.equal(parseTierRequestFilter('withdrawn'), 'pending', 'withdrawn requests are only in All');
    assert.equal(tierRequestsHref('pending'), '/tier-requests');
    assert.equal(tierRequestsHref('all', 'abc=='), '/tier-requests?filter=all&cursor=abc%3D%3D');
    assert.equal(tierRequestsHref('pending', 'n1'), '/tier-requests?cursor=n1');
  });

  it('shows the decision email as still going, done, nothing to send, or failed', () => {
    assert.equal(emailTone(null), null);
    assert.deepEqual(EMAIL_STATUSES.map(emailTone), ['progress', 'done', 'done', 'none', 'none', 'failed']);
  });

  it('names the person by their profile, else the name they typed', () => {
    assert.equal(requesterName({ displayName: 'Amina K', name: 'Amina' }), 'Amina K');
    assert.equal(requesterName({ displayName: null, name: 'Amina' }), 'Amina');
  });

  it('turns a refused decision into the right message', () => {
    assert.equal(decisionFailure({ status: 409, code: 'tier_request_not_pending' }), 'alreadyDecided');
    assert.equal(decisionFailure({ status: 403 }), 'readOnly');
    assert.equal(decisionFailure({ status: 500 }), 'failed');
  });

  it('labels every status, tab and email state in English and Arabic', () => {
    for (const [values, group] of [
      [TIER_REQUEST_STATUSES, 'status'],
      [ADMIN_TIER_REQUEST_FILTERS, 'filters'],
      [EMAIL_STATUSES, 'email'],
    ] as const) {
      for (const v of values) {
        const enLabel = (en.tierRequests[group] as Record<string, string>)[v];
        const arLabel = (ar.tierRequests[group] as Record<string, string>)[v];
        assert.ok(enLabel, `en ${group}.${v}`);
        assert.match(arLabel ?? '', ARABIC, `ar ${group}.${v}`);
      }
    }
  });

  it('is in the People group with a pending badge, for every admin role', () => {
    const item = NAV_ITEMS.find((i) => i.href === '/tier-requests');
    assert.ok(item);
    assert.deepEqual([item.group, item.badge, item.requires, item.badgeTestId], ['people', 'tierRequests', undefined, 'tier-requests-nav-badge']);
  });

  it('renders Approve (the main action) and Decline with their confirmations, in English and Arabic', () => {
    const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
    const render = (locale: 'en' | 'ar') =>
      renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(TierRequestActions as unknown as React.FC<Record<string, unknown>>, { id: 'tr1', name: 'Amina', tier: 'Creator', actions: { approve: noop, decline: noop } })) as never);
    const html = render('en');
    assert.match(html, /data-testid="tier-request-approve-tr1"[^>]*>Approve</);
    assert.match(html, /bg-accent[^"]*"[^>]*data-testid="tier-request-approve-tr1"/);
    assert.match(html, /data-testid="tier-request-decline-tr1"[^>]*>Decline</);
    assert.match(html, /Give Amina the Creator tier\?/);
    assert.match(html, /maxLength="500"/);
    assert.match(render('ar'), /موافقة/);
  });
});

describe('Allow tier requests (the Upgrade page mode)', () => {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  const noop = async () => ({ ok: true as const, data: { previous: true, allowed: true, mode: 'request' } });
  const html = (props: Record<string, unknown>, locale = 'en') =>
    renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(AllowRequestsSwitch as unknown as React.FC<Record<string, unknown>>, { canManage: true, setAllowed: noop, ...props })) as never);

  it('says what the Upgrade page does in each of the three states', () => {
    assert.match(html({ allowed: true, providerEnabled: false }), /data-mode="request"[\s\S]*shows the request form/);
    // Closed: the Upgrade page is an off feature (owner decision 2026-11-19, O37)
    assert.match(html({ allowed: false, providerEnabled: false }), /data-mode="closed"[\s\S]*don’t see the Upgrade page or any link to it/);
    assert.match(html({ allowed: true, providerEnabled: true }), /data-mode="pay"[\s\S]*sells tiers, and requests are off/);
    assert.match(html({ allowed: false, providerEnabled: false }, 'ar'), /الطلبات متوقفة/);
  });

  it('is read-only without creators:manage', () => {
    assert.match(html({ allowed: true, providerEnabled: false, canManage: false }), /disabled=""[^>]*data-testid="tier-requests-allow-switch"|data-testid="tier-requests-allow-switch"[^>]*disabled=""/);
  });
});

