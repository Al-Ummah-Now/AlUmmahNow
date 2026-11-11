import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      isRTL: isAr,
    };
  },
}));

let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/components/VideoThumbnail', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="thumb">{alt}</span>,
}));

jest.mock('@/services/api/watch-history', () => ({
  WatchHistoryService: { list: jest.fn(), getPaused: jest.fn() },
}));

import { WatchHistoryService } from '@/services/api/watch-history';
import { ContinueWatchingShelf, CONTINUE_WATCHING_LIMIT } from '../ContinueWatchingShelf';

const service = WatchHistoryService as jest.Mocked<typeof WatchHistoryService>;

const entry = (videoId: string, percentageWatched: number) => ({
  id: `u1:${videoId}`, userId: 'u1', videoId, videoTitle: `Lecture ${videoId}`, videoDuration: 600,
  channelId: 'c1', channelName: 'Noor', firstWatchedAt: '', lastWatchedAt: '', watchCount: 1,
  progress: 6 * percentageWatched, completed: false, percentageWatched,
});

/** Lets the shelf's load settle (it renders nothing until then, or for good). */
const settle = () => waitFor(() => expect(service.list).toHaveBeenCalled());

describe('ContinueWatchingShelf (#242)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a', 42.4), entry('b', 10)], total: 2, hasMore: false });
  });

  it('lists unfinished videos with their progress, linking to the watch page', async () => {
    render(<ContinueWatchingShelf />);
    expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeInTheDocument();
    expect(service.list).toHaveBeenCalledWith({ limit: CONTINUE_WATCHING_LIMIT, completed: false });

    const tiles = screen.getAllByTestId('continue-watching-video');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveAttribute('href', '/en/video/a');
    const bar = screen.getAllByRole('progressbar')[0];
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAccessibleName('42% watched');
  });

  it('is labelled in Arabic', async () => {
    mockLang = 'ar';
    render(<ContinueWatchingShelf />);
    expect(await screen.findByRole('heading', { name: 'متابعة المشاهدة' })).toBeInTheDocument();
    expect(screen.getAllByTestId('continue-watching-video')[0]).toHaveAttribute('href', '/ar/video/a');
  });

  it('renders nothing for a signed-out visitor and never calls the API', () => {
    mockUser = null;
    const { container } = render(<ContinueWatchingShelf />);
    expect(container).toBeEmptyDOMElement();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('is hidden while watch history is paused', async () => {
    service.getPaused.mockResolvedValue(true);
    const { container } = render(<ContinueWatchingShelf />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when the pause setting or the history cannot be loaded', async () => {
    service.getPaused.mockResolvedValue(null);
    const first = render(<ContinueWatchingShelf />);
    await settle();
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue(null);
    const second = render(<ContinueWatchingShelf />);
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });

  it('is hidden when there is nothing to continue', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    const { container } = render(<ContinueWatchingShelf />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});
