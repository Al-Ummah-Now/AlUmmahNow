/**
 * A rule for one feature, in a DOM (jsdom; wiki AUN-WORKFLOWS §10, #1897): the feature is chosen from a list
 * that opens with every feature without a rule, and nothing can be sent before one is.
 */
import './support/next-navigation-stub';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { FEATURE_REGISTRY, WORKFLOW_ACTIONS } from '@al-ummah/shared-types';

(globalThis as unknown as { React: unknown }).React = React;

describe('a rule for one feature', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'getComputedStyle'])
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    g.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has <dialog> without its methods
    const dialog = dom.window.HTMLDialogElement.prototype as unknown as { showModal(): void; close(): void; open: boolean };
    dialog.showModal = function () { this.open = true; };
    dialog.close = function () { this.open = false; };
  });
  after(() => dom.window.close());

  it('the list has every feature without a rule; the request is for the one chosen', async () => {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const { RuleEditor } = await import('../src/components/workflows/RuleEditor');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const sent: unknown[][] = [];
    const action = WORKFLOW_ACTIONS['features.set'];
    const props = {
      type: 'features.set', scope: '', actionName: action.label.en, rule: action.defaultRule, floor: action.floor, names: {}, forFeature: ['newsletter'],
      recipients: async () => ({ items: [] }),
      propose: async (...args: unknown[]) => (sent.push(args), { ok: true, data: { status: 'pending_approval', request: {} } }),
    };
    const run = (f: () => void) => React.act(async () => { f(); await new Promise((r) => setTimeout(r, 0)); });
    await run(() => root.render(React.createElement(I18nProvider as unknown as React.FC<Record<string, unknown>>, { locale: 'en', theme: 'light' }, React.createElement(RuleEditor as unknown as React.FC<Record<string, unknown>>, props))));
    const q = (sel: string) => container.querySelector<HTMLElement>(sel);
    const click = (sel: string) => run(() => void q(sel)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    const submit = () => q('[data-testid="approval-rule-submit"]') as HTMLButtonElement;

    await click('[data-testid="approval-rule-for-feature"]');
    await run(() => q('[data-testid="approval-rule-feature-input"]')!.focus());
    const ids = [...container.querySelectorAll('[data-testid="approval-rule-feature-option"]')].map((o) => o.getAttribute('data-id'));
    assert.equal(ids.length, FEATURE_REGISTRY.length - 1);
    assert.ok(ids.includes('live') && !ids.includes('newsletter'));

    const why = q('[data-testid="approval-rule-reason"]') as HTMLTextAreaElement;
    await run(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(why, 'Live needs a second person.');
      why.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(submit().disabled, true, 'no feature chosen');
    await click('[data-testid="approval-rule-feature-option"][data-id="live"]');
    assert.equal(submit().disabled, false);
    await run(() => void q('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(sent, [['features.set', 'live', action.defaultRule, 'Live needs a second person.']]);

    // Opened again: nothing is chosen, and the list is whole
    await click('[data-testid="approval-rule-for-feature"]');
    assert.equal(!!q('[data-testid="approval-rule-feature-selected"]'), false);
    assert.equal(submit().disabled, true);
    await run(() => root.unmount());
  });
});
