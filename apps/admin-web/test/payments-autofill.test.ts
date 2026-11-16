/**
 * Autofill on the admin Payments forms (owner 2026-11-16): the seller details carry the standard
 * tokens (organization, street-address, country) with names and labels inside a real form, the VAT
 * number has a plain label; a provider's API key is not a password: managers must not save or
 * generate one there.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// These components rely on the automatic JSX runtime; under tsx (classic) React must be in scope
(globalThis as unknown as { React: typeof React }).React = React;
import type { BillingTaxSettings, PaymentProviderConfig } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { TaxPanel } from '../src/components/payments/TaxPanel';
import { ProvidersPanel } from '../src/components/payments/ProvidersPanel';

function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}
const el = <P extends object>(c: (p: P) => unknown, p: P) => React.createElement(c as unknown as React.FC<P>, p);
/** The tag of the field with this name. */
const field = (html: string, name: string) => html.match(new RegExp(`<(?:input|textarea|select)[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
/** An attribute, case-insensitive like HTML (React's server render writes autoComplete) */
const attr = (tag: string, a: string) => tag.match(new RegExp(`\\s${a}="([^"]*)"`, 'i'))?.[1] ?? null;

const tax: BillingTaxSettings = { sellerName: 'Al Ummah Now', sellerAddress: '1 Example Street', sellerCountry: 'GB', taxId: 'GB123', pricesIncludeTax: true, taxRatePercent: null, updatedAt: null, updatedBy: null } as BillingTaxSettings;

describe('Payments forms autofill', () => {
  it('seller details: standard tokens in a seller section, names, labels, one form; VAT number has a plain label and no token', () => {
    const html = render(el(TaxPanel, { tax, canManage: true, onRefresh: async () => {} }));
    assert.equal((html.match(/<form/g) ?? []).length, 1);
    for (const [name, token] of [['organization', 'section-seller organization'], ['street-address', 'section-seller street-address'], ['country', 'section-seller country']] as const) {
      const tag = field(html, name);
      assert.ok(tag, `${name} field`);
      assert.equal(attr(tag, 'autocomplete'), token, name);
      assert.ok(html.includes(`for="${attr(tag, 'id')}"`), `${name} has a visible label`);
    }
    const vat = field(html, 'vat-number');
    assert.equal(attr(vat, 'autocomplete'), null, 'no token exists for a VAT number');
    assert.ok(html.includes('VAT number'));
    assert.equal(/autocomplete="off"/i.test(html), false);
  });

  it('a provider API key: masked, named, labelled, and kept out of password managers (no save, no generate)', () => {
    const paddle = { id: 'paddle', enabled: false, mode: 'test', settings: {}, credentials: { apiKey: {}, webhookSecret: {} }, webhookUrl: 'https://x', missing: [], updatedAt: null, updatedBy: null } as unknown as PaymentProviderConfig;
    const html = render(el(ProvidersPanel, { providers: [paddle], credentialStorage: true, canManage: true, onRefresh: async () => {} }));
    const key = field(html, 'paddle-apiKey-test');
    assert.ok(key, 'the key field');
    assert.equal(attr(key, 'type'), 'password');
    assert.equal(attr(key, 'autocomplete'), 'off');
    assert.equal(attr(key, 'data-1p-ignore'), '');
    assert.equal(attr(key, 'data-bwignore'), 'true');
    assert.ok(html.includes(`for="${attr(key, 'id')}"`), 'a visible label');
    assert.equal(/new-password/.test(html), false);
    assert.equal(/autocomplete="cc-/i.test(html), false, 'no card fields in the admin either');
  });
});
