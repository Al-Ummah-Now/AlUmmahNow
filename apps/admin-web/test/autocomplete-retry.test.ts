/**
 * The admin autocomplete when its opening list fails (components/search/Autocomplete): Retry is reached
 * from the keyboard, focus out of the box closes it, and a failure is announced, a later page's too.
 */
import './support/next-navigation-stub';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { Autocomplete, type AutocompleteSource } from '../src/components/search/Autocomplete';
import en from '../src/i18n/messages/en';

(globalThis as unknown as { React: unknown }).React = React;

const item = (id: string) => ({ kind: 'user' as const, id, label: `Name ${id}`, secondary: null, imageUrl: null });
type Page = Awaited<ReturnType<AutocompleteSource>>;

describe('a failed opening list', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'getComputedStyle'])
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });
  after(() => dom.window.close());

  async function mount(answers: Array<Page | Error>) {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const cursors: Array<string | null> = [];
    const source = (async (_q: string, cursor: string | null) => {
      cursors.push(cursor);
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }) as AutocompleteSource;
    await React.act(async () =>
      root.render(
        React.createElement(
          I18nProvider as unknown as React.FC<Record<string, unknown>>,
          { locale: 'en', theme: 'light' },
          React.createElement(Autocomplete, { kind: 'user', mode: 'pick', label: 'Owner', testId: 'ac', source }),
          React.createElement('button', { id: 'after' }, 'after'),
        ),
      ),
    );
    const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="ac-${id}"]`);
    const focus = (el: HTMLElement) => React.act(async () => el.focus());
    /** What a browser does on Tab: the key first, then focus moves to the next stop that is still shown */
    const tab = async (shiftKey = false) => {
      const from = document.activeElement as HTMLElement;
      await React.act(async () => void from.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })));
      const stops = [...container.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')].filter((el) => !el.closest('[hidden]'));
      const to = stops[stops.indexOf(from) + (shiftKey ? -1 : 1)];
      await React.act(async () => (to ? to.focus() : from.blur()));
    };
    const key = (k: string, shiftKey = false) => React.act(async () => void document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })));
    const click = (el: HTMLElement) => React.act(async () => void el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    return { q, focus, tab, key, click, cursors, open: () => q('input')!.getAttribute('aria-expanded') === 'true', container, unmount: () => React.act(async () => root.unmount()) };
  }

  it('Tab reaches Retry, which loads it again and gives the box focus back', async () => {
    const r = await mount([new Error('down'), { items: [item('usr_1')], next: null }]);
    await r.focus(r.q('input')!);
    assert.equal(r.q('status')!.textContent, en.autocomplete.listFailed);
    await r.tab();
    assert.equal(document.activeElement, r.q('retry'));
    assert.ok(r.open(), 'the list stays while focus is in it');
    await r.click(r.q('retry')!);
    assert.equal(document.activeElement, r.q('input'));
    assert.ok(r.open() && r.q('option') && !r.q('error'));
    assert.deepEqual(r.cursors, [null, null]);
    await r.unmount();
  });

  it('closes when focus leaves the box: past Retry, backwards, or with no failure', async () => {
    const r = await mount([new Error('down'), new Error('down'), { items: [item('usr_1')], next: null }]);
    await r.focus(r.q('input')!);
    await r.tab();
    await r.tab();
    assert.equal((document.activeElement as HTMLElement).id, 'after');
    assert.ok(!r.open(), 'past Retry');
    await r.focus(r.q('input')!);
    assert.ok(r.open());
    await r.tab(true);
    assert.ok(!r.open(), 'backwards');
    await r.focus(r.q('input')!);
    assert.ok(r.q('option'));
    await r.tab();
    assert.equal((document.activeElement as HTMLElement).id, 'after');
    assert.ok(!r.open(), 'no failure');
    await r.unmount();
  });

  it('Tab forward from a failure leaves the list open for Retry; backwards, or with no failure, the key closes it', async () => {
    const r = await mount([new Error('down'), { items: [item('usr_1')], next: null }]);
    await r.focus(r.q('input')!);
    await r.key('Tab');
    assert.ok(r.open());
    await r.key('Tab', true);
    assert.ok(!r.open());
    await r.click(r.q('input')!);
    await r.key('ArrowDown');
    assert.ok(r.open() && r.q('option'));
    await r.key('Tab');
    assert.ok(!r.open());
    await r.unmount();
  });

  it('Shift+Tab back from Retry keeps the failure and asks for nothing; a new visit asks again', async () => {
    const r = await mount([new Error('down'), { items: [item('usr_1')], next: null }]);
    await r.focus(r.q('input')!);
    for (const id of ['popup', 'list']) assert.equal(r.q(id)!.getAttribute('tabindex'), '-1', `${id}: not a tab stop`);
    assert.equal(r.q('status')!.getAttribute('aria-atomic'), 'true');
    await r.tab();
    await r.tab(true);
    assert.equal(document.activeElement, r.q('input'));
    assert.ok(r.open() && r.q('retry'));
    assert.deepEqual(r.cursors, [null]);
    await r.focus(document.querySelector<HTMLElement>('#after')!);
    await r.focus(r.q('input')!);
    assert.deepEqual(r.cursors, [null, null]);
    assert.ok(r.q('option'));
    await r.unmount();
  });

  it('a later page that fails is announced, and again when its retry fails; the items stay', async () => {
    const r = await mount([{ items: [item('usr_1')], next: 'p2' }, new Error('down'), new Error('down'), { items: [item('usr_2')], next: null }]);
    await r.focus(r.q('input')!);
    const said: string[] = [];
    const watch = new dom.window.MutationObserver(() => said.push(r.q('status')!.textContent!));
    watch.observe(r.q('status')!, { childList: true, characterData: true, subtree: true });
    await r.key('ArrowDown');
    assert.equal(r.q('status')!.textContent, en.autocomplete.listFailed);
    assert.ok(r.q('option') && r.q('retry'));
    await r.click(r.q('retry')!);
    assert.equal(said.filter((s) => s === en.autocomplete.listFailed).length, 2, said.join(' | '));
    await r.click(r.q('retry')!);
    assert.equal(r.container.querySelectorAll('[data-testid="ac-option"]').length, 2);
    assert.notEqual(r.q('status')!.textContent, en.autocomplete.listFailed);
    assert.deepEqual(r.cursors, [null, 'p2', 'p2', 'p2']);
    watch.disconnect();
    await r.unmount();
  });
});
