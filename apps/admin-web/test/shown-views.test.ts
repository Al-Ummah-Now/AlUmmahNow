/** A list's views: which get a tab (lib/list/shown-views.ts) and which of them fit the row (PriorityTabs fitItems). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shownViews } from '../src/lib/list/shown-views';
import { fitItems } from '../src/components/PriorityTabs';

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

describe('fitItems', () => {
  it('keeps the current tab in the row, and decides nothing on widths it does not have', () => {
    // 5 tabs of 100, gap 0, More 50, room for 300: two lead tabs and the current one
    assert.deepEqual(fitItems([100, 100, 100, 100, 100], 0, 300, 50, 4), [0, 4]);
    assert.deepEqual(fitItems([100, 100, 100], 0, 400, 50, 2), [0, 1, 2]);
    // A tab added before it was measured: nothing is laid out from a missing width (no NaN, no empty row later)
    assert.deepEqual(fitItems([100, Number.NaN, 100], 0, 400, 50, 1), []);
    assert.deepEqual(fitItems([100, 100], 0, 400, 50, 3), []);
  });
});
