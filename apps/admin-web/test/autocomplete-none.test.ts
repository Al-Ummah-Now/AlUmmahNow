/**
 * The admin autocomplete when nothing matches (components/search/Autocomplete, jsdom): a picker says so in its
 * list, in its own words (it has no search to run), from the first character typed; with a status line under
 * the box the line says it and no empty list shows.
 */
import './support/next-navigation-stub';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { Autocomplete, type AutocompleteSource } from '../src/components/search/Autocomplete';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

const person = { kind: 'user' as const, id: 'usr_1', label: 'Amina', secondary: null, imageUrl: null };

describe('nothing matches', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'getComputedStyle'])
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });
  after(() => dom.window.close());

  async function mount(props: Record<string, unknown>, locale: 'en' | 'ar' = 'en') {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const source = (async (q: string) => ({ items: q ? [] : [person], next: null })) as AutocompleteSource;
    await React.act(async () =>
      root.render(React.createElement(I18nProvider as unknown as React.FC<Record<string, unknown>>, { locale, theme: 'light' }, React.createElement(Autocomplete as unknown as React.FC<Record<string, unknown>>, { kind: 'user', mode: 'pick', label: 'Owner', testId: 'ac', allowIds: false, source, ...props }))),
    );
    const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="ac-${id}"]`);
    const type = async (text: string) => {
      await React.act(async () => {
        const box = q('input') as HTMLInputElement;
        box.focus();
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(box, text);
        box.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await React.act(async () => void (await new Promise((r) => setTimeout(r, 300))));
    };
    return { q, type, unmount: () => React.act(async () => root.unmount()) };
  }

  for (const [locale, m] of [['en', en], ['ar', ar]] as const) {
    it(`a picker without words of its own says so, with nothing about Enter (${locale})`, async () => {
      const r = await mount({}, locale);
      for (const text of ['z', 'zz', 'zzz']) {
        await r.type(text);
        assert.equal(r.q('none')?.textContent, m.autocomplete.pickNoMatches, text);
        assert.equal(r.q('status')!.textContent, m.autocomplete.pickNoMatches, text);
        assert.equal(r.q('popup')!.hidden, false, text);
      }
      assert.doesNotMatch(m.autocomplete.pickNoMatches, /Enter/);
      await r.type('');
      assert.ok(!r.q('none') && r.q('option'));
      await r.type('a');
      assert.ok(!r.q('none') && r.q('option'), 'one character that matches');
      await r.unmount();
    });
  }

  it('a picker\'s own words', async () => {
    const r = await mount({ messages: { noMatches: (q: string) => `No owner matches ${q}` } });
    for (const text of ['z', 'zz']) {
      await r.type(text);
      assert.equal(r.q('none')?.textContent, `No owner matches ${text}`);
    }
    await r.unmount();
  });

  it('with the status line shown, the line says it and no empty list does', async () => {
    const r = await mount({ showStatus: true });
    for (const text of ['z', 'zz']) {
      await r.type(text);
      assert.ok(!r.q('none'));
      assert.equal(r.q('popup')!.hidden, true, text);
      assert.equal(r.q('status')!.textContent, en.autocomplete.pickNoMatches);
    }
    await r.type('');
    assert.equal(r.q('popup')!.hidden, false);
    await r.unmount();
  });
});
