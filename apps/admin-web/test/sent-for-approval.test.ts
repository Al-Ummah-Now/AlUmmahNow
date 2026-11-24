/**
 * Tier changes sent for approval, in a DOM (jsdom; wiki AUN-WORKFLOWS §10): the notice, the control that
 * stays locked, and when the notice ends. `pendingRequest`: the request the page lists as open, undefined
 * when it lists none, null when it couldn't read them.
 */
import './support/next-navigation-stub';
import { routerCalls } from './support/next-navigation-stub';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { DEFAULT_CREATOR_TIER, DEFAULT_MEMBER_TIER, DEFAULT_UNLIMITED_TIER, type CreatorTier } from '@al-ummah/shared-types';

(globalThis as unknown as { React: unknown }).React = React;

const stamp = { updatedAt: null, updatedBy: null };
const TIERS: CreatorTier[] = [{ ...DEFAULT_MEMBER_TIER, ...stamp }, { ...DEFAULT_CREATOR_TIER, ...stamp }, { ...DEFAULT_UNLIMITED_TIER, ...stamp }];
const SENT = { ok: 'sent' as const, requestId: 'wfr_1' };

describe('a change sent for approval', () => {
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
  beforeEach(() => void routerCalls.splice(0));

  async function mount(component: unknown, props: Record<string, unknown>) {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const show = (more: Record<string, unknown> = {}) =>
      React.act(async () => root.render(React.createElement(I18nProvider as unknown as React.FC<Record<string, unknown>>, { locale: 'en', theme: 'light' }, React.createElement(component as React.FC<Record<string, unknown>>, { ...props, ...more }))));
    await show();
    const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = (id: string) => React.act(async () => void q(id)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    return { container, q, click, show, unmount: () => React.act(async () => root.unmount()) };
  }

  describe('the rank list', () => {
    const rank = async (pendingRequest: string | null | undefined) => {
      const { TierRankList } = await import('../src/components/creators/TierRankList');
      const calls: string[][] = [];
      const reorder = async (ids: string[]) => {
        calls.push(ids);
        return calls.length === 1 ? SENT : { ok: false as const, status: 409, error: 'x', code: 'change_pending' };
      };
      return { calls, ...(await mount(TierRankList, { tiers: TIERS, defaultTierId: 'member', canManage: true, reorder, pendingRequest })) };
    };

    it('stays locked with its notice while the page can\'t say, so the order can\'t be sent again', async () => {
      const r = await rank(null);
      await r.click('tiers-rank-creator-down');
      assert.ok(r.q('tiers-rank-sent'));
      assert.match(r.q('tiers-rank-sent-link')!.getAttribute('href')!, /\/approvals\/wfr_1$/);
      assert.equal(r.container.querySelectorAll('button').length, 0, 'no Move up or Move down');
      assert.ok(!r.container.querySelector('[draggable="true"]'));
      assert.deepEqual(r.calls.length, 1);
      assert.ok(routerCalls.includes('refresh'));
      await r.unmount();
    });

    it('waits while the page lists the request, and comes back once it no longer does', async () => {
      const r = await rank(null);
      await r.click('tiers-rank-creator-down');
      await r.show({ pendingRequest: 'wfr_1' });
      assert.ok(r.q('tiers-rank-sent'));
      assert.equal(r.container.querySelectorAll('button').length, 0);
      await r.show({ pendingRequest: undefined });
      assert.ok(!r.q('tiers-rank-sent'));
      assert.ok(r.q('tiers-rank-creator-down'));
      await r.unmount();
    });

    it('decided before the refresh came back: the notice ends although the page never listed it', async () => {
      const r = await rank(null);
      await r.click('tiers-rank-creator-down');
      await r.show({ pendingRequest: undefined });
      assert.ok(!r.q('tiers-rank-sent'));
      assert.ok(r.q('tiers-rank-creator-down'));
      await r.unmount();
    });
  });

  it('a tier card is read only while its change is sent, and the other cards are not', async () => {
    const { TierEditor } = await import('../src/components/creators/TierEditor');
    let saves = 0;
    const save = async () => (saves++, SENT);
    const r = await mount(TierEditor, { tiers: TIERS, counts: {}, defaultTierId: 'member', canManage: true, actions: { save, remove: save }, pending: null });
    assert.ok(r.q('tier-creator-save'));
    await r.click('tier-creator-hidden');
    assert.equal(saves, 1);
    assert.ok(r.q('tier-creator-sent'));
    assert.ok(!r.q('tier-creator-save'));
    assert.equal((r.q('tier-creator-hidden') as HTMLInputElement).disabled, true);
    assert.equal((r.q('tier-creator-hidden') as HTMLInputElement).checked, false, 'nothing changed yet');
    assert.ok(r.q('tier-unlimited-save'));
    await r.show({ pending: {} });
    assert.ok(!r.q('tier-creator-sent'));
    assert.ok(r.q('tier-creator-save'));
    await r.unmount();
  });

  it('a default-tier change replaces its button until it is decided', async () => {
    const { DefaultTierButton } = await import('../src/components/creators/DefaultTierButton');
    const r = await mount(DefaultTierButton, { tierId: 'creator', tierName: 'Creator', label: 'Set as default', setDefault: async () => SENT, testId: 'def', pendingRequest: null });
    await r.click('def');
    assert.ok(r.q('def-sent'));
    assert.ok(!r.q('def'));
    await r.unmount();
  });

  it('a declined tier request that fails keeps the sent approval: no Approve again', async () => {
    const { TierRequestActions } = await import('../src/components/tier-requests/TierRequestActions');
    const calls: string[] = [];
    const actions = {
      approve: async () => (calls.push('approve'), SENT),
      decline: async () => (calls.push('decline'), { ok: false as const, status: 500, error: 'x' }),
    };
    const r = await mount(TierRequestActions, { id: 'r1', name: 'Sara', tier: 'Creator', actions, pendingRequest: null });
    const confirm = (id: string) => React.act(async () => void r.q(`${id}-dialog`)!.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await r.click('tier-request-approve-r1');
    await confirm('tier-request-approve');
    assert.deepEqual(calls, ['approve']);
    assert.ok(r.q('tier-request-sent-r1'));
    assert.ok(!r.q('tier-request-approve-r1'));
    assert.equal(routerCalls.filter((c) => c === 'refresh').length, 1, 'one refresh');
    await r.click('tier-request-decline-r1');
    await confirm('tier-request-decline');
    assert.deepEqual(calls, ['approve', 'decline']);
    assert.ok(r.q('tier-request-sent-r1'), 'the notice and its link stay');
    assert.ok(!r.q('tier-request-approve-r1'));
    await r.unmount();
  });

  it('a creator\'s tier control keeps its notice while the page can\'t say', async () => {
    const { CreatorTierControl } = await import('../src/components/creators/CreatorTierControl');
    const r = await mount(CreatorTierControl, {
      userId: 'usr_1', userName: 'Sara', current: { tierId: 'member', origin: 'admin', assignedBy: 'a', assignedAt: '2026-11-08T00:00:00Z' },
      tiers: TIERS, canManage: true, needsTier: false, setTier: async () => SENT, pendingRequest: null,
    });
    await r.click('creator-tier-select');
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.value === 'creator')!;
    await React.act(async () => void option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await r.click('creator-tier-change-confirm');
    assert.ok(r.q('creator-tier-sent'));
    assert.ok(!r.q('creator-tier-select'));
    await r.show({ pendingRequest: undefined });
    assert.ok(!r.q('creator-tier-sent'));
    assert.ok(r.q('creator-tier-select'));
    await r.unmount();
  });
});
