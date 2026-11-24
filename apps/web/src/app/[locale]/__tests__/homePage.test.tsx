/**
 * Server Component tests for app/[locale]/page.tsx:
 * - Assembles initialLibrary + stableImages so signed CDN URLs never enter SSR HTML.
 * - Preserves resolved /thumb/<id>.jpg covers for Continue-watching entries not in the first feed page.
 * - Real server timeout path through withinBudget: when getHomeLibrary hangs past FIRST_DATA_BUDGET_MS,
 *   HomePage finishes with initialLibrary === undefined and mounts the client fallback below the feed.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { FIRST_DATA_BUDGET_MS } from '@/lib/ssr/first-data';
import type { HomeLibraryCard } from '@/lib/home/library-row';

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => new Headers({ host: 'videos.alummahnow.net' })),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
jest.mock('nuqs', () => ({ useQueryState: () => [null, jest.fn()] }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/components/home/SignInBanner', () => ({ SignInBanner: () => null }));
jest.mock('@/components/videoCard/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/components/videoCard/rtl/index', () => ({ __esModule: true, default: () => null }));

const mockLibraryRowProps = jest.fn();
jest.mock('@/components/home/LibraryRow', () => ({
  LibraryRow: (props: { initialCards?: HomeLibraryCard[]; initialPartial?: boolean; initialUserId?: string | null }) => {
    mockLibraryRowProps(props);
    return <section data-testid="mock-library-row" data-server={props.initialCards !== undefined ? 'yes' : 'no'} />;
  },
}));

const mockFetchVideos = jest.fn();
jest.mock('@/lib/api/videos', () => ({
  fetchVideosWithPagination: (...args: unknown[]) => mockFetchVideos(...args),
}));

const mockGetHomeRails = jest.fn();
jest.mock('@/lib/api/discovery-home', () => ({
  getHomeRails: (...args: unknown[]) => mockGetHomeRails(...args),
}));

const mockGetHomeLibrary = jest.fn();
jest.mock('@/lib/api/home-library', () => ({
  getHomeLibrary: (...args: unknown[]) => mockGetHomeLibrary(...args),
}));

import HomePage from '../page';

const SIGNED_FEED = 'https://vz-1.b-cdn.net/feed1/thumbnail.jpg?token=abc&expires=1794603600';
const SIGNED_PRIV = 'https://vz-1.b-cdn.net/priv1/thumbnail.jpg?token=xyz&expires=1794603600';

const feedPage = {
  data: [
    { id: 'feed1', title: 'Public Feed Video', channelName: 'Lectures', thumbnailUrl: SIGNED_FEED, views: 10, isPublic: true },
  ],
  cursor: '',
};

const historyEntry = (videoId: string, videoThumbnail?: string) => ({
  id: `u1:${videoId}`,
  userId: 'u1',
  videoId,
  videoTitle: `Talk ${videoId}`,
  videoThumbnail,
  videoDuration: 600,
  channelId: 'c1',
  channelName: 'Noor',
  firstWatchedAt: '',
  lastWatchedAt: '',
  watchCount: 1,
  progress: 120,
  completed: false,
  percentageWatched: 20,
});

describe('HomePage Server Component (page.tsx) library assembly and timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchVideos.mockResolvedValue(feedPage);
    mockGetHomeRails.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes non-partial stable library cards above HomeHero with zero signed URLs (including a Continue-watching video not in the feed)', async () => {
    mockGetHomeLibrary.mockResolvedValueOnce({
      userId: 'u1',
      cards: [
        { kind: 'continue', top: historyEntry('old-pub-1', '/thumb/old-pub-1.jpg'), next: [], total: 2 },
        {
          kind: 'watch-later',
          top: { id: 'wl1', title: 'Saved', thumbnailUrl: SIGNED_FEED, channelName: 'Noor', views: 5, isPublic: true },
          next: [],
          total: 1,
          index: 0,
        },
      ],
    });

    const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });
    const { container } = render(element);

    const lib = screen.getByTestId('mock-library-row');
    const hero = container.querySelector('section.home-hero')!;
    expect(lib).toHaveAttribute('data-server', 'yes');
    expect(Boolean(lib.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const passed = mockLibraryRowProps.mock.calls[0][0];
    expect(passed.initialPartial).toBe(false);
    expect(passed.initialUserId).toBe('u1');
    expect(JSON.stringify(passed.initialCards)).not.toMatch(/token=|b-cdn/);
    expect(passed.initialCards[0].top.videoThumbnail).toBe('/thumb/old-pub-1.jpg');
    expect(passed.initialCards[1].top.thumbnailUrl).toBe('/thumb/wl1.jpg');
  });

  it('strips signed thumbnails for private videos and sets initialPartial: true', async () => {
    mockGetHomeLibrary.mockResolvedValueOnce({
      userId: 'u1',
      cards: [{ kind: 'continue', top: historyEntry('priv1', SIGNED_PRIV), next: [], total: 1 }],
    });

    const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });
    render(element);

    const passed = mockLibraryRowProps.mock.calls[0][0];
    expect(passed.initialPartial).toBe(true);
    expect(JSON.stringify(passed.initialCards)).not.toMatch(/token=|b-cdn/);
    expect(passed.initialCards[0].top.videoThumbnail).toBeUndefined();
  });

  it('falls back below the video grid when getHomeLibrary times out past FIRST_DATA_BUDGET_MS', async () => {
    jest.useFakeTimers();
    // Simulate a slow library backend that never answers within the SSR budget
    mockGetHomeLibrary.mockReturnValueOnce(new Promise(() => undefined));

    const pending = HomePage({ params: Promise.resolve({ locale: 'en' }) });
    await jest.advanceTimersByTimeAsync(FIRST_DATA_BUDGET_MS + 50);
    const element = await pending;
    const { container } = render(element);

    const lib = screen.getByTestId('mock-library-row');
    const hero = container.querySelector('section.home-hero')!;
    const grid = screen.getByTestId('video-grid');
    expect(lib).toHaveAttribute('data-server', 'no');
    expect(mockLibraryRowProps.mock.calls[0][0].initialCards).toBeUndefined();
    expect(Boolean(hero.compareDocumentPosition(lib) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(grid.compareDocumentPosition(lib) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
