/**
 * The shared list foundation (lib/list): the URL param codec and saved views,
 * the keyboard model, the optimistic update / rollback reducer, the undo
 * toast's state machine, the relative time, and the content pass-through's
 * allowlist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeView, checkValue, filtersOf, hasFilters, listHref, mergeListParams, parseListParams, selectView, serializeListParams, type ListSpec, type SavedView } from '../src/lib/list/params';
import { isTypingTarget, listKeyAction, moveIndex } from '../src/lib/list/keyboard';
import { addOverride, applyOverrides, confirmOverride, narrowOverride, pruneOverrides, rollbackOverride, type RowOverride } from '../src/lib/list/optimistic';
import { MAX_TOASTS, UNDO_WINDOW_MS, UNDONE_LINGER_MS, latestUndoable, nextExpiry, undoReducer, type UndoToast } from '../src/lib/list/undo';
import { formatRelative, relativeParts } from '../src/lib/list/relative-time';
import { isAllowedContentPath, upstreamContentPath } from '../src/lib/api/content-proxy';
import { VIDEO_LIST_SPEC, VIDEO_VIEWS, videosBackHref } from '../src/app/(protected)/videos/list-spec';

const SPEC: ListSpec = { q: 'text', status: ['processing', 'failed', 'ready'], reported: ['yes'], from: 'date', sort: ['newest', 'oldest'], page: 'page', cursor: 'cursor' };
const VIEWS: SavedView[] = [
  { id: 'all', params: {} },
  { id: 'failed', params: { status: 'failed' } },
  { id: 'reported', params: { reported: 'yes' } },
];

describe('list URL params', () => {
  it('keeps only known keys with valid values', () => {
    assert.deepEqual(parseListParams(SPEC, 'q=%20hello%20&status=failed&evil=1&page=3&from=2026-11-01'), { q: 'hello', status: 'failed', from: '2026-11-01', page: '3' });
    assert.deepEqual(parseListParams(SPEC, { status: 'nope', page: '1', from: '2026-13-45', q: ['a', 'b'] }), { q: 'a' });
    assert.equal(checkValue('page', '0'), undefined);
    assert.equal(checkValue('page', '999999'), '10000');
    assert.equal(checkValue('text', 'x'.repeat(300))?.length, 200);
    assert.equal(checkValue('cursor', 'abc<script>'), undefined);
    assert.equal(checkValue('cursor', 'eyJpZCI6MX0='), 'eyJpZCI6MX0=');
  });

  it('serializes in the spec order, so equal filters give equal keys', () => {
    assert.equal(serializeListParams(SPEC, { page: '2', status: 'failed', q: 'a b' }), 'q=a+b&status=failed&page=2');
    assert.equal(serializeListParams(SPEC, { status: 'failed', q: 'a b', page: '2' }), 'q=a+b&status=failed&page=2');
    assert.equal(serializeListParams(SPEC, { q: '', status: undefined }), '');
    assert.equal(listHref('/videos', SPEC, {}), '/videos');
    assert.equal(listHref('/videos', SPEC, { reported: 'yes' }), '/videos?reported=yes');
  });

  it('round-trips through the query string', () => {
    const values = { q: 'تفسير', status: 'processing', sort: 'oldest', page: '4' };
    assert.deepEqual(parseListParams(SPEC, serializeListParams(SPEC, values)), values);
  });

  it('a filter change goes back to the first page; a page change keeps the filters', () => {
    const current = { status: 'failed', page: '3', cursor: 'abc' };
    assert.deepEqual(mergeListParams(SPEC, current, { q: 'x' }), { q: 'x', status: 'failed' });
    assert.deepEqual(mergeListParams(SPEC, current, { page: '4' }), { status: 'failed', page: '4', cursor: 'abc' });
    assert.deepEqual(mergeListParams(SPEC, current, { status: undefined }), {});
    assert.deepEqual(mergeListParams(SPEC, { status: 'failed', page: '3' }, { page: undefined }), { status: 'failed' });
  });

  it('saved views: the active one is the exact filter set; sort and page do not count', () => {
    assert.equal(activeView(VIEWS, {}), 'all');
    assert.equal(activeView(VIEWS, { sort: 'oldest', page: '2' }), 'all');
    assert.equal(activeView(VIEWS, { status: 'failed', page: '2' }), 'failed');
    assert.equal(activeView(VIEWS, { status: 'failed', q: 'x' }), null);
    assert.deepEqual(filtersOf({ status: 'failed', sort: 'oldest', page: '2' }), { status: 'failed' });
    assert.equal(hasFilters({ sort: 'oldest' }), false);
    assert.equal(hasFilters({ q: 'x' }), true);
  });

  it('choosing a view sets its filters, keeps the sort and starts on page one', () => {
    assert.deepEqual(selectView(SPEC, VIEWS, { q: 'x', sort: 'oldest', page: '5' }, 'reported'), { reported: 'yes', sort: 'oldest' });
    assert.deepEqual(selectView(SPEC, VIEWS, { status: 'failed' }, 'all'), {});
    assert.deepEqual(selectView(SPEC, VIEWS, { status: 'failed' }, 'unknown'), { status: 'failed' });
  });

  it('the Videos spec: every saved view is valid and the Back link keeps only list filters', () => {
    for (const view of VIDEO_VIEWS) assert.deepEqual(parseListParams(VIDEO_LIST_SPEC, view.params), view.params, view.id);
    assert.equal(videosBackHref(undefined), '/videos');
    assert.equal(videosBackHref('status=failed&page=2'), '/videos?status=failed&page=2');
    assert.equal(videosBackHref('status=failed&next=https://evil.example'), '/videos?status=failed');
    assert.equal(videosBackHref(['reported=yes', 'x']), '/videos?reported=yes');
    assert.equal(videosBackHref('//evil.example'), '/videos');
  });
});

describe('list keyboard model', () => {
  const body = { tagName: 'BODY' };
  it('maps j, k, x, Enter, / and u', () => {
    assert.equal(listKeyAction({ key: 'j' }, body), 'next');
    assert.equal(listKeyAction({ key: 'k' }, body), 'prev');
    assert.equal(listKeyAction({ key: 'x' }, body), 'toggle');
    assert.equal(listKeyAction({ key: 'Enter' }, body), 'open');
    assert.equal(listKeyAction({ key: '/' }, body), 'search');
    assert.equal(listKeyAction({ key: 'u' }, body), 'undo');
    assert.equal(listKeyAction({ key: 'U' }, body), 'undo');
    assert.equal(listKeyAction({ key: 'a' }, body), null);
  });

  it('never acts while typing, with a modifier or during IME composition', () => {
    for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', role: 'combobox' }]) {
      assert.equal(listKeyAction({ key: 'j' }, target), null, JSON.stringify(target));
    }
    assert.equal(listKeyAction({ key: 'j', ctrlKey: true }, body), null);
    assert.equal(listKeyAction({ key: 'k', metaKey: true }, body), null);
    assert.equal(listKeyAction({ key: '/', altKey: true }, body), null);
    assert.equal(listKeyAction({ key: 'x', isComposing: true }, body), null);
  });

  it('a checkbox or a button is not a typing target; Enter on a link is left to the browser', () => {
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isTypingTarget(null), false);
    assert.equal(listKeyAction({ key: 'x' }, { tagName: 'INPUT', type: 'checkbox' }), 'toggle');
    assert.equal(listKeyAction({ key: 'Enter' }, { tagName: 'A' }, { focusOnRowControl: true }), null);
  });

  it('moves without wrapping; from no row, j goes to the first and k to the last', () => {
    assert.equal(moveIndex(-1, 5, 'next'), 0);
    assert.equal(moveIndex(-1, 5, 'prev'), 4);
    assert.equal(moveIndex(2, 5, 'next'), 3);
    assert.equal(moveIndex(4, 5, 'next'), 4);
    assert.equal(moveIndex(0, 5, 'prev'), 0);
    assert.equal(moveIndex(9, 5, 'next'), 0);
    assert.equal(moveIndex(0, 0, 'next'), -1);
  });
});

describe('optimistic row updates', () => {
  type Row = { id: string; isHidden: boolean; title: string };
  const rows: Row[] = [
    { id: 'a', isHidden: false, title: 'A' },
    { id: 'b', isHidden: false, title: 'B' },
    { id: 'c', isHidden: true, title: 'C' },
  ];
  const now = 1_000_000;

  it('shows a pending change at once and rolls back only that change', () => {
    let o: RowOverride<Row>[] = addOverride([], { token: 't1', ids: ['a'], patch: { isHidden: true } }, now);
    o = addOverride(o, { token: 't2', ids: ['b'], patch: 'remove' }, now);
    assert.deepEqual(applyOverrides(rows, o, now).map((r) => [r.id, r.isHidden]), [['a', true], ['c', true]]);
    o = rollbackOverride(o, 't1');
    assert.deepEqual(applyOverrides(rows, o, now).map((r) => [r.id, r.isHidden]), [['a', false], ['c', true]]);
    assert.equal(rollbackOverride(o, 't2').length, 0);
  });

  it('later changes win (unpublish then undo)', () => {
    let o = addOverride<Row>([], { token: 'do', ids: ['a'], patch: { isHidden: true } }, now);
    o = addOverride(o, { token: 'undo', ids: ['a'], patch: { isHidden: false } }, now);
    assert.equal(applyOverrides(rows, o, now)[0].isHidden, false);
  });

  it('a confirmed change stays until the API agrees, then is pruned; a pending one is never pruned', () => {
    let o = addOverride<Row>([], { token: 't', ids: ['a'], patch: { isHidden: true } }, now);
    assert.equal(pruneOverrides(o, rows, now).length, 1, 'pending');
    o = confirmOverride(o, 't', now);
    assert.equal(pruneOverrides(o, rows, now + 1).length, 1, 'the index has not caught up');
    const caughtUp = rows.map((r) => (r.id === 'a' ? { ...r, isHidden: true } : r));
    assert.equal(pruneOverrides(o, caughtUp, now + 1).length, 0);
  });

  it('expires, so a change the API never shows stops hiding the truth', () => {
    const o = confirmOverride(addOverride<Row>([], { token: 't', ids: ['a'], patch: { isHidden: true } }, now, 1000), 't', now, 1000);
    assert.equal(applyOverrides(rows, o, now + 1001)[0].isHidden, false);
    assert.equal(pruneOverrides(o, rows, now + 1001).length, 0);
  });

  it('a removal is pruned once the rows are gone; a partial bulk keeps only the ids that went through', () => {
    let o = confirmOverride(addOverride<Row>([], { token: 'del', ids: ['a', 'b'], patch: 'remove' }, now), 'del', now);
    o = narrowOverride(o, 'del', ['b']);
    assert.deepEqual(applyOverrides(rows, o, now).map((r) => r.id), ['a', 'c']);
    assert.equal(pruneOverrides(o, rows.filter((r) => r.id !== 'b'), now).length, 0);
    assert.equal(narrowOverride(o, 'del', []).length, 0);
  });

  it('returns the same rows when nothing is overridden', () => {
    assert.equal(applyOverrides(rows, [], now), rows);
  });
});

describe('undo toast state machine', () => {
  const t0 = 5_000_000;
  const add = (toasts: UndoToast[], id: string, now = t0) => undoReducer(toasts, { type: 'add', id, message: id, now });

  it('done → undoing → undone → gone', () => {
    let s = add([], 'a');
    assert.equal(s[0].status, 'done');
    assert.equal(s[0].expiresAt, t0 + UNDO_WINDOW_MS);
    s = undoReducer(s, { type: 'undoStart', id: 'a' });
    assert.equal(s[0].status, 'undoing');
    s = undoReducer(s, { type: 'undoStart', id: 'a' });
    assert.equal(s[0].status, 'undoing', 'a second press does nothing');
    s = undoReducer(s, { type: 'tick', now: t0 + UNDO_WINDOW_MS + 1 });
    assert.equal(s.length, 1, 'an undo in flight never expires');
    s = undoReducer(s, { type: 'undoSucceeded', id: 'a', now: t0 + 9000 });
    assert.equal(s[0].status, 'undone');
    s = undoReducer(s, { type: 'tick', now: t0 + 9000 + UNDONE_LINGER_MS + 1 });
    assert.equal(s.length, 0);
  });

  it('expires after the window; a failed undo stays until dismissed', () => {
    let s = add([], 'a');
    assert.equal(undoReducer(s, { type: 'tick', now: t0 + UNDO_WINDOW_MS - 1 }).length, 1);
    assert.equal(undoReducer(s, { type: 'tick', now: t0 + UNDO_WINDOW_MS }).length, 0);
    s = undoReducer(undoReducer(s, { type: 'undoStart', id: 'a' }), { type: 'undoFailed', id: 'a' });
    assert.equal(s[0].status, 'undoFailed');
    assert.equal(undoReducer(s, { type: 'tick', now: t0 + 60_000 }).length, 1);
    assert.equal(undoReducer(s, { type: 'dismiss', id: 'a' }).length, 0);
  });

  it('an expired offer cannot be undone; dismiss waits for an undo in flight', () => {
    let s = add([], 'a');
    s = undoReducer(s, { type: 'undoSucceeded', id: 'a', now: t0 });
    assert.equal(s[0].status, 'done', 'success without a start is ignored');
    s = undoReducer(s, { type: 'undoStart', id: 'a' });
    assert.equal(undoReducer(s, { type: 'dismiss', id: 'a' }).length, 1);
  });

  it('pauses while hovered or focused and gives time back on resume', () => {
    let s = add([], 'a');
    s = undoReducer(s, { type: 'pause', now: t0 + 6000 });
    assert.equal(s[0].remainingMs, 2000);
    assert.equal(nextExpiry(s), null);
    assert.equal(undoReducer(s, { type: 'tick', now: t0 + 60_000 }).length, 1);
    s = undoReducer(s, { type: 'resume', now: t0 + 60_000 });
    assert.equal(s[0].expiresAt, t0 + 62_000);
    assert.equal(nextExpiry(s), t0 + 62_000);
  });

  it('stacks the newest last, keeps at most three (finished ones go first) and u takes the newest open offer', () => {
    let s: UndoToast[] = [];
    s = add(s, 'a');
    s = undoReducer(undoReducer(s, { type: 'undoStart', id: 'a' }), { type: 'undoSucceeded', id: 'a', now: t0 });
    s = add(s, 'b');
    s = add(s, 'c');
    s = add(s, 'd');
    assert.equal(s.length, MAX_TOASTS);
    assert.deepEqual(s.map((x) => x.id), ['b', 'c', 'd']);
    s = add(s, 'e');
    assert.deepEqual(s.map((x) => x.id), ['c', 'd', 'e']);
    assert.equal(latestUndoable(s)?.id, 'e');
    s = undoReducer(s, { type: 'undoStart', id: 'e' });
    assert.equal(latestUndoable(s)?.id, 'd');
    assert.equal(latestUndoable([]), null);
  });
});

describe('relative time', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  it('picks the largest whole unit', () => {
    assert.deepEqual(relativeParts(new Date('2026-11-11T11:59:40Z'), now), { value: 0, unit: 'second' });
    assert.deepEqual(relativeParts(new Date('2026-11-11T11:57:00Z'), now), { value: -3, unit: 'minute' });
    assert.deepEqual(relativeParts(new Date('2026-11-11T09:00:00Z'), now), { value: -3, unit: 'hour' });
    assert.deepEqual(relativeParts(new Date('2026-11-09T12:00:00Z'), now), { value: -2, unit: 'day' });
    assert.deepEqual(relativeParts(new Date('2025-11-01T12:00:00Z'), now), { value: -1, unit: 'year' });
  });
  it('formats in English and Arabic', () => {
    assert.equal(formatRelative('2026-11-11T11:57:00Z', 'en', now), '3 minutes ago');
    assert.equal(formatRelative('2026-11-10T12:00:00Z', 'en', now), 'yesterday');
    assert.match(formatRelative('2026-11-11T11:57:00Z', 'ar', now), /دقائق/);
    assert.equal(formatRelative('not a date', 'en', now), 'not a date');
  });
});

describe('content pass-through allowlist', () => {
  it('lets the lists read and the Videos list act, nothing else', () => {
    assert.equal(isAllowedContentPath('GET', ['videos']), true);
    assert.equal(isAllowedContentPath('GET', ['permissions']), true);
    assert.equal(isAllowedContentPath('POST', ['videos', 'v1', 'unpublish']), true);
    assert.equal(isAllowedContentPath('POST', ['videos', 'v1', 'republish']), true);
    assert.equal(isAllowedContentPath('DELETE', ['videos', 'v1']), true);
    assert.equal(isAllowedContentPath('POST', ['videos']), false);
    assert.equal(isAllowedContentPath('DELETE', ['videos']), false);
    assert.equal(isAllowedContentPath('POST', ['videos', 'v1', 'move']), false);
    assert.equal(isAllowedContentPath('POST', ['users', 'u1', 'ban']), false);
    assert.equal(isAllowedContentPath('POST', ['deletions', 'video', 'v1', 'purge']), false);
    assert.equal(isAllowedContentPath('GET', ['videos', 'v1']), false);
    assert.equal(isAllowedContentPath('GET', []), false);
  });

  it('refuses dot segments and smuggled slashes', () => {
    assert.equal(isAllowedContentPath('DELETE', ['videos', '..']), false);
    assert.equal(isAllowedContentPath('POST', ['videos', '..', 'unpublish']), false);
    assert.equal(isAllowedContentPath('DELETE', ['videos', 'a/b']), false);
    assert.equal(isAllowedContentPath('DELETE', ['videos', '']), false);
  });

  it('builds the admin-api path with each segment encoded and the query kept', () => {
    assert.equal(upstreamContentPath(['videos'], '?status=failed&page=2'), '/api/content/videos?status=failed&page=2');
    assert.equal(upstreamContentPath(['videos', 'a b?c', 'unpublish'], ''), '/api/content/videos/a%20b%3Fc/unpublish');
  });
});
