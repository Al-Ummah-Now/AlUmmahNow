/** A list's views: which get a tab (lib/list/shown-views.ts) and which of them fit the row (PriorityTabs fitItems). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shownViews } from '../src/lib/list/shown-views';

const ids = (views: { id: string; count?: number | null }[], current = '') => shownViews(views, (v) => v.id === current).map((v) => v.id);

describe('shownViews', () => {
  it('leaves out a view known to be empty, never the first or the current one', () => {
    const views = [{ id: 'all', count: 0 }, { id: 'processing', count: 0 }, { id: 'failed', count: 3 }, { id: 'reported', count: 0 }];
    assert.deepEqual(ids(views), ['all', 'failed']);
    assert.deepEqual(ids(views, 'reported'), ['all', 'failed', 'reported']);
  });

  it('keeps a view whose count is loading, not readable or not counted', () => {
    assert.deepEqual(ids([{ id: 'all' }, { id: 'a', count: undefined }, { id: 'b', count: null }, { id: 'c' }]), ['all', 'a', 'b', 'c']);
  });
});
