/**
 * Unique qualified viewers for discovery ranking (lib/discovery-viewers.ts):
 * one row per viewer per video per day, retries never count twice. Real SQL on node:sqlite.
 */
import { RankViewerBatch, rankViewerRow } from '../lib/discovery-viewers';
import { createSqliteD1 } from './sqlite-d1';

const view = (over: Record<string, unknown> = {}) => ({ videoId: 'v1', videoChannelId: 'c1', trackedView: true, timestamp: '2026-11-21T10:00:00Z', rankViewer: 'u:user-1', ...over });

describe('rankViewerRow', () => {
  it('turns a tracked view with a viewer key into a (day, video, viewer) row', () => {
    expect(rankViewerRow(view(), 0)).toEqual(['2026-11-21', 'v1', 'u:user-1']);
    expect(rankViewerRow(view({ rankViewer: 'a:0123456789abcdef' }), 0)).toEqual(['2026-11-21', 'v1', 'a:0123456789abcdef']);
  });

  it('ignores views without a key (owner, staff, test, bot, autoplay) or with a malformed one', () => {
    expect(rankViewerRow(view({ rankViewer: undefined }), 0)).toBeNull();
    expect(rankViewerRow(view({ rankViewer: 'a:not-hex' }), 0)).toBeNull();
    expect(rankViewerRow(view({ rankViewer: 'x:1' }), 0)).toBeNull();
  });

  it('ignores search telemetry that reuses the view type', () => {
    expect(rankViewerRow({ videoId: 'v1', rankViewer: 'u:1' } as never, 0)).toBeNull();
  });
});

describe('RankViewerBatch', () => {
  it('counts a viewer once per video per day, across batches and retries', async () => {
    const db = createSqliteD1();
    const batch = new RankViewerBatch();
    batch.add(rankViewerRow(view(), 0));
    batch.add(rankViewerRow(view(), 0)); // same view twice in a batch
    batch.add(rankViewerRow(view({ rankViewer: 'u:user-2' }), 0));
    batch.add(rankViewerRow(view({ timestamp: '2026-11-22T01:00:00Z' }), 0)); // next day counts again
    await batch.flush(db);
    // A redelivered message (queue retry)
    batch.add(rankViewerRow(view(), 0));
    await batch.flush(db);
    const rows = db.raw.prepare('SELECT day, COUNT(*) AS n FROM discovery_viewers WHERE video_id = ? GROUP BY day ORDER BY day').all('v1');
    expect(rows).toEqual([{ day: '2026-11-21', n: 2 }, { day: '2026-11-22', n: 1 }]);
    expect(batch.size).toBe(0);
  });
});
