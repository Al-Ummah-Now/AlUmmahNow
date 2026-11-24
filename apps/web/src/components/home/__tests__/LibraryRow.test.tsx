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

jest.mock('@/services/api/library', () => ({
  LibraryService: { watchLater: jest.fn(), liked: jest.fn() },
}));

import { WatchHistoryService } from '@/services/api/watch-history';
import { LibraryService } from '@/services/api/library';
import { LibraryRow } from '../LibraryRow';

const service = WatchHistoryService as jest.Mocked<typeof WatchHistoryService>;
const library = LibraryService as jest.Mocked<typeof LibraryService>;

const video = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Video ${id}`, thumbnailUrl: `https://img/${id}.jpg`, channelName: 'Noor', ...extra }) as never;
const watchLaterPage = (items: unknown[], total: number, videoIds: string[]) => ({ items, total, nextCursor: null, playlistId: 'wl', videoIds }) as never;
const likedPage = (items: unknown[], total: number) => ({ items, total, nextCursor: null }) as never;
const EMPTY_WL = watchLaterPage([], 0, []);
const EMPTY_LL = likedPage([], 0);

const entry = (videoId: string, percentageWatched: number) => ({
  id: `u1:${videoId}`, userId: 'u1', videoId, videoTitle: `Talk ${videoId}`, videoDuration: 600, videoThumbnail: `https://img/${videoId}.jpg`,
  channelId: 'c1', channelName: 'Noor', firstWatchedAt: '', lastWatchedAt: '', watchCount: 1,
  progress: 6 * percentageWatched, completed: false, percentageWatched,
});

/** Lets the card's load settle (it renders nothing until then, or for good). */
const settle = async () => {
  await waitFor(() => expect(library.liked).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('LibraryRow: Continue watching card (#242, owner 2026-11-21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a', 42.4)], total: 7, hasMore: true });
    library.watchLater.mockResolvedValue(EMPTY_WL);
    library.liked.mockResolvedValue(EMPTY_LL);
  });

  it('is one card: the newest unfinished video on the cover, the count, its progress, links to the list and to resume', async () => {
    render(<LibraryRow />);
    const card = await screen.findByTestId('continue-watching-card');
    expect(service.list).toHaveBeenCalledWith({ limit: 3, completed: false });
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
    render(<LibraryRow />);
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
    render(<LibraryRow />);
    expect(await screen.findByTestId('continue-watching-card-count')).toHaveTextContent('1 video');
  });

  it('renders nothing for a signed-out visitor and never calls the API', () => {
    mockUser = null;
    const { container } = render(<LibraryRow />);
    expect(container).toBeEmptyDOMElement();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('is hidden while watch history is paused', async () => {
    service.getPaused.mockResolvedValue(true);
    const { container } = render(<LibraryRow />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when the pause setting or the history cannot be loaded', async () => {
    service.getPaused.mockResolvedValue(null);
    const first = render(<LibraryRow />);
    await settle();
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue(null);
    const second = render(<LibraryRow />);
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
    await settle();
    expect(second.container).toBeEmptyDOMElement();
  });

  it('is hidden, without an unhandled rejection, when a page has no entries array', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => void rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      service.list.mockResolvedValue({ total: 3, hasMore: false } as never);
      const { container } = render(<LibraryRow />);
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
    const { container } = render(<LibraryRow />);
    await waitFor(() => expect(mockWarn).toHaveBeenCalledWith('[LibraryRow] Could not load a library list', { list: 'continue', error: 'network down' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when there is nothing to continue', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    const { container } = render(<LibraryRow />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LibraryRow: Your library row with Watch later and Liked videos (owner 2026-11-22)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
    service.getPaused.mockResolvedValue(false);
    service.list.mockResolvedValue({ entries: [entry('a', 40)], total: 7, hasMore: true });
    // Watch later's stored order puts its first shown video at index 2
    library.watchLater.mockResolvedValue(watchLaterPage([video('w1')], 3, ['x', 'y', 'w1']));
    library.liked.mockResolvedValue(likedPage([video('l1', { titleLocalized: { en: 'Liked one', ar: 'المعجب الأول' }, channelNameLocalized: { ar: 'نور' } })], 12));
  });

  it('shows three cards in order under the "Your library" heading, with a See all link', async () => {
    render(<LibraryRow />);
    const row = await screen.findByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '3');
    expect(within(row).getByRole('heading', { level: 2, name: 'Your library' })).toBeInTheDocument();
    expect(screen.getByTestId('home-library-all')).toHaveAttribute('href', '/en/library');
    const items = [...row.querySelectorAll('.hlib-list > li')].map((li) => li.getAttribute('data-testid'));
    expect(items).toEqual(['continue-watching', 'home-library-watch-later', 'home-library-liked']);
    // Each list asks for its cover's video and the next two (a lone card's Up next)
    expect(library.watchLater).toHaveBeenCalledWith({ limit: 3 });
    expect(library.liked).toHaveBeenCalledWith({ limit: 3 });
  });

  it('Watch later: opens the list, counts it, and Play all starts its first video at its stored index', async () => {
    render(<LibraryRow />);
    const card = await screen.findByTestId('home-library-watch-later-card');
    expect(within(card).getByRole('heading', { name: 'Watch later' })).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/en/library/watch-later');
    expect(within(card).getByTestId('thumb')).toHaveAttribute('data-src', 'https://img/w1.jpg');
    expect(screen.getByTestId('home-library-watch-later-card-count')).toHaveTextContent('3 videos');
    // No progress bar on a saved list
    expect(card.querySelector('.plc-progress')).toBeNull();
    const lines = [...screen.getByTestId('home-library-watch-later-meta').querySelectorAll('[data-meta-part]')].map((e) => e.textContent);
    expect(lines).toEqual(['Video w1', 'Noor']);
    const play = screen.getByTestId('home-library-watch-later-play');
    expect(play).toHaveAttribute('href', '/en/video/w1?list=WL&index=2');
    expect(play).toHaveAccessibleName('Play all in Watch later');
    expect(card.contains(play)).toBe(false);
  });

  it('Liked videos in Arabic: the Arabic title and channel, «تشغيل الكل في …», list LL from the top', async () => {
    mockLang = 'ar';
    render(<LibraryRow />);
    const card = await screen.findByTestId('home-library-liked-card');
    expect(within(card).getByRole('heading', { name: 'المرئيات التي أعجبتك' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'مكتبتك' })).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/ar/library/liked');
    const lines = [...screen.getByTestId('home-library-liked-meta').querySelectorAll('[data-meta-part]')].map((e) => e.textContent);
    expect(lines).toEqual(['المعجب الأول', 'نور']);
    const play = screen.getByTestId('home-library-liked-play');
    expect(play).toHaveAttribute('href', '/ar/video/l1?list=LL&index=0');
    expect(play).toHaveAccessibleName('تشغيل الكل في المرئيات التي أعجبتك');
    expect(play).toHaveTextContent('تشغيل الكل');
  });

  it('lists the next videos of each list under "Up next" (shown when a card has the row to itself)', async () => {
    library.watchLater.mockResolvedValue(watchLaterPage([video('w1'), video('w2', { channelNameLocalized: { en: 'Seerah' } }), video('w3')], 3, ['w1', 'w2', 'w3']));
    service.list.mockResolvedValue({ entries: [entry('a', 40), entry('b', 72)], total: 2, hasMore: false });
    render(<LibraryRow />);
    const wl = await screen.findByTestId('home-library-watch-later-next');
    expect(within(wl).getByText('Up next')).toBeInTheDocument();
    const rows = [...wl.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['Video w2Seerah', 'Video w3Noor']);
    // Continue watching lists how far each next one was watched
    const cw = screen.getByTestId('continue-watching-next');
    expect(cw.querySelector('li')?.textContent).toBe('Talk b72%\u00a0watched');
    // Part of the card's link, never links of their own
    expect(wl.querySelector('a')).toBeNull();
    expect(screen.getByTestId('home-library-watch-later-card').contains(wl)).toBe(true);
    // A list with only its cover's video has no Up next
    expect(screen.queryByTestId('home-library-liked-next')).toBeNull();
  });

  it('leaves out an empty list and the rest share the row', async () => {
    library.watchLater.mockResolvedValue(EMPTY_WL);
    render(<LibraryRow />);
    const row = await screen.findByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '2');
    expect(row.querySelector('.hlib-list')).toHaveAttribute('data-count', '2');
    expect(screen.queryByTestId('home-library-watch-later')).toBeNull();
  });

  it('one list left: a single card', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    library.watchLater.mockResolvedValue(EMPTY_WL);
    render(<LibraryRow />);
    const row = await screen.findByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('home-library-liked')).toBeInTheDocument();
  });

  it('no row when all three are empty', async () => {
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });
    library.watchLater.mockResolvedValue(EMPTY_WL);
    library.liked.mockResolvedValue(EMPTY_LL);
    const { container } = render(<LibraryRow />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('paused history drops only Continue watching', async () => {
    service.getPaused.mockResolvedValue(true);
    render(<LibraryRow />);
    const row = await screen.findByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '2');
    expect(screen.queryByTestId('continue-watching')).toBeNull();
  });

  it('a list that fails to load is left out (logged), the others still show', async () => {
    library.watchLater.mockRejectedValue(new Error('offline'));
    library.liked.mockResolvedValue(null as never);
    render(<LibraryRow />);
    const row = await screen.findByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '1');
    expect(mockWarn).toHaveBeenCalledWith('[LibraryRow] Could not load a library list', { list: 'watch-later', error: 'offline' });
  });

  it('shows nothing until every list has settled (no card-by-card growth)', async () => {
    let finishLiked: (value: unknown) => void = () => undefined;
    library.liked.mockReturnValue(new Promise((resolve) => (finishLiked = resolve)) as never);
    const { container } = render(<LibraryRow />);
    await waitFor(() => expect(library.watchLater).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    finishLiked(likedPage([video('l1')], 1));
    expect(await screen.findByTestId('home-library')).toHaveAttribute('data-count', '3');
  });

  it('signed out: no row and no requests', () => {
    mockUser = null;
    const { container } = render(<LibraryRow />);
    expect(container).toBeEmptyDOMElement();
    expect(library.watchLater).not.toHaveBeenCalled();
    expect(library.liked).not.toHaveBeenCalled();
  });

  it('renders server-loaded initialCards immediately on first paint without client requests', () => {
    const initialCards = [
      { kind: 'continue' as const, top: entry('a', 40), next: [], total: 7 },
      { kind: 'watch-later' as const, top: video('w1'), next: [], total: 3, index: 2 },
    ];
    render(<LibraryRow initialCards={initialCards} initialUserId="u1" />);
    const row = screen.getByTestId('home-library');
    expect(row).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('continue-watching-card')).toBeInTheDocument();
    expect(screen.getByTestId('home-library-watch-later-card')).toBeInTheDocument();
    expect(service.getPaused).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
    expect(library.watchLater).not.toHaveBeenCalled();
    expect(library.liked).not.toHaveBeenCalled();
  });

  it('renders nothing and makes zero requests when server confirmed an empty library ([])', () => {
    const { container } = render(<LibraryRow initialCards={[]} initialUserId="u1" />);
    expect(container).toBeEmptyDOMElement();
    expect(service.getPaused).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
    expect(library.watchLater).not.toHaveBeenCalled();
    expect(library.liked).not.toHaveBeenCalled();
  });

  it('refreshes stripped thumbnails in place when initialPartial is true without changing card count', async () => {
    const initialCards = [
      { kind: 'continue' as const, top: { ...entry('a', 40), videoThumbnail: undefined }, next: [], total: 7 },
    ];
    render(<LibraryRow initialCards={initialCards} initialPartial initialUserId="u1" />);
    // Present synchronously on first paint with its card frame intact
    expect(screen.getByTestId('home-library')).toHaveAttribute('data-count', '1');
    // Background refresh fills the thumbnail in place without adding the other cards that arrived late
    await waitFor(() =>
      expect(within(screen.getByTestId('continue-watching-card')).getByTestId('thumb')).toHaveAttribute('data-src', 'https://img/a.jpg'),
    );
    expect(screen.getByTestId('home-library')).toHaveAttribute('data-count', '1');
    expect(screen.queryByTestId('home-library-watch-later')).toBeNull();
  });

  it('never shows another user’s initialCards after a client-side account switch', async () => {
    mockUser = { id: 'u2' };
    const u1Cards = [{ kind: 'watch-later' as const, top: video('u1-only'), next: [], total: 1, index: 0 }];
    library.watchLater.mockResolvedValue(EMPTY_WL);
    library.liked.mockResolvedValue(EMPTY_LL);
    service.list.mockResolvedValue({ entries: [], total: 0, hasMore: false });

    const { container } = render(<LibraryRow initialCards={u1Cards} initialUserId="u1" />);
    expect(screen.queryByTestId('home-library-watch-later')).toBeNull();
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});
