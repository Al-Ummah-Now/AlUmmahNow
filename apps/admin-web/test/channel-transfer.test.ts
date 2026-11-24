/**
 * Channel transfer (#695, #713): the new owner is chosen with the shared Autocomplete
 * (search results as items with their facts, banned users not choosable, the chosen
 * user as a card), and the typed confirmation.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { AdminUserSearchItem } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { createTranslator } from '../src/i18n/translate';
import { Autocomplete } from '../src/components/search/Autocomplete';
import { ConfirmButton } from '../src/components/content/actions';
import { bidiIsolate, confirmMatches, transferConfirmValues, transferItem, userMeta, userName } from '../src/components/content/transfer-model';
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
  it('isolates Latin values inside Arabic text, nowhere else', () => {
    assert.equal(bidiIsolate('@nasheeds', 'ar'), '\u2068@nasheeds\u2069');
    assert.equal(bidiIsolate('@nasheeds', 'en'), '@nasheeds');
    assert.equal(bidiIsolate('', 'ar'), '');
    const label = tAr('channels.transferTypeToConfirm', { handle: bidiIsolate('@nasheeds', 'ar'), id: bidiIsolate('usr_1', 'ar') });
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

describe('transfer confirmation', () => {
  it('accepts the channel @handle (with or without @) or the new owner user id, never an email', () => {
    const values = transferConfirmValues('nasheeds', 'usr_amina');
    assert.equal(confirmMatches('@nasheeds', values), true);
    assert.equal(confirmMatches('nasheeds', values), true);
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
