import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';

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
  THUMBNAIL_16_9: {},
  default: ({ src, children }: { src?: string; children?: React.ReactNode }) => (
    <span data-testid="thumb" data-src={src}>
      {children}
    </span>
  ),
}));

const mockWarn = jest.fn();
jest.mock('@/lib/logger-client', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/services/api/watch-history', () => ({
  ...jest.requireActual('@/services/api/watch-history'),
  WatchHistoryService: { list: jest.fn(), getPaused: jest.fn() },
}));

import { WatchHistoryService } from '@/services/api/watch-history';
import { ContinueWatchingShelf } from '../ContinueWatchingShelf';

const service = WatchHistoryService as jest.Mocked<typeof WatchHistoryService>;

const entry = (videoId: string, percentageWatched: number) => ({
  id: `u1:${videoId}`, userId: 'u1', videoId, videoTitle: `Talk ${videoId}`, videoDuration: 600, videoThumbnail: `https://img/${videoId}.jpg`,
  channelId: 'c1', channelName: 'Noor', firstWatchedAt: '', lastWatchedAt: '', watchCount: 1,
  progress: 6 * percentageWatched, completed: false, percentageWatched,
});

/** Lets the card's load settle (it renders nothing until then, or for good). */
const settle = () => waitFor(() => expect(service.list).toHaveBeenCalled());

describe('ContinueWatchingShelf: one playlist-style card (#242, owner 2026-11-21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a', 42.4)], total: 7, hasMore: true });
  });

  it('is one card: the newest unfinished video on the cover, the count, its progress, links to the list and to resume', async () => {
    render(<ContinueWatchingShelf />);
    const card = await screen.findByTestId('continue-watching-card');
    expect(service.list).toHaveBeenCalledWith({ limit: 1, completed: false });
    expect(screen.getAllByTestId('continue-watching-card')).toHaveLength(1);
    expect(screen.queryByTestId('continue-watching-video')).toBeNull();

    expect(within(card).getByRole('heading', { name: 'Continue watching' })).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/en/history?view=continue');
    expect(within(card).getByTestId('thumb')).toHaveAttribute('data-src', 'https://img/a.jpg');
    expect(screen.getByTestId('continue-watching-card-count')).toHaveTextContent('7 videos');
    expect(card.querySelector('.plc-progress > span')).toHaveStyle({ inlineSize: '42%' });
    // Title and progress stack, one per line: no separator left at a line edge
    const lines = [...screen.getByTestId('continue-watching-meta').querySelectorAll('[data-meta-part]')].map((e) => e.textContent);
    expect(lines).toEqual(['Talk a', '42%\u00a0watched']);
    expect(screen.getByTestId('continue-watching-meta').textContent).not.toMatch(/[•·]/);

    const resume = screen.getByTestId('continue-watching-resume');
    expect(resume).toHaveAttribute('href', '/en/video/a');
    expect(resume).toHaveAccessibleName('Resume Talk a');
    // Its own link, never nested in the card's link
    expect(card.contains(resume)).toBe(false);
  });

  it('in Arabic: the Arabic title, ungrouped compact count (the shared formatter, #1665), title and progress on their own lines', async () => {
    mockLang = 'ar';
    service.list.mockResolvedValue({
      entries: [{ ...entry('a', 42), videoTitleLocalized: { en: 'Weak Hadith 1', ar: 'سلسلة الحديث الضعيف ١' } }],
      total: 4800,
      hasMore: true,
    });
    render(<ContinueWatchingShelf />);
    const card = await screen.findByTestId('continue-watching-card');
    expect(within(card).getByRole('heading', { name: 'متابعة المشاهدة' })).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/ar/history?view=continue');
    // Direction marks and no-break spaces read as plain spaces
    const count = (screen.getByTestId('continue-watching-card-count').textContent ?? '').replace(/[\u00a0\u061c\u200e\u200f\u202f]/g, ' ').replace(/ +/g, ' ');
    expect(count).toMatch(/^٤٫٨ ألف/);
    expect(count).not.toMatch(/[,،٬]/);
    const raw = screen.getByTestId('continue-watching-meta').textContent ?? '';
    // The number never leaves the word before it: «مشاهدة\u00a0٤٢٪»
    expect(raw).toContain('مشاهدة\u00a0٤٢٪');
    const lines = [...screen.getByTestId('continue-watching-meta').querySelectorAll('[data-meta-part]')].map((e) => (e.textContent ?? '').replace(/\u00a0/g, ' '));
    expect(lines).toEqual(['سلسلة الحديث الضعيف ١', 'تمت مشاهدة ٤٢٪']);
    expect(raw).not.toMatch(/[•·]/);
    expect(screen.getByTestId('continue-watching-resume')).toHaveAttribute('href', '/ar/video/a');
    expect(screen.getByTestId('continue-watching-resume')).toHaveTextContent('تابِع');
  });

  it('counts one when the page has no total', async () => {
    service.list.mockResolvedValue({ entries: [entry('a', 10)], total: 0, hasMore: false });
    render(<ContinueWatchingShelf />);
    expect(await screen.findByTestId('continue-watching-card-count')).toHaveTextContent('1 video');
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

  it('is hidden, without an unhandled rejection, when a page has no entries array', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => void rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      service.list.mockResolvedValue({ total: 3, hasMore: false } as never);
      const { container } = render(<ContinueWatchingShelf />);
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(container).toBeEmptyDOMElement();
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('is hidden and logs a warning when loading rejects', async () => {
    service.list.mockRejectedValue(new Error('network down'));
    const { container } = render(<ContinueWatchingShelf />);
    await waitFor(() => expect(mockWarn).toHaveBeenCalledWith('[ContinueWatchingShelf] Could not load continue watching', { error: 'network down' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when there is nothing to continue', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    const { container } = render(<ContinueWatchingShelf />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});
