/**
 * Channel transfer (#695, #713): the new owner is chosen with the shared Autocomplete
 * (search results as items with their facts, banned users not choosable, the chosen
 * user as a card), and the typed confirmation.
 */
import './support/next-navigation-stub';
import { routerCalls } from './support/next-navigation-stub';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { AdminUserSearchItem } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { createTranslator } from '../src/i18n/translate';
import { Autocomplete } from '../src/components/search/Autocomplete';
import { ConfirmButton } from '../src/components/content/actions';
import { bidiIsolate, confirmMatches, isOfficialHandle, needsOfficialTick, transferConfirmValues, transferItem, userMeta, userName } from '../src/components/content/transfer-model';
import { ChannelTransfer } from '../src/app/(protected)/channels/[id]/ChannelTransfer';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const user = (id: string, over: Partial<AdminUserSearchItem> = {}): AdminUserSearchItem => ({
  id,
  displayName: `Name ${id}`,
  userName: id,
  email: `${id}@example.com`,
  avatarUrl: null,
  createdAt: null,
  isBanned: false,
  channelCount: 0,
  channelRole: null,
  ...over,
});

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const tEn = createTranslator('en');
const tAr = createTranslator('ar');

function el<P extends object>(component: (props: P) => unknown, props: P): React.ReactElement {
  return React.createElement(component as unknown as React.FC<P>, props);
}

function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}

describe('transfer search results as Autocomplete items', () => {
  it('name and email (never a user @handle), facts, and banned users listed but not choosable', () => {
    const item = transferItem(user('usr_1', { displayName: 'Amina', userName: 'amina', channelCount: 2, channelRole: 'editor' }), tEn);
    assert.deepEqual(
      { kind: item.kind, id: item.id, label: item.label, secondary: item.secondary, meta: item.meta, disabled: item.disabled },
      { kind: 'user', id: 'usr_1', label: 'Amina', secondary: 'usr_1@example.com', meta: 'Owns 2 channels • Channel editor here', disabled: false },
    );
    assert.equal(transferItem(user('usr_2', { isBanned: true }), tEn).disabled, true);
    assert.equal(transferItem(user('usr_3', { email: null }), tAr).secondary?.includes(tAr('channels.pickerNoEmail')), true);
    assert.equal(transferItem(user('usr_4', { invite: { id: 'i', status: 'invited' } }), tEn).badge, 'invited');
    assert.equal(transferItem(user('usr_5', { invite: { id: 'i', status: 'active' } }), tEn).badge, null);
  });

  it('the transfer uses the shared Autocomplete: own source, no pasted ids, a card to choose again', () => {
    const file = readFileSync(new URL('../src/app/(protected)/channels/[id]/ChannelTransfer.tsx', import.meta.url), 'utf8');
    assert.match(file, /<Autocomplete[\s\S]*kind="user"[\s\S]*mode="pick"[\s\S]*source=\{source\}[\s\S]*allowIds=\{false\}[\s\S]*chosen="card"/);
    assert.doesNotMatch(file, /showIds=\{false\}/, 'the user id is shown');
    assert.doesNotMatch(file, /UserPicker/);
  });
});

describe('transfer text', () => {
  it('isolates a value inside a sentence, in either language', () => {
    assert.equal(bidiIsolate('@nasheeds'), '\u2068@nasheeds\u2069');
    assert.equal(bidiIsolate(''), '');
    // A name can't end its isolate or reorder the text around it
    assert.equal(bidiIsolate('\u202eAmina\u2069\nx'), '\u2068Amina x\u2069');
    const label = tAr('channels.transferTypeToConfirm', { handle: bidiIsolate('@nasheeds'), id: bidiIsolate('usr_1') });
    assert.ok(label.includes('\u2068@nasheeds\u2069') && label.includes('\u2068usr_1\u2069'));
  });

  it('shows channel count, role on the channel and bans', () => {
    assert.equal(userMeta(user('a'), tEn), 'Owns no channels');
    assert.equal(userMeta(user('a', { channelCount: 1 }), tEn), 'Owns 1 channel');
    assert.equal(userMeta(user('a', { channelCount: 3, channelRole: 'editor' }), tEn), 'Owns 3 channels • Channel editor here');
    assert.match(userMeta(user('a', { isBanned: true }), tEn), /Banned/);
    assert.match(userMeta(user('a', { channelRole: 'moderator' }), tAr), /مشرف/);
    // No @handle for users (handles belong to channels): an unnamed user is called by their email
    assert.equal(userName(user('a', { displayName: '' })), 'a@example.com');
    assert.equal(userName(user('a', { displayName: '', userName: null })), 'a@example.com');
  });
});

describe('an official handle (AUN-CHANNEL-CLAIM §3.5)', () => {
  it('is one of the site’s names, in any case', () => {
    for (const handle of ['ummah', 'Lamahat', 'AL-UMMAH-NOW']) assert.equal(isOfficialHandle(handle), true, handle);
    for (const handle of [null, '', 'ummahs', 'morningadhkar']) assert.equal(isOfficialHandle(handle), false, String(handle));
  });

  it('needs its own tick for anyone who is not known to be staff', () => {
    assert.equal(needsOfficialTick('ummah', user('usr_1')), true, 'not known: asked');
    assert.equal(needsOfficialTick('ummah', user('usr_1', { isStaff: false })), true);
    assert.equal(needsOfficialTick('ummah', user('usr_1', { isStaff: true })), false);
    assert.equal(needsOfficialTick('ummah', null), false, 'nobody picked yet');
    assert.equal(needsOfficialTick('morningadhkar', user('usr_1')), false);
  });

  it('says why a move was refused or left undone, in both languages', () => {
    for (const m of [en, ar]) assert.ok(m.content.errors.official_handle_confirm && m.channels.transferStatus.keptHandle && m.channels.transferStatus.skipped);
  });
});

describe('the official handle’s tick on the form (§3.5)', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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

  type Answer = { ok: true; data: unknown } | { ok: false; status: number; error: string; code?: string };
  const refused = (code?: string, status = 409): Answer => ({ ok: false, status, error: 'refused', code });
  const job = (over: Record<string, unknown> = {}) => ({ id: 'job_1', kind: 'channel.transfer', status: 'succeeded', progress: null, result: {}, lastError: null, ...over });

  async function mount(people: AdminUserSearchItem[], answers: Answer[] = [], handle: string | null = 'ummah') {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const sent: Array<{ to: string; officialHandle: string | null }> = [];
    const actions = {
      search: async () => ({ ok: true, data: { items: people } }),
      transfer: async (_id: string, to: string, _reason: string, options: { officialHandle: string | null }) => {
        sent.push({ to, officialHandle: options.officialHandle });
        return answers.shift()!;
      },
      readJob: async () => ({ ok: true, data: job() }),
    };
    const show = (now: string | null) =>
      React.act(async () =>
        root.render(
          React.createElement(
            I18nProvider as unknown as React.FC<Record<string, unknown>>,
            { locale: 'en', theme: 'light' },
            React.createElement(ChannelTransfer, { channel: { id: 'ch_1', name: 'Adhkar', handle: now, ownerId: 'usr_owner', videos: 1, playlists: 0 }, actions: actions as never }),
          ),
        ),
      );
    await show(handle);
    const q = <T extends HTMLElement = HTMLElement>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
    const click = (el: Element | null) => React.act(async () => void el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
      React.act(async () => {
        const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
        el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    const pick = async (id: string) => {
      if (q('channel-transfer-owner-change')) await click(q('channel-transfer-owner-change'));
      await React.act(async () => q('channel-transfer-owner-input')!.focus());
      await React.act(async () => new Promise((r) => setTimeout(r, 0)));
      const option = [...container.querySelectorAll('[data-testid="channel-transfer-owner-option"]')].find((el) => el.textContent!.includes(`Name ${id}`));
      await click(option!);
    };
    const tick = () => q<HTMLInputElement>('channel-transfer-official');
    const submit = () => q<HTMLButtonElement>('channel-transfer-submit')!;
    const transfer = async (typed: string) => {
      await click(submit());
      await type(q<HTMLTextAreaElement>('channel-transfer-submit-reason')!, 'Owner asked by email');
      await type(q<HTMLInputElement>('channel-transfer-submit-typed')!, typed);
      await React.act(async () => void container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    };
    return { q, click, pick, tick, submit, transfer, show, sent, unmount: () => React.act(async () => root.unmount()) };
  }

  it('asks for anyone who is not staff, waits for it, and sends the handle that was ticked', async () => {
    const r = await mount([user('usr_1', { isStaff: false }), user('usr_2', { isStaff: true })], [{ ok: true, data: { job: job() } }]);
    assert.equal(r.tick(), null, 'nobody picked yet');
    await r.pick('usr_2');
    assert.equal(r.tick(), null, 'staff');
    assert.equal(r.submit().disabled, false);
    await r.pick('usr_1');
    assert.equal(r.submit().disabled, true);
    await r.click(r.tick());
    assert.equal(r.submit().disabled, false);
    await r.transfer('@ummah');
    assert.deepEqual(r.sent, [{ to: 'usr_1', officialHandle: 'ummah' }]);
    await r.unmount();
  });

  it('is about this person and this handle: another of either, and it is asked again', async () => {
    const r = await mount([user('usr_1'), user('usr_2')]);
    await r.pick('usr_1');
    await r.click(r.tick());
    assert.equal(r.tick()!.checked, true);
    await r.pick('usr_2');
    assert.deepEqual([r.tick()!.checked, r.submit().disabled], [false, true]);
    await r.click(r.tick());
    await r.show('lamahat');
    assert.deepEqual([r.tick()!.checked, r.submit().disabled], [false, true]);
    await r.unmount();
  });

  it('sends no tick to staff, nor one ticked before the handle became a plain one', async () => {
    const r = await mount([user('usr_1'), user('usr_2', { isStaff: true })], [refused('already_owner'), refused('already_owner')]);
    await r.pick('usr_1');
    await r.click(r.tick());
    await r.show('adhkar');
    assert.equal(r.tick(), null);
    await r.transfer('@adhkar');
    await r.pick('usr_2');
    await r.show('ummah');
    await r.transfer('@ummah');
    assert.deepEqual(r.sent.map((s) => s.officialHandle), [null, null]);
    await r.unmount();
  });

  it('refused for the handle: the box shows, unticked, and the page is read again; they left the site team', async () => {
    const r = await mount([user('usr_1', { isStaff: true })], [refused('official_handle_confirm')]);
    await r.pick('usr_1');
    await r.transfer('@ummah');
    assert.deepEqual([r.tick()?.checked, r.submit().disabled], [false, true]);
    assert.ok(routerCalls.includes('refresh'));
    assert.ok(r.q('channel-transfer-feedback')!.textContent!.includes(en.content.errors.official_handle_confirm));
    await r.unmount();
  });

  it('refused for the handle the channel got meanwhile: asked about that one once the page shows it', async () => {
    for (const from of ['adhkar', 'ummah']) {
      const r = await mount([user('usr_1', { isStaff: false })], [refused('official_handle_confirm'), refused('already_owner')], from);
      await r.pick('usr_1');
      if (from === 'ummah') await r.click(r.tick());
      await r.transfer(`@${from}`);
      assert.ok(routerCalls.includes('refresh'));
      if (from === 'ummah') assert.equal(r.tick()!.checked, false, 'the tick that was refused is not kept');
      await r.show('lamahat');
      assert.deepEqual([r.tick()!.checked, r.submit().disabled], [false, true]);
      await r.click(r.tick());
      await r.transfer('@lamahat');
      assert.deepEqual(r.sent.map((s) => s.officialHandle), [from === 'ummah' ? 'ummah' : null, 'lamahat']);
      await r.unmount();
    }
  });

  it('any other refusal leaves the form as it was', async () => {
    for (const answer of [refused('transfer_in_progress'), refused(undefined, 500), refused(undefined, 403), refused('rate_limited', 429)]) {
      const staff = await mount([user('usr_1', { isStaff: true })], [answer]);
      await staff.pick('usr_1');
      await staff.transfer('@ummah');
      assert.deepEqual([staff.tick(), staff.submit().disabled, staff.sent.length], [null, false, 1]);
      await staff.unmount();
      const ticked = await mount([user('usr_1', { isStaff: false })], [answer]);
      await ticked.pick('usr_1');
      await ticked.click(ticked.tick());
      await ticked.transfer('@ummah');
      assert.deepEqual([ticked.tick()?.checked, ticked.submit().disabled], [true, false]);
      assert.ok(!routerCalls.includes('refresh'));
      await ticked.unmount();
    }
  });

  it('a move that ended without moving says so', async () => {
    for (const [skipped, text] of [['official_handle', en.channels.transferStatus.keptHandle], ['channel_deleted', en.channels.transferStatus.skipped]] as const) {
      const r = await mount([user('usr_1', { isStaff: true })], [{ ok: true, data: { job: job({ result: { skipped } }) } }]);
      await r.pick('usr_1');
      await r.transfer('@ummah');
      const status = r.q('channel-transfer-status')!;
      assert.deepEqual([status.dataset.status, status.getAttribute('role')], ['skipped', 'alert']);
      assert.ok(!r.q('job-status'), 'not “Succeeded”');
      assert.ok(status.textContent!.includes(text.replace('{name}', 'Name usr_1')), status.textContent!);
      await r.unmount();
    }
  });
});

describe('transfer confirmation', () => {
  it('accepts the channel @handle (with or without @) or the new owner user id, never an email', () => {
    const values = transferConfirmValues('nasheeds', 'usr_amina');
    assert.equal(confirmMatches('@nasheeds', values), true);
    assert.equal(confirmMatches('nasheeds', values), true);
    assert.equal(confirmMatches(bidiIsolate('@nasheeds'), values), true, 'copied from the label');
    assert.equal(confirmMatches(' usr_amina ', values), true);
    assert.equal(confirmMatches('amina@example.com', values), false);
    assert.equal(confirmMatches('usr_Amina', values), false, 'ids are exact');
    assert.equal(confirmMatches('@Nasheeds', values), false, 'handles are exact');
    assert.equal(confirmMatches('', values), false);
    assert.equal(confirmMatches('amina', values), false);
    assert.deepEqual(transferConfirmValues(null, 'usr_1'), ['usr_1']);
  });

  it('the confirm dialog names the user, is danger styled and asks for the typed value', () => {
    const html = render(
      el(ConfirmButton, {
        label: 'Transfer',
        title: tEn('channels.transferConfirm', { name: 'Amina Yusuf', id: '(usr_amina)' }),
        body: tEn('channels.transferBody', { channel: 'QA Nasheeds', name: 'Amina Yusuf', videos: 4, playlists: 1 }),
        confirmLabel: 'Transfer',
        typeToConfirm: transferConfirmValues('nasheeds', 'usr_amina'),
        typeToConfirmLabel: tEn('channels.transferTypeToConfirm', { handle: '@nasheeds', id: 'usr_amina' }),
        danger: true,
        testId: 'channel-transfer-submit',
        onConfirm: () => undefined,
      }),
    );
    assert.match(html, /Move this channel to Amina Yusuf \(usr_amina\)\?/);
    assert.match(html, /its 4 videos and 1 playlists/);
    assert.match(html, /Type @nasheeds or usr_amina to confirm/);
    assert.match(html, /<dialog[^>]*aria-labelledby=/);
    assert.match(html, /data-testid="channel-transfer-submit-confirm"[^>]*disabled=""|disabled=""[^>]*data-testid="channel-transfer-submit-confirm"/, 'confirm starts disabled');
    assert.match(html, /bg-danger-bg|danger/);
  });
});

describe('the new owner field', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`is an ARIA combobox with a listbox and a live status (${locale})`, () => {
      const t = locale === 'en' ? tEn : tAr;
      const html = render(
        el(Autocomplete, { kind: 'user', mode: 'pick', label: t('channels.newOwner'), hint: t('channels.newOwnerHint'), placeholder: t('channels.newOwnerPlaceholder'), source: async () => ({ items: [] }), allowIds: false, chosen: 'card', showStatus: true, testId: 'p' }),
        locale,
      );
      assert.match(html, /role="combobox"/);
      assert.match(html, /aria-autocomplete="list"/);
      assert.match(html, /aria-expanded="false"/);
      const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
      assert.ok(controls && html.includes(`id="${controls}" role="listbox"`), 'the input controls the listbox');
      assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*data-testid="p-status" data-status="idle"/);
      assert.ok(html.includes(t('channels.newOwner')));
      assert.ok(html.includes(t('channels.newOwnerPlaceholder')));
      // Empty, the box follows the page direction (an Arabic placeholder starts at the right); once a
      // name is typed it takes dir="auto", so Arabic and Latin names both read in their own direction
      const input = html.match(/<input[^>]*role="combobox"[^>]*>/)?.[0] ?? '';
      assert.ok(input, 'renders the combobox input');
      assert.doesNotMatch(input, /\sdir=/, 'an empty box follows the page direction');
    });
  }

  it('a chosen user shows as a card with avatar initial, name, email, facts and a way back', () => {
    const item = transferItem(user('usr_1', { displayName: 'أمينة', channelCount: 2 }), tAr);
    const html = render(
      el(Autocomplete, { kind: 'user', mode: 'pick', label: 'المالك الجديد', defaultValue: 'usr_1', defaultItem: item, source: async () => ({ items: [] }), chosen: 'card', changeLabel: tAr('channels.pickerChange'), testId: 'p' }),
      'ar',
    );
    assert.match(html, /data-testid="p-selected" data-id="usr_1"/);
    assert.ok(html.includes('أمينة'));
    assert.ok(html.includes('usr_1@example.com'));
    assert.match(html, /<bdi[^>]*>usr_1<\/bdi>/, 'the card shows the user id');
    assert.ok(html.includes(tAr('channels.pickerOwnsMany', { count: 2 })));
    assert.match(html, new RegExp(`data-testid="p-change"[^>]*>${tAr('channels.pickerChange')}<`));
    assert.ok(html.includes(tAr('autocomplete.selected', { name: 'أمينة' })), 'the choice is announced');
    assert.doesNotMatch(html, /role="combobox"/);
    assert.doesNotMatch(html, /data-testid="p-clear"/, 'one way back, no Remove');
  });
});

describe('names after a preposition', () => {
  it('the Arabic link back to the users says «المستخدمين»', () => {
    assert.equal(tAr('content.back', { section: tAr('users.backName') }), 'العودة إلى المستخدمين');
    assert.equal(tEn('content.back', { section: tEn('users.backName') }), 'Back to Users');
  });
});

describe('transfer strings', () => {
  it('exist in English and Arabic', () => {
    const keys = Object.keys(en.channels).filter((k) => k.startsWith('picker') || k.startsWith('transfer') || k.startsWith('newOwner') || k === 'memberRoles');
    assert.ok(keys.length > 15);
    for (const key of keys) assert.ok(key in ar.channels, `ar.channels.${key}`);
    assert.deepEqual(Object.keys(ar.channels.transferStatus).sort(), Object.keys(en.channels.transferStatus).sort());
    assert.ok(en.content.errors.invalid_new_owner && ar.content.errors.invalid_new_owner);
  });
});
