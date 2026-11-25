/**
 * The owner's open channel offer on the admin channel page (wiki AUN-CHANNEL-CLAIM CC-7b): who, until
 * when, and Stop, in both languages; nothing without an offer; a failed read says so.
 */
import './support/next-navigation-stub';
import { routerCalls } from './support/next-navigation-stub';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { ActionResult } from '../src/lib/api/errors';
import type { AdminChannelMoveOffer, AdminUserRow } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { ChannelMoveOffers } from '../src/app/(protected)/channels/[id]/ChannelMoveOffers';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const user = (id: string, over: Partial<AdminUserRow> = {}): AdminUserRow => ({ id, displayName: `Name ${id}`, userName: `handle_${id}`, email: `${id}@example.com`, avatarUrl: null, createdAt: null, isBanned: false, ...over });
const offer = (over: Partial<AdminChannelMoveOffer> = {}): AdminChannelMoveOffer => ({ id: 'off_1', status: 'offered', from: user('usr_1'), to: user('usr_2', { displayName: 'أمينة' }), keepContactEmail: false, createdAt: '2026-11-24T12:00:00.000Z', expiresAt: '2026-12-01T12:00:00.000Z', ...over });

async function render(offers: AdminChannelMoveOffer[] | null, locale: 'en' | 'ar' = 'en') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(ChannelMoveOffers, { channelId: 'ch_1', offers, stop: async () => ({ ok: true as const, data: {} }) })) as never);
}

describe('the open offer on the admin channel page', () => {
  it('nothing without an offer; a failed read says so', async () => {
    assert.equal(await render([]), '');
    const failed = await render(null);
    assert.ok(failed.includes('channel-move-offers-failed') && failed.includes(en.channels.moveOffer.loadFailed));
  });

  for (const [locale, m] of [['en', en], ['ar', ar]] as const) {
    it(`names both people with links, says until when, and offers Stop (${locale})`, async () => {
      const html = await render([offer({ keepContactEmail: true })], locale);
      assert.ok(html.includes('href="/users/usr_1"') && html.includes('href="/users/usr_2"'));
      assert.ok(html.includes('Name usr_1') && html.includes('أمينة') && html.includes('usr_2@example.com'));
      assert.ok(!html.includes('handle_'), 'a user has no handle');
      for (const text of [m.channels.moveOffer.title, m.channels.moveOffer.hint, m.channels.moveOffer.contactKept, m.channels.moveOffer.stop]) assert.ok(html.includes(text), text);
      assert.ok(html.includes('channel-move-offer-stop'));
      if (locale === 'ar') assert.ok(!/[0-9]/.test(JSDOM.fragment(html).textContent!.replace(/usr_\d(@example\.com)?/g, '')), 'Arabic digits');
    });
  }

  it('one being accepted can’t be stopped; a person without a name shows by email, then as unknown', async () => {
    const html = await render([offer({ status: 'accepting', from: user('usr_1', { displayName: '' }), to: user('usr_2', { displayName: '', email: null }) })]);
    assert.ok(html.includes('channel-move-offer-starting') && !html.includes('channel-move-offer-stop"'));
    assert.equal(html.split('usr_1@example.com').length - 1, 1, 'the email once');
    assert.ok(html.includes(en.auditLog.unknownUser));
  });
});

describe('stopping an offer', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'getComputedStyle'])
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    g.IS_REACT_ACT_ENVIRONMENT = true;
    const dialog = dom.window.HTMLDialogElement.prototype as unknown as { showModal(): void; close(): void; open: boolean };
    dialog.showModal = function () { this.open = true; };
    dialog.close = function () { this.open = false; };
  });
  after(() => dom.window.close());
  beforeEach(() => void routerCalls.splice(0));

  async function mount(answer: ActionResult<unknown>) {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const calls: string[][] = [];
    const stop = async (...args: string[]) => {
      calls.push(args);
      return answer;
    };
    const show = (offers: AdminChannelMoveOffer[]) =>
      React.act(async () => root.render(React.createElement(I18nProvider as unknown as React.FC<Record<string, unknown>>, { locale: 'en', theme: 'light' }, React.createElement(ChannelMoveOffers, { channelId: 'ch_1', offers, stop: stop as never }))));
    await show([offer()]);
    const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = (id: string) => React.act(async () => void q(id)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    const reason = (text: string) =>
      React.act(async () => {
        const field = container.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
        field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    return { container, q, click, reason, show, calls, unmount: () => React.act(async () => root.unmount()) };
  }

  it('asks for a reason, says what happens, stops it, and the outcome stays when the offer is gone', async () => {
    const r = await mount({ ok: true, data: {} });
    await r.click('channel-move-offer-stop');
    for (const text of [en.channels.moveOffer.stopTold, en.channels.moveOffer.stopAgain]) assert.ok(r.container.textContent!.includes(text), text);
    await r.click('channel-move-offer-stop-confirm');
    assert.deepEqual(r.calls, [], 'not without a reason');
    await r.reason('Owner reported a scam');
    await r.click('channel-move-offer-stop-confirm');
    assert.deepEqual(r.calls, [['ch_1', 'off_1', 'Owner reported a scam']]);
    assert.ok(routerCalls.includes('refresh'));
    await r.show([]);
    assert.ok(!r.q('channel-move-offer') && r.q('channel-move-offers-feedback')!.textContent!.includes(en.channels.moveOffer.stopped));
    await r.unmount();
  });

  it('one answered or withdrawn meanwhile says so and shows as it is now', async () => {
    const r = await mount({ ok: false, status: 404, code: 'offer_not_found', error: 'x' });
    await r.click('channel-move-offer-stop');
    await r.reason('Owner reported a scam');
    await r.click('channel-move-offer-stop-confirm');
    assert.ok(r.container.textContent!.includes(en.content.errors.offer_not_found));
    assert.ok(routerCalls.includes('refresh'));
    await r.unmount();
  });
});
