/**
 * The audit log page and names instead of ids (issues #711, #745): who sees the page, action
 * labels in en and ar, people and items by name with the system actors as "System", id-valued
 * details named, the names request of a page, and the page's URLs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminNames } from '@al-ummah/shared-types';
import { canReadAudit } from '../src/lib/roles';
import { actionKey, actionLabel, auditHref, splitTemplate, detailViews, itemHref, itemView, namesRequestOf, paymentsLine, personView } from '../src/components/audit/audit-model';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { PersonName } from '../src/components/audit/Named';

const ARABIC = /[؀-ۿ]/;
const t = createTranslator('en');
const tAr = createTranslator('ar');

const names: AdminNames = {
  users: { usr_1: { id: 'usr_1', found: true, name: 'Aisha Rahman', userName: 'aisha', email: 'aisha@example.com' }, usr_2: { id: 'usr_2', found: true, name: null, userName: 'omar', email: null } },
  items: { 'channel:ch_1': { kind: 'channel', id: 'ch_1', found: true, title: 'Daily reminders' }, 'video:vid_1': { kind: 'video', id: 'vid_1', found: false, title: null } },
};

describe('audit log', () => {
  it('is for admins and super admins only', () => {
    assert.equal(canReadAudit('admin'), true);
    assert.equal(canReadAudit('super_admin'), true);
    assert.equal(canReadAudit('moderator'), false);
    assert.equal(canReadAudit(undefined), false);
  });

  it('names every action in words, in English and Arabic', () => {
    assert.equal(actionLabel('transfer', t), 'Ownership transferred');
    assert.equal(actionLabel('purge-request', t), 'Permanent deletion requested');
    assert.equal(actionLabel('auth_request.info_sent', t), 'More information requested');
    // Status page actions read by their verb
    assert.equal(actionLabel('status.incident.edit', t), 'Edited');
    assert.equal(actionLabel('site-domain-add', tAr), 'أُضيف نطاق');
    // An action with no words yet still reads as words
    assert.equal(actionLabel('brand_new.thing-done', t), 'brand new thing done');
    assert.equal(actionKey('Site-Grant'), 'site_grant');
  });

  it('has Arabic for every audit string, using مرئي for video', () => {
    const walk = (a: Record<string, unknown>, b: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(a)) {
        if (typeof v === 'string') {
          assert.equal(typeof b[k], 'string', `${path}.${k}`);
          assert.ok(ARABIC.test(b[k] as string) || /^\{\w+\}$/.test(v), `${path}.${k} is not Arabic`);
          assert.ok(!/فيديو/.test(b[k] as string), `${path}.${k} says فيديو`);
        } else walk(v as Record<string, unknown>, b[k] as Record<string, unknown>, `${path}.${k}`);
      }
    };
    walk(en.auditLog as never, ar.auditLog as never, 'auditLog');
    assert.equal(ar.auditLog.kinds.video, 'مرئي');
    assert.equal(ar.nav.audit, 'سجل التدقيق');
  });

  it('shows people by name with the email beside it, and system actors as System', () => {
    assert.deepEqual(personView('usr_1', names, t), { id: 'usr_1', label: 'Aisha Rahman', email: 'aisha@example.com', href: '/users/usr_1', system: false, found: true, unknown: false });
    // No @handle (handles belong to channels): a user without a name or an email is unknown
    assert.equal(personView('usr_2', names, t).label, 'Unknown user');
    assert.equal(personView('usr_2', names, t).unknown, true);
    // Display name, then the email (the lookup's, else the one the row stored), then "Unknown user": never the id
    assert.equal(personView('usr_9', names, t, 'x@example.com').label, 'x@example.com');
    assert.equal(personView('usr_9', names, t, 'x@example.com').unknown, false);
    assert.equal(personView('usr_9', names, t, '  ').label, 'Unknown user');
    assert.equal(personView('usr_9', null, t).label, 'Unknown user');
    assert.equal(personView('usr_9', null, tAr).label, 'مستخدم غير معروف');
    assert.equal(personView('usr_9', null, t).href, '/users/usr_9');
    assert.equal(itemView('user', 'usr_9', null, t).unknown, true);
    assert.deepEqual(personView('system:trash-cleanup', names, tAr), { id: 'system:trash-cleanup', label: 'النظام', email: null, href: null, system: true, found: true, unknown: false });
  });

  it('shows items by title, and their id when they have none', () => {
    assert.deepEqual(itemView('channel', 'ch_1', names, t), { kind: 'channel', id: 'ch_1', label: 'Daily reminders', href: '/channels/ch_1', found: true });
    assert.equal(itemView('channel', 'ch_1', names, t).unknown, undefined);
    assert.equal(itemView('video', 'vid_1', names, t).label, 'vid_1');
    assert.equal(itemHref('post', 'p1'), null);
  });

  it('names id-valued details and leaves the rest as text', () => {
    const views = detailViews({ channelId: 'ch_1', newOwnerId: 'usr_1', reason: 'spam', count: 3, empty: '' }, names, t);
    assert.deepEqual(views.map((v) => (v.type === 'ref' ? `${v.key}=${v.item.label}` : `${v.key}:${v.value}`)), ['channelId=Daily reminders', 'newOwnerId=Aisha Rahman', 'reason:spam', 'count:3']);
  });

  it('asks for every person and item a page mentions, once, and never for the system', () => {
    const req = namesRequestOf([
      { actorId: 'usr_1', target: { kind: 'video', id: 'vid_1' }, details: { channelId: 'ch_1', ownerId: 'usr_2' } },
      { actorId: 'usr_1', target: { kind: 'user', id: 'usr_3' }, details: null },
      { actorId: 'system:cleanup', details: null },
    ]);
    assert.deepEqual(req.users.sort(), ['usr_1', 'usr_2', 'usr_3']);
    assert.deepEqual(req.items.map((i) => `${i.kind}:${i.id}`).sort(), ['channel:ch_1', 'video:vid_1']);
  });

  it('keeps the filters in the URL and drops empty ones', () => {
    assert.equal(auditHref({}), '/audit');
    assert.equal(auditHref({ actorId: 'usr_1', area: '', action: 'hide', cursor: '2026|content:1' }), '/audit?actorId=usr_1&action=hide&cursor=2026%7Ccontent%3A1');
  });

  it('puts a name into a translated template without losing the rest', () => {
    assert.deepEqual(splitTemplate('by {actor}', ['actor']), ['by ', { slot: 'actor' }]);
    assert.deepEqual(splitTemplate(tAr('creators.historyBy', { date: '١ نوفمبر' }), ['actor']).filter((p) => typeof p !== 'string'), [{ slot: 'actor' }]);
    assert.deepEqual(splitTemplate('{a} and {b}', ['a']), [{ slot: 'a' }, ' and ', '{b}']);
  });
});

describe('an unknown user in a history line', () => {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  const render = (element: React.ReactElement, locale: 'en' | 'ar' = 'en') =>
    renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
  (globalThis as unknown as { React: unknown }).React = React;

  // Without the /users link: next/link does not render in this plain-Node test (the label and detail are the same)
  const plain = (p: ReturnType<typeof personView>) => ({ ...p, href: null });
  // Two @types/react meet here: the component as a plain function component
  const Person = PersonName as unknown as React.FC<{ person: ReturnType<typeof personView> }>;

  it('reads "Unknown user" with the id only in a copyable detail', () => {
    const html = render(React.createElement(Person, { person: plain(personView('usr_unknown_1', null, t)) }));
    assert.match(html, />Unknown user</);
    // The id is in the disclosure (and the link's title), never as the line's text
    assert.match(html, /data-testid="unknown-user-id"/);
    assert.match(html, /data-testid="unknown-user-id-value"[^>]*>usr_unknown_1</);
    assert.match(html, /aria-label="Copy the user id"/);
    const visibleLine = html.replace(/<details[\s\S]*<\/details>/, '').replace(/\s(title|data-[a-z-]+)="[^"]*"/g, '');
    assert.doesNotMatch(visibleLine, /usr_/);
  });

  it('reads in Arabic and shows no copy detail for a named user', () => {
    const ar = render(React.createElement(Person, { person: plain(personView('usr_unknown_1', null, tAr)) }), 'ar');
    assert.match(ar, /مستخدم غير معروف/);
    assert.match(ar, /aria-label="نسخ معرّف المستخدم"/);
    const named = render(React.createElement(Person, { person: plain(personView('usr_1', names, t)) }));
    assert.doesNotMatch(named, /unknown-user-id/);
    assert.match(named, /Aisha Rahman/);
  });
});

describe('Payments rows in words (never raw codes)', () => {
  const en_ = createTranslator('en');
  const ar_ = createTranslator('ar');
  const tiers = { creator: { name: 'Creator', nameAr: 'صانع محتوى' } };
  it('names the provider, key, price and the user given free months', () => {
    assert.equal(paymentsLine({ action: 'update', target: { kind: 'billing-provider', id: 'paddle' }, details: { enabled: true } }, en_, 'en')!.template, 'Payment provider turned on: Paddle');
    assert.equal(paymentsLine({ action: 'update', target: { kind: 'billing-provider', id: 'fake' }, details: { mode: 'live' } }, en_, 'en')!.template, 'Payment provider switched to Live: Test provider');
    assert.equal(paymentsLine({ action: 'credential-set', target: { kind: 'billing-provider', id: 'paddle' }, details: { field: 'apiKey', mode: 'test' } }, en_, 'en')!.template, 'API key saved for Paddle (Test)');
    assert.equal(paymentsLine({ action: 'save', target: { kind: 'billing-price', id: 'creator:month:USD' }, details: { tierId: 'creator', period: 'month', currency: 'USD', amount: 500 } }, en_, 'en', tiers)!.template, 'Price saved: Creator, Monthly, $5.00');
    const comp = paymentsLine({ action: 'billing-comp', target: { kind: 'user', id: 'usr_1' }, details: { tierId: 'creator' } }, en_, 'en', tiers)!;
    assert.deepEqual([comp.template, comp.user], ['Complimentary Creator given to {user}', 'usr_1']);
    assert.equal(paymentsLine({ action: 'update', target: { kind: 'billing-settings', id: 'tax' }, details: { undo: true } }, en_, 'en')!.undone, true);
    assert.equal(paymentsLine({ action: 'hide', target: { kind: 'video', id: 'v' }, details: {} }, en_, 'en'), null, 'other rows keep their own words');
  });
  it('Arabic: Arabic words and the tier\'s Arabic name', () => {
    const line = paymentsLine({ action: 'billing-comp', target: { kind: 'user', id: 'usr_1' }, details: { tierId: 'creator' } }, ar_, 'ar', tiers)!;
    assert.match(line.template, /صانع محتوى/);
    assert.doesNotMatch(line.template, /billing|creator/);
  });
});
