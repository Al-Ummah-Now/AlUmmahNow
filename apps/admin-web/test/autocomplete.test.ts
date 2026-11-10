/**
 * The admin autocomplete (components/search): the keyboard of the ARIA 1.2
 * combobox key by key, the options each mode offers (search everything, use a
 * pasted id), where a chosen suggestion goes, stale answers, the rendered ARIA
 * markup in English and Arabic, and that no filter asks for a raw id any more.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminSuggestion } from '@al-ummah/shared-types';
import { I18nProvider } from '../src/i18n/I18nProvider';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { Autocomplete, type AutocompleteProps } from '../src/components/search/Autocomplete';
import type { FilterField } from '../src/components/content/FilterForm';
import {
  MIN_QUERY,
  failed,
  hrefFor,
  initialState,
  keyDown,
  looksLikeId,
  optionsFor,
  received,
  typed,
  type AutocompleteState,
} from '../src/components/search/autocomplete-model';
import { entitySuggestKind, moderationHref, parseModerationFilters } from '../src/app/(protected)/moderation/filters';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const ARABIC = /[؀-ۿ]/;

const channel = (id: string, label: string): AdminSuggestion => ({ kind: 'channel', id, label, secondary: `@${label.toLowerCase()}`, imageUrl: null });
const SUGGESTIONS = [channel('ch_1', 'Mostafa'), channel('ch_2', 'Mostafa Elbadry')];

/** Types a query and receives suggestions for it. */
function withResults(mode: 'search' | 'pick', query: string, items = SUGGESTIONS): AutocompleteState {
  return received(typed(initialState(), query), mode, query, items);
}

function press(state: AutocompleteState, mode: 'search' | 'pick', ...keys: string[]) {
  let result = { state, effect: { type: 'none' } as ReturnType<typeof keyDown>['effect'], preventDefault: false };
  for (const key of keys) result = keyDown(result.state, mode, key);
  return result;
}

describe('autocomplete: typing and answers', () => {
  it('asks only from the minimum length, and opens while it waits', () => {
    const short = typed(initialState(), 'm');
    assert.equal(MIN_QUERY, 2);
    assert.deepEqual([short.open, short.status], [false, 'idle']);
    const long = typed(initialState(), 'mo');
    assert.deepEqual([long.open, long.status, long.active], [true, 'loading', -1]);
  });

  it('drops an answer for an older query', () => {
    const state = typed(initialState(), 'mostafa');
    assert.equal(received(state, 'pick', 'most', SUGGESTIONS), state);
    assert.equal(failed(state, 'pick', 'most'), state);
  });

  it('search mode always offers "search everything" last; a failure still offers it', () => {
    const options = withResults('search', 'most').options;
    assert.deepEqual(options.map((o) => o.type), ['suggestion', 'suggestion', 'searchAll']);
    const down = failed(typed(initialState(), 'most'), 'search', 'most');
    assert.deepEqual([down.status, down.options.map((o) => o.type)], ['error', ['searchAll']]);
  });

  it('pick mode offers a pasted id that no suggestion has, and nothing for a plain word', () => {
    assert.deepEqual(optionsFor('pick', 'usr_8f3a', []), [{ type: 'useId', id: 'usr_8f3a' }]);
    assert.deepEqual(optionsFor('pick', 'ch_1', SUGGESTIONS).map((o) => o.type), ['suggestion', 'suggestion'], 'the exact match is already listed');
    assert.deepEqual(optionsFor('pick', 'mostafa', []), []);
  });

  it('tells ids from words', () => {
    for (const id of ['usr_8f3a2b', 'ch_123456', '2b1f6c1e-7d7c-4a7a-9d5e-1f0a8c3b6e21', 'V1StGXR8_Z5jdHi6B-myT']) assert.equal(looksLikeId(id), true, id);
    for (const word of ['mostafa', 'Tafsir', 'two words_1', 'ab_1', '']) assert.equal(looksLikeId(word), false, word);
  });
});

describe('autocomplete: keyboard (ARIA 1.2 combobox, manual selection)', () => {
  it('Down and Up move through the options and wrap; Alt+Up closes', () => {
    const s = withResults('search', 'most');
    assert.equal(press(s, 'search', 'ArrowDown').state.active, 0);
    assert.equal(press(s, 'search', 'ArrowDown', 'ArrowDown', 'ArrowDown').state.active, 2);
    assert.equal(press(s, 'search', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown').state.active, 0, 'wraps to the first');
    assert.equal(press(s, 'search', 'ArrowUp').state.active, 2, 'Up from nothing goes to the last');
    const altUp = keyDown(press(s, 'search', 'ArrowDown').state, 'search', 'ArrowUp', true);
    assert.deepEqual([altUp.state.open, altUp.state.active], [false, -1]);
    assert.equal(press(s, 'search', 'ArrowDown').preventDefault, true, 'the caret does not move');
  });

  it('Down on a closed list opens it on the first option', () => {
    const s = { ...withResults('pick', 'most'), open: false };
    const r = keyDown(s, 'pick', 'ArrowDown');
    assert.deepEqual([r.state.open, r.state.active], [true, 0]);
  });

  it('Enter on an active option chooses it', () => {
    const r = press(withResults('search', 'most'), 'search', 'ArrowDown', 'ArrowDown', 'Enter');
    assert.deepEqual(r.effect, { type: 'choose', option: { type: 'suggestion', suggestion: SUGGESTIONS[1] } });
    assert.deepEqual([r.preventDefault, r.state.open], [true, false]);
  });

  it('search mode: Enter with nothing active runs the full-text filter (the form submits)', () => {
    const r = press(withResults('search', 'most'), 'search', 'Enter');
    assert.deepEqual([r.effect.type, r.preventDefault], ['default', false]);
  });

  it('pick mode: Enter takes the top match, a pasted id, or does nothing for an unknown word', () => {
    assert.deepEqual(press(withResults('pick', 'most'), 'pick', 'Enter').effect, { type: 'choose', option: { type: 'suggestion', suggestion: SUGGESTIONS[0] } });
    assert.deepEqual(press(withResults('pick', 'usr_9z9z9z', []), 'pick', 'Enter').effect, { type: 'choose', option: { type: 'useId', id: 'usr_9z9z9z' } });
    const pending = typed(initialState(), 'usr_9z9z9z');
    assert.deepEqual(press(pending, 'pick', 'Enter').effect, { type: 'choose', option: { type: 'useId', id: 'usr_9z9z9z' } }, 'a pasted id works before suggestions arrive');
    const unknown = press(withResults('pick', 'nobody', []), 'pick', 'Enter');
    assert.deepEqual([unknown.effect.type, unknown.preventDefault], ['none', true], 'never submits the old value by accident');
    assert.deepEqual(press(initialState(), 'pick', 'Enter').effect, { type: 'default' }, 'an empty box applies the rest of the form');
  });

  it('Escape closes the list, then clears the text; Tab just closes', () => {
    const s = withResults('search', 'most');
    const once = keyDown(s, 'search', 'Escape');
    assert.deepEqual([once.state.open, once.state.query, once.preventDefault], [false, 'most', true]);
    const twice = keyDown(once.state, 'search', 'Escape');
    assert.deepEqual([twice.state.query, twice.effect.type], ['', 'clear']);
    const tab = keyDown(s, 'search', 'Tab');
    assert.deepEqual([tab.state.open, tab.preventDefault], [false, false]);
  });

  it('other keys (letters, Home, End) are left to the input', () => {
    for (const key of ['a', 'Home', 'End', 'ArrowLeft']) assert.equal(keyDown(withResults('search', 'most'), 'search', key).preventDefault, false, key);
  });
});

describe('autocomplete: where a suggestion goes', () => {
  it('opens items that have a page; lists the others filtered to them', () => {
    assert.equal(hrefFor({ kind: 'channel', id: 'ch 1' }), '/channels/ch%201');
    assert.equal(hrefFor({ kind: 'user', id: 'usr_1' }), '/users/usr_1');
    assert.equal(hrefFor({ kind: 'video', id: 'v_1' }), '/videos/v_1');
    assert.equal(hrefFor({ kind: 'contact', id: 'm_1' }), '/contact/m_1');
    assert.equal(hrefFor({ kind: 'error', id: 'g_1' }), '/errors/g_1');
    assert.equal(hrefFor({ kind: 'playlist', id: 'p_1' }), '/playlists?q=p_1');
    assert.equal(hrefFor({ kind: 'post', id: 'po_1' }), '/community?q=po_1');
    assert.equal(hrefFor({ kind: 'comment', id: 'c_1', parentId: 'v_1' }), '/comments?videoId=v_1');
  });
});

/** react-dom/server and this app resolve different @types/react copies; render through one typed helper. */
function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}
const box = (props: AutocompleteProps, locale: 'en' | 'ar' = 'en') => render(React.createElement(Autocomplete as unknown as React.FC<AutocompleteProps>, props), locale);

describe('autocomplete: markup', () => {
  it('search mode renders a labelled ARIA combobox carrying the query parameter', () => {
    const html = box({ kind: 'video', mode: 'search', name: 'q', label: 'Title or ID', defaultValue: 'tafsir', testId: 'vs' });
    assert.match(html, /<label for="([^"]+)-input"[^>]*>Title or ID<\/label>/);
    assert.match(html, /role="combobox"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-autocomplete="list"/);
    assert.match(html, /aria-controls="[^"]+-list"/);
    assert.match(html, /type="search"[^>]*name="q"|name="q"[^>]*type="search"/);
    assert.match(html, /value="tafsir"/);
    assert.match(html, /role="listbox"[^>]*hidden=""/);
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /autoComplete="off"|autocomplete="off"/);
  });

  it('pick mode keeps the id in a hidden input and the visible box nameless', () => {
    const html = box({ kind: 'channel', mode: 'pick', name: 'channelId', label: 'Channel' });
    assert.match(html, /<input type="hidden" name="channelId" value=""\/>/);
    assert.equal((html.match(/name="/g) ?? []).length, 1, 'only the hidden input is submitted');
    assert.match(html, /placeholder="Name, @handle, email or ID"/);
  });

  it('a chosen id shows as a chip with its name, the id left-to-right, Change and Remove', () => {
    const item = channel('ch_1', 'Mostafa');
    const html = box({ kind: 'channel', mode: 'pick', name: 'channelId', label: 'Channel', defaultValue: 'ch_1', defaultItem: item, testId: 'f' });
    assert.match(html, /<input type="hidden" name="channelId" value="ch_1"\/>/);
    assert.match(html, /data-testid="f-chip" data-id="ch_1"/);
    assert.match(html, />Mostafa</);
    assert.match(html, /<bdi dir="ltr"[^>]*>ch_1<\/bdi>/);
    assert.match(html, /aria-label="Change the channel \(Mostafa\)"/);
    assert.match(html, /aria-label="Remove the chosen channel \(Mostafa\)"/);
    assert.doesNotMatch(html, /role="combobox"/, 'the box returns when Change is pressed');
  });

  it('an id from the URL shows while its name is looked up', () => {
    const html = box({ kind: 'user', mode: 'pick', name: 'ownerId', label: 'Owner', defaultValue: 'usr_1' });
    assert.match(html, /Looking up…/);
    assert.match(html, />usr_1</);
  });

  it('speaks Arabic in Arabic', () => {
    const html = box({ kind: 'channel', mode: 'pick', name: 'channelId', label: 'القناة', defaultValue: 'ch_1', defaultItem: channel('ch_1', 'مصطفى') }, 'ar');
    assert.match(html, /aria-label="[^"]*[؀-ۿ][^"]*"/);
    assert.match(html, new RegExp(ar.autocomplete.change));
  });
});

describe('filters ask for names, never raw ids', () => {
  // FilterForm itself renders through next/form, which needs the app router; the pages' field lists are checked instead
  it('every list page filters by picked names, and no FilterForm field takes raw text', () => {
    const page = (path: string) => readFileSync(new URL(`../src/app/(protected)/${path}`, import.meta.url), 'utf8');
    const picks: [string, string, string][] = [
      ['videos/page.tsx', 'channelId', 'channel'],
      ['videos/page.tsx', 'ownerId', 'user'],
      ['playlists/page.tsx', 'channelId', 'channel'],
      ['playlists/page.tsx', 'ownerId', 'user'],
      ['community/page.tsx', 'channelId', 'channel'],
      ['comments/page.tsx', 'videoId', 'video'],
      ['comments/page.tsx', 'userId', 'user'],
      ['channels/page.tsx', 'ownerId', 'user'],
    ];
    for (const [file, name, kind] of picks) assert.match(page(file), new RegExp(`kind: 'pick', name: '${name}', [^}]*suggest: '${kind}'`), `${file} ${name}`);
    for (const file of ['videos', 'playlists', 'community', 'comments', 'channels', 'users'].map((p) => `${p}/page.tsx`)) {
      assert.doesNotMatch(page(file), /kind: 'text'/, file);
      assert.match(page(file), /kind: 'search', name: 'q', [^}]*suggest: '/, file);
    }
    const field: FilterField = { kind: 'pick', name: 'channelId', label: 'Channel', suggest: 'channel' };
    assert.equal(field.kind, 'pick');
  });

  it('labels no longer ask for an ID', () => {
    const labels = [en.videos.channelId, en.videos.ownerId, en.playlists.channelId, en.playlists.ownerId, en.community.channelId, en.comments.videoId, en.comments.userId, en.videos.targetChannel];
    for (const label of labels) assert.doesNotMatch(label, /\bID\b/, label);
    for (const label of [ar.videos.channelId, ar.comments.userId, ar.videos.targetChannel]) assert.doesNotMatch(label, /معرّف/, label);
  });

  it('every autocomplete string exists in both languages, Arabic in Arabic', () => {
    const walk = (a: Record<string, unknown>, b: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(a)) {
        if (typeof v === 'string') {
          assert.equal(typeof b[k], 'string', `${path}.${k}`);
          assert.match(b[k] as string, ARABIC, `${path}.${k}`);
        } else walk(v as Record<string, unknown>, b[k] as Record<string, unknown>, `${path}.${k}`);
      }
    };
    walk(en.autocomplete, ar.autocomplete as unknown as Record<string, unknown>, 'autocomplete');
  });
});

describe('moderation filters by reported item and reporter', () => {
  it('reads and writes entity_id and reporter_id, trimmed and bounded', () => {
    const f = parseModerationFilters({ entity_type: 'video', entity_id: '  v_1 ', reporter_id: 'usr_1' });
    assert.deepEqual([f.entity_type, f.entity_id, f.reporter_id], ['video', 'v_1', 'usr_1']);
    assert.equal(parseModerationFilters({ entity_id: 'x'.repeat(500) }).entity_id?.length, 200);
    assert.equal(moderationHref({ entity_type: 'channel', entity_id: 'ch_1', reporter_id: 'usr_1', page: 2 }), '/moderation?entity_type=channel&entity_id=ch_1&reporter_id=usr_1&page=2');
  });

  it('picks the reported item with the autocomplete of its type', () => {
    assert.equal(entitySuggestKind('video'), 'video');
    assert.equal(entitySuggestKind('post'), 'post');
    assert.equal(entitySuggestKind('livestream'), null);
    assert.equal(entitySuggestKind(undefined), null);
  });
});
