/**
 * Channel transfer's new-owner picker (components/content/UserPicker.tsx and
 * its model) and the transfer confirmation: keyboard and search rules, the
 * combobox markup in English and Arabic, and the typed confirmation.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { AdminUserSearchItem } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { createTranslator } from '../src/i18n/translate';
import { UserPicker } from '../src/components/content/UserPicker';
import { ConfirmButton } from '../src/components/content/actions';
import {
  bidiIsolate,
  canSearch,
  confirmMatches,
  initialPickerState,
  pickerReducer,
  searchable,
  statusText,
  step,
  transferConfirmValues,
  userMeta,
  userName,
  type PickerAction,
  type PickerState,
} from '../src/components/content/userPickerModel';
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

const run = (actions: PickerAction[], from: PickerState = initialPickerState) => actions.reduce(pickerReducer, from);
const tEn = createTranslator('en');
const tAr = createTranslator('ar');

function el<P extends object>(component: (props: P) => unknown, props: P): React.ReactElement {
  return React.createElement(component as unknown as React.FC<P>, props);
}

function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}

describe('user picker search rules', () => {
  it('searches from 2 characters, ignoring a leading @', () => {
    assert.equal(canSearch('a'), false);
    assert.equal(canSearch(' ab '), true);
    assert.equal(canSearch('@a'), false);
    assert.equal(canSearch('@ab'), true);
    assert.equal(searchable('  @@amina '), 'amina');
  });

  it('typing moves between idle, too short and loading', () => {
    assert.equal(run([{ type: 'type', query: 'a' }]).status, 'short');
    assert.equal(run([{ type: 'type', query: 'am' }]).status, 'loading');
    const cleared = run([{ type: 'type', query: 'am' }, { type: 'type', query: '' }]);
    assert.equal(cleared.status, 'idle');
    assert.equal(cleared.open, false);
  });

  it('drops answers to an older query', () => {
    const state = run([
      { type: 'type', query: 'am' },
      { type: 'type', query: 'ami' },
      { type: 'results', query: 'am', results: [user('old')] },
    ]);
    assert.equal(state.status, 'loading');
    assert.deepEqual(state.results, []);
    const answered = pickerReducer(state, { type: 'results', query: 'ami', results: [user('a')] });
    assert.equal(answered.status, 'done');
    assert.equal(answered.active, 0, 'the first result is highlighted');
    assert.equal(pickerReducer(answered, { type: 'failed', query: 'am' }), answered, 'a stale failure is ignored');
    assert.equal(pickerReducer(state, { type: 'failed', query: 'ami' }).status, 'error');
  });
});

describe('user picker opens with content (the channel\'s team)', () => {
  it('focusing an empty box lists the first page; it is fetched once, then shown again', () => {
    const browsing = run([{ type: 'browse' }]);
    assert.equal(browsing.status, 'loading');
    assert.equal(browsing.open, true);
    const listed = pickerReducer(browsing, { type: 'results', query: '', results: [user('a')] });
    assert.equal(listed.status, 'done');
    assert.equal(listed.active, 0);
    const reopened = pickerReducer(pickerReducer(listed, { type: 'close' }), { type: 'browse' });
    assert.equal(reopened.status, 'done', 'no second request');
    assert.equal(reopened.open, true);
  });

  it('clearing the text goes back to the first page when browsing; without it the box closes as before', () => {
    const typedThenCleared = run([{ type: 'type', query: 'am', browse: true }, { type: 'type', query: '', browse: true }]);
    assert.equal(typedThenCleared.status, 'loading');
    assert.equal(typedThenCleared.open, true);
    assert.equal(run([{ type: 'type', query: 'am' }, { type: 'type', query: '' }]).open, false);
  });

  it('says what the first page is, in English and Arabic', () => {
    const team = run([{ type: 'browse' }, { type: 'results', query: '', results: [user('a'), user('c')] }]);
    assert.match(statusText(team, tEn), /2 people on this channel/);
    assert.match(statusText(team, tAr), /[؀-ۿ]/);
    const none = run([{ type: 'browse' }, { type: 'results', query: '', results: [] }]);
    assert.match(statusText(none, tEn), /Type a name/);
  });
});

describe('user picker keyboard', () => {
  const results = [user('a'), user('b', { isBanned: true }), user('c')];
  const listed = run([{ type: 'type', query: 'xx' }, { type: 'results', query: 'xx', results }]);

  it('arrows move over selectable options, wrapping, and skip banned users', () => {
    assert.equal(listed.active, 0);
    const down = pickerReducer(listed, { type: 'move', by: 1 });
    assert.equal(down.active, 2, 'the banned user is skipped');
    assert.equal(pickerReducer(down, { type: 'move', by: 1 }).active, 0, 'wraps to the first');
    assert.equal(pickerReducer(listed, { type: 'move', by: -1 }).active, 2, 'up from the first wraps to the last');
    assert.equal(step(results, -1, -1), 2);
    assert.equal(step([user('x', { isBanned: true })], -1, 1), -1, 'nothing selectable');
  });

  it('Home and End jump; hover only highlights selectable options', () => {
    assert.equal(pickerReducer(listed, { type: 'edge', to: 'last' }).active, 2);
    assert.equal(pickerReducer({ ...listed, active: 2 }, { type: 'edge', to: 'first' }).active, 0);
    assert.equal(pickerReducer(listed, { type: 'hover', index: 1 }).active, 0);
    assert.equal(pickerReducer(listed, { type: 'hover', index: 2 }).active, 2);
  });

  it('Escape closes the list; reopening keeps the results', () => {
    const closed = pickerReducer(listed, { type: 'close' });
    assert.equal(closed.open, false);
    assert.equal(pickerReducer(closed, { type: 'move', by: 1 }).open, true, 'ArrowDown reopens');
    assert.deepEqual(pickerReducer(closed, { type: 'reset' }), initialPickerState);
  });
});

describe('user picker text', () => {
  it('status lines for every state, in both languages', () => {
    for (const t of [tEn, tAr]) {
      assert.match(statusText(run([{ type: 'type', query: 'a' }]), t), /2/);
      assert.ok(statusText(run([{ type: 'type', query: 'ab' }]), t));
      assert.match(statusText(run([{ type: 'type', query: 'zz' }, { type: 'results', query: 'zz', results: [] }]), t), /zz/);
      assert.match(statusText(run([{ type: 'type', query: 'zz' }, { type: 'results', query: 'zz', results: [user('a'), user('b')] }]), t), /2/);
      assert.ok(statusText(run([{ type: 'type', query: 'zz' }, { type: 'failed', query: 'zz' }]), t));
    }
    assert.equal(statusText(initialPickerState, tEn), '');
  });

  it('one result is singular', () => {
    const one = run([{ type: 'type', query: 'zz' }, { type: 'results', query: 'zz', results: [user('a')] }]);
    assert.match(statusText(one, tEn), /^1 result\. /);
    assert.match(statusText(one, tAr), /^نتيجة واحدة/);
  });

  it('isolates Latin values inside Arabic text, nowhere else', () => {
    assert.equal(bidiIsolate('@nasheeds', 'ar'), '\u2068@nasheeds\u2069');
    assert.equal(bidiIsolate('@nasheeds', 'en'), '@nasheeds');
    assert.equal(bidiIsolate('', 'ar'), '');
    const label = tAr('channels.transferTypeToConfirm', { handle: bidiIsolate('@nasheeds', 'ar'), email: bidiIsolate('a@b.c', 'ar') });
    assert.ok(label.includes('\u2068@nasheeds\u2069') && label.includes('\u2068a@b.c\u2069'));
  });

  it('shows channel count, role on the channel and bans', () => {
    assert.equal(userMeta(user('a'), tEn), 'Owns no channels');
    assert.equal(userMeta(user('a', { channelCount: 1 }), tEn), 'Owns 1 channel');
    assert.equal(userMeta(user('a', { channelCount: 3, channelRole: 'editor' }), tEn), 'Owns 3 channels · Channel editor here');
    assert.match(userMeta(user('a', { isBanned: true }), tEn), /Banned/);
    assert.match(userMeta(user('a', { channelRole: 'moderator' }), tAr), /مشرف/);
    assert.equal(userName(user('a', { displayName: '' })), '@a');
    assert.equal(userName(user('a', { displayName: '', userName: null })), 'a@example.com');
  });
});

describe('transfer confirmation', () => {
  it('accepts the channel @handle (with or without @) or the new owner email', () => {
    const values = transferConfirmValues('nasheeds', 'Amina@Example.com');
    assert.equal(confirmMatches('@nasheeds', values), true);
    assert.equal(confirmMatches('nasheeds', values), true);
    assert.equal(confirmMatches(' amina@example.com ', values), true, 'emails ignore case');
    assert.equal(confirmMatches('@Nasheeds', values), false, 'handles are exact');
    assert.equal(confirmMatches('', values), false);
    assert.equal(confirmMatches('amina', values), false);
    assert.deepEqual(transferConfirmValues(null, 'a@b.c'), ['a@b.c']);
    assert.deepEqual(transferConfirmValues(null, null), []);
  });

  it('the confirm dialog names the user, is danger styled and asks for the typed value', () => {
    const html = render(
      el(ConfirmButton, {
        label: 'Transfer',
        title: tEn('channels.transferConfirm', { name: 'Amina Yusuf', email: 'amina@example.com' }),
        body: tEn('channels.transferBody', { channel: 'QA Nasheeds', name: 'Amina Yusuf', videos: 4, playlists: 1 }),
        confirmLabel: 'Transfer',
        typeToConfirm: transferConfirmValues('nasheeds', 'amina@example.com'),
        typeToConfirmLabel: tEn('channels.transferTypeToConfirm', { handle: '@nasheeds', email: 'amina@example.com' }),
        danger: true,
        testId: 'channel-transfer-submit',
        onConfirm: () => undefined,
      }),
    );
    assert.match(html, /Move this channel to Amina Yusuf \(amina@example\.com\)\?/);
    assert.match(html, /its 4 videos and 1 playlists/);
    assert.match(html, /Type @nasheeds or amina@example\.com to confirm/);
    assert.match(html, /<dialog[^>]*aria-labelledby=/);
    assert.match(html, /data-testid="channel-transfer-submit-confirm"[^>]*disabled=""|disabled=""[^>]*data-testid="channel-transfer-submit-confirm"/, 'confirm starts disabled');
    assert.match(html, /bg-danger-bg|danger/);
  });
});

describe('UserPicker markup', () => {
  const search = async () => ({ ok: true as const, data: { items: [] } });

  for (const locale of ['en', 'ar'] as const) {
    it(`is an ARIA combobox with a listbox and a live status (${locale})`, () => {
      const t = locale === 'en' ? tEn : tAr;
      const html = render(
        el(UserPicker, { label: t('channels.newOwner'), hint: t('channels.newOwnerHint'), search, value: null, onChange: () => undefined, testId: 'p' }),
        locale,
      );
      assert.match(html, /role="combobox"/);
      assert.match(html, /aria-autocomplete="list"/);
      assert.match(html, /aria-expanded="false"/);
      const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
      assert.ok(controls && html.includes(`id="${controls}" role="listbox"`), 'the input controls the listbox');
      assert.match(html, /role="status"[^>]*aria-live="polite"/);
      assert.match(html, /<label for="[^"]+"/);
      assert.ok(html.includes(t('channels.newOwner')));
      assert.ok(html.includes(t('channels.newOwnerPlaceholder')));
      assert.match(html, /dir="auto"/, 'Arabic and Latin names both read in their own direction');
    });
  }

  it('a chosen user shows avatar initial, name, email, meta and a way back', () => {
    const html = render(
      el(UserPicker, { label: 'New owner', search, value: user('usr_1', { displayName: 'أمينة', channelCount: 2 }), onChange: () => undefined, testId: 'p' }),
      'ar',
    );
    assert.match(html, /data-selected-id="usr_1"/);
    assert.ok(html.includes('أمينة'));
    assert.ok(html.includes('usr_1@example.com'));
    assert.ok(html.includes(tAr('channels.pickerOwnsMany', { count: 2 })));
    assert.ok(html.includes(tAr('channels.pickerChange')));
    assert.doesNotMatch(html, /role="combobox"/);
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
