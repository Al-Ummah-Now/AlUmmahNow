/**
 * Regression: /en/live and /ar/live showed "Invalid response format" because
 * GET /api/live-streams answers `{ success, result: { data, cursor, limit } }`
 * while useLiveStreams only read `response.data`.
 */
jest.mock('@/lib/api/livestreams', () => ({ listLiveStreams: jest.fn() }));
jest.mock('@/lib/api/channels', () => ({ getChannelById: jest.fn() }));
jest.mock('@/lib/websocket/WebSocketProvider', () => ({ useOptionalWebSocketSubscription: jest.fn() }));

import { normalizeLiveStreamsPage } from '../useLiveStreams';

describe('normalizeLiveStreamsPage', () => {
  it('reads the API `result` envelope (empty list => empty page, no more pages)', () => {
    const page = normalizeLiveStreamsPage({ result: { cursor: '', limit: 12, data: [] } }, 12);
    expect(page).toEqual({
      data: [],
      pagination: { limit: 12, cursor: undefined, nextCursor: undefined, hasMore: false },
    });
  });

  it('maps API-shaped streams to card models and exposes the cursor', () => {
    const page = normalizeLiveStreamsPage(
      {
        result: {
          cursor: 'abc',
          limit: 1,
          data: [{ id: 's1', title: 'Live', channelId: 'c1', channelName: 'Chan', status: 'live', currentViewers: 7 }],
        },
      },
      12
    );
    expect(page?.data[0]).toMatchObject({ id: 's1', status: 'live', viewerCount: 7, channel: { id: 'c1', name: 'Chan' } });
    expect(page?.pagination).toMatchObject({ hasMore: true, nextCursor: 'abc', limit: 1 });
  });

  it('keeps the legacy `data` envelope with card-shaped streams unchanged', () => {
    const stream = { id: 's2', title: 'T', thumbnailUrl: '/x.png', status: 'live' as const, channel: { id: 'c', name: 'n' } };
    const pagination = { limit: 5, hasMore: false };
    expect(normalizeLiveStreamsPage({ data: { data: [stream], pagination } }, 5)).toEqual({ data: [stream], pagination });
  });

  it('returns null when neither envelope is present', () => {
    expect(normalizeLiveStreamsPage({}, 12)).toBeNull();
  });
});
