/**
 * One-row tab and chip strips (#1669): which items fit beside "More", and the current item always
 * in the row; the channel page's empty tabs hidden from visitors.
 */
import { fitItems } from '../PriorityStrip';
import { emptyTabs } from '@/components/ChannelTabs/emptyTabs';

describe('fitItems', () => {
  const widths = [80, 90, 70, 100, 85, 95, 110, 75];

  it('keeps every item when they all fit (no More)', () => {
    expect(fitItems([50, 60, 70], 0, 180, 60, 0)).toEqual([0, 1, 2]);
  });

  it('fits the leading items beside More', () => {
    // 80 + 90 + 70 = 240 and More 60 = 300 ≤ 320; adding 100 would not fit
    expect(fitItems(widths, 0, 320, 60, 0)).toEqual([0, 1, 2]);
  });

  it('counts the gap between items and before More', () => {
    // with 8px gaps: 80+8+90+8+70 = 256, +8+60 = 324 > 320, so two items
    expect(fitItems(widths, 8, 320, 60, 0)).toEqual([0, 1]);
  });

  it('puts the current item in the last slot when it would be under More', () => {
    expect(fitItems(widths, 0, 320, 60, 6)).toEqual([0, 6]);
    expect(fitItems(widths, 0, 320, 60, 2)).toEqual([0, 1, 2]);
  });

  it('shows only the current item when nothing else fits beside More', () => {
    expect(fitItems([200, 210], 0, 280, 60, 1)).toEqual([1]);
    expect(fitItems([200, 210], 0, 100, 60, 1)).toEqual([]);
  });
});

describe('emptyTabs', () => {
  const counts = { videos: 0, shorts: 0, live: 2, playlists: 0, community: 3, channels: 0 };

  it('hides the empty Shorts, Playlists and Channels tabs from a visitor (never Videos)', () => {
    expect(emptyTabs(counts, false)).toEqual(['shorts', 'playlists', 'channels']);
  });

  it('shows the owner every tab, and every tab when there are no counts', () => {
    expect(emptyTabs(counts, true)).toEqual([]);
    expect(emptyTabs(undefined, false)).toEqual([]);
  });
});
